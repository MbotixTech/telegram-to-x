require('dotenv').config();
const config = require('./src/config');
const TelegramListener = require('./src/telegramListener');
const telegramLogger = require('./src/telegramLogger');
const cleanup = require('./src/cleanup');
const { QueueManager } = require('./src/queueManager');
const twitterPoster = require('./src/twitterPoster');

// Initialize queue manager
const queueManager = new QueueManager(config.queue);
const telegramListener = new TelegramListener();

async function main() {
  try {
    console.log('🚀 Starting Muse AutoPost...');
    
    // Initialize cleanup on startup
    await cleanup.initCleanup();
    
    // Initialize logger and set it for components
    await telegramLogger.initialize();
    queueManager.setLogger(telegramLogger);
    twitterPoster.setLogger(telegramLogger);
    
    // Set up telegram listener with queue integration
    telegramListener.setQueueManager(queueManager);
    
    // Start Telegram listener
    await telegramListener.start();
    
    console.log('✅ Muse AutoPost is running!');
    
    // Send startup notification with new log level
    await telegramLogger.log('🚀 Muse AutoPost started successfully!\n\n' +
                            `📊 Queue enabled: ${config.queue.enabled}\n` +
                            `⏱️ Post delay: ${config.queue.postDelay/1000}s\n` +
                            `🔄 Max retries: ${config.queue.maxRetries}`, 'success');
    
  } catch (error) {
    console.error('❌ Failed to start Muse AutoPost:', error);
    await telegramLogger.log(`❌ Startup failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Clear queue and log status
  const clearedCount = queueManager.clearQueue();
  if (clearedCount > 0) {
    await telegramLogger.log(`🗑️ Cleared ${clearedCount} pending posts from queue`, 'warning');
  }
  
  await telegramLogger.log('🛑 Muse AutoPost shutting down...', 'info');
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await telegramLogger.log(`💥 Critical error: ${error.message}`, 'error');
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await telegramLogger.log(`💥 Unhandled rejection: ${reason}`, 'error');
});

main();