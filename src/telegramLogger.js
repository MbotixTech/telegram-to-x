const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const path = require('path');
const fs = require('fs-extra');

class TelegramLogger {
  constructor() {
    this.bot = null;
    this.isInitialized = false;
    this.isInitializing = false;
    this.messageQueue = [];
    this.isProcessingQueue = false;
  }

  async initialize() {
    try {
      if (this.isInitialized || this.isInitializing) {
        return;
      }
      
      this.isInitializing = true;
      console.log('📱 Initializing Telegram logger...');
      
      // Initialize Telegram bot for logging
      this.bot = new TelegramBot(config.telegram.botToken);
      
      // Test bot connection
      const me = await this.bot.getMe();
      console.log(`✅ Logger bot connected as: ${me.first_name} (@${me.username})`);
      
      this.isInitialized = true;
      this.isInitializing = false;
      console.log('✅ Telegram logger initialized successfully!');
      
      // Process any queued messages
      setImmediate(() => this.processMessageQueue());
      
    } catch (error) {
      this.isInitializing = false;
      console.error('❌ Failed to initialize Telegram logger:', error);
      // Don't throw error, just log it - logging should be optional
    }
  }

  async log(message, level = 'info', options = {}) {
    try {
      const logMessage = {
        text: this.formatLogMessage(message, level),
        timestamp: new Date().toISOString(),
        level: level,
        ...options
      };
      
      // Add to queue
      this.messageQueue.push(logMessage);
      
      // Initialize if not done yet
      if (!this.isInitialized && !this.isInitializing) {
        await this.initialize();
        return; // Don't process queue during initialization to avoid recursion
      }
      
      // If still initializing, just queue the message
      if (this.isInitializing) {
        return;
      }
      
      // Process queue
      setImmediate(() => this.processMessageQueue());
      
    } catch (error) {
      console.error('❌ Error sending log message:', error);
      // Fallback to console log
      console.log('📋 LOG:', message);
    }
  }

  async processMessageQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    try {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        await this.sendMessageToGroup(message);
        
        // Small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('❌ Error processing message queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  async sendMessageToGroup(messageObj) {
    try {
      if (!this.bot || !this.isInitialized) {
        console.log('⚠️ Telegram logger not initialized, skipping log message');
        return;
      }
      
      if (!config.telegram.logGroupId) {
        console.log('⚠️ Log group ID not configured, skipping log message');
        return;
      }
      
      await this.bot.sendMessage(config.telegram.logGroupId, messageObj.text, {
        parse_mode: 'HTML'
      });
      
      console.log('📤 Log sent to Telegram group');
      
    } catch (error) {
      console.error('❌ Error sending message to group:', error.message);
      
      // Handle specific Telegram errors
      if (error.message.includes('chat not found')) {
        console.log('⚠️ Log group not found. Please check if:');
        console.log('   1. The bot is added to the group');
        console.log('   2. The group ID is correct');
        console.log('   3. The group still exists');
        console.log('📋 Fallback LOG:', messageObj.text.replace(/<[^>]*>/g, ''));
        return; // Don't retry for this error
      }
      
      // Re-add to queue for retry if it's a temporary error
      if (error.message.includes('FLOOD_WAIT') || error.message.includes('network')) {
        this.messageQueue.unshift(messageObj);
      } else {
        // For other errors, just log to console as fallback
        console.log('📋 Fallback LOG:', messageObj.text.replace(/<[^>]*>/g, ''));
      }
    }
  }

  formatLogMessage(message, level = 'info') {
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const levelEmojis = {
      'info': 'ℹ️',
      'warning': '⚠️',
      'error': '❌',
      'success': '✅',
      'debug': '🐛'
    };
    
    const emoji = levelEmojis[level] || 'ℹ️';
    
    return `<b>🤖 Muse AutoPost</b> ${emoji}\n<i>${timestamp} EST</i>\n\n${message}`;
  }

  async sendSuccessLog(tweetUrl, imageCount = 1) {
    const message = `✅ <b>Post Successful!</b>\n\n` +
                   `📸 Images: ${imageCount}\n` +
                   `🐦 Tweet: <a href="${tweetUrl}">View Tweet</a>\n` +
                   `📍 Location: ${config.constants.twitterLocation}`;
    
    await this.sendLog(message);
  }

  async sendErrorLog(error, context = '') {
    const message = `❌ <b>Error Occurred</b>\n\n` +
                   `📍 Context: ${context}\n` +
                   `🚨 Error: <code>${error.message}</code>\n` +
                   `⏰ Time: ${new Date().toLocaleString()}`;
    
    await this.sendLog(message);
  }

  async sendStartupLog() {
    const message = `🚀 <b>Muse AutoPost Started</b>\n\n` +
                   `📱 Monitoring: Channel ${config.telegram.channelId}\n` +
                   `🐦 Twitter: @${config.twitter.username}\n` +
                   `⚙️ Status: Ready for posts`;
    
    await this.sendLog(message);
  }

  async sendShutdownLog() {
    const message = `🛑 <b>Muse AutoPost Shutdown</b>\n\n` +
                   `⏰ Time: ${new Date().toLocaleString()}\n` +
                   `📊 Status: Service stopped`;
    
    await this.sendLog(message);
  }

  async sendProcessingLog(imageCount) {
    const message = `🔄 <b>Processing Images</b>\n\n` +
                   `📸 Images found: ${imageCount}\n` +
                   `⚙️ Status: Adding watermarks and building caption...`;
    
    await this.sendLog(message);
  }

  async sendTestLog() {
    const message = `🧪 <b>Test Message</b>\n\n` +
                   `✅ Telegram logger is working correctly\n` +
                   `⏰ Time: ${new Date().toLocaleString()}`;
    
    await this.sendLog(message);
  }

  async sendStatsLog(stats) {
    const message = `📊 <b>Daily Stats</b>\n\n` +
                   `✅ Successful posts: ${stats.successful || 0}\n` +
                   `❌ Failed posts: ${stats.failed || 0}\n` +
                   `📸 Images processed: ${stats.imagesProcessed || 0}\n` +
                   `🏷️ Hashtags used: ${stats.hashtagsUsed || 0}\n` +
                   `⏰ Last post: ${stats.lastPost || 'N/A'}`;
    
    await this.sendLog(message);
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
        this.isInitialized = false;
        console.log('📱 Telegram logger disconnected');
      }
    } catch (error) {
      console.error('❌ Error disconnecting Telegram logger:', error);
    }
  }

  async testConnection() {
    try {
      await this.initialize();
      await this.sendTestLog();
      console.log('✅ Telegram logger test successful');
      return true;
    } catch (error) {
      console.error('❌ Telegram logger test failed:', error);
      return false;
    }
  }

  // Utility method to send custom formatted messages
  async sendCustomLog(title, details, emoji = '📋') {
    const message = `${emoji} <b>${title}</b>\n\n${details}`;
    await this.sendLog(message);
  }

  // Method to send photos with captions
  async sendPhoto(photoPath, caption = '', level = 'info') {
    try {
      if (!this.bot || !this.isInitialized) {
        console.log('⚠️ Telegram logger not initialized, skipping photo');
        return;
      }
      
      if (!config.telegram.logGroupId) {
        console.log('⚠️ Log group ID not configured, skipping photo');
        return;
      }
      
      if (!await fs.pathExists(photoPath)) {
        console.log('⚠️ Photo file not found:', photoPath);
        return;
      }
      
      // Check file size and dimensions before sending
      const stats = await fs.stat(photoPath);
      if (stats.size === 0) {
        console.log('⚠️ Photo file is empty, skipping:', photoPath);
        return;
      }
      
      // Check if file size is too large (Telegram limit is 10MB for photos)
      if (stats.size > 10 * 1024 * 1024) {
        console.log('⚠️ Photo file too large for Telegram, skipping:', photoPath);
        await this.log(`📸 Photo file too large: ${path.basename(photoPath)} (${Math.round(stats.size / 1024 / 1024)}MB)`, 'warning');
        return;
      }
      
      const formattedCaption = this.formatLogMessage(caption, level);
      
      // Detect file type from extension
      const ext = path.extname(photoPath).toLowerCase();
      let contentType = 'image/png'; // default
      
      switch (ext) {
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
        case '.webp':
          contentType = 'image/webp';
          break;
        default:
          console.log(`⚠️ Unknown image format: ${ext}, using default PNG content type`);
      }
      
      // Read file and send with proper content type
      const photoBuffer = await fs.readFile(photoPath);
      
      // Validate that buffer is not empty
      if (photoBuffer.length === 0) {
        console.log('⚠️ Photo buffer is empty, skipping:', photoPath);
        return;
      }
      
      await this.bot.sendPhoto(config.telegram.logGroupId, photoBuffer, {
        caption: formattedCaption,
        parse_mode: 'HTML'
      }, {
        filename: path.basename(photoPath),
        contentType: contentType
      });
      
      console.log('📸 Photo sent to Telegram group');
      
    } catch (error) {
      console.error('❌ Error sending photo to group:', error.message);
      
      // If it's a dimension error, try to provide more helpful info
      if (error.message.includes('PHOTO_INVALID_DIMENSIONS')) {
        console.log('📏 Photo has invalid dimensions for Telegram. Telegram requires photos to be at least 1x1 pixels and no more than 10000x10000 pixels.');
      }
      
      // Fallback to text message
      await this.log(`📸 Failed to send photo: ${path.basename(photoPath)}\n${caption}\nError: ${error.message}`, 'error');
    }
  }
  
  // Legacy method for backward compatibility
  async sendLog(message, options = {}) {
    return await this.log(message, 'info', options);
  }
  
  // Method to send logs with different priority levels (legacy)
  async sendPriorityLog(level, message) {
    return await this.log(message, level);
  }

  // Convenience methods for different log levels
  async logInfo(message, options = {}) {
    return await this.log(message, 'info', options);
  }

  async logError(message, options = {}) {
    return await this.log(message, 'error', options);
  }

  async logWarning(message, options = {}) {
    return await this.log(message, 'warning', options);
  }

  async logSuccess(message, options = {}) {
    return await this.log(message, 'success', options);
  }
}

module.exports = new TelegramLogger();