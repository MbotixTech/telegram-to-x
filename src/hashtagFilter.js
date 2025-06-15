const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs-extra');
const config = require('./config');

class HashtagFilter {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // Cache for filtered hashtags
    this.cache = {
      filtered: new Map(),
      lastCleanup: Date.now(),
      maxAge: 2 * 60 * 60 * 1000 // 2 hours
    };
    
    // Predefined relevant keywords for quick filtering
    this.relevantKeywords = [
      'beauty', 'beautiful', 'aesthetic', 'art', 'artistic', 'model', 'modeling',
      'photography', 'photo', 'portrait', 'fashion', 'style', 'elegant', 'elegance',
      'curves', 'sensual', 'stunning', 'gorgeous', 'glamour', 'glamorous',
      'feminine', 'grace', 'graceful', 'allure', 'alluring', 'captivating',
      'enchanting', 'mesmerizing', 'breathtaking', 'divine', 'goddess',
      'sophisticated', 'chic', 'classy', 'refined', 'luxurious', 'premium',
      'exclusive', 'unique', 'special', 'rare', 'precious', 'treasure',
      'inspiration', 'inspiring', 'motivational', 'empowering', 'confidence',
      'selfie', 'pose', 'posing', 'shoot', 'session', 'studio', 'natural',
      'lifestyle', 'mood', 'vibe', 'energy', 'aura', 'charisma', 'charm'
    ];
    
    // Keywords to avoid
    this.avoidKeywords = [
      'politics', 'political', 'news', 'breaking', 'covid', 'pandemic',
      'war', 'conflict', 'violence', 'death', 'disaster', 'tragedy',
      'sports', 'football', 'basketball', 'soccer', 'game', 'match',
      'tech', 'technology', 'crypto', 'bitcoin', 'stock', 'market',
      'business', 'corporate', 'finance', 'economy', 'economic',
      'food', 'recipe', 'cooking', 'restaurant', 'travel', 'vacation',
      'weather', 'climate', 'science', 'research', 'study', 'education'
    ];
  }

  async filterHashtags(hashtags) {
    try {
      console.log(`🔍 Filtering ${hashtags.length} hashtags for niche relevance...`);
      
      // Clean up old cache entries
      this.cleanupCache();
      
      // Quick filter first using predefined keywords
      const quickFiltered = this.quickFilter(hashtags);
      
      if (quickFiltered.length === 0) {
        console.log('⚠️ No hashtags passed quick filter, using AI filter on all');
        return await this.aiFilter(hashtags.slice(0, 15)); // Limit for AI processing
      }
      
      // If we have enough from quick filter, use those
      if (quickFiltered.length >= 10) {
        console.log(`✅ Quick filter found ${quickFiltered.length} relevant hashtags`);
        return quickFiltered.slice(0, 12);
      }
      
      // Otherwise, enhance with AI filtering
      const aiFiltered = await this.aiFilter(hashtags.slice(0, 20));
      
      // Combine and deduplicate
      const combined = [...new Set([...quickFiltered, ...aiFiltered])];
      
      console.log(`✅ Filtered to ${combined.length} relevant hashtags`);
      return combined.slice(0, 12);
      
    } catch (error) {
      console.error('❌ Error filtering hashtags:', error);
      // Fallback to quick filter only
      return this.quickFilter(hashtags).slice(0, 8);
    }
  }

  quickFilter(hashtags) {
    const filtered = [];
    
    for (const hashtag of hashtags) {
      const tag = hashtag.toLowerCase().replace('#', '');
      
      // Skip if contains avoid keywords
      if (this.avoidKeywords.some(keyword => tag.includes(keyword))) {
        continue;
      }
      
      // Include if contains relevant keywords
      if (this.relevantKeywords.some(keyword => tag.includes(keyword))) {
        filtered.push(hashtag);
        continue;
      }
      
      // Include if it's a general aesthetic/beauty related term
      if (this.isAestheticTerm(tag)) {
        filtered.push(hashtag);
      }
    }
    
    return filtered;
  }

  async aiFilter(hashtags) {
    try {
      if (!config.gemini.apiKey) {
        console.log('⚠️ No Gemini API key, skipping AI filter');
        return [];
      }
      
      // Check cache first
      const cacheKey = hashtags.sort().join(',');
      if (this.cache.filtered.has(cacheKey)) {
        console.log('📋 Using cached AI filter result');
        return this.cache.filtered.get(cacheKey);
      }
      
      console.log('🤖 Using AI to filter hashtags...');
      
      const prompt = `
Analyze the following hashtags and select ONLY those that are relevant to:
- Sensual and aesthetic photography
- Beauty and modeling
- Artistic and elegant content
- Curves and feminine beauty
- Fashion and style
- Glamour photography

Hashtags to analyze: ${hashtags.join(', ')}

Output: Return ONLY the relevant hashtags, as a comma-separated list, with NO explanations and NO extra words. 
If none are relevant, return "NONE". 
Maximum 10 hashtags. Do not exceed 10.
      `;
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      if (text === 'NONE' || !text) {
        return [];
      }
      
      // Parse the response
      const filtered = text
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.startsWith('#') && tag.length > 1)
        .slice(0, 10);
      
      // Cache the result
      this.cache.filtered.set(cacheKey, filtered);
      
      console.log(`🤖 AI filtered to ${filtered.length} hashtags`);
      return filtered;
      
    } catch (error) {
      console.error('❌ Error in AI filtering:', error);
      return [];
    }
  }

  isAestheticTerm(tag) {
    const aestheticPatterns = [
      /^(hot|sexy|cute|pretty|lovely|sweet)$/,
      /^(perfect|amazing|incredible|wonderful)$/,
      /^(dream|fantasy|magic|magical)$/,
      /^(glow|glowing|shine|shining|sparkle)$/,
      /^(soft|smooth|silky|delicate)$/,
      /^(pure|innocent|natural|organic)$/,
      /^(luxury|premium|exclusive|elite)$/,
      /^(vintage|classic|timeless|eternal)$/,
      /^(modern|contemporary|fresh|new)$/,
      /^(bold|confident|strong|powerful)$/
    ];
    
    return aestheticPatterns.some(pattern => pattern.test(tag));
  }

  async getRelevantHashtagsFromPresets() {
    try {
      if (!await fs.pathExists(config.paths.presets.hashtags)) {
        return [];
      }
      
      const presets = await fs.readJson(config.paths.presets.hashtags);
      return presets.relevant || [];
      
    } catch (error) {
      console.error('❌ Error reading preset hashtags:', error);
      return [];
    }
  }

  cleanupCache() {
    const now = Date.now();
    
    // Clean up every hour
    if (now - this.cache.lastCleanup > 60 * 60 * 1000) {
      const keysToDelete = [];
      
      for (const [key, value] of this.cache.filtered.entries()) {
        if (now - value.timestamp > this.cache.maxAge) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => this.cache.filtered.delete(key));
      this.cache.lastCleanup = now;
      
      if (keysToDelete.length > 0) {
        console.log(`🗑️ Cleaned up ${keysToDelete.length} old cache entries`);
      }
    }
  }

  async validateHashtagRelevance(hashtag) {
    try {
      const tag = hashtag.toLowerCase().replace('#', '');
      
      // Quick checks first
      if (this.avoidKeywords.some(keyword => tag.includes(keyword))) {
        return false;
      }
      
      if (this.relevantKeywords.some(keyword => tag.includes(keyword))) {
        return true;
      }
      
      if (this.isAestheticTerm(tag)) {
        return true;
      }
      
      // Use AI for uncertain cases
      if (config.gemini.apiKey) {
        const prompt = `
Is the hashtag "${hashtag}" relevant to sensual aesthetic photography, beauty, modeling, or feminine curves content?
Answer only: YES or NO
        `;
        
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text().trim().toUpperCase();
        
        return answer === 'YES';
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ Error validating hashtag relevance:', error);
      return false;
    }
  }

  getFallbackRelevantHashtags() {
    return [
      '#aesthetic',
      '#beauty',
      '#beautiful',
      '#model',
      '#photography',
      '#art',
      '#artistic',
      '#elegant',
      '#stunning',
      '#gorgeous',
      '#glamour',
      '#style'
    ];
  }

  clearCache() {
    this.cache.filtered.clear();
    this.cache.lastCleanup = Date.now();
    console.log('🗑️ Hashtag filter cache cleared');
  }
}

module.exports = new HashtagFilter();