import { useState, useEffect, useCallback } from "react";

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

const GITHUB_RAW_URL = "https://raw.githubusercontent.com/Bundepunemmanuel/crosstalk-monitor/main/data/opportunities.json";

const GROQ_SYSTEM_PROMPT = `you are a solo founder on reddit. you will receive context including the subreddit, post title, post body, top comments, matched keywords, and a tool called crosstalk at crosstalk-one.vercel.app that repurposes X threads into LinkedIn and Reddit posts.

write a short reddit comment based on this context. sound like a real person who understands the pain. one or two sentences of genuine insight first. only mention crosstalk if the post is clearly asking for a tool or solution. if it's not the right moment, just be helpful and skip the link. casual tone, lowercase is fine, no hype, no corporate language, no bullet points. founder talking to a founder. never start with "i". keep it under 3 sentences.

if you mention crosstalk, weave it in naturally as something you built to solve this exact problem, not as a recommendation or promotion.

return ONLY a JSON object with this shape, no markdown, no backticks:
{"soft": "...","medium": "...","direct": "..."}`;

const ASKREDDIT_SYSTEM_PROMPT = `you are a witty, genuine person on reddit answering a question in r/AskReddit. your goal is to write a comment that feels real, relatable, and earns upvotes. no corporate language, no bullet points, no lists. casual tone, lowercase is fine. be specific and personal-sounding. funny or insightful works best. keep it under 3 sentences. never start with "i".

return ONLY a JSON object with this shape, no markdown, no backticks:
{"witty": "...","genuine": "...","story": "..."}`;

function decodeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

async function callGroq(apiKey, systemPrompt, userMsg) {
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
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      temperature: 0.85,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq error ${res.status}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }} style={{
      padding: "5px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
      cursor: "pointer", border: "1px solid #334155",
      background: copied ? "#00ff8822" : "#1e293b",
      color: copied ? "#00ff88" : "#94a3b8", transition: "all 0.2s", flexShrink: 0,
    }}>{copied ? "Copied!" : "Copy"}</button>
  );
}

function ReplyVariant({ label, text, accent }) {
  return (
    <div style={{ borderRadius: "8px", padding: "12px 14px", marginBottom: "8px", background: "#0f172a", border: `1px solid ${accent}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span style={{ fontSize: "10px", fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
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

  const cleanTitle = decodeHTML(post.title);
  const cleanBody = decodeHTML(post.body);

  const draft = useCallback(async () => {
    if (!groqKey) { setError("Add Groq API key in Settings first."); return; }
    setDrafting(true); setError(null);
    try {
      const userMsg = `
Subreddit: r/${post.subreddit}
Post Title: ${cleanTitle}
Post Body: ${cleanBody.slice(0, 400) || "(no body)"}
Top Comments: ${post.topComments?.length ? post.topComments.join(" | ") : "(none)"}
Matched Keywords: ${post.matched?.map((m) => m.keyword).join(", ") || "none"}
${extraCtx ? `Extra context: ${extraCtx}` : ""}
${threadHistory.length > 0 ? `\nThread so far:\n${threadHistory.map((m) => `${m.role === "user" ? "Reddit user" : "My reply"}: ${m.content}`).join("\n")}` : ""}`.trim();
      const result = await callGroq(groqKey, GROQ_SYSTEM_PROMPT, userMsg);
      setReplies(result);
    } catch (e) { setError(e.message); }
    finally { setDrafting(false); }
  }, [groqKey, post, extraCtx, threadHistory, cleanTitle, cleanBody]);

  const continueThread = useCallback(async () => {
    if (!userResponse.trim()) return;
    const newHistory = [...threadHistory, { role: "assistant", content: replyInput }, { role: "user", content: userResponse }];
    setThreadHistory(newHistory); setUserResponse(""); setDrafting(true); setError(null);
    try {
      const userMsg = `
Subreddit: r/${post.subreddit}
Post Title: ${cleanTitle}
Post Body: ${cleanBody.slice(0, 400) || "(no body)"}
Matched Keywords: ${post.matched?.map((m) => m.keyword).join(", ") || "none"}
${extraCtx ? `Extra context: ${extraCtx}` : ""}
Thread so far:
${newHistory.map((m) => `${m.role === "user" ? "Reddit user" : "My reply"}: ${m.content}`).join("\n")}`.trim();
      const result = await callGroq(groqKey, GROQ_SYSTEM_PROMPT, userMsg);
      setReplies(result);
    } catch (e) { setError(e.message); }
    finally { setDrafting(false); }
  }, [groqKey, post, extraCtx, threadHistory, replyInput, userResponse, cleanTitle, cleanBody]);

  const inp = { width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: "7px", fontSize: "12px", background: "#0c1421", border: "1px solid #1e293b", color: "#cbd5e1", outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ borderRadius: "12px", marginBottom: "10px", background: "#111827", border: "1px solid #1e293b" }}>
      <div style={{ padding: "14px 16px" }}>
        {/* Meta row */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#6366f1", fontFamily: "monospace" }}>r/{post.subreddit}</span>
          <span style={{ fontSize: "11px", color: "#334155" }}>·</span>
          <span style={{ fontSize: "11px", color: "#475569" }}>{timeAgo(post.createdAt)}</span>
          <span style={{ fontSize: "11px", color: "#334155" }}>·</span>
          <span style={{ fontSize: "11px", color: "#475569" }}>💬{post.commentCount}</span>
        </div>

        {/* Title + score */}
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "6px" }}>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, flex: 1 }}>{cleanTitle}</p>
          <span style={{ fontSize: "18px", fontWeight: 800, color: scoreColor(post.score), flexShrink: 0 }}>{post.score}</span>
        </div>

        {/* Body preview */}
        {cleanBody && (
          <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>
            {cleanBody.slice(0, 120)}{cleanBody.length > 120 ? "..." : ""}
          </p>
        )}

        {/* Keyword badges */}
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "10px" }}>
          {post.matched?.slice(0, 3).map((m, i) => {
            const c = categoryBadgeColor(m.category);
            return <span key={i} style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: c.bg, border: `1px solid ${c.border}`, color: c.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.keyword}</span>;
          })}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <a href={post.url} target="_blank" rel="noreferrer" style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, background: "#1e293b", color: "#94a3b8", textDecoration: "none", border: "1px solid #334155" }}>View Post ↗</a>
          <button onClick={() => setExpanded(!expanded)} style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", background: expanded ? "#6366f122" : "#1e293b", color: expanded ? "#818cf8" : "#94a3b8", border: `1px solid ${expanded ? "#6366f1" : "#334155"}`, transition: "all 0.2s" }}>
            {expanded ? "Collapse" : "Draft Reply"}
          </button>
          <button onClick={() => onDone(post.id)} style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", background: "transparent", color: "#334155", border: "1px solid #1e293b", marginLeft: "auto" }}>✓ Done</button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid #1e293b", padding: "14px 16px", background: "#0c1421", borderRadius: "0 0 12px 12px" }}>
          <textarea value={extraCtx} onChange={(e) => setExtraCtx(e.target.value)} placeholder="Optional context... e.g. 'they seem technical, keep it dev-friendly'" rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5, marginBottom: "10px" }} />
          <button onClick={draft} disabled={drafting} style={{ padding: "8px 18px", borderRadius: "7px", fontSize: "13px", fontWeight: 700, cursor: drafting ? "not-allowed" : "pointer", background: drafting ? "#1e293b" : "linear-gradient(135deg, #6366f1, #8b5cf6)", color: drafting ? "#475569" : "#fff", border: "none", marginBottom: "12px" }}>
            {drafting ? "Drafting..." : replies ? "Re-draft" : "Draft Reply →"}
          </button>
          {error && <p style={{ color: "#f87171", fontSize: "12px", marginBottom: "10px" }}>{error}</p>}
          {replies && (
            <>
              <ReplyVariant label="Soft" text={replies.soft} accent="#00ff88" />
              <ReplyVariant label="Medium" text={replies.medium} accent="#ffd166" />
              <ReplyVariant label="Direct" text={replies.direct} accent="#f87171" />
              <div style={{ marginTop: "12px", padding: "12px", borderRadius: "8px", background: "#0f172a", border: "1px solid #1e293b" }}>
                <p style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>Continue thread</p>
                <input value={replyInput} onChange={(e) => setReplyInput(e.target.value)} placeholder="Paste the reply you sent..." style={{ ...inp, marginBottom: "6px" }} />
                <textarea value={userResponse} onChange={(e) => setUserResponse(e.target.value)} placeholder="Paste what the Reddit user replied..." rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5, marginBottom: "8px" }} />
                <button onClick={continueThread} disabled={drafting || !userResponse.trim()} style={{ padding: "7px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: drafting || !userResponse.trim() ? "not-allowed" : "pointer", background: drafting || !userResponse.trim() ? "#1e293b" : "#0ea5e9", color: drafting || !userResponse.trim() ? "#475569" : "#fff", border: "none" }}>
                  {drafting ? "Writing..." : "Write Next Reply →"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AskRedditCard({ post, groqKey }) {
  const [drafting, setDrafting] = useState(false);
  const [replies, setReplies] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const cleanTitle = decodeHTML(post.title);
  const cleanBody = decodeHTML(post.body);

  const draft = useCallback(async () => {
    if (!groqKey) { setError("Add Groq API key in Settings first."); return; }
    setDrafting(true); setError(null);
    try {
      const userMsg = `Question: ${cleanTitle}\n\nContext: ${cleanBody.slice(0, 300) || "(no body)"}\n\nWrite 3 comment variations to get upvotes on this AskReddit post.`;
      const result = await callGroq(groqKey, ASKREDDIT_SYSTEM_PROMPT, userMsg);
      setReplies(result);
    } catch (e) { setError(e.message); }
    finally { setDrafting(false); }
  }, [groqKey, cleanTitle, cleanBody]);

  return (
    <div style={{ borderRadius: "12px", marginBottom: "10px", background: "#111827", border: "1px solid #1e293b" }}>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#f97316", fontFamily: "monospace" }}>r/AskReddit</span>
          <span style={{ fontSize: "11px", color: "#334155" }}>·</span>
          <span style={{ fontSize: "11px", color: "#475569" }}>{timeAgo(post.createdAt)}</span>
          <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: "#f9731622", border: "1px solid #f97316", color: "#f97316", marginLeft: "4px" }}>KARMA</span>
        </div>
        <p style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4 }}>{cleanTitle}</p>
        <div style={{ display: "flex", gap: "6px" }}>
          <a href={post.url} target="_blank" rel="noreferrer" style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, background: "#1e293b", color: "#94a3b8", textDecoration: "none", border: "1px solid #334155" }}>View Post ↗</a>
          <button onClick={() => { setExpanded(!expanded); if (!expanded && !replies) draft(); }} style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", background: expanded ? "#f9731622" : "#1e293b", color: expanded ? "#f97316" : "#94a3b8", border: `1px solid ${expanded ? "#f97316" : "#334155"}`, transition: "all 0.2s" }}>
            {expanded ? "Collapse" : "Draft Karma Reply"}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid #1e293b", padding: "14px 16px", background: "#0c1421", borderRadius: "0 0 12px 12px" }}>
          {drafting && <p style={{ fontSize: "13px", color: "#64748b" }}>Drafting...</p>}
          {error && <p style={{ color: "#f87171", fontSize: "12px" }}>{error}</p>}
          {replies && (
            <>
              <ReplyVariant label="Witty" text={replies.witty} accent="#f97316" />
              <ReplyVariant label="Genuine" text={replies.genuine} accent="#ffd166" />
              <ReplyVariant label="Story" text={replies.story} accent="#a78bfa" />
              <button onClick={draft} disabled={drafting} style={{ marginTop: "8px", padding: "7px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer", background: "#1e293b", color: "#64748b", border: "1px solid #1e293b" }}>Re-draft</button>
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
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };

  const inp = { flex: 1, padding: "8px 12px", borderRadius: "7px", fontSize: "13px", background: "#0f172a", border: "1px solid #1e293b", color: "#e2e8f0", outline: "none", fontFamily: "inherit" };
  const tag = (color = "#334155") => ({ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "5px", fontSize: "11px", background: "#0f172a", border: `1px solid ${color}`, color: "#94a3b8", margin: "3px" });
  const xBtn = { background: "none", border: "none", cursor: "pointer", color: "#f87171", padding: 0, fontSize: "12px", lineHeight: 1 };
  const label = { display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" };

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <label style={label}>Groq API Key</label>
        <input type="password" value={groqKey} onChange={(e) => setGroqKey(e.target.value)} placeholder="gsk_..." style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
        <p style={{ fontSize: "11px", color: "#475569", margin: "6px 0 0" }}>Free at <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>console.groq.com</a> — stored only in your browser.</p>
      </div>

      <div style={{ marginBottom: "24px" }}>
        <label style={label}>Subreddits (Crosstalk Monitor)</label>
        <div style={{ marginBottom: "8px" }}>{subreddits.map((s) => <span key={s} style={tag()}> r/{s} <button onClick={() => setSubreddits(subreddits.filter(x => x !== s))} style={xBtn}>×</button></span>)}</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const s = newSub.trim().replace(/^r\//, ""); if (s && !subreddits.includes(s)) { setSubreddits([...subreddits, s]); setNewSub(""); } } }} placeholder="subredditname" style={inp} />
     
