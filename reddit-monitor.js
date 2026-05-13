import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUBREDDITS = [
  "SaaS", "indiehackers", "entrepreneur", "solopreneur",
  "SideProject", "marketing", "linkedin", "TwitterMarketing",
];

const KEYWORDS = {
  pain: [
    "repurpose content", "cross post to linkedin", "x thread to linkedin",
    "rewrite for linkedin", "post on multiple platforms", "content distribution",
    "grow on linkedin", "linkedin post from twitter", "thread repurposer", "save time posting",
  ],
  audience: [
    "solo founder", "indie hacker", "building in public", "bootstrapped founder",
    "solopreneur", "content creator", "developer founder", "maker", "side project", "indiehacker",
  ],
  intent: [
    "get more reach", "grow audience", "linkedin growth", "reddit traffic",
    "drive traffic from reddit", "content repurposing tool", "automate linkedin posts",
    "build in public", "founder content strategy", "distribution strategy",
  ],
};

const POINTS = { pain: 3, audience: 2, intent: 1 };
const DELAY_MS = 6000;
const DATA_PATH = path.join(__dirname, "data", "opportunities.json");

// Reddit allows RSS from anywhere — no IP blocking
const USER_AGENT = "crosstalk-monitor/1.0 (by Bundepunemmanuel)";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scorePost(title, body) {
  const text = `${title} ${body}`.toLowerCase();
  let score = 0;
  const matched = [];
  for (const [category, keywords] of Object.entries(KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        score += POINTS[category];
        matched.push({ keyword: kw, category });
      }
    }
  }
  return { score, matched };
}

// Parse Reddit RSS feed — always works, never blocked
async function fetchRSS(subreddit, sort = "new") {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}/.rss?limit=50`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
    });

    if (!res.ok) {
      console.warn(`[WARN] r/${subreddit} RSS ${sort} → HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const posts = [];

    // Parse entries from Atom feed
    const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);

    for (const match of entryMatches) {
      const entry = match[1];

      const id = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim() ?? "";
      const title = (entry.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]
        ?.replace(/<!\[CDATA\[|\]\]>/g, "")?.trim() ?? "";
      const link = (entry.match(/<link[^>]*href="([^"]+)"/) || [])[1]?.trim() ?? "";
      const content = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1]
        ?.replace(/<!\[CDATA\[|\]\]>/g, "")
        ?.replace(/<[^>]+>/g, " ")
        ?.trim() ?? "";
      const updated = (entry.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1]?.trim() ?? "";

      // Extract post ID from the URL
      const postIdMatch = link.match(/comments\/([a-z0-9]+)\//);
      const postId = postIdMatch?.[1] ?? id.split("_").pop();

      if (!postId || !title) continue;

      posts.push({
        id: postId,
        title,
        body: content.slice(0, 500),
        url: link,
        permalink: link.replace("https://www.reddit.com", ""),
        createdAt: updated ? new Date(updated).getTime() : Date.now(),
        upvotes: 0,
        commentCount: 0,
        subreddit,
      });
    }

    console.log(`[OK] r/${subreddit}/${sort} RSS → ${posts.length} posts`);
    return posts;
  } catch (err) {
    console.warn(`[WARN] r/${subreddit} RSS failed: ${err.message}`);
    return [];
  }
}

async function run() {
  console.log("[START] Reddit monitor running via RSS...");

  let existing = [];
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    existing = JSON.parse(raw).opportunities ?? [];
  } catch {
    existing = [];
  }

  const existingIds = new Set(existing.map((p) => p.id));
  const found = new Map();

  for (const subreddit of SUBREDDITS) {
    console.log(`\n[SCAN] r/${subreddit}`);

    const newPosts = await fetchRSS(subreddit, "new");
    await sleep(DELAY_MS);
    const hotPosts = await fetchRSS(subreddit, "hot");
    await sleep(DELAY_MS);

    for (const post of [...newPosts, ...hotPosts]) {
      if (!post?.id || found.has(post.id) || existingIds.has(post.id)) continue;
      const { score, matched } = scorePost(post.title, post.body);
      if (score === 0) continue;
      found.set(post.id, { ...post, score, matched, topComments: [], drafted: false, done: false, fetchedAt: Date.now() });
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n[FOUND] ${found.size} matching posts`);

  // Merge + deduplicate
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const kept = existing.filter((p) => !p.done || p.fetchedAt > sevenDaysAgo);
  const newList = [...found.values()].sort((a, b) => b.score - a.score);
  const merged = [...newList, ...kept];

  const seen = new Set();
  const deduped = merged.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify({
    lastUpdated: new Date().toISOString(),
    totalFound: newList.length,
    opportunities: deduped,
  }, null, 2));

  console.log(`[DONE] ${newList.length} new posts. ${deduped.length} total in feed.`);
}

run().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
        
