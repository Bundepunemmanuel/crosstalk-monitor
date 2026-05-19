import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ───────────────────────────────────────────────────────────────────

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
const DELAY_MS = 5000;
const DELAY_SUB_MS = 10000;
const DATA_PATH = path.join(__dirname, "data", "opportunities.json");
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function scorePost(title, body) {
  const text = (title + " " + body).toLowerCase();
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

function scoreAskReddit(title) {
  const t = title.toLowerCase();
  const skipWords = ["weekly", "daily thread", "mod ", "announcement", "megathread"];
  for (const s of skipWords) { if (t.includes(s)) return 0; }

  let score = 0;

  const viralFormats = [
    "what is the most", "what are the most", "what was the most",
    "men of reddit", "women of reddit", "people of reddit",
    "people who", "those who", "anyone who",
    "what's your", "what is your", "whats your",
    "have you ever", "did you ever",
    "what do you", "how do you",
    "why do you", "when did you",
    "what would you", "if you could",
    "what made you", "what was it like",
  ];
  for (const f of viralFormats) { if (t.includes(f)) { score += 3; break; } }

  const emotional = [
    "embarrassing", "embarrassed", "awkward", "regret", "regrets",
    "proud", "terrifying", "terrified", "scary", "horrifying",
    "crazy", "insane", "wild", "shocking", "unbelievable",
    "honest", "honestly", "truth", "reality", "actually",
    "worst", "best", "funniest", "strangest", "weirdest",
    "secret", "never told", "finally", "confess", "admit",
  ];
  for (const e of emotional) { if (t.includes(e)) { score += 2; break; } }

  const relatable = [
    "job", "work", "boss", "coworker", "office",
    "relationship", "partner", "date", "dating", "ex",
    "family", "parent", "mom", "dad", "sibling", "childhood",
    "money", "salary", "debt", "rich", "poor",
    "school", "teacher", "college", "student",
    "friend", "friendship", "social",
    "food", "eating", "drink", "sleep", "tired", "habit",
  ];
  for (const r of relatable) { if (t.includes(r)) { score += 1; break; } }

  if (title.length < 80) score += 2;
  else if (title.length < 120) score += 1;

  return score;
}

async function fetchRSS(subreddit, sort = "new") {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}/.rss?limit=100`;
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
    for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const entry = match[1];
      const title = (entry.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]
        ?.replace(/<!\[CDATA\[|\]\]>/g, "")?.trim() ?? "";
      const link = (entry.match(/<link[^>]*href="([^"]+)"/) || [])[1]?.trim() ?? "";
      const content = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1]
        ?.replace(/<!\[CDATA\[|\]\]>/g, "")
        ?.replace(/<[^>]+>/g, " ")
        ?.trim() ?? "";
      const updated = (entry.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1]?.trim() ?? "";
      const postIdMatch = link.match(/comments\/([a-z0-9]+)\//);
      const postId = postIdMatch?.[1] ?? null;
      if (!postId || !title) continue;
      posts.push({
        id: postId, title,
        body: content.slice(0, 500),
        url: link,
        permalink: link.replace("https://www.reddit.com", ""),
        createdAt: updated ? new Date(updated).getTime() : Date.now(),
        upvotes: 0, commentCount: 0, subreddit,
      });
    }
    console.log(`[OK] r/${subreddit}/${sort} → ${posts.length} posts`);
    return posts;
  } catch (err) {
    console.warn(`[WARN] r/${subreddit} RSS failed: ${err.message}`);
    return [];
  }
}

async function fetchAskReddit() {
  console.log("\n[SCAN] r/AskReddit (karma builder)");
  const all = [];
  const seen = new Set();
  for (const sort of ["hot", "new"]) {
    const posts = await fetchRSS("AskReddit", sort);
    await sleep(DELAY_MS);
    for (const post of posts) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      const engScore = scoreAskReddit(post.title);
      if (engScore === 0) continue;
      all.push({ ...post, engScore });
    }
  }
  return all.sort((a, b) => b.engScore - a.engScore).slice(0, 25);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("[START] Reddit monitor running...");

  // Load existing data
  let existing = [];
  let existingKarma = [];
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    existing = parsed.opportunities ?? [];
    existingKarma = parsed.karmaOpportunities ?? [];
  } catch { existing = []; existingKarma = []; }

  // ── FIX: only skip posts marked as done, not ALL existing posts ──
  // This ensures new runs always re-evaluate fresh posts
  const doneIds = new Set(existing.filter((p) => p.done).map((p) => p.id));
  const found = new Map();

  // ── Scan Crosstalk subreddits ──
  for (const subreddit of SUBREDDITS) {
    console.log(`\n[SCAN] r/${subreddit}`);
    const newPosts = await fetchRSS(subreddit, "new");
    await sleep(DELAY_MS);
    const hotPosts = await fetchRSS(subreddit, "hot");
    await sleep(DELAY_MS);

    for (const post of [...newPosts, ...hotPosts]) {
      if (!post?.id || found.has(post.id) || doneIds.has(post.id)) continue;
      const { score, matched } = scorePost(post.title, post.body);
      if (score === 0) continue;
      found.set(post.id, {
        ...post, score, matched,
        topComments: [], drafted: false, done: false, fetchedAt: Date.now(),
      });
    }

    await sleep(DELAY_SUB_MS);
  }

  console.log(`\n[FOUND] ${found.size} matching Crosstalk posts`);

  // ── Scan AskReddit for karma ──
  const karmaPosts = await fetchAskReddit();
  console.log(`[FOUND] ${karmaPosts.length} AskReddit karma posts`);

  // ── Build final opportunities list ──
  // New posts first, then existing undone posts, deduplicated
  const newList = [...found.values()].sort((a, b) => b.score - a.score);
  const existingUndone = existing.filter((p) => !p.done);
  const merged = [...newList, ...existingUndone];

  const seen2 = new Set();
  const deduped = merged.filter((p) => {
    if (seen2.has(p.id)) return false;
    seen2.add(p.id);
    return true;
  });

  // ── Build final karma list ──
  // Always replace with fresh AskReddit posts, keep undone old ones not in new batch
  const newKarmaIds = new Set(karmaPosts.map((p) => p.id));
  const keptKarma = existingKarma.filter((p) => !p.done && !newKarmaIds.has(p.id));
  const mergedKarma = [...karmaPosts, ...keptKarma].slice(0, 40);

  // ── Save ──
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify({
    lastUpdated: new Date().toISOString(),
    totalFound: newList.length,
    opportunities: deduped,
    karmaOpportunities: mergedKarma,
  }, null, 2));

  console.log(`[DONE] ${newList.length} new posts. ${deduped.length} total. ${mergedKarma.length} karma posts.`);
}

run().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
