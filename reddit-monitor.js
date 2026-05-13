import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SUBREDDITS = [
  "SaaS",
  "indiehackers",
  "entrepreneur",
  "solopreneur",
  "SideProject",
  "marketing",
  "linkedin",
  "TwitterMarketing",
];

const KEYWORDS = {
  pain: [
    "repurpose content",
    "cross post to linkedin",
    "x thread to linkedin",
    "rewrite for linkedin",
    "post on multiple platforms",
    "content distribution",
    "grow on linkedin",
    "linkedin post from twitter",
    "thread repurposer",
    "save time posting",
  ],
  audience: [
    "solo founder",
    "indie hacker",
    "building in public",
    "bootstrapped founder",
    "solopreneur",
    "content creator",
    "developer founder",
    "maker",
    "side project",
    "indiehacker",
  ],
  intent: [
    "get more reach",
    "grow audience",
    "linkedin growth",
    "reddit traffic",
    "drive traffic from reddit",
    "content repurposing tool",
    "automate linkedin posts",
    "build in public",
    "founder content strategy",
    "distribution strategy",
  ],
};

const POINTS = { pain: 3, audience: 2, intent: 1 };

// Longer delays to avoid Reddit rate limiting
const DELAY_BETWEEN_REQUESTS_MS = 4000; // 4 seconds between each request
const DELAY_BETWEEN_SUBREDDITS_MS = 8000; // 8 seconds between subreddits

const DATA_PATH = path.join(__dirname, "data", "opportunities.json");

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchSubredditSearch(subreddit, query) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25&restrict_sr=1`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[WARN] ${subreddit} search "${query}" → HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    return json?.data?.children?.map((c) => c.data) ?? [];
  } catch (err) {
    console.warn(`[WARN] Failed to fetch r/${subreddit} "${query}": ${err.message}`);
    return [];
  }
}

async function fetchTopComments(permalink) {
  try {
    const url = `https://www.reddit.com${permalink}.json?limit=5`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!res.ok) return [];

    const json = await res.json();
    const comments = json?.[1]?.data?.children ?? [];
    return comments
      .filter((c) => c.kind === "t1" && c.data?.body)
      .slice(0, 3)
      .map((c) => c.data.body);
  } catch {
    return [];
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("[START] Reddit monitor running...");

  // Load existing opportunities to avoid duplicates
  let existing = [];
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    existing = JSON.parse(raw).opportunities ?? [];
  } catch {
    existing = [];
  }

  const existingIds = new Set(existing.map((p) => p.id));
  const found = new Map(); // id → post

  // Use a subset of high-signal keyword combos grouped to reduce requests
  const searchQueries = [
    "repurpose content linkedin",
    "x thread linkedin post",
    "content distribution solo founder",
    "solo founder building in public",
    "indie hacker content strategy",
    "grow linkedin audience",
    "thread repurposer tool",
    "cross post twitter linkedin",
    "bootstrapped founder content",
    "automate linkedin posts",
  ];

  for (const subreddit of SUBREDDITS) {
    console.log(`[SCAN] r/${subreddit}`);

    for (const query of searchQueries) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);

      const posts = await fetchSubredditSearch(subreddit, query);

      for (const post of posts) {
        if (found.has(post.id) || existingIds.has(post.id)) continue;

        const { score, matched } = scorePost(post.title, post.selftext ?? "");
        if (score === 0) continue;

        found.set(post.id, {
          id: post.id,
          subreddit: post.subreddit,
          title: post.title,
          body: post.selftext ?? "",
          url: `https://www.reddit.com${post.permalink}`,
          permalink: post.permalink,
          upvotes: post.ups,
          commentCount: post.num_comments,
          createdAt: post.created_utc * 1000,
          score,
          matched,
          topComments: [],
          drafted: false,
          done: false,
          fetchedAt: Date.now(),
        });
      }
    }

    await sleep(DELAY_BETWEEN_SUBREDDITS_MS);
  }

  // Fetch top comments for high-score posts
  const highScore = [...found.values()]
    .filter((p) => p.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  for (const post of highScore) {
    console.log(`[COMMENTS] Fetching comments for: ${post.title.slice(0, 50)}...`);
    post.topComments = await fetchTopComments(post.permalink);
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  // Merge: new posts first, keep existing (not done) ones, drop done ones older than 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const kept = existing.filter(
    (p) => !p.done || p.fetchedAt > sevenDaysAgo
  );

  const newPosts = [...found.values()].sort((a, b) => b.score - a.score);
  const merged = [...newPosts, ...kept];

  // Deduplicate
  const seen = new Set();
  const deduped = merged.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Save
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(
    DATA_PATH,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        totalFound: newPosts.length,
        opportunities: deduped,
      },
      null,
      2
    )
  );

  console.log(
    `[DONE] Found ${newPosts.length} new posts. Total in feed: ${deduped.length}`
  );
}

run().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
