import { useState, useEffect, useCallback } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DEFAULT_SUBREDDITS = [
  "SaaS", "indiehackers", "entrepreneur", "solopreneur",
  "SideProject", "marketing", "linkedin", "TwitterMarketing",
];

const DEFAULT_KEYWORDS = {
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

// Replace with your GitHub raw URL after pushing
// Format: https://raw.githubusercontent.com/USERNAME/REPO/main/data/opportunities.json
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/Bundepunemmanuel/Crosstalk-monitor/main/data/opportunities.json";

const GROQ_SYSTEM_PROMPT = `you are a solo founder on reddit. you will receive context including the subreddit, post title, post body, top comments, matched keywords, and a tool called crosstalk at crosstalk-one.vercel.app that repurposes X threads into LinkedIn and Reddit posts.

write a short reddit comment based on this context. sound like a real person who understands the pain. one or two sentences of genuine insight first. only mention crosstalk if the post is clearly asking for a tool or solution. if it's not the right moment, just be helpful and skip the link. casual tone, lowercase is fine, no hype, no corporate language, no bullet points. founder talking to a founder. never start with "i". keep it under 3 sentences.

if you mention crosstalk, weave it in naturally as something you built to solve this exact problem, not as a recommendation or promotion.

return ONLY a JSON object with this shape, no markdown, no backticks:
{
  "soft": "...",
  "medium": "...",
  "direct": "..."
}`;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function scoreColor(score) {
  if (score >= 6) return "#00ff88";
  if (score >= 3) return "#ffd166";
  return "#94a3b8";
}

function categoryBadgeColor(cat) {
  if (cat === "pain") return { bg: "#ff4d6d22", border: "#ff4d6d", text: "#ff4d6d" };
  if (cat === "audience") return { bg: "#7c3aed22", border: "#7c3aed", text: "#a78bfa" };
  return { bg: "#0ea5e922", border: "#0ea5e9", text: "#38bdf8" };
}

// ─── GROQ CALL ───────────────────────────────────────────────────────────────

async function callGroq(apiKey, post, extraContext, threadHistory = []) {
  const userMsg = `
Subreddit: r/${post.subreddit}
Post Title: ${post.title}
Post Body: ${post.body || "(no body)"}
Top Comments: ${post.topComments?.length ? post.topComments.join(" | ") : "(none)"}
Matched Keywords: ${post.matched?.map((m) => m.keyword).join(", ") || "none"}
${extraContext ? `Extra context from me: ${extraContext}` : ""}
${threadHistory.length > 0 ? `\nThread so far:\n${threadHistory.map((m) => `${m.role === "user" ? "Reddit user" : "My reply"}: ${m.content}`).join("\n")}` : ""}
`.trim();

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 600,
      messages: [
        { role: "system", content: GROQ_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.85,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function Badge({ label, category }) {
  const colors = categoryBadgeColor(category);
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
      padding: "2px 7px", borderRadius: "4px", textTransform: "uppercase",
      background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text,
    }}>
      {label}
    </span>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button onClick={copy} style={{
      padding: "6px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
      cursor: "pointer", border: "1px solid #334155",
      background: copied ? "#00ff8822" : "#1e293b",
      color: copied ? "#00ff88" : "#94a3b8",
      transition: "all 0.2s",
    }}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function ReplyVariant({ label, text, accent }) {
  return (
    <div style={{
      borderRadius: "10px", padding: "14px 16px", marginBottom: "10px",
      background: "#0f172a", border: `1px solid ${accent}33`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {label}
        </span>
        <CopyButton text={text} />
      </div>
      <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.65, color: "#cbd5e1" }}>{text}</p>
    </div>
  );
}

function OpportunityCard({ post, onDone, groqKey }) {
  const [expanded, setExpanded] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [replies, setReplies] = useState(null);
  const [error, setError] = useState(null);
  const [extraCtx, setExtraCtx] = useState("");
  const [threadHistory, setThreadHistory] = useState([]);
  const [replyInput, setReplyInput] = useState("");
  const [userResponse, setUserResponse] = useState("");
  const [showThread, setShowThread] = useState(false);

  const draft = useCallback(async () => {
    if (!groqKey) { setError("Add your Groq API key in Settings first."); return; }
    setDrafting(true); setError(null);
    try {
      const result = await callGroq(groqKey, post, extraCtx, threadHistory);
      setReplies(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setDrafting(false);
    }
  }, [groqKey, post, extraCtx, threadHistory]);

  const continueThread = useCallback(async () => {
    if (!userResponse.trim()) return;
    const newHistory = [
      ...threadHistory,
      { role: "assistant", content: replyInput },
      { role: "user", content: userResponse },
    ];
    setThreadHistory(newHistory);
    setUserResponse("");
    setDrafting(true); setError(null);
    try {
      const result = await callGroq(groqKey, post, extraCtx, newHistory);
      setReplies(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setDrafting(false);
    }
  }, [groqKey, post, extraCtx, threadHistory, replyInput, userResponse]);

  return (
    <div style={{
      borderRadius: "14px", marginBottom: "14px",
      background: "#111827", border: "1px solid #1e293b",
      transition: "border-color 0.2s",
    }}>
      {/* Header */}
      <div style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
              <span style={{
                fontSize: "11px", fontWeight: 700, color: "#64748b",
                fontFamily: "monospace",
              }}>r/{post.subreddit}</span>
              <span style={{ fontSize: "11px", color: "#334155" }}>·</span>
              <span style={{ fontSize: "11px", color: "#475569" }}>{timeAgo(post.createdAt)}</span>
              <span style={{ fontSize: "11px", color: "#334155" }}>·</span>
              <span style={{ fontSize: "11px", color: "#475569" }}>↑{post.upvotes} · 💬{post.commentCount}</span>
            </div>
            <p style={{
              margin: "0 0 8px", fontSize: "14px", fontWeight: 600,
              color: "#e2e8f0", lineHeight: 1.4,
            }}>{post.title}</p>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {post.matched?.slice(0, 4).map((m, i) => (
                <Badge key={i} label={m.keyword} category={m.category} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px", flexShrink: 0 }}>
            <span style={{
              fontSize: "20px", fontWeight: 800, color: scoreColor(post.score),
              fontVariantNumeric: "tabular-nums",
            }}>{post.score}</span>
            <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em" }}>score</span>
          </div>
        </div>

        {/* Action row */}
        <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
          <a href={post.url} target="_blank" rel="noreferrer" style={{
            padding: "7px 14px", borderRadius: "7px", fontSize: "12px", fontWeight: 600,
            background: "#1e293b", color: "#94a3b8", textDecoration: "none",
            border: "1px solid #334155", transition: "all 0.2s",
          }}>
            View Post ↗
          </a>
          <button onClick={() => setExpanded(!expanded)} style={{
            padding: "7px 14px", borderRadius: "7px", fontSize: "12px", fontWeight: 600,
            cursor: "pointer", background: expanded ? "#0ea5e922" : "#1e293b",
            color: expanded ? "#38bdf8" : "#94a3b8",
            border: `1px solid ${expanded ? "#0ea5e9" : "#334155"}`,
            transition: "all 0.2s",
          }}>
            {expanded ? "Collapse" : "Draft Reply"}
          </button>
          <button onClick={() => onDone(post.id)} style={{
            padding: "7px 14px", borderRadius: "7px", fontSize: "12px", fontWeight: 600,
            cursor: "pointer", background: "#1e293b", color: "#475569",
            border: "1px solid #1e293b", marginLeft: "auto",
          }}>
            ✓ Done
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          borderTop: "1px solid #1e293b", padding: "16px 18px",
          background: "#0c1421", borderRadius: "0 0 14px 14px",
        }}>
          {/* Post body preview */}
          {post.body && (
            <div style={{
              padding: "10px 14px", borderRadius: "8px", background: "#0f172a",
              border: "1px solid #1e293b", marginBottom: "12px",
            }}>
              <p style={{ margin: 0, fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
                {post.body.slice(0, 300)}{post.body.length > 300 ? "..." : ""}
              </p>
            </div>
          )}

          {/* Extra context */}
          <textarea
            value={extraCtx}
            onChange={(e) => setExtraCtx(e.target.value)}
            placeholder="Optional: add context before drafting... e.g. 'this person seems technical, keep it dev-friendly'"
            rows={2}
            style={{
              width: "100%", boxSizing: "border-box", resize: "vertical",
              padding: "10px 12px", borderRadius: "8px", fontSize: "12px",
              background: "#0f172a", border: "1px solid #1e293b",
              color: "#cbd5e1", outline: "none", marginBottom: "10px",
              fontFamily: "inherit", lineHeight: 1.5,
            }}
          />

          <button
            onClick={draft}
            disabled={drafting}
            style={{
              padding: "9px 20px", borderRadius: "8px", fontSize: "13px", fontWeight: 700,
              cursor: drafting ? "not-allowed" : "pointer",
              background: drafting ? "#1e293b" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: drafting ? "#475569" : "#fff",
              border: "none", marginBottom: "14px", transition: "all 0.2s",
            }}
          >
            {drafting ? "Drafting..." : replies ? "Re-draft" : "Draft Reply →"}
          </button>

          {error && (
            <p style={{ color: "#f87171", fontSize: "12px", marginBottom: "12px" }}>{error}</p>
          )}

          {replies && (
            <>
              <ReplyVariant label="Soft" text={replies.soft} accent="#00ff88" />
              <ReplyVariant label="Medium" text={replies.medium} accent="#ffd166" />
              <ReplyVariant label="Direct" text={replies.direct} accent="#f87171" />

              {/* Continue thread */}
              <div style={{
                marginTop: "16px", padding: "14px", borderRadius: "10px",
                background: "#0f172a", border: "1px solid #1e293b",
              }}>
                <p style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Continue the thread
                </p>
                <input
                  value={replyInput}
                  onChange={(e) => setReplyInput(e.target.value)}
                  placeholder="Paste the reply you sent..."
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "8px 12px",
                    borderRadius: "7px", fontSize: "12px", background: "#0c1421",
                    border: "1px solid #1e293b", color: "#cbd5e1", outline: "none",
                    fontFamily: "inherit", marginBottom: "8px",
                  }}
                />
                <textarea
                  value={userResponse}
                  onChange={(e) => setUserResponse(e.target.value)}
                  placeholder="Paste what the Reddit user replied..."
                  rows={2}
                  style={{
                    width: "100%", boxSizing: "border-box", resize: "vertical",
                    padding: "8px 12px", borderRadius: "7px", fontSize: "12px",
                    background: "#0c1421", border: "1px solid #1e293b",
                    color: "#cbd5e1", outline: "none", fontFamily: "inherit",
                    lineHeight: 1.5, marginBottom: "8px",
                  }}
                />
                <button
                  onClick={continueThread}
                  disabled={drafting || !userResponse.trim()}
                  style={{
                    padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 700,
                    cursor: drafting || !userResponse.trim() ? "not-allowed" : "pointer",
                    background: drafting || !userResponse.trim() ? "#1e293b" : "#0ea5e9",
                    color: drafting || !userResponse.trim() ? "#475569" : "#fff",
                    border: "none", transition: "all 0.2s",
                  }}
                >
                  {drafting ? "Writing..." : "Write Next Reply →"}
                </button>
                {threadHistory.length > 0 && (
                  <button
                    onClick={() => setShowThread(!showThread)}
                    style={{
                      marginLeft: "8px", padding: "8px 14px", borderRadius: "7px",
                      fontSize: "12px", cursor: "pointer", background: "transparent",
                      color: "#64748b", border: "1px solid #1e293b",
                    }}
                  >
                    {showThread ? "Hide" : "Show"} Thread ({threadHistory.length / 2} exchanges)
                  </button>
                )}
                {showThread && threadHistory.length > 0 && (
                  <div style={{ marginTop: "10px" }}>
                    {threadHistory.map((m, i) => (
                      <div key={i} style={{
                        padding: "8px 12px", borderRadius: "7px", marginBottom: "6px",
                        background: m.role === "user" ? "#0c1421" : "#0f172a",
                        border: "1px solid #1e293b",
                        borderLeft: `3px solid ${m.role === "user" ? "#f87171" : "#6366f1"}`,
                      }}>
                        <p style={{ margin: "0 0 2px", fontSize: "10px", fontWeight: 700, color: m.role === "user" ? "#f87171" : "#a78bfa", textTransform: "uppercase" }}>
                          {m.role === "user" ? "Reddit User" : "Your Reply"}
                        </p>
                        <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>{m.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ groqKey, setGroqKey, subreddits, setSubreddits, keywords, setKeywords }) {
  const [newSub, setNewSub] = useState("");
  const [newKw, setNewKw] = useState("");
  const [kwCat, setKwCat] = useState("pain");
  const [saved, setSaved] = useState(false);

  const save = () => {
    localStorage.setItem("groq_key", groqKey);
    localStorage.setItem("subreddits", JSON.stringify(subreddits));
    localStorage.setItem("keywords", JSON.stringify(keywords));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const addSub = () => {
    const s = newSub.trim().replace(/^r\//, "");
    if (s && !subreddits.includes(s)) {
      setSubreddits([...subreddits, s]);
      setNewSub("");
    }
  };

  const removeSub = (s) => setSubreddits(subreddits.filter((x) => x !== s));

  const addKw = () => {
    const k = newKw.trim().toLowerCase();
    if (k && !keywords[kwCat].includes(k)) {
      setKeywords({ ...keywords, [kwCat]: [...keywords[kwCat], k] });
      setNewKw("");
    }
  };

  const removeKw = (cat, kw) => setKeywords({ ...keywords, [cat]: keywords[cat].filter((x) => x !== kw) });

  const inputStyle = {
    flex: 1, padding: "8px 12px", borderRadius: "7px", fontSize: "13px",
    background: "#0f172a", border: "1px solid #1e293b", color: "#e2e8f0",
    outline: "none", fontFamily: "inherit",
  };

  const tagStyle = (color = "#334155") => ({
    display: "inline-flex", alignItems: "center", gap: "5px",
    padding: "3px 9px", borderRadius: "5px", fontSize: "11px",
    background: "#0f172a", border: `1px solid ${color}`, color: "#94a3b8",
    margin: "3px",
  });

  return (
    <div style={{ padding: "0 4px" }}>
      {/* Groq API Key */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
          Groq API Key
        </label>
        <input
          type="password"
          value={groqKey}
          onChange={(e) => setGroqKey(e.target.value)}
          placeholder="gsk_..."
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "11px", color: "#475569", margin: "6px 0 0" }}>
          Get your free key at <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>console.groq.com</a>. Stored only in your browser.
        </p>
      </div>

      {/* Subreddits */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
          Subreddits
        </label>
        <div style={{ marginBottom: "8px" }}>
          {subreddits.map((s) => (
            <span key={s} style={tagStyle()}>
              r/{s}
              <button onClick={() => removeSub(s)} style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", padding: 0, fontSize: "12px", lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSub()} placeholder="subredditname" style={inputStyle} />
          <button onClick={addSub} style={{ padding: "8px 16px", borderRadius: "7px", background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Add</button>
        </div>
      </div>

      {/* Keywords */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
          Keywords
        </label>
        {Object.entries(keywords).map(([cat, kws]) => {
          const colors = categoryBadgeColor(cat);
          return (
            <div key={cat} style={{ marginBottom: "12px" }}>
              <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: colors.text, textTransform: "uppercase" }}>{cat}</p>
              <div>
                {kws.map((kw) => (
                  <span key={kw} style={tagStyle(colors.border)}>
                    {kw}
                    <button onClick={() => removeKw(cat, kw)} style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", padding: 0, fontSize: "12px", lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
          <select value={kwCat} onChange={(e) => setKwCat(e.target.value)} style={{ ...inputStyle, flex: "0 0 auto" }}>
            <option value="pain">Pain</option>
            <option value="audience">Audience</option>
            <option value="intent">Intent</option>
          </select>
          <input value={newKw} onChange={(e) => setNewKw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKw()} placeholder="new keyword" style={inputStyle} />
          <button onClick={addKw} style={{ padding: "8px 16px", borderRadius: "7px", background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Add</button>
        </div>
      </div>

      <button onClick={save} style={{
        padding: "10px 24px", borderRadius: "8px", fontSize: "13px", fontWeight: 700,
        cursor: "pointer", border: "none",
        background: saved ? "#00ff8822" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
        color: saved ? "#00ff88" : "#fff", transition: "all 0.2s",
      }}>
        {saved ? "Saved ✓" : "Save Settings"}
      </button>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("feed");
  const [opportunities, setOpportunities] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [done, setDone] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("done_ids") || "[]")); }
    catch { return new Set(); }
  });

  const [groqKey, setGroqKey] = useState(() => localStorage.getItem("groq_key") || "");
  const [subreddits, setSubreddits] = useState(() => {
    try { return JSON.parse(localStorage.getItem("subreddits")) || DEFAULT_SUBREDDITS; }
    catch { return DEFAULT_SUBREDDITS; }
  });
  const [keywords, setKeywords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("keywords")) || DEFAULT_KEYWORDS; }
    catch { return DEFAULT_KEYWORDS; }
  });

  const markDone = useCallback((id) => {
    setDone((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("done_ids", JSON.stringify([...next]));
      return next;
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`${GITHUB_RAW_URL}?t=${Date.now()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setOpportunities(data.opportunities || []);
        setLastUpdated(data.lastUpdated);
        setLoading(false);
      })
      .catch((e) => {
        setFetchError(e.message);
        setLoading(false);
      });
  }, []);

  const visible = opportunities
    .filter((p) => !done.has(p.id))
    .filter((p) => {
      if (filter === "high") return p.score >= 6;
      if (filter === "pain") return p.matched?.some((m) => m.category === "pain");
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const navBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "8px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
        cursor: "pointer", border: "none", transition: "all 0.2s",
        background: tab === id ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "transparent",
        color: tab === id ? "#fff" : "#64748b",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      minHeight: "100vh", background: "#080e1a",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: "#e2e8f0",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e293b", padding: "0 24px",
        position: "sticky", top: 0, zIndex: 100,
        background: "#080e1aee", backdropFilter: "blur(12px)",
      }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: "56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px", fontWeight: 800, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Crosstalk
            </span>
            <span style={{ fontSize: "11px", color: "#334155", fontWeight: 600 }}>MONITOR</span>
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            {navBtn("feed", `Feed ${visible.length > 0 ? `(${visible.length})` : ""}`)}
            {navBtn("settings", "Settings")}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "24px 20px" }}>
        {tab === "feed" && (
          <>
            {/* Status bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
              <div>
                {lastUpdated && (
                  <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>
                    Last scan: {new Date(lastUpdated).toLocaleString()}
                  </p>
                )}
                {!groqKey && (
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#fbbf24" }}>
                    ⚠ Add your Groq API key in Settings to draft replies
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                {["all", "high", "pain"].map((f) => (
                  <button key={f} onClick={() => setFilter(f)} style={{
                    padding: "5px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
                    cursor: "pointer", border: "1px solid",
                    textTransform: "uppercase", letterSpacing: "0.06em", transition: "all 0.2s",
                    borderColor: filter === f ? "#6366f1" : "#1e293b",
                    background: filter === f ? "#6366f122" : "transparent",
                    color: filter === f ? "#818cf8" : "#475569",
                  }}>
                    {f === "high" ? "High Score" : f}
                  </button>
                ))}
              </div>
            </div>

            {loading && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
                <p style={{ fontSize: "14px" }}>Loading opportunities...</p>
              </div>
            )}

            {fetchError && (
              <div style={{
                padding: "16px", borderRadius: "10px", background: "#ff4d6d11",
                border: "1px solid #ff4d6d33", marginBottom: "16px",
              }}>
                <p style={{ margin: 0, fontSize: "13px", color: "#f87171" }}>
                  Could not load opportunities: {fetchError}
                </p>
                <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#64748b" }}>
                  Make sure the GitHub raw URL in the code matches your repo, and that <code>data/opportunities.json</code> exists.
                </p>
              </div>
            )}

            {!loading && !fetchError && visible.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
                <p style={{ fontSize: "32px", marginBottom: "8px" }}>🔍</p>
                <p style={{ fontSize: "14px", margin: 0 }}>No opportunities yet.</p>
                <p style={{ fontSize: "12px", margin: "6px 0 0" }}>The GitHub Action will scan Reddit every 4 hours. You can also trigger it manually from GitHub Actions.</p>
              </div>
            )}

            {visible.map((post) => (
              <OpportunityCard
                key={post.id}
                post={post}
                onDone={markDone}
                groqKey={groqKey}
              />
            ))}
          </>
        )}

        {tab === "settings" && (
          <SettingsPanel
            groqKey={groqKey} setGroqKey={setGroqKey}
            subreddits={subreddits} setSubreddits={setSubreddits}
            keywords={keywords} setKeywords={setKeywords}
          />
        )}
      </div>
    </div>
  );
}
