const fs = require('fs-extra');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const hashtagFetcher = require('./hashtagFetcher');
const hashtagFilter = require('./hashtagFilter');

class CaptionBuilder {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async buildCaption(originalCaption, imagePath, channelHashtags = []) {
    try {
      console.log('📝 Building caption...');
      
      let caption = '';
      let cleanCaption = '';
      let originalHashtags = [];
      
      // Extract hashtags from original caption
      if (originalCaption && originalCaption.trim()) {
        const hashtagMatches = originalCaption.match(/#[a-zA-Z0-9_]+/g);
        originalHashtags = hashtagMatches || [];
        cleanCaption = originalCaption.replace(/#[a-zA-Z0-9_]+/g, '').trim();
      }
      
      // Determine scenario based on what we have
      const hasCaption = cleanCaption && cleanCaption.length > 0;
      const hasHashtags = originalHashtags.length > 0;
      
      console.log(`📊 Content analysis: Caption=${hasCaption}, Hashtags=${hasHashtags}`);
      
      if (hasCaption && hasHashtags) {
        // Scenario 1: Both caption and hashtags present
        console.log('📝 Scenario 1: Caption + Hashtags - Analyzing caption spiciness...');
        const isSpicy = await this.analyzeCaptionSpiciness(cleanCaption);
        
        if (isSpicy) {
          console.log('🌶️ Caption is already spicy, using as-is');
          caption = cleanCaption;
        } else {
          console.log('🔥 Caption needs more spice, enhancing...');
          caption = await this.enhanceCaptionSpiciness(cleanCaption);
        }
        
        // Build hashtags: channel hashtags + trending
        const hashtags = await this.buildHashtags([...channelHashtags, ...originalHashtags]);
        return this.combineWithHashtags(caption, hashtags);
        
      } else if (!hasCaption && hasHashtags) {
        // Scenario 2: Only hashtags, no caption
        console.log('📝 Scenario 2: Only Hashtags - Generating spicy caption...');
        caption = await this.generateSpicyCaption(imagePath);
        
        // Build hashtags: channel hashtags + trending
        const hashtags = await this.buildHashtags([...channelHashtags, ...originalHashtags]);
        return this.combineWithHashtags(caption, hashtags);
        
      } else if (hasCaption && !hasHashtags) {
        // Scenario 3: Only caption, no hashtags
        console.log('📝 Scenario 3: Only Caption - Analyzing and using trending hashtags...');
        const isSpicy = await this.analyzeCaptionSpiciness(cleanCaption);
        
        if (isSpicy) {
          console.log('🌶️ Caption is already spicy, using as-is');
          caption = cleanCaption;
        } else {
          console.log('🔥 Caption needs more spice, enhancing...');
          caption = await this.enhanceCaptionSpiciness(cleanCaption);
        }
        
        // Build hashtags: 100% from trending (no channel hashtags)
        const hashtags = await this.buildHashtags([]);
        return this.combineWithHashtags(caption, hashtags);
        
      } else {
        // Scenario 4: No caption, no hashtags
        console.log('📝 Scenario 4: Empty - Generating everything spicy...');
        caption = await this.generateSpicyCaption(imagePath);
        
        // Build hashtags: trending only
        const hashtags = await this.buildHashtags([]);
        return this.combineWithHashtags(caption, hashtags);
      }
      
    } catch (error) {
      console.error('❌ Error building caption:', error);
      // Fallback to basic caption
      return this.getFallbackCaption();
    }
  }

  async getRandomPresetCaption() {
    try {
      if (!await fs.pathExists(config.paths.presets.captions)) {
        console.log('📝 No preset captions file found');
        return null;
      }
      
      const presets = await fs.readJson(config.paths.presets.captions);
      
      if (!presets.captions || presets.captions.length === 0) {
        console.log('📝 No preset captions available');
        return null;
      }
      
      const randomCaption = presets.captions[Math.floor(Math.random() * presets.captions.length)];
      console.log('✅ Using preset caption');
      return randomCaption;
      
    } catch (error) {
      console.error('❌ Error reading preset captions:', error);
      return null;
    }
  }

  async generateAICaption(imagePath) {
    try {
      if (!config.gemini.apiKey) {
        throw new Error('Gemini API key not configured');
      }
      
      // Read image file
      const imageBuffer = await fs.readFile(imagePath);
      const imageBase64 = imageBuffer.toString('base64');
      
      const prompt = `
Analyze this image and write a short, captivating caption for a model photo.
It must be:

- Fun, flirty, and confident
- Celebrating curves, beauty, and femininity
- Tasteful but bold (suggestive, not explicit)
- 1–2 short sentences only
- Aligned with playful, confident model aesthetics

Return only the caption text.

      `;
      
      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType: 'image/jpeg'
          }
        }
      ]);
      
      const response = await result.response;
      const caption = response.text().trim();
      
      if (caption) {
        console.log('✅ AI caption generated successfully');
        return caption;
      } else {
        throw new Error('Empty AI response');
      }
      
    } catch (error) {
      console.error('❌ Error generating AI caption:', error);
      throw error;
    }
  }

  async analyzeCaptionSpiciness(caption) {
    try {
      if (!config.gemini.apiKey) {
        console.log('⚠️ No Gemini API key, assuming caption needs enhancement');
        return false;
      }
      
      const prompt = `
Analyze this caption and determine if it's already "nakal, liar, menggoda" (naughty, wild, seductive) enough for a model/beauty content:

"${caption}"

Consider if the caption is:
- Flirty, playful, or seductive
- Confident and bold
- Has suggestive undertones
- Celebrates sensuality or allure
- Uses enticing or provocative language

Respond with only "YES" if it's already spicy enough, or "NO" if it needs enhancement.
      `;
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const analysis = response.text().trim().toUpperCase();
      
      const isSpicy = analysis.includes('YES');
      console.log(`🌡️ Caption spiciness analysis: ${isSpicy ? 'SPICY' : 'NEEDS ENHANCEMENT'}`);
      
      return isSpicy;
      
    } catch (error) {
      console.error('❌ Error analyzing caption spiciness:', error);
      // Default to false (needs enhancement) on error
      return false;
    }
  }

  async enhanceCaptionSpiciness(originalCaption) {
    try {
      if (!config.gemini.apiKey) {
        console.log('⚠️ No Gemini API key, using original caption');
        return originalCaption;
      }
      
      const prompt = `
Enhance this caption to make it more "nakal, liar, menggoda" (naughty, wild, seductive) while keeping it tasteful:

Original: "${originalCaption}"

Make it:
- More flirty and playful
- Confident and bold
- Suggestive but not explicit
- Celebrating sensuality and allure
- Keep it 1-2 sentences maximum
- Maintain the core message but add spice

Return only the enhanced caption text.
      `;
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const enhancedCaption = response.text().trim();
      
      if (enhancedCaption && enhancedCaption.length > 0) {
        console.log('🔥 Caption enhanced successfully');
        return enhancedCaption;
      } else {
        console.log('⚠️ Enhancement failed, using original');
        return originalCaption;
      }
      
    } catch (error) {
      console.error('❌ Error enhancing caption:', error);
      return originalCaption;
    }
  }

  async generateSpicyCaption(imagePath) {
    try {
      if (!config.gemini.apiKey) {
        // Fallback to preset if no API key
        const preset = await this.getRandomPresetCaption();
        return preset || this.getSpicyFallbackCaption();
      }
      
      // Read image file
      const imageBuffer = await fs.readFile(imagePath);
      const imageBase64 = imageBuffer.toString('base64');
      
      const prompt = `
Analyze this image and create a "nakal, liar, menggoda" (naughty, wild, seductive) caption for a model photo.

The caption must be:
- Flirty, playful, and seductive
- Confident and bold
- Suggestive but tasteful (not explicit)
- Celebrating curves, sensuality, and allure
- 1-2 short sentences only
- Perfect for social media model content

Return only the spicy caption text.
      `;
      
      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType: 'image/jpeg'
          }
        }
      ]);
      
      const response = await result.response;
      const caption = response.text().trim();
      
      if (caption) {
        console.log('🔥 Spicy AI caption generated successfully');
        return caption;
      } else {
        throw new Error('Empty AI response');
      }
      
    } catch (error) {
      console.error('❌ Error generating spicy caption:', error);
      // Fallback to preset or default spicy caption
      const preset = await this.getRandomPresetCaption();
      return preset || this.getSpicyFallbackCaption();
    }
  }

  getSpicyFallbackCaption() {
    const spicyFallbacks = [
      'Curves that speak louder than words 🔥',
      'Confidence is my best accessory 💋',
      'Serving looks and stealing hearts ✨',
      'Dangerous curves ahead... proceed with caution 😈',
      'Art in motion, beauty in every curve 🎨',
      'Flawless and fearless, just how I like it 💫',
      'Making hearts skip beats, one pose at a time 💕',
      'Elegance with a hint of mischief 😏'
    ];
    
    return spicyFallbacks[Math.floor(Math.random() * spicyFallbacks.length)];
  }

  async buildHashtags(channelHashtags = []) {
    try {
      console.log('🏷️ Building hashtags...');
      
      // Get trending hashtags
      const trendingHashtags = await hashtagFetcher.getTrendingHashtags();
      
      // Filter hashtags for niche relevance
      const filteredHashtags = await hashtagFilter.filterHashtags(trendingHashtags);
      
      // Get preset hashtags
      const presetHashtags = await this.getPresetHashtags();
      
      // Prioritize channel hashtags, then combine with others
      const allHashtags = [...new Set([
        ...channelHashtags,              // Channel hashtags have highest priority
        ...config.constants.fixedHashtags, // Always include fixed
        ...filteredHashtags.slice(0, 6), // Reduced trending to make room for channel hashtags
        ...presetHashtags.slice(0, 4)    // Reduced preset to make room for channel hashtags
      ])];
      
      // Limit total hashtags to avoid Twitter limits
      const limitedHashtags = allHashtags.slice(0, 15);
      
      if (channelHashtags.length > 0) {
        console.log(`✅ Built ${limitedHashtags.length} hashtags (${channelHashtags.length} from channel)`);
      } else {
        console.log(`✅ Built ${limitedHashtags.length} hashtags`);
      }
      
      return limitedHashtags;
      
    } catch (error) {
      console.error('❌ Error building hashtags:', error);
      // Return fallback hashtags including channel hashtags
      return [
        ...channelHashtags,
        ...config.constants.fixedHashtags,
        '#aesthetic',
        '#beauty',
        '#model',
        '#photography'
      ].slice(0, 15);
    }
  }

  async getPresetHashtags() {
    try {
      if (!await fs.pathExists(config.paths.presets.hashtags)) {
        return [];
      }
      
      const presets = await fs.readJson(config.paths.presets.hashtags);
      return presets.hashtags || [];
      
    } catch (error) {
      console.error('❌ Error reading preset hashtags:', error);
      return [];
    }
  }

  combineWithHashtags(caption, hashtags) {
    // Ensure caption doesn't exceed Twitter limit with hashtags
    const hashtagString = hashtags.join(' ');
    const maxCaptionLength = config.constants.maxCaptionLength - hashtagString.length - 2; // -2 for spacing
    
    let finalCaption = caption;
    if (finalCaption.length > maxCaptionLength) {
      finalCaption = finalCaption.substring(0, maxCaptionLength - 3) + '...';
    }
    
    return `${finalCaption}\n\n${hashtagString}`;
  }

  getFallbackCaption() {
    const fallbacks = [
      'Embracing the art of beauty and elegance ✨',
      'Where curves meet artistry 🎨',
      'Celebrating the aesthetic of grace 💫',
      'Beauty in its purest form 🌟',
      'Artistic expression through elegance 🖼️'
    ];
    
    const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    const hashtags = [
      ...config.constants.fixedHashtags,
      '#aesthetic',
      '#beauty',
      '#art'
    ];
    
    return this.combineWithHashtags(randomFallback, hashtags);
  }

  async validateCaption(caption) {
    // Check length
    if (caption.length > config.constants.maxCaptionLength) {
      return false;
    }
    
    // Check for inappropriate content (basic check)
    const inappropriateWords = ['explicit', 'nsfw', 'xxx']; // Add more as needed
    const lowerCaption = caption.toLowerCase();
    
    for (const word of inappropriateWords) {
      if (lowerCaption.includes(word)) {
        return false;
      }
    }
    
    return true;
  }
}

module.exports = new CaptionBuilder();