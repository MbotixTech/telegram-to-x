const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const config = require('./src/config');

class TwitterLogin {
    constructor() {
        this.browser = null;
        this.page = null;
        this.cookiesPath = config.paths.cookies;
    }

    async initBrowser() {
        console.log('🚀 Initializing browser...');
        
        this.browser = await puppeteer.launch({
            headless: false, // Set to false so you can see the login process
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1280,720'
            ],
            defaultViewport: {
                width: 1280,
                height: 720
            }
        });

        this.page = await this.browser.newPage();
        
        // Set user agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('✅ Browser initialized successfully');
    }

    async loadExistingCookies() {
        try {
            if (await fs.pathExists(this.cookiesPath)) {
                console.log('🍪 Loading existing cookies...');
                const cookies = await fs.readJson(this.cookiesPath);
                await this.page.setCookie(...cookies);
                console.log('✅ Cookies loaded successfully');
                return true;
            }
        } catch (error) {
            console.log('⚠️ Could not load existing cookies:', error.message);
        }
        return false;
    }

    async saveCookies() {
        try {
            console.log('💾 Saving cookies...');
            const cookies = await this.page.cookies();
            await fs.ensureDir(path.dirname(this.cookiesPath));
            await fs.writeJson(this.cookiesPath, cookies, { spaces: 2 });
            console.log('✅ Cookies saved successfully to:', this.cookiesPath);
        } catch (error) {
            console.error('❌ Failed to save cookies:', error.message);
            throw error;
        }
    }

    async navigateToTwitter() {
        console.log('🌐 Navigating to Twitter...');
        await this.page.goto('https://twitter.com/login', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log('✅ Twitter login page loaded');
    }

    async checkIfLoggedIn() {
        try {
            console.log('🔍 Checking if already logged in...');
            
            // Navigate to home page to check login status
            await this.page.goto('https://twitter.com/home', {
                waitUntil: 'networkidle2',
                timeout: 15000
            });

            // Wait a bit for the page to load
            await this.page.waitForTimeout(3000);

            // Check if we're on the home page (logged in) or redirected to login
            const currentUrl = this.page.url();
            
            if (currentUrl.includes('/home') || currentUrl.includes('/timeline')) {
                console.log('✅ Already logged in to Twitter!');
                return true;
            } else {
                console.log('❌ Not logged in, need to authenticate');
                return false;
            }
        } catch (error) {
            console.log('⚠️ Could not verify login status:', error.message);
            return false;
        }
    }

    async waitForManualLogin() {
        console.log('\n🔐 MANUAL LOGIN REQUIRED');
        console.log('👆 Please complete the login process in the browser window');
        console.log('📝 Enter your username/email and password');
        console.log('🔒 Complete any 2FA/verification if required');
        console.log('⏳ This script will wait until you are logged in...');
        console.log('\n💡 TIP: Look for the Twitter home feed to confirm login');
        
        // Wait for user to complete login manually
        let isLoggedIn = false;
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes (5 second intervals)
        
        while (!isLoggedIn && attempts < maxAttempts) {
            await this.page.waitForTimeout(5000); // Wait 5 seconds
            attempts++;
            
            try {
                // Check if we're on home page or timeline
                const currentUrl = this.page.url();
                
                if (currentUrl.includes('/home') || currentUrl.includes('/timeline')) {
                    // Double check by looking for compose tweet button or similar
                    const composeButton = await this.page.$('[data-testid="SideNav_NewTweet_Button"]');
                    if (composeButton) {
                        isLoggedIn = true;
                        console.log('\n✅ Login detected! You are now logged in to Twitter.');
                    }
                }
                
                if (!isLoggedIn && attempts % 12 === 0) { // Every minute
                    console.log(`⏳ Still waiting for login... (${Math.floor(attempts/12)} minutes elapsed)`);
                }
                
            } catch (error) {
                // Continue waiting
            }
        }
        
        if (!isLoggedIn) {
            throw new Error('Login timeout - please try again');
        }
        
        return true;
    }

    async performLogin() {
        try {
            // First, try loading existing cookies
            await this.loadExistingCookies();
            
            // Check if already logged in
            if (await this.checkIfLoggedIn()) {
                console.log('🎉 Already authenticated with existing cookies!');
                return true;
            }
            
            // Navigate to login page
            await this.navigateToTwitter();
            
            // Wait for manual login
            await this.waitForManualLogin();
            
            // Save the new cookies
            await this.saveCookies();
            
            console.log('\n🎉 Login process completed successfully!');
            console.log('🍪 Cookies have been saved for future use');
            console.log('🤖 The bot can now use these cookies for automated posting');
            
            return true;
            
        } catch (error) {
            console.error('❌ Login failed:', error.message);
            throw error;
        }
    }

    async closeBrowser() {
        if (this.browser) {
            console.log('🔒 Closing browser...');
            await this.browser.close();
            console.log('✅ Browser closed');
        }
    }

    async takeScreenshot(filename = 'login_screenshot.png') {
        try {
            const screenshotPath = path.join(config.paths.temp, filename);
            await this.page.screenshot({ 
                path: screenshotPath, 
                fullPage: true 
            });
            console.log('📸 Screenshot saved:', screenshotPath);
            return screenshotPath;
        } catch (error) {
            console.error('❌ Failed to take screenshot:', error.message);
        }
    }
}

// Main execution function
async function main() {
    const twitterLogin = new TwitterLogin();
    
    try {
        console.log('🚀 Starting Twitter Login Process...');
        console.log('=' .repeat(50));
        
        await twitterLogin.initBrowser();
        await twitterLogin.performLogin();
        
        console.log('\n' + '=' .repeat(50));
        console.log('✅ LOGIN PROCESS COMPLETED SUCCESSFULLY!');
        console.log('🍪 Cookies saved to:', config.paths.cookies);
        console.log('🤖 You can now run the main bot with these credentials');
        
        // Keep browser open for a few seconds to show success
        console.log('\n⏳ Keeping browser open for 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
    } catch (error) {
        console.error('\n❌ LOGIN FAILED!');
        console.error('Error:', error.message);
        
        // Take screenshot for debugging
        try {
            await twitterLogin.takeScreenshot('login_error.png');
        } catch (screenshotError) {
            // Ignore screenshot errors
        }
        
        process.exit(1);
    } finally {
        await twitterLogin.closeBrowser();
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\n🛑 Process interrupted by user');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Process terminated');
    process.exit(0);
});

// Run the login process
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = TwitterLogin;