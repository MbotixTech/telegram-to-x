const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const imageWatermark = require('./imageWatermark');
const captionBuilder = require('./captionBuilder');
const twitterPoster = require('./twitterPoster');
const telegramLogger = require('./telegramLogger');
const cleanup = require('./cleanup');

class TelegramListener {
  constructor() {
    this.bot = null;
    this.queueManager = null;
    this.mediaGroups = new Map(); // Store media group messages
    this.mediaGroupTimers = new Map(); // Timers for processing media groups
  }

  setQueueManager(queueManager) {
    this.queueManager = queueManager;
  }

  async start() {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    
    // Add error handling for polling
    this.bot.on('polling_error', (error) => {
      console.error('❌ Polling error:', error);
    });
    
    // Add webhook error handling
    this.bot.on('webhook_error', (error) => {
      console.error('❌ Webhook error:', error);
    });
    
    this.bot.on('message', async (message) => {
      try {
        console.log('🔔 Bot received a message event!');
        await this.handleNewMessage(message);
      } catch (error) {
        console.error('Error handling message:', error);
        await telegramLogger.logError(`Error handling message: ${error.message}`);
      }
    });
    
    // Test if bot can receive any messages at all
    this.bot.on('channel_post', async (message) => {
      try {
        console.log('📢 Bot received a channel post!');
        await this.handleNewMessage(message);
      } catch (error) {
        console.error('Error handling channel post:', error);
        await telegramLogger.logError(`Error handling channel post: ${error.message}`);
      }
    });

    console.log('🤖 Telegram bot initialized and listening...');
    await telegramLogger.logInfo('Telegram bot initialized and listening');
    
    // Test bot connection
    try {
      const me = await this.bot.getMe();
      console.log(`✅ Bot connected successfully: @${me.username} (${me.first_name})`);
    } catch (error) {
      console.error('❌ Failed to get bot info:', error);
    }
  }

  async initialize(queueManager) {
    this.queueManager = queueManager;
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    
    this.bot.on('message', async (message) => {
      try {
        await this.handleNewMessage(message);
      } catch (error) {
        console.error('Error handling message:', error);
        await telegramLogger.logError(`Error handling message: ${error.message}`);
      }
    });

    console.log('🤖 Telegram bot initialized and listening...');
    await telegramLogger.logInfo('Telegram bot initialized and listening');
  }

  async handleNewMessage(message) {
    // Debug logging - log ALL messages received
    console.log(`📨 Received message from chat ID: ${message.chat?.id}, type: ${message.chat?.type}, title: ${message.chat?.title}`);
    console.log(`📋 Message details:`, {
      messageId: message.message_id,
      date: new Date(message.date * 1000).toISOString(),
      hasPhoto: !!message.photo,
      hasMediaGroup: !!message.media_group_id,
      caption: message.caption || 'No caption',
      from: message.from?.username || 'Unknown'
    });
    
    // Check if message is from allowed channel
    if (!this.isFromAllowedChannel(message)) {
      console.log(`❌ Message rejected - not from allowed channel. Chat ID: ${message.chat?.id}`);
      console.log(`📋 Allowed channels: ${JSON.stringify(config.telegram.allowedChannels)}`);
      return;
    }
    
    console.log(`✅ Message accepted from allowed channel: ${this.getChannelName(message)}`);

    // Check if message has photos
    if (message.photo || message.media_group_id) {
      // Handle media group messages
      if (message.media_group_id) {
        await this.handleMediaGroupMessage(message);
        return;
      }
      
      // Handle single image messages
      const images = await this.extractImages(message);
      if (images.length > 0) {
        const postData = {
          images,
          caption: message.caption || '',
          channelName: this.getChannelName(message)
        };

        if (config.app.useQueue) {
          await this.addToQueue(postData);
        } else {
          await this.processAndPost(postData);
        }
      }
    }
  }

  async handleMediaGroupMessage(message) {
    const mediaGroupId = message.media_group_id;
    
    // Initialize media group if not exists
    if (!this.mediaGroups.has(mediaGroupId)) {
      this.mediaGroups.set(mediaGroupId, []);
    }
    
    // Add message to media group
    this.mediaGroups.get(mediaGroupId).push(message);
    
    console.log(`📸 Added message to media group ${mediaGroupId} (${this.mediaGroups.get(mediaGroupId).length} messages)`);
    
    // Clear existing timer
    if (this.mediaGroupTimers.has(mediaGroupId)) {
      clearTimeout(this.mediaGroupTimers.get(mediaGroupId));
    }
    
    // Set timer to process media group after 2 seconds of no new messages
    const timer = setTimeout(async () => {
      await this.processMediaGroup(mediaGroupId);
    }, 2000);
    
    this.mediaGroupTimers.set(mediaGroupId, timer);
  }
  
  async processMediaGroup(mediaGroupId) {
    try {
      const messages = this.mediaGroups.get(mediaGroupId);
      if (!messages || messages.length === 0) {
        return;
      }
      
      console.log(`🔄 Processing media group ${mediaGroupId} with ${messages.length} messages`);
      
      // Extract all images from the media group
      const allImages = [];
      let caption = '';
      let channelName = '';
      
      for (const message of messages) {
        const images = await this.extractImages(message);
        allImages.push(...images);
        
        // Use caption from first message that has one
        if (!caption && message.caption) {
          caption = message.caption;
        }
        
        // Get channel name
        if (!channelName) {
          channelName = this.getChannelName(message);
        }
      }
      
      // Limit images per post
      const limitedImages = allImages.slice(0, config.app.maxImagesPerPost);
      
      if (limitedImages.length > 0) {
        const postData = {
          images: limitedImages,
          caption: caption || '',
          channelName
        };

        if (config.app.useQueue) {
          await this.addToQueue(postData);
        } else {
          await this.processAndPost(postData);
        }
      }
      
      // Cleanup
      this.mediaGroups.delete(mediaGroupId);
      this.mediaGroupTimers.delete(mediaGroupId);
      
    } catch (error) {
      console.error(`Error processing media group ${mediaGroupId}:`, error);
      await telegramLogger.logError(`Error processing media group: ${error.message}`);
    }
  }

  async extractImages(message) {
    const images = [];
    
    try {
      if (message.photo) {
        // Get the highest resolution photo
        const photo = message.photo[message.photo.length - 1];
        const fileLink = await this.bot.getFileLink(photo.file_id);
        
        // Download image to temp folder
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 15);
        const fileName = `image_${timestamp}_${randomId}.jpg`;
        const imagePath = path.join(config.paths.temp, fileName);
        
        await this.downloadImage(fileLink, imagePath);
        images.push(imagePath);
        
        console.log(`📥 Downloaded image: ${fileName}`);
      }
    } catch (error) {
      console.error('Error extracting images:', error);
      await telegramLogger.logError(`Error extracting images: ${error.message}`);
    }
    
    // Limit the number of images
    return images.slice(0, config.app.maxImagesPerPost);
  }

  async downloadImage(url, filePath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    await fs.ensureDir(path.dirname(filePath));
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  isFromAllowedChannel(message) {
    if (!message.chat) return false;
    
    const chatId = message.chat.id.toString();
    const allowedChannels = config.telegram.allowedChannels;
    
    return allowedChannels.includes(chatId);
  }

  getChannelName(message) {
    if (!message.chat) return 'Unknown';
    return message.chat.title || message.chat.username || 'Unknown';
  }

  async addToQueue(postData) {
    try {
      await this.queueManager.addToQueue(postData);
      console.log(`📋 Added post to queue with ${postData.images.length} image(s)`);
      await telegramLogger.logInfo(`Added post to queue with ${postData.images.length} image(s)`);
    } catch (error) {
      console.error('Error adding to queue:', error);
      await telegramLogger.logError(`Error adding to queue: ${error.message}`);
    }
  }

  async processAndPost(postData) {
    let watermarkedImages = [];
    
    try {
      console.log(`🔄 Processing ${postData.images.length} image(s) for posting...`);
      
      // Get watermarked images (use existing or create new)
      watermarkedImages = await this.getWatermarkedImages(postData.images);
      
      if (watermarkedImages.length === 0) {
        throw new Error('No watermarked images available');
      }
      
      // Extract channel hashtags from original caption if present
      const channelHashtags = [];
      if (postData.caption) {
        const hashtagMatches = postData.caption.match(/#[a-zA-Z0-9_]+/g);
        if (hashtagMatches) {
          channelHashtags.push(...hashtagMatches);
        }
      }
      
      // Build caption with hashtags using the first watermarked image
      const finalCaption = await captionBuilder.buildCaption(
        postData.caption,
        watermarkedImages[0], // Use first image for AI analysis
        channelHashtags
      );
      
      // Post to Twitter
      const success = await twitterPoster.postTweet(watermarkedImages, finalCaption);
      
      if (success) {
        console.log('✅ Successfully posted to Twitter');
        await telegramLogger.logSuccess('Successfully posted to Twitter');
      } else {
        throw new Error('Failed to post to Twitter');
      }
      
    } catch (error) {
      console.error('Error processing and posting:', error);
      await telegramLogger.logError(`Error processing and posting: ${error.message}`);
    } finally {
      // Cleanup temp files if enabled
      if (config.app.tempCleanupEnabled) {
        try {
          // Clean up original temp images
          for (const imagePath of postData.images) {
            if (await fs.pathExists(imagePath)) {
              await fs.remove(imagePath);
              console.log(`🗑️ Cleaned up temp file: ${path.basename(imagePath)}`);
            }
          }
          
          // Note: We don't clean up watermarked images as they're in the output folder
          // and might be reused for future posts
        } catch (cleanupError) {
          console.error('Error during cleanup:', cleanupError);
        }
      }
    }
  }

  async getWatermarkedImages(imagePaths) {
    const watermarkedImages = [];
    
    for (const imagePath of imagePaths) {
      try {
        const fileName = path.basename(imagePath, path.extname(imagePath));
        const watermarkedFileName = `${fileName}_watermarked.jpg`;
        const watermarkedPath = path.join(config.paths.output, watermarkedFileName);
        
        // Check if watermarked version already exists
        if (await fs.pathExists(watermarkedPath)) {
          console.log(`♻️ Using existing watermarked image: ${watermarkedFileName}`);
          watermarkedImages.push(watermarkedPath);
        } else {
          // Create new watermarked image
          console.log(`🎨 Creating watermark for: ${path.basename(imagePath)}`);
          const newWatermarkedPath = await imageWatermark.addWatermark(imagePath);
          
          if (newWatermarkedPath && await fs.pathExists(newWatermarkedPath)) {
            watermarkedImages.push(newWatermarkedPath);
            console.log(`✅ Watermark created: ${path.basename(newWatermarkedPath)}`);
          } else {
            console.warn(`⚠️ Failed to create watermark for: ${path.basename(imagePath)}`);
            // Fallback: use original image if watermarking fails
            watermarkedImages.push(imagePath);
          }
        }
      } catch (error) {
        console.error(`Error processing watermark for ${imagePath}:`, error);
        // Fallback: use original image
        watermarkedImages.push(imagePath);
      }
    }
    
    return watermarkedImages;
  }

  async stop() {
    if (this.bot) {
      await this.bot.stopPolling();
      console.log('🛑 Telegram bot stopped');
    }
    
    // Clear all media group timers
    for (const timer of this.mediaGroupTimers.values()) {
      clearTimeout(timer);
    }
    this.mediaGroupTimers.clear();
    this.mediaGroups.clear();
  }
}

module.exports = TelegramListener;