const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

class HashtagFetcher {
  constructor() {
    this.cache = {
      hashtags: [],
      lastFetch: 0,
      cacheDuration: 30 * 60 * 1000 // 30 minutes
    };
  }

  async getTrendingHashtags() {
    try {
      // Check cache first
      if (this.isCacheValid()) {
        console.log('📋 Using cached trending hashtags');
        return this.cache.hashtags;
      }
      
      console.log('🌐 Fetching trending hashtags from trends24.in...');
      
      const hashtags = await this.scrapeTrends24();
      
      // Update cache
      this.cache.hashtags = hashtags;
      this.cache.lastFetch = Date.now();
      
      console.log(`✅ Fetched ${hashtags.length} trending hashtags`);
      return hashtags;
      
    } catch (error) {
      console.error('❌ Error fetching trending hashtags:', error);
      
      // Return cached data if available, otherwise fallback
      if (this.cache.hashtags.length > 0) {
        console.log('📋 Using stale cached hashtags due to error');
        return this.cache.hashtags;
      }
      
      return this.getFallbackHashtags();
    }
  }

  async scrapeTrends24() {
    try {
      const response = await axios.get(config.urls.trendingHashtags, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      const hashtags = [];
      
      // Try multiple selectors as the site structure might change
      const selectors = [
        '.trend-card__list li a',
        '.trend-card li a',
        '.trends-list li a',
        'li a[href*="hashtag"]',
        'a[href*="twitter.com/hashtag"]'
      ];
      
      for (const selector of selectors) {
        $(selector).each((index, element) => {
          const text = $(element).text().trim();
          if (text && text.startsWith('#') && text.length > 1) {
            hashtags.push(text);
          }
        });
        
        if (hashtags.length > 0) {
          break; // Found hashtags with this selector
        }
      }
      
      // If no hashtags found with specific selectors, try general approach
      if (hashtags.length === 0) {
        $('a').each((index, element) => {
          const href = $(element).attr('href');
          const text = $(element).text().trim();
          
          if (href && href.includes('hashtag') && text.startsWith('#')) {
            hashtags.push(text);
          }
        });
      }
      
      // Clean and deduplicate hashtags
      const cleanHashtags = [...new Set(hashtags)]
        .filter(tag => this.isValidHashtag(tag))
        .slice(0, 20); // Limit to top 20
      
      return cleanHashtags;
      
    } catch (error) {
      console.error('❌ Error scraping trends24:', error);
      throw error;
    }
  }

  async getTwitterTrendingHashtags() {
    // Alternative method using Twitter's public trends (if available)
    try {
      console.log('🐦 Attempting to fetch Twitter trends...');
      
      // This would require Twitter API access
      // For now, return empty array as fallback
      return [];
      
    } catch (error) {
      console.error('❌ Error fetching Twitter trends:', error);
      return [];
    }
  }

  async getAlternativeTrends() {
    // Try alternative trending sources
    const sources = [
      'https://getdaytrends.com/united-states/',
      'https://trendsmap.com/local/us',
    ];
    
    for (const url of sources) {
      try {
        console.log(`🌐 Trying alternative source: ${url}`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: 8000
        });
        
        const $ = cheerio.load(response.data);
        const hashtags = [];
        
        // Generic hashtag extraction
        $('a, span, div').each((index, element) => {
          const text = $(element).text().trim();
          if (text.startsWith('#') && this.isValidHashtag(text)) {
            hashtags.push(text);
          }
        });
        
        if (hashtags.length > 0) {
          return [...new Set(hashtags)].slice(0, 15);
        }
        
      } catch (error) {
        console.error(`❌ Error with alternative source ${url}:`, error.message);
        continue;
      }
    }
    
    return [];
  }

  isValidHashtag(hashtag) {
    // Basic validation for hashtags
    if (!hashtag || typeof hashtag !== 'string') return false;
    if (!hashtag.startsWith('#')) return false;
    if (hashtag.length < 2 || hashtag.length > 50) return false;
    
    // Remove # and check if remaining text is valid
    const tag = hashtag.slice(1);
    
    // Should contain only letters, numbers, and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(tag)) return false;
    
    // Should not be just numbers
    if (/^\d+$/.test(tag)) return false;
    
    return true;
  }

  isCacheValid() {
    return (
      this.cache.hashtags.length > 0 &&
      Date.now() - this.cache.lastFetch < this.cache.cacheDuration
    );
  }

  getFallbackHashtags() {
    console.log('📋 Using fallback trending hashtags');
    
    return [
      '#trending',
      '#viral',
      '#aesthetic',
      '#beauty',
      '#model',
      '#photography',
      '#art',
      '#style',
      '#fashion',
      '#elegant',
      '#curves',
      '#artistic',
      '#beautiful',
      '#stunning',
      '#gorgeous'
    ];
  }

  clearCache() {
    this.cache.hashtags = [];
    this.cache.lastFetch = 0;
    console.log('🗑️ Hashtag cache cleared');
  }

  async testConnection() {
    try {
      const response = await axios.get(config.urls.trendingHashtags, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      console.log(`✅ Connection test successful: ${response.status}`);
      return true;
      
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      return false;
    }
  }
}

module.exports = new HashtagFetcher();