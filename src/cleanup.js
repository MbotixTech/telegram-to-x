const fs = require('fs-extra');
const path = require('path');
const config = require('./config');

class Cleanup {
  constructor() {
    this.cleanupInterval = null;
    this.stats = {
      filesDeleted: 0,
      totalSizeFreed: 0,
      lastCleanup: null
    };
  }

  async initCleanup() {
    try {
      console.log('🧹 Initializing cleanup system...');
      
      // Ensure directories exist
      await this.ensureDirectories();
      
      // Perform initial cleanup
      await this.performCleanup();
      
      // Set up automatic cleanup every hour
      this.cleanupInterval = setInterval(async () => {
        await this.performCleanup();
      }, 60 * 60 * 1000); // 1 hour
      
      console.log('✅ Cleanup system initialized');
      
    } catch (error) {
      console.error('❌ Error initializing cleanup:', error);
    }
  }

  async ensureDirectories() {
    const directories = [
      config.paths.temp,
      config.paths.output,
      path.dirname(config.paths.cookies),
      path.dirname(config.paths.watermark)
    ];
    
    for (const dir of directories) {
      await fs.ensureDir(dir);
    }
    
    console.log('📁 Required directories ensured');
  }

  async performCleanup() {
    try {
      if (!config.app.tempCleanupEnabled) {
        console.log('🧹 Cleanup disabled in config');
        return;
      }
      
      console.log('🧹 Starting cleanup process...');
      
      const startTime = Date.now();
      let totalFilesDeleted = 0;
      let totalSizeFreed = 0;
      
      // Clean temp directory
      const tempStats = await this.cleanDirectory(config.paths.temp, {
        maxAge: 2 * 60 * 60 * 1000, // 2 hours
        keepRecent: 5 // Keep 5 most recent files
      });
      
      // Clean output directory
      const outputStats = await this.cleanDirectory(config.paths.output, {
        maxAge: 6 * 60 * 60 * 1000, // 6 hours
        keepRecent: 10 // Keep 10 most recent files
      });
      
      // Clean old log files if any
      await this.cleanLogFiles();
      
      totalFilesDeleted = tempStats.filesDeleted + outputStats.filesDeleted;
      totalSizeFreed = tempStats.sizeFreed + outputStats.sizeFreed;
      
      // Update stats
      this.stats.filesDeleted += totalFilesDeleted;
      this.stats.totalSizeFreed += totalSizeFreed;
      this.stats.lastCleanup = new Date().toISOString();
      
      const duration = Date.now() - startTime;
      
      if (totalFilesDeleted > 0) {
        console.log(`✅ Cleanup completed: ${totalFilesDeleted} files deleted, ${this.formatBytes(totalSizeFreed)} freed in ${duration}ms`);
      } else {
        console.log('✅ Cleanup completed: No files to delete');
      }
      
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }

  async cleanDirectory(dirPath, options = {}) {
    const stats = { filesDeleted: 0, sizeFreed: 0 };
    
    try {
      if (!await fs.pathExists(dirPath)) {
        return stats;
      }
      
      const files = await fs.readdir(dirPath);
      
      if (files.length === 0) {
        return stats;
      }
      
      // Get file stats with timestamps
      const fileStats = [];
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            fileStats.push({
              path: filePath,
              name: file,
              size: stat.size,
              mtime: stat.mtime,
              age: Date.now() - stat.mtime.getTime()
            });
          }
        } catch (e) {
          // Skip files that can't be accessed
          continue;
        }
      }
      
      // Sort by modification time (newest first)
      fileStats.sort((a, b) => b.mtime - a.mtime);
      
      // Determine which files to delete
      const filesToDelete = [];
      const maxAge = options.maxAge || 24 * 60 * 60 * 1000; // Default 24 hours
      const keepRecent = options.keepRecent || 0;
      
      for (let i = 0; i < fileStats.length; i++) {
        const file = fileStats[i];
        
        // Always keep the most recent files
        if (i < keepRecent) {
          continue;
        }
        
        // Delete files older than maxAge
        if (file.age > maxAge) {
          filesToDelete.push(file);
        }
      }
      
      // Delete the files
      for (const file of filesToDelete) {
        try {
          await fs.unlink(file.path);
          stats.filesDeleted++;
          stats.sizeFreed += file.size;
          console.log(`🗑️ Deleted: ${file.name} (${this.formatBytes(file.size)})`);
        } catch (error) {
          console.error(`❌ Failed to delete ${file.name}:`, error.message);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error cleaning directory ${dirPath}:`, error);
    }
    
    return stats;
  }

  async cleanLogFiles() {
    try {
      // Clean old session files if they exist
      const sessionFiles = [
        path.join(config.paths.root, 'telegram_session.txt'),
        path.join(config.paths.root, 'telegram_logger_session.txt')
      ];
      
      for (const sessionFile of sessionFiles) {
        if (await fs.pathExists(sessionFile)) {
          const stat = await fs.stat(sessionFile);
          const age = Date.now() - stat.mtime.getTime();
          
          // Keep session files for 30 days
          if (age > 30 * 24 * 60 * 60 * 1000) {
            await fs.unlink(sessionFile);
            console.log(`🗑️ Deleted old session file: ${path.basename(sessionFile)}`);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error cleaning log files:', error);
    }
  }

  async cleanupFiles(filePaths) {
    try {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return;
      }
      
      console.log(`🧹 Cleaning up ${filePaths.length} specific files...`);
      
      let deletedCount = 0;
      let totalSize = 0;
      
      for (const filePath of filePaths) {
        try {
          if (await fs.pathExists(filePath)) {
            const stat = await fs.stat(filePath);
            await fs.unlink(filePath);
            deletedCount++;
            totalSize += stat.size;
            console.log(`🗑️ Deleted: ${path.basename(filePath)}`);
          }
        } catch (error) {
          console.error(`❌ Failed to delete ${filePath}:`, error.message);
        }
      }
      
      if (deletedCount > 0) {
        console.log(`✅ Cleaned up ${deletedCount} files (${this.formatBytes(totalSize)})`);
      }
      
    } catch (error) {
      console.error('❌ Error in cleanup files:', error);
    }
  }

  async getDirectorySize(dirPath) {
    try {
      if (!await fs.pathExists(dirPath)) {
        return 0;
      }
      
      const files = await fs.readdir(dirPath);
      let totalSize = 0;
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            totalSize += stat.size;
          } else if (stat.isDirectory()) {
            totalSize += await this.getDirectorySize(filePath);
          }
        } catch (e) {
          // Skip files that can't be accessed
          continue;
        }
      }
      
      return totalSize;
      
    } catch (error) {
      console.error(`❌ Error getting directory size for ${dirPath}:`, error);
      return 0;
    }
  }

  async getCleanupStats() {
    try {
      const tempSize = await this.getDirectorySize(config.paths.temp);
      const outputSize = await this.getDirectorySize(config.paths.output);
      
      return {
        ...this.stats,
        currentSizes: {
          temp: tempSize,
          output: outputSize,
          total: tempSize + outputSize
        },
        formattedSizes: {
          temp: this.formatBytes(tempSize),
          output: this.formatBytes(outputSize),
          total: this.formatBytes(tempSize + outputSize),
          totalFreed: this.formatBytes(this.stats.totalSizeFreed)
        }
      };
      
    } catch (error) {
      console.error('❌ Error getting cleanup stats:', error);
      return this.stats;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async forceCleanup() {
    console.log('🧹 Forcing immediate cleanup...');
    await this.performCleanup();
  }

  async emergencyCleanup() {
    try {
      console.log('🚨 Emergency cleanup initiated...');
      
      // More aggressive cleanup
      await this.cleanDirectory(config.paths.temp, {
        maxAge: 30 * 60 * 1000, // 30 minutes
        keepRecent: 1
      });
      
      await this.cleanDirectory(config.paths.output, {
        maxAge: 60 * 60 * 1000, // 1 hour
        keepRecent: 2
      });
      
      console.log('✅ Emergency cleanup completed');
      
    } catch (error) {
      console.error('❌ Error during emergency cleanup:', error);
    }
  }

  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('🛑 Cleanup system stopped');
    }
  }
}

module.exports = new Cleanup();