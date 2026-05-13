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

// Safe delays to avoid Reddit rate limiting
const DELAY_BETWEEN_REQUESTS_MS = 5000;  // 5s between requests
const DELAY_BETWEEN_SUBREDDITS_MS = 10000; // 10s between subreddits

const DATA_PATH = path.join(__dirname, "data", "opportunities.json");

// Reddit requires a real-looking User-Agent or it 403s
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

// Fetch new OR hot posts from a subreddit — no search endpoint (blocked by Reddit on cloud IPs)
async function fetchSubredditFeed(subreddit, sort = "new") {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=100`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!res.ok) {
      console.warn(`[WARN] r/${subreddit} ${sort} → HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    const posts = json?.data?.children?.map((c) => c.data) ?? [];
    console.log(`[OK] r/${subreddit}/${sort} → ${posts.length} posts`);
    return posts;
  } catch (err) {
    console.warn(`[WARN] r/${subreddit} ${sort} failed: ${err.message}`);
    return [];
  }
}

async function fetchTopComments(permalink) {
  try {
    const url = `https://www.reddit.com${permalink}.json?limit=5`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
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

  // Load existing to avoid duplicates
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

    // Fetch both new and hot to maximise coverage
    const newPosts = await fetchSubredditFeed(subreddit, "new");
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
    const hotPosts = await fetchSubredditFeed(subreddit, "hot");
    await sleep(DELAY_BETWEEN_REQUESTS_MS);

    const allPosts = [...newPosts, ...hotPosts];

    for (const post of allPosts) {
      if (!post?.id) continue;
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

    await sleep(DELAY_BETWEEN_SUBREDDITS_MS);
  }

  console.log(`\n[FOUND] ${found.size} matching posts before comment fetch`);

  // Fetch comments for top scoring posts only
  const topPosts = [...found.values()]
    .filter((p) => p.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  for (const post of topPosts) {
    console.log(`[COMMENTS] ${post.title.slice(0, 50)}...`);
    post.topComments = await fetchTopComments(post.permalink);
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  // Merge with existing, keep undone posts, drop done posts older than 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const kept = existing.filter((p) => !p.done || p.fetchedAt > sevenDaysAgo);

  const newList = [...found.values()].sort((a, b) => b.score - a.score);
  const merged = [...newList, ...kept];

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
        totalFound: newList.length,
        opportunities: deduped,
      },
      null,
      2
    )
  );

  console.log(`\n[DONE] ${newList.length} new posts. ${deduped.length} total in feed.`);
}

run().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
                            
