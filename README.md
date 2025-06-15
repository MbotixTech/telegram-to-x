# Telegram to X

Automated Telegram to Twitter posting with watermarking and AI-powered captions.

## Features
- Listens to a Telegram channel for new posts
- Downloads images, applies watermark
- Generates captions and hashtags using AI
- Posts to Twitter automatically
- Uses login session cookies for persistent authentication
- Queue management and retry logic
- Telegram-based logging and notifications

---

## Getting Started

### 1. Clone & Install
```bash
# Clone the repository
# Install dependencies
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory with the following variables:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHANNEL_ID=your_channel_id
TELEGRAM_LOG_GROUP_ID=your_log_group_id
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
GEMINI_API_KEY=your_gemini_api_key
# Optional settings
QUEUE_POST_DELAY=20000
QUEUE_MAX_RETRIES=2
QUEUE_RETRY_DELAY=5000
QUEUE_ENABLED=true
WATERMARK_OPACITY=0.3
WATERMARK_SIZE=0.35
MAX_IMAGES_PER_POST=4
TEMP_CLEANUP_ENABLED=true
LOG_LEVEL=info
```

### 3. Twitter Login Session
This project uses Puppeteer to log in to Twitter and save session cookies for automated posting.

#### To generate a login session:
```bash
node login.js
```
- A browser window will open. Log in to Twitter manually (including 2FA if needed).
- On success, cookies will be saved to `cookies/session.json`.
- These cookies are used for all future automated posts.

If you change your Twitter password or the session expires, re-run `node login.js`.

### 4. Start the Bot
```bash
npm start
```
Or for development with auto-reload:
```bash
npm run dev
```

---

## File Structure
- `index.js` — Main entry, starts the Telegram listener and queue
- `login.js` — Twitter login session generator (manual login, saves cookies)
- `src/` — Core logic (caption builder, hashtag fetcher, watermarking, queue, etc.)
- `cookies/session.json` — Saved Twitter session cookies
- `output/` — Processed images ready for posting
- `presets/` — Caption and hashtag templates
- `watermark/` — Watermark image

---

## Usage Notes
- **Do not share your `cookies/session.json` or `.env` file.**
- If login fails, delete `cookies/session.json` and re-run `node login.js`.
- For troubleshooting, check logs in your Telegram log group.

---

## 📄 License
This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.
