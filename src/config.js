const path = require('path');

module.exports = {
  // Telegram Configuration
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID,
    logGroupId: process.env.TELEGRAM_LOG_GROUP_ID,
    allowedChannels: [process.env.TELEGRAM_CHANNEL_ID], // Array of allowed channel IDs
  },
  
  // Twitter Configuration
  twitter: {
    username: process.env.TWITTER_USERNAME,
    password: process.env.TWITTER_PASSWORD,
    maxRetries: parseInt(process.env.TWITTER_MAX_RETRIES) || 2,
    retryDelay: parseInt(process.env.TWITTER_RETRY_DELAY) || 5000,
  },
  
  // Google Gemini API
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  
  // Application Settings
  app: {
    watermarkOpacity: parseFloat(process.env.WATERMARK_OPACITY) || 0.3,
    watermarkSize: parseFloat(process.env.WATERMARK_SIZE) || 0.35, // 35% of image width
    maxImagesPerPost: parseInt(process.env.MAX_IMAGES_PER_POST) || 4,
    tempCleanupEnabled: process.env.TEMP_CLEANUP_ENABLED === 'true',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  
  // Queue Management
  queue: {
    postDelay: parseInt(process.env.QUEUE_POST_DELAY) || 20000, // 20 seconds between posts
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES) || 2,
    retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY) || 5000,
    enabled: process.env.QUEUE_ENABLED !== 'false', // Default enabled
  },
  
  // Paths
  paths: {
    root: path.resolve(__dirname, '..'),
    temp: path.resolve(__dirname, '..', 'temp'),
    output: path.resolve(__dirname, '..', 'output'),
    watermark: path.resolve(__dirname, '..', 'watermark', 'museofcurves.png'),
    cookies: path.resolve(__dirname, '..', 'cookies', 'session.json'),
    presets: {
      captions: path.resolve(__dirname, '..', 'presets', 'captions.json'),
      hashtags: path.resolve(__dirname, '..', 'presets', 'hashtags.json'),
    },
  },
  
  // URLs
  urls: {
    trendingHashtags: 'https://trends24.in/united-states/',
    twitter: 'https://twitter.com',
  },
  
  // Constants
  constants: {
    fixedHashtags: ['#MuseOfCurves'],
    supportedImageTypes: ['.jpg', '.jpeg', '.png', '.webp'],
    maxCaptionLength: 280,
    watermarkPosition: 'center',
    twitterLocation: 'United States',
  },
};