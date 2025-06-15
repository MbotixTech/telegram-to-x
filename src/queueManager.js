const { TelegramLogger } = require('./telegramLogger');

class QueueManager {
  constructor(config) {
    this.queue = [];
    this.isProcessing = false;
    this.config = config;
    this.logger = null;
    this.postDelay = config.postDelay || 20000; // 20 seconds default
    this.maxRetries = config.maxRetries || 2;
  }

  setLogger(logger) {
    this.logger = logger;
  }

  async addToQueue(postData) {
    this.queue.push({
      ...postData,
      id: Date.now() + Math.random(),
      timestamp: Date.now(),
      retries: 0
    });

    if (this.logger) {
      await this.logger.log(`📥 Post added to queue. Queue size: ${this.queue.length}`, 'info');
    }

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const postData = this.queue.shift();
      
      try {
        if (this.logger) {
          await this.logger.log(`🔄 Processing post from queue. Remaining: ${this.queue.length}`, 'info');
        }

        await this.processPost(postData);
        
        // Add delay between posts
        if (this.queue.length > 0) {
          if (this.logger) {
            await this.logger.log(`⏳ Waiting ${this.postDelay/1000}s before next post...`, 'info');
          }
          await this.delay(this.postDelay);
        }

      } catch (error) {
        if (this.logger) {
          await this.logger.log(`❌ Error processing post: ${error.message}`, 'error');
        }
        
        // Retry logic
        if (postData.retries < this.maxRetries) {
          postData.retries++;
          this.queue.unshift(postData); // Put back at front of queue
          
          if (this.logger) {
            await this.logger.log(`🔄 Retrying post (attempt ${postData.retries}/${this.maxRetries})`, 'warning');
          }
          
          // Wait before retry
          await this.delay(5000 * postData.retries); // Exponential backoff
        } else {
          if (this.logger) {
            await this.logger.log(`💀 Post failed after ${this.maxRetries} retries. Skipping.`, 'error');
          }
        }
      }
    }

    this.isProcessing = false;
    
    if (this.logger) {
      await this.logger.log(`✅ Queue processing completed`, 'info');
    }
  }

  async processPost(postData) {
    // This will be called by the main application
    // The actual posting logic will be handled by the caller
    if (postData.processor && typeof postData.processor === 'function') {
      await postData.processor(postData);
    } else {
      throw new Error('No processor function provided for post data');
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      nextPostTime: this.isProcessing ? Date.now() + this.postDelay : null
    };
  }

  clearQueue() {
    const clearedCount = this.queue.length;
    this.queue = [];
    return clearedCount;
  }
}

module.exports = { QueueManager };