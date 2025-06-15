const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');

class TwitterPoster {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.logger = null;
    this.maxRetries = config.twitter?.maxRetries || 2;
    this.retryDelay = config.twitter?.retryDelay || 5000;
    
    // Add process exit handlers to ensure browser cleanup
    this.setupProcessHandlers();
  }

  setupProcessHandlers() {
    const cleanup = () => {
      if (this.browser) {
        try {
          console.log('🧹 Emergency browser cleanup on process exit');
          if (this.browser.process()) {
            this.browser.process().kill('SIGKILL');
          }
        } catch (error) {
          console.error('❌ Error in emergency cleanup:', error);
        }
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      cleanup();
      process.exit(1);
    });
  }

  setLogger(logger) {
    this.logger = logger;
  }

  async postTweet(imagePaths, caption) {
    // Add global timeout wrapper to prevent stuck processes
    return await this.postTweetWithTimeout(imagePaths, caption, 120000); // 2 minutes timeout
  }

  async postTweetWithTimeout(imagePaths, caption, timeoutMs = 120000) {
    return Promise.race([
      this.postTweetWithRetry(imagePaths, caption, 0),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Tweet posting timeout - process took too long')), timeoutMs)
      )
    ]);
  }

  async postTweetWithRetry(imagePaths, caption, attempt = 0) {
    try {
      console.log(`🐦 Starting Twitter post process... (attempt ${attempt + 1}/${this.maxRetries + 1})`);
      
      if (this.logger) {
        await this.logger.log(`🐦 Posting to Twitter (attempt ${attempt + 1}/${this.maxRetries + 1})`, 'info');
      }
      
      // Initialize browser and login
      await this.initializeBrowser();
      await this.ensureLoggedIn();
      
      // Navigate to compose tweet
      await this.navigateToCompose();
      
      // Upload images
      await this.uploadImages(imagePaths);
      
      // Add caption
      await this.addCaption(caption);
      
      // Post the tweet
      const tweetUrl = await this.publishTweet();
      
      console.log('✅ Tweet posted successfully!');
      if (this.logger) {
        await this.logger.log(`✅ Tweet posted successfully: ${tweetUrl}`, 'info');
      }
      
      // Delete image files from output folder after successful posting
      await this.deleteImageFiles(imagePaths);
      
      return tweetUrl;
      
    } catch (error) {
      console.error(`❌ Error posting tweet (attempt ${attempt + 1}):`, error);
      
      if (this.logger) {
        await this.logger.log(`❌ Twitter post failed (attempt ${attempt + 1}): ${error.message}`, 'error');
      }
      
      // Take screenshot for debugging
      await this.captureErrorScreenshot(attempt);
      
      // Close browser on error to ensure clean state for retry
      await this.closeBrowser();
      
      // Retry if we haven't exceeded max retries
      if (attempt < this.maxRetries) {
        const delay = this.retryDelay * (attempt + 1); // Exponential backoff
        console.log(`🔄 Retrying in ${delay/1000} seconds...`);
        
        if (this.logger) {
          await this.logger.log(`🔄 Retrying Twitter post in ${delay/1000} seconds...`, 'warning');
        }
        
        await this.delay(delay);
        return await this.postTweetWithRetry(imagePaths, caption, attempt + 1);
      }
      
      // Max retries exceeded
      if (this.logger) {
        await this.logger.log(`💀 Twitter post failed after ${this.maxRetries + 1} attempts`, 'error');
      }
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async deleteImageFiles(imagePaths) {
    try {
      console.log('🗑️ Deleting image files from output folder...');
      
      for (const imagePath of imagePaths) {
        try {
          // Check if file exists before attempting deletion
          if (await fs.pathExists(imagePath)) {
            await fs.unlink(imagePath);
            console.log(`✅ Deleted: ${path.basename(imagePath)}`);
            
            if (this.logger) {
              await this.logger.log(`🗑️ Deleted image file: ${path.basename(imagePath)}`, 'info');
            }
          } else {
            console.log(`⚠️ File not found (already deleted?): ${path.basename(imagePath)}`);
          }
        } catch (fileError) {
          console.error(`❌ Failed to delete ${path.basename(imagePath)}:`, fileError.message);
          
          if (this.logger) {
            await this.logger.log(`❌ Failed to delete image file ${path.basename(imagePath)}: ${fileError.message}`, 'error');
          }
        }
      }
      
      console.log('✅ Image file cleanup completed');
      
    } catch (error) {
      console.error('❌ Error during image file cleanup:', error);
      
      if (this.logger) {
        await this.logger.log(`❌ Image file cleanup error: ${error.message}`, 'error');
      }
    }
  }

  async initializeBrowser() {
    try {
      if (this.browser) {
        return; // Already initialized
      }
      
      console.log('🌐 Launching browser...');
      
      this.browser = await puppeteer.launch({
        headless: process.env.NODE_ENV === 'production' || process.env.HEADLESS === 'new',
        defaultViewport: null,
        timeout: 30000, // Add browser launch timeout
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--window-size=1366,768',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-default-apps',
          '--no-default-browser-check'
        ]
      });
      
      this.page = await this.browser.newPage();
      
      // Set user agent
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0');
      
      // Load cookies if available
      await this.loadCookies();
      
      console.log('✅ Browser initialized');
      
    } catch (error) {
      console.error('❌ Error initializing browser:', error);
      throw error;
    }
  }

  async loadCookies() {
    try {
      if (await fs.pathExists(config.paths.cookies)) {
        console.log('🍪 Loading saved cookies...');
        const cookies = await fs.readJson(config.paths.cookies);
        await this.page.setCookie(...cookies);
        console.log('✅ Cookies loaded successfully');
      } else {
        console.log('🍪 No saved cookies found');
      }
    } catch (error) {
      console.error('❌ Error loading cookies:', error);
    }
  }

  async saveCookies() {
    try {
      const cookies = await this.page.cookies();
      await fs.ensureDir(path.dirname(config.paths.cookies));
      await fs.writeJson(config.paths.cookies, cookies);
      console.log('✅ Cookies saved successfully');
    } catch (error) {
      console.error('❌ Error saving cookies:', error);
    }
  }

  async ensureLoggedIn() {
    try {
      console.log('🔐 Checking login status...');
      
      // Navigate to Twitter
      await this.page.goto('https://x.com/home', { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
      
      // Wait a bit for page to load
      await this.page.waitForTimeout(3000);
      
      // Check if we're on the home page (logged in)
      const currentUrl = this.page.url();
      
      if (currentUrl.includes('/home') || currentUrl.includes('/timeline')) {
        console.log('✅ Already logged in');
        this.isLoggedIn = true;
        return;
      }
      
      // If not logged in, perform login
      await this.performLogin();
      
    } catch (error) {
      console.error('❌ Error ensuring login:', error);
      
      // Capture screenshot for login debugging
      await this.captureLoginErrorScreenshot();
      
      if (this.logger) {
        await this.logger.log(`❌ Twitter login failed: ${error.message}`, 'error');
        await this.logger.log('📸 Screenshot captured for debugging. Check temp folder.', 'warning');
      }
      
      throw error;
    }
  }

  async performLogin() {
    try {
      console.log('🔑 Performing login...');
      
      // Navigate to login page
      await this.page.goto('https://x.com/i/flow/login', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Wait for username field
      await this.page.waitForSelector('input[name="text"]', { timeout: 10000 });
      
      // Enter username
      await this.page.type('input[name="text"]', config.twitter.username, { delay: 100 });
      
      // Click Next button
      await this.page.click('[role="button"]:has-text("Next")');
      
      // Wait for password field
      await this.page.waitForSelector('input[name="password"]', { timeout: 10000 });
      
      // Enter password
      await this.page.type('input[name="password"]', config.twitter.password, { delay: 100 });
      
      // Click Login button
      await this.page.click('[data-testid="LoginForm_Login_Button"]');
      
      // Wait for successful login (home page)
      await this.page.waitForNavigation({ 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
      
      // Verify we're logged in
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/home')) {
        throw new Error('Login failed - not redirected to home page');
      }
      
      // Save cookies for future use
      await this.saveCookies();
      
      this.isLoggedIn = true;
      console.log('✅ Login successful');
      
    } catch (error) {
      console.error('❌ Login failed:', error);
      throw new Error(`Twitter login failed: ${error.message}`);
    }
  }

  async navigateToCompose() {
    try {
      console.log('✍️ Navigating to compose tweet...');
      
      // Click on Post button or compose with more robust selectors
      const composeSelectors = [
        '[data-testid="SideNav_NewTweet_Button"]',
        '[aria-label*="Post"]',
        '[data-testid="tweetButtonInline"]',
        'a[href="/compose/tweet"]',
        'button:has-text("Post")',
        '[role="button"]:has-text("Post")',
        'div[role="button"]:has-text("Post")',
        '[data-testid*="tweet"][role="button"]',
        '[data-testid*="compose"]'
      ];
      
      let clicked = false;
      for (const selector of composeSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          await this.page.click(selector);
          clicked = true;
          break;
        } catch (e) {
          continue;
        }
      }
      
      if (!clicked) {
        throw new Error('Could not find compose tweet button');
      }
      
      // Wait for compose modal to appear
      await this.page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 });
      
      console.log('✅ Compose window opened');
      
    } catch (error) {
      console.error('❌ Error navigating to compose:', error);
      throw error;
    }
  }

  async uploadImages(imagePaths) {
    try {
      console.log(`📸 Uploading ${imagePaths.length} image(s)...`);
      
      // 1. CARI file input langsung
      const fileInputSelectors = [
        'input[data-testid="fileInput"]',
        'input[accept*="image"]',
        'input[type="file"]'
      ];
      
      let fileInput = null;
      for (const selector of fileInputSelectors) {
        try {
          fileInput = await this.page.$(selector);
          if (fileInput) {
            console.log(`🔍 Found file input: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // 2. JIKA file input belum ketemu, BARU klik tombol upload biar file input muncul
      if (!fileInput) {
        const mediaButtonSelectors = [
          '[data-testid="attachments"]',
          '[aria-label="Add photos or video"]',
          '[data-testid="toolBar"] [aria-label*="photo"]'
        ];
        
        for (const selector of mediaButtonSelectors) {
          try {
            const element = await this.page.$(selector);
            if (element) {
              console.log(`🔍 Found media button: ${selector}`);
              await element.click();
              console.log('✅ Media upload button clicked');
              await this.page.waitForTimeout(1000);
              
              // Cek ulang file input
              for (const selectorInput of fileInputSelectors) {
                fileInput = await this.page.$(selectorInput);
                if (fileInput) {
                  console.log(`🔍 Found file input after clicking media button: ${selectorInput}`);
                  break;
                }
              }
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      if (!fileInput) {
        throw new Error('Could not find file input for image upload.');
      }
      
      console.log(`📁 Uploading files: ${imagePaths.join(', ')}`);
      
      // Upload all images at once
      await fileInput.uploadFile(...imagePaths);
      
      console.log('⏳ Waiting for images to be processed...');
      
      // Wait for images to be processed with longer timeout
      await this.page.waitForTimeout(5000);
      
      // Verify images were uploaded with multiple attempts - reduced to prevent stuck
      let uploadedImages = [];
      let attempts = 0;
      const maxAttempts = 3; // Reduced from 5 to 3
      
      // Multiple selectors to find uploaded media
      const mediaSelectors = [
        '[data-testid="media"]',
        '[data-testid="attachments"] img',
        '[aria-label*="Image"]',
        '.css-1dbjc4n img[src*="blob:"]',
        '.css-1dbjc4n img[src*="data:"]',
        '[role="img"]',
        'img[alt*="Image"]'
      ];
      
      while (attempts < maxAttempts) {
        uploadedImages = [];
        
        // Try all selectors to find uploaded media
        for (const selector of mediaSelectors) {
          try {
            const elements = await this.page.$$(selector);
            if (elements.length > 0) {
              console.log(`🔍 Found ${elements.length} elements with selector: ${selector}`);
              uploadedImages = elements;
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (uploadedImages.length === imagePaths.length) {
          break;
        }
        
        console.log(`⏳ Attempt ${attempts + 1}: Found ${uploadedImages.length}/${imagePaths.length} images`);
        
        // Debug: Log all images on the page (only on last attempt to reduce processing)
        if (attempts === maxAttempts - 1) {
          try {
            const allImages = await this.page.$$eval('img', imgs => 
              imgs.map(img => ({ src: img.src, alt: img.alt, className: img.className }))
            );
            console.log('🔍 All images on page:', JSON.stringify(allImages, null, 2));
          } catch (debugError) {
            console.log('⚠️ Could not debug images:', debugError.message);
          }
        }
        
        await this.page.waitForTimeout(1500); // Reduced from 2000ms
        attempts++;
      }
      
      if (uploadedImages.length !== imagePaths.length) {
        console.warn(`⚠️ Expected ${imagePaths.length} images, found ${uploadedImages.length} after ${maxAttempts} attempts`);
        // Take a screenshot for debugging with timeout
        try {
          await Promise.race([
            this.page.screenshot({ path: `temp/image_upload_issue_${Date.now()}.png` }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 3000))
          ]);
        } catch (screenshotError) {
          console.warn('⚠️ Could not take debug screenshot:', screenshotError.message);
        }
        // Don't throw error, continue with whatever images were uploaded
      }
      
      console.log(`✅ Images uploaded successfully: ${uploadedImages.length}/${imagePaths.length}`);
      
      // Additional wait to ensure images are fully processed
      await this.page.waitForTimeout(3000);
      
      // Check if there are any error indicators
      const errorElements = await this.page.$$('[data-testid="error"], .error, [aria-label*="error"]');
      if (errorElements.length > 0) {
        console.warn('⚠️ Found error indicators on page');
        await this.page.screenshot({ path: `temp/upload_errors_${Date.now()}.png` });
      }
      
    } catch (error) {
      console.error('❌ Error uploading images:', error);
      throw error;
    }
  }

  async addCaption(caption) {
    try {
      console.log('📝 Adding caption...');
      
      // Find the tweet text area with multiple selectors
      const textAreaSelectors = [
        '[data-testid="tweetTextarea_0"]',
        '[role="textbox"]',
        '.public-DraftEditor-content',
        '[contenteditable="true"]'
      ];
      
      let textArea = null;
      for (const selector of textAreaSelectors) {
        try {
          textArea = await this.page.waitForSelector(selector, { timeout: 5000 });
          if (textArea) {
            console.log(`🔍 Found text area: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!textArea) {
        throw new Error('Could not find tweet text area');
      }
      
      // Clear any existing text and add caption
      await textArea.click();
      await this.page.waitForTimeout(500);
      
      // Select all and delete
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyA');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Backspace');
      
      await this.page.waitForTimeout(500);
      
      // Type the caption with delay to avoid being flagged as bot
      console.log(`📝 Typing caption: ${caption.substring(0, 50)}...`);
      await this.page.type('[data-testid="tweetTextarea_0"]', caption, { delay: 50 });
      
      // Verify caption was added - check multiple properties
      await this.page.waitForTimeout(1000);
      const textAreaElement = await this.page.$('[data-testid="tweetTextarea_0"]');
      
      if (textAreaElement) {
        const textInfo = await this.page.evaluate(el => {
          return {
            textContent: el.textContent || '',
            innerText: el.innerText || '',
            value: el.value || '',
            innerHTML: el.innerHTML || ''
          };
        }, textAreaElement);
        
        const hasContent = textInfo.textContent.includes(caption.substring(0, 20)) || 
                          textInfo.innerText.includes(caption.substring(0, 20)) ||
                          textInfo.value.includes(caption.substring(0, 20));
        
        if (hasContent) {
          console.log('✅ Caption added and verified successfully');
          console.log(`📝 Content found: ${textInfo.textContent || textInfo.innerText || textInfo.value}`);
        } else {
          console.warn('⚠️ Caption may not have been added correctly');
          console.log(`Expected: ${caption.substring(0, 50)}...`);
          console.log('Text area content:', textInfo);
          
          // Try alternative method - focus and clear, then type again
          console.log('🔄 Trying alternative caption method...');
          await textArea.focus();
          await this.page.waitForTimeout(500);
          
          // Clear with keyboard shortcuts
          await this.page.keyboard.down('Control');
          await this.page.keyboard.press('KeyA');
          await this.page.keyboard.up('Control');
          await this.page.waitForTimeout(200);
          
          // Type character by character
          for (const char of caption) {
            await this.page.keyboard.type(char, { delay: 100 });
          }
          
          await this.page.waitForTimeout(1000);
        }
      }
      
      // Add space character to dismiss hashtag suggestions and ensure Post button is enabled
      console.log('🔄 Adding space character to dismiss hashtag suggestions...');
      await this.page.keyboard.type(' ');
      await this.page.waitForTimeout(200);
      
      console.log('✅ Caption finalized with space character');
      
    } catch (error) {
      console.error('❌ Error adding caption:', error);
      throw error;
    }
  }

  async publishTweet() {
    try {
      console.log('🚀 Publishing tweet...');
      
      // Brief wait for UI to stabilize
      await this.page.waitForTimeout(1000);
      
      const maxPublishAttempts = 5; // Increased from 3 to 5 attempts
      let publishSuccess = false;
      
      for (let publishAttempt = 0; publishAttempt < maxPublishAttempts; publishAttempt++) {
        console.log(`🔄 Tweet publish attempt ${publishAttempt + 1}/${maxPublishAttempts}`);
        
        // Check if modal is still open before attempting to click
        const modalStillOpen = await this.isComposeModalOpen();
        if (!modalStillOpen) {
          console.log('✅ Compose modal already closed - tweet may have been posted');
          break;
        }
        
        // Find and validate Post button
        const postButton = await this.findPostButton();
        if (!postButton) {
          if (publishAttempt === maxPublishAttempts - 1) {
            throw new Error('Could not find post button after all attempts');
          }
          console.log('⚠️ Post button not found, retrying...');
          await this.page.waitForTimeout(2000);
          continue;
        }
        
        // Check if button is enabled and try to enable it if needed
        const buttonEnabled = await this.ensurePostButtonEnabled(postButton);
        if (!buttonEnabled) {
          console.log(`⚠️ Post button still disabled on attempt ${publishAttempt + 1}`);
          if (publishAttempt < maxPublishAttempts - 1) {
            await this.page.waitForTimeout(2000);
            continue;
          }
        }
        
        // Attempt to click the Post button
        const clickResult = await this.attemptPostButtonClick(postButton, publishAttempt + 1);
        if (clickResult.success) {
          publishSuccess = true;
          break;
        }
        
        // If click failed and we have more attempts, wait and retry
        if (publishAttempt < maxPublishAttempts - 1) {
          console.log(`🔄 Post button click failed, retrying in 3 seconds...`);
          await this.page.waitForTimeout(3000);
        }
      }
      
      // Final check for persistent modal after all attempts
      const finalModalCheck = await this.isComposeModalOpen();
      if (finalModalCheck) {
        console.warn(`⚠️ WARNING: Compose modal still open after ${maxPublishAttempts} attempts - tweet may not have been posted`);
        if (this.logger) {
          await this.logger.log(`⚠️ WARNING: Tweet posting may have failed - modal still open after ${maxPublishAttempts} attempts`, 'warning');
        }
      }
      
      if (!publishSuccess && finalModalCheck) {
        throw new Error(`Tweet posting failed - modal still open after ${maxPublishAttempts} attempts`);
      }
      
      return await this.verifyTweetSuccess();
      
    } catch (error) {
      console.error('❌ Error publishing tweet:', error);
      throw error;
    }
  }
  
  async isComposeModalOpen() {
    try {
      const composeModal = await this.page.$('[data-testid="tweetTextarea_0"]');
      const currentUrl = this.page.url();
      const onComposePage = currentUrl.includes('/compose/tweet');
      
      return !!(composeModal || onComposePage);
    } catch (error) {
      console.error('❌ Error checking compose modal state:', error);
      return true; // Assume modal is open if we can't check
    }
  }
  
  async findPostButton() {
    const postButtonSelectors = [
      '[data-testid="tweetButton"]',
      '[data-testid="tweetButtonInline"]', 
      'button[data-testid="tweetButton"]',
      'button[role="button"]:has-text("Post")',
      'button:has(span:text("Post"))',
      'button[role="button"] span:text("Post")',
      'button[role="button"] div span:text("Post")',
      '[aria-label*="Post"]',
      'button[data-testid*="tweet"]',
      'button:has([data-testid*="tweet"])',
      'div[role="button"]:has-text("Post")',
      'div[role="button"]:has(span:text("Post"))'
    ];
    
    for (const selector of postButtonSelectors) {
      try {
        const button = await this.page.waitForSelector(selector, { timeout: 2000 });
        if (button) {
          console.log(`✅ Found post button with selector: ${selector}`);
          return button;
        }
      } catch (e) {
        continue;
      }
    }
    
    console.log('⚠️ No post button found with any selector');
    return null;
  }
  
  async ensurePostButtonEnabled(postButton) {
    try {
      const isDisabled = await this.page.evaluate(button => {
        return button.disabled || button.getAttribute('aria-disabled') === 'true' || 
               button.classList.contains('disabled') || 
               getComputedStyle(button).pointerEvents === 'none';
      }, postButton);
      
      if (isDisabled) {
        console.log('⏳ Post button disabled, attempting activation...');
        
        // Try multiple activation methods
        const activationMethods = [
          // Method 1: Click textarea
          async () => {
            const textArea = await this.page.$('[data-testid="tweetTextarea_0"]');
            if (textArea) {
              await textArea.click();
              await this.page.waitForTimeout(500);
            }
          },
          // Method 2: Focus and type space then backspace
          async () => {
            const textArea = await this.page.$('[data-testid="tweetTextarea_0"]');
            if (textArea) {
              await textArea.focus();
              await this.page.keyboard.type(' ');
              await this.page.keyboard.press('Backspace');
              await this.page.waitForTimeout(500);
            }
          },
          // Method 3: Trigger input event
          async () => {
            await this.page.evaluate(() => {
              const textArea = document.querySelector('[data-testid="tweetTextarea_0"]');
              if (textArea) {
                textArea.dispatchEvent(new Event('input', { bubbles: true }));
                textArea.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });
            await this.page.waitForTimeout(500);
          }
        ];
        
        for (const method of activationMethods) {
          try {
            await method();
            
            // Check if button is now enabled
            const stillDisabled = await this.page.evaluate(button => {
              return button.disabled || button.getAttribute('aria-disabled') === 'true';
            }, postButton);
            
            if (!stillDisabled) {
              console.log('✅ Post button successfully enabled');
              return true;
            }
          } catch (e) {
            continue;
          }
        }
        
        console.log('⚠️ Post button still disabled after activation attempts');
        return false;
      }
      
      return true; // Button was already enabled
    } catch (error) {
      console.error('❌ Error checking/enabling post button:', error);
      return false;
    }
  }
  
  async attemptPostButtonClick(postButton, attemptNumber) {
    const clickMethods = [
      // Method 1: Normal click
      async (button) => {
        await button.click();
        return 'normal click';
      },
      // Method 2: JavaScript click
      async (button) => {
        await this.page.evaluate(btn => btn.click(), button);
        return 'javascript click';
      },
      // Method 3: Coordinate click
      async (button) => {
        const box = await button.boundingBox();
        if (box) {
          await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          return 'coordinate click';
        }
        throw new Error('Could not get button coordinates');
      },
      // Method 4: Force click with keyboard
      async (button) => {
        await button.focus();
        await this.page.keyboard.press('Enter');
        return 'keyboard enter';
      },
      // Method 5: Force click with space
      async (button) => {
        await button.focus();
        await this.page.keyboard.press('Space');
        return 'keyboard space';
      }
    ];
    
    for (let methodIndex = 0; methodIndex < clickMethods.length; methodIndex++) {
      try {
        const methodName = await clickMethods[methodIndex](postButton);
        console.log(`✅ Post button click executed (${methodName}) - attempt ${attemptNumber}`);
        
        // Wait and check if click was successful
        await this.page.waitForTimeout(2000);
        
        const clickSuccess = await this.validatePostButtonClick();
        if (clickSuccess.success) {
          console.log(`✅ Post button click successful: ${clickSuccess.reason}`);
          return { success: true, method: methodName, reason: clickSuccess.reason };
        }
        
        console.log(`⚠️ Click method '${methodName}' did not succeed: ${clickSuccess.reason}`);
        
        // If this isn't the last method, wait a bit before trying next method
        if (methodIndex < clickMethods.length - 1) {
          await this.page.waitForTimeout(1000);
        }
        
      } catch (clickError) {
        console.error(`❌ Click method ${methodIndex + 1} failed:`, clickError.message);
        continue;
      }
    }
    
    return { success: false, reason: 'All click methods failed' };
  }
  
  async validatePostButtonClick() {
    try {
      // Check 1: URL changed away from compose
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/compose/tweet')) {
        return { success: true, reason: 'navigated away from compose page' };
      }
      
      // Check 2: Compose modal disappeared
      const composeModal = await this.page.$('[data-testid="tweetTextarea_0"]');
      if (!composeModal) {
        return { success: true, reason: 'compose modal disappeared' };
      }
      
      // Check 3: Success notification appeared
      const successNotification = await this.page.evaluate(() => {
        const allText = document.body.innerText;
        return allText.includes('Your post was sent') || 
               allText.includes('Post was sent') ||
               allText.includes('Tweet sent');
      });
      
      if (successNotification) {
        return { success: true, reason: 'success notification found' };
      }
      
      // Check 4: Post button state changed (became disabled or disappeared)
      const postButton = await this.findPostButton();
      if (!postButton) {
        return { success: true, reason: 'post button disappeared' };
      }
      
      const isDisabled = await this.page.evaluate(button => {
        return button.disabled || button.getAttribute('aria-disabled') === 'true';
      }, postButton);
      
      if (isDisabled) {
        // Button disabled could mean posting in progress, wait a bit more
        await this.page.waitForTimeout(1000);
        const modalStillThere = await this.page.$('[data-testid="tweetTextarea_0"]');
        if (!modalStillThere) {
          return { success: true, reason: 'button disabled and modal disappeared' };
        }
      }
      
      return { success: false, reason: 'no success indicators detected' };
      
    } catch (error) {
      console.error('❌ Error validating post button click:', error);
      return { success: false, reason: `validation error: ${error.message}` };
    }
  }

  async extractTweetUrlFromPage() {
    // First, check if we're already on a tweet page
    let currentUrl = this.page.url();
    if (currentUrl.includes('/status/')) {
      console.log('🔗 Found tweet URL from current page:', currentUrl);
      return currentUrl;
    }
    
    // Look for status links in the current page DOM (most reliable for just-posted tweets)
    try {
      console.log('🔍 Searching for tweet links in current page DOM...');
      const tweetLinks = await this.page.$$eval('a[href*="/status/"]', els => {
        return els.map(el => {
          const href = el.href;
          const statusMatch = href.match(/\/status\/(\d+)/);
          const tweetId = statusMatch ? statusMatch[1] : null;
          return { href, tweetId, timestamp: tweetId ? parseInt(tweetId) : 0 };
        })
        .filter(item => item.tweetId)
        .sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first
      });
      
      if (tweetLinks && tweetLinks.length > 0) {
        const newestTweet = tweetLinks[0];
        console.log('🔗 Found tweet URL from DOM (newest):', newestTweet.href);
        console.log(`📅 Tweet ID: ${newestTweet.tweetId}`);
        return newestTweet.href;
      }
    } catch (e) {
      console.log('⚠️ Could not extract tweet links from DOM:', e.message);
    }
    
    // If no status links found in current page, navigate to profile as fallback
    try {
      console.log('🔍 Checking profile for latest tweet...');
      const profileUrl = `https://x.com/${config.twitter.username}`;
      console.log(`🔗 Navigating to profile: ${profileUrl}`);
      
      await this.page.goto(profileUrl, {
        waitUntil: 'networkidle2', 
        timeout: 15000
      });
      await this.page.waitForTimeout(3000); // Wait for tweets to load
      
      // Scroll slightly to ensure tweets are loaded
      await this.page.evaluate(() => window.scrollTo(0, 300));
      await this.page.waitForTimeout(2000);
      
      const tweetLinks = await this.page.$$eval('a[href*="/status/"]', els => {
        return els.map(el => {
          const href = el.href;
          const statusMatch = href.match(/\/status\/(\d+)/);
          const tweetId = statusMatch ? statusMatch[1] : null;
          return { href, tweetId, timestamp: tweetId ? parseInt(tweetId) : 0 };
        })
        .filter(item => item.tweetId)
        .sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first
      });
      
      if (tweetLinks && tweetLinks.length > 0) {
        const latestTweet = tweetLinks[0];
        console.log('🔗 Found latest tweet URL from profile:', latestTweet.href);
        console.log(`📅 Tweet ID: ${latestTweet.tweetId}`);
        return latestTweet.href;
      } else {
        console.log('⚠️ No tweet links found on profile page');
      }
    } catch (e) {
      console.log('⚠️ Could not check profile for tweet URL:', e.message);
    }
    
    // If all methods fail, throw error
    console.error('❌ Could not find tweet URL - posting may have failed');
    throw new Error('Unable to extract tweet URL - tweet may not have been posted successfully');
  }

  async verifyTweetSuccess() {
    console.log('⏳ Waiting for tweet to be published...');
    
    // Wait for actual indicators of successful posting
    const maxWaitTime = 20000; // 20 seconds max wait
    const checkInterval = 1000; // Check every 1 second
    let waitTime = 0;
    
    while (waitTime < maxWaitTime) {
      try {
        // Check if we navigated to a tweet URL (most reliable indicator)
        const currentUrl = this.page.url();
        if (currentUrl.includes('/status/')) {
          console.log('✅ Tweet published successfully - navigated to tweet URL');
          console.log(`🔗 Tweet URL: ${currentUrl}`);
          return currentUrl;
        }
        
        // Check for 'View' button/link that appears after successful posting
        const viewButtonFound = await this.page.evaluate(() => {
          const statusLinks = Array.from(document.querySelectorAll('a[href*="/status/"]'));
          for (const link of statusLinks) {
            const linkText = link.textContent || link.innerText || '';
            if (linkText.toLowerCase().includes('view')) {
              return { found: true, href: link.href };
            }
            // Also check for spans inside the link
            const spans = link.querySelectorAll('span');
            for (const span of spans) {
              const spanText = span.textContent || span.innerText || '';
              if (spanText.toLowerCase().includes('view')) {
                return { found: true, href: link.href };
              }
            }
          }
          return { found: false };
        });
        
        if (viewButtonFound.found) {
          console.log('✅ Tweet published successfully - View button found');
          console.log(`🔗 Tweet URL from View button: ${viewButtonFound.href}`);
          return viewButtonFound.href;
        }
        
        // Check for success notification banner "Your post was sent. View"
        const successNotification = await this.page.evaluate(() => {
          const allText = document.body.innerText;
          return allText.includes('Your post was sent') || allText.includes('Post was sent');
        });
        
        if (successNotification) {
          console.log('✅ Tweet published successfully - success notification found');
          // Look for any status URL in the page after success notification
          const statusLinks = await this.page.$$eval('a[href*="/status/"]', els => 
            els.map(el => el.href).filter(href => href.includes('/status/'))
          );
          
          if (statusLinks && statusLinks.length > 0) {
            // Get the most recent status URL (highest ID number)
            const sortedLinks = statusLinks.sort((a, b) => {
              const aId = a.match(/\/status\/(\d+)/)?.[1] || '0';
              const bId = b.match(/\/status\/(\d+)/)?.[1] || '0';
              return parseInt(bId) - parseInt(aId);
            });
            console.log(`🔗 Tweet URL from notification: ${sortedLinks[0]}`);
            return sortedLinks[0];
          }
          
          // If notification found but no status link yet, wait a bit more
          await this.page.waitForTimeout(3000);
          return await this.extractTweetUrlFromPage();
        }
        
        // Check if compose modal completely disappeared AND we're not on compose page
        const currentUrlCheck = this.page.url();
        const composeModal = await this.page.$('[data-testid="tweetTextarea_0"]');
        
        if (!composeModal && !currentUrlCheck.includes('/compose')) {
          console.log('✅ Tweet published successfully - compose modal disappeared and left compose page');
          await this.page.waitForTimeout(3000);
          return await this.extractTweetUrlFromPage();
        }
        
        console.log(`⏳ Still waiting for tweet to be published... (${waitTime/1000}s)`);
        await this.page.waitForTimeout(checkInterval);
        waitTime += checkInterval;
        
      } catch (error) {
        console.error(`❌ Error during verification (${waitTime/1000}s):`, error.message);
        await this.page.waitForTimeout(checkInterval);
        waitTime += checkInterval;
      }
    }
    
    // If we reach here, posting may have failed
    console.error('❌ Tweet posting verification timed out - tweet may not have been posted');
    throw new Error('Tweet posting verification failed - no success indicators found within timeout period');
  }

  async closeBrowser() {
    try {
      if (this.browser) {
        // Force close browser with timeout to prevent hanging
        await Promise.race([
          this.browser.close(),
          new Promise((resolve) => {
            setTimeout(() => {
              console.log('⚡ Force killing browser process due to timeout');
              try {
                if (this.browser && this.browser.process()) {
                  this.browser.process().kill('SIGKILL');
                }
              } catch (killError) {
                console.error('❌ Error force killing browser:', killError);
              }
              resolve();
            }, 5000); // 5 second timeout for browser close
          })
        ]);
        console.log('🌐 Browser closed');
      }
    } catch (error) {
      console.error('❌ Error closing browser:', error);
      // Force cleanup even if close failed
      try {
        if (this.browser && this.browser.process()) {
          this.browser.process().kill('SIGKILL');
        }
      } catch (killError) {
        console.error('❌ Error in force cleanup:', killError);
      }
    } finally {
      // Always reset state
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
    }
  }

  async captureErrorScreenshot(attempt) {
    try {
      if (this.page) {
        const screenshotPath = path.join(config.paths.temp, `twitter_error_attempt_${attempt + 1}_${Date.now()}.png`);
        
        // Use viewport screenshot instead of fullPage to avoid dimension issues
        await this.page.screenshot({ 
          path: screenshotPath, 
          fullPage: false,
          clip: {
            x: 0,
            y: 0,
            width: Math.min(1920, await this.page.evaluate(() => window.innerWidth)),
            height: Math.min(1080, await this.page.evaluate(() => window.innerHeight))
          }
        });
        console.log(`📸 Error screenshot saved: ${screenshotPath}`);
        
        if (this.logger) {
          await this.logger.sendPhoto(screenshotPath, `❌ Twitter error screenshot (attempt ${attempt + 1})`);
        }
      }
    } catch (error) {
      console.error('❌ Error capturing screenshot:', error);
    }
  }

  async captureLoginErrorScreenshot() {
    try {
      if (this.page) {
        const screenshotPath = path.join(config.paths.temp, `twitter_login_error_${Date.now()}.png`);
        
        // Use viewport screenshot instead of fullPage to avoid dimension issues
        await this.page.screenshot({ 
          path: screenshotPath, 
          fullPage: false,
          clip: {
            x: 0,
            y: 0,
            width: Math.min(1920, await this.page.evaluate(() => window.innerWidth)),
            height: Math.min(1080, await this.page.evaluate(() => window.innerHeight))
          }
        });
        console.log(`📸 Login error screenshot saved: ${screenshotPath}`);
        
        if (this.logger) {
          await this.logger.sendPhoto(screenshotPath, '🔐 Twitter login failed - Manual intervention may be required');
        }
      }
    } catch (error) {
      console.error('❌ Error capturing login screenshot:', error);
    }
  }

  async testLogin() {
    try {
      await this.initializeBrowser();
      await this.ensureLoggedIn();
      console.log('✅ Twitter login test successful');
      return true;
    } catch (error) {
      console.error('❌ Twitter login test failed:', error);
      return false;
    } finally {
      await this.closeBrowser();
    }
  }
}

module.exports = new TwitterPoster();