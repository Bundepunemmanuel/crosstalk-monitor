# Crosstalk Reddit Monitor

Finds Reddit posts where your target audience is feeling the exact pain Crosstalk solves. Drafts founder-to-founder replies using Groq AI. Runs every 4 hours for free.

---

## What it does

- Scans 8 subreddits every 4 hours via GitHub Actions
- Scores posts against 30 keywords (pain, audience, intent)
- Saves top opportunities to `data/opportunities.json`
- Dashboard fetches that file and shows ranked posts
- Click "Draft Reply" → Groq writes 3 variations (soft / medium / direct)
- Continue the thread: paste what the user replied, get your next reply
- Mark posts as done when you've replied

**Total cost: $0**

---

## Folder structure

```
crosstalk-monitor/
├── .github/
│   └── workflows/
│       └── automation.yml       ← runs every 4hrs on GitHub Actions
├── data/
│   └── opportunities.json       ← auto-updated by the script
├── dashboard/
│   ├── src/
│   │   ├── App.jsx              ← the full dashboard
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── reddit-monitor.js            ← the scanner script
├── package.json
└── README.md
```

---

## Step 1 — Create the GitHub repo

1. Go to github.com → New repository
2. Name it `crosstalk-monitor`
3. Set it to **Public** (required for free GitHub Actions minutes)
4. Clone it to your machine:

```bash
git clone https://github.com/YOUR_USERNAME/crosstalk-monitor.git
cd crosstalk-monitor
```

---

## Step 2 — Add the files

Copy these files into your repo exactly as structured above:

- `reddit-monitor.js` → root
- `.github/workflows/automation.yml` → exactly that path
- `data/opportunities.json` → root (the empty seed file)
- `dashboard/src/App.jsx` → inside dashboard folder
- `dashboard/src/main.jsx` → see content below
- `dashboard/index.html` → see content below
- `dashboard/package.json` → see content below
- `dashboard/vite.config.js` → see content below

---

## Step 3 — Dashboard setup files

Create `dashboard/src/main.jsx`:

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `dashboard/src/index.css`:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #080e1a; color: #e2e8f0; }
```

Create `dashboard/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Crosstalk Monitor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Create `dashboard/package.json`:

```json
{
  "name": "crosstalk-monitor-dashboard",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.8"
  }
}
```

Create `dashboard/vite.config.js`:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

---

## Step 4 — Root package.json

Create `package.json` in the root (for the script):

```json
{
  "name": "crosstalk-monitor",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "scan": "node reddit-monitor.js"
  }
}
```

---

## Step 5 — Update the GitHub raw URL in App.jsx

Open `dashboard/src/App.jsx` and find this line near the top:

```js
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/Bundepunemmanuel/Crosstalk/main/data/opportunities.json";
```

Replace it with your actual repo:

```js
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/YOUR_USERNAME/crosstalk-monitor/main/data/opportunities.json";
```

---

## Step 6 — Push everything to GitHub

```bash
git add .
git commit -m "init: crosstalk monitor"
git push
```

---

## Step 7 — Deploy dashboard to Vercel

1. Go to vercel.com → New Project
2. Import your `crosstalk-monitor` GitHub repo
3. Set **Root Directory** to `dashboard`
4. Framework preset: **Vite**
5. Click Deploy

That's it. Vercel auto-deploys every time you push.

---

## Step 8 — Add your Groq API key to the dashboard

1. Go to console.groq.com → sign up free
2. Create an API key
3. Open your deployed dashboard
4. Go to **Settings** tab
5. Paste your key → Save Settings

The key is stored only in your browser's localStorage. It never leaves your device.

---

## Step 9 — Trigger the first scan manually

The script runs automatically every 4 hours. To run it immediately:

1. Go to your GitHub repo
2. Click **Actions** tab
3. Click **Reddit Monitor** in the left sidebar
4. Click **Run workflow** → **Run workflow**
5. Wait ~2 minutes
6. Refresh your dashboard — opportunities will appear

---

## How to use the dashboard daily

| Step | Time |
|---|---|
| Open dashboard | 10 sec |
| Scan the feed, sorted by score | 2 min |
| Click "View Post" on the best ones | read the thread |
| Click "Draft Reply" | Groq writes 3 options in ~1 sec |
| Add optional context if needed | 10 sec |
| Copy the best reply, paste to Reddit | 1 min |
| Click "Done" | post disappears |
| If someone replies, paste it in "Continue the thread" | get next reply drafted |

**Total daily time: 10–15 minutes max.**

---

## Scoring system

| Keyword category | Points |
|---|---|
| Pain keywords | 3 pts |
| Audience keywords | 2 pts |
| Intent keywords | 1 pt |

Posts scoring 6+ are your highest priority. Filter by "High Score" in the dashboard to see only these.

---

## Subreddits being monitored

- r/SaaS
- r/indiehackers
- r/entrepreneur
- r/solopreneur
- r/SideProject
- r/marketing
- r/linkedin
- r/TwitterMarketing

You can add or remove subreddits directly in the Settings tab of the dashboard.

---

## Adding keywords or subreddits

You can do this two ways:

**Via the dashboard** (easiest):
- Go to Settings tab
- Add keywords to any category (pain / audience / intent)
- Add new subreddits
- Click Save Settings

Note: dashboard settings affect reply drafting context only. To affect what the GitHub Action scans, also update the `KEYWORDS` and `SUBREDDITS` arrays in `reddit-monitor.js` and push.

**Via code** (affects the scanner):
- Open `reddit-monitor.js`
- Add to the `SUBREDDITS` array or `KEYWORDS` object
- Push to GitHub — next scan picks it up automatically

---

## Reddit safety tips

- Don't reply to more than 5–10 posts per day
- Space your replies across different subreddits
- Build karma in subreddits before dropping your link
- Only mention Crosstalk when someone is clearly asking for a tool
- The "Soft" variant is usually safest in new subreddits

---

## Troubleshooting

**Dashboard shows "Could not load opportunities"**
- Check the `GITHUB_RAW_URL` in App.jsx matches your actual repo username and repo name
- Make sure `data/opportunities.json` exists in your repo (push the seed file)
- Make sure the repo is Public

**GitHub Action fails**
- Go to Actions tab → click the failed run → read the logs
- Most common issue: the `data/` folder doesn't exist — make sure you pushed `data/opportunities.json`

**Groq returns an error**
- Double-check your API key in Settings
- Make sure you're using a valid key from console.groq.com
- Free tier limit is 14,400 requests/day — more than enough

**No opportunities showing after first scan**
- The scanner found posts but they scored 0 — your keywords didn't match
- Try running manually again and checking the Action logs for `[DONE] Found X new posts`
