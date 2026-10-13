import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planMission, InterviewSession } from "@steward/intent";
import { OnboardingSession } from "@steward/onboarding";
import { CANONICAL_LINES, inQuietHours, speakableBrief, voiceHome, type VoiceContextName } from "@steward/voice";
import { createSteward, seedDemo, type StewardSystem } from "./system.js";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* ---------------------------------------------------------------------------
 * STYLE C — "CLEAN COMMAND" (owner's chosen direction, October 2026).
 * Light surfaces, white cards, deep navy as the single accent, bold Swiss
 * sans, process-status chips, and a voice bar built around a big navy
 * push-to-talk disc. This supersedes the earlier editorial-noir direction.
 * ------------------------------------------------------------------------- */
const CSS = `

  :root {
    --bg:#f5f6f8; --surface:#ffffff; --border:#e4e7ec; --border2:#d0d5dd;
    --ink:#101828; --ink2:#344054; --muted:#667085; --faint:#98a2b3;
    --accent:#0b2a5b; --accent-ink:#ffffff; --accent-soft:#eef2f7; --soft2:#f2f4f7;
    --shadow:0 1px 3px rgba(16,24,40,.06); --disc:68px;
    --danger:#b42318; --ok:#027a48; --warn:#b54708;
  }
  [data-theme="signal"] {
    --bg:#131416; --surface:#1f2124; --border:#45484d; --border2:#565a60;
    --ink:#f4f4f5; --ink2:#d4d7db; --muted:#a2a8ae; --faint:#7d838a;
    --accent:#ff6f1f; --accent-ink:#181a1c; --accent-soft:#2e2a24; --soft2:#26282c;
    --shadow:0 2px 0 rgba(0,0,0,.55); --disc:88px;
    --danger:#ff4d42; --ok:#3ddc84; --warn:#ffb020;
  }
  [data-theme="signal"] .card { border-width:2px; border-radius:10px; }
  [data-theme="signal"] header.top { border-bottom:3px solid var(--accent); }
  [data-theme="signal"] h1.masthead, [data-theme="signal"] h1.page, [data-theme="signal"] h2,
  [data-theme="signal"] .wordmark, [data-theme="signal"] .pill, [data-theme="signal"] .chip,
  [data-theme="signal"] button, [data-theme="signal"] .dateline, [data-theme="signal"] .stack-count {
    text-transform:uppercase; letter-spacing:.07em;
  }
  [data-theme="signal"] h1.masthead { color:var(--accent); }
  [data-theme="signal"] button { padding:14px 26px; font-size:16px; border-width:2px; }
  [data-theme="signal"] .decision-card form.decide { display:flex; }
  [data-theme="signal"] .decision-card form.decide button { flex:1; padding:18px 10px; font-size:17px; }
  [data-theme="signal"] #pttDisc { background:#101112; color:var(--accent); border:3px solid var(--accent); }
  [data-theme="signal"] #voicebar { border-top:3px solid var(--accent); }
  [data-theme="signal"] .pill.gold { background:#ffb020; color:#181a1c; }
  [data-theme="signal"] .tile { border:2px solid var(--accent); }
  [data-theme="signal"] input, [data-theme="signal"] textarea, [data-theme="signal"] select { border-width:2px; }
  .theme-switch { display:flex; gap:6px; }
  .theme-switch button { padding:6px 12px !important; font-size:12.5px !important; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--ink); line-height: 1.5; padding-bottom: 120px; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 16px; }
  header.top { background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20; }
  header.top .wrap { display: flex; align-items: center; gap: 18px; padding-top: 12px; padding-bottom: 12px; flex-wrap: wrap; }
  .wordmark { font-weight: 800; letter-spacing: .14em; color: var(--accent); font-size: 15px; }
  .wordmark span { color: var(--faint); font-weight: 600; letter-spacing: .04em; }
  nav.main { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
  nav.main a { color: var(--ink2); text-decoration: none; font-size: 13.5px; font-weight: 600; padding: 6px 10px; border-radius: 999px; }
  nav.main a:hover { background: var(--accent-soft); color: var(--accent); }
  h1.masthead { font-size: 38px; font-weight: 800; letter-spacing: -0.02em; margin: 26px 0 2px; color: var(--ink); }
  h1.page { font-size: 28px; font-weight: 800; letter-spacing: -0.015em; margin: 24px 0 4px; }
  h2 { font-size: 17px; font-weight: 700; margin: 26px 0 8px; }
  .attention { font-size: 16.5px; color: var(--ink2); margin: 0 0 18px; }
  .attention strong { color: var(--accent); }
  .dateline { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: .08em; font-weight: 600; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 18px; margin: 12px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat .num { font-size: 30px; font-weight: 800; color: var(--accent); line-height: 1.1; }
  .stat .lbl { color: var(--muted); font-size: 13px; font-weight: 600; }
  .pill { display: inline-block; background: var(--accent); color: var(--accent-ink); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }
  .pill.light { background: var(--accent-soft); color: var(--accent); }
  .pill.gold { background: #b54708; }
  .pill.gray { background: var(--soft2); color: var(--ink2); }
  button, .btn { font: inherit; font-weight: 700; font-size: 15px; padding: 11px 20px; border-radius: 10px; cursor: pointer; border: 1.5px solid var(--accent); background: var(--accent); color: var(--accent-ink); text-decoration: none; display: inline-block; }
  button.outline, .btn.outline { background: var(--surface); color: var(--accent); }
  button.small { font-size: 13px; padding: 7px 12px; border-radius: 8px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
  .muted { color: var(--muted); } .small { font-size: 13px; }
  pre.args { background: var(--soft2); border: 1px solid var(--border); border-radius: 10px; padding: 10px; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); }
  td, th { padding: 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; font-size: 14px; }
  /* approval card stack */
  .stack { position: relative; margin-top: 8px; }
  .stack .decision-card { position: relative; }
  .stack .decision-card.behind1 { transform: scale(.985) translateY(8px); opacity: .65; margin-top: -6px; }
  .stack .decision-card.behind2 { transform: scale(.97) translateY(16px); opacity: .4; margin-top: -6px; }
  .decision-card h3 { font-size: 20px; font-weight: 800; margin: 10px 0 4px; letter-spacing: -0.01em; }
  .decision-card .detail { color: var(--ink2); font-size: 15.5px; }
  .stack-count { color: var(--muted); font-weight: 700; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
  .swipe-hint { color: var(--faint); font-size: 12.5px; margin-top: 8px; }
  /* ladder chips */
  .chips { display: flex; align-items: center; gap: 0; flex-wrap: wrap; margin: 8px 0 4px; }
  .chip { font-size: 12.5px; font-weight: 700; padding: 6px 12px; border-radius: 999px; border: 1.5px solid var(--border2); color: var(--faint); background: var(--soft2); white-space: nowrap; }
  .chip.done { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .chip.current { background: var(--surface); border-color: var(--accent); color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
  .chip-sep { width: 14px; height: 2px; background: var(--border2); }
  /* receipt document cards */
  .receipt { display: flex; gap: 14px; align-items: flex-start; }
  .tile { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
  .receipt .title { font-weight: 700; font-size: 15.5px; }
  .receipt .meta { color: var(--muted); font-size: 13px; }
  details.evidence { margin-top: 8px; } details.evidence summary { cursor: pointer; color: var(--accent); font-weight: 600; font-size: 13.5px; }
  .verified { color: var(--ok); font-weight: 700; } .unverified { color: var(--warn); font-weight: 700; }
  .filterchips a { text-decoration: none; }
  input[type=text], input[type=time], textarea, select { font: inherit; width: 100%; padding: 11px 12px; border: 1.5px solid var(--border2); border-radius: 10px; background: var(--surface); color: var(--ink); margin: 6px 0; }
  input[type=range] { width: 100%; accent-color: var(--accent); }
  label.f { font-weight: 700; font-size: 13.5px; color: var(--ink2); display: block; margin-top: 12px; }
  audio { width: 100%; margin-top: 6px; }
  .brief-body h2 { border-top: 2px solid var(--ink); padding-top: 12px; }
  .brief-body ul { margin: 6px 0 12px; padding-left: 20px; }
  /* voice bar */
  #voicebar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -4px 18px rgba(16,24,40,.08); z-index: 30; }
  #voicebar .wrap { display: flex; align-items: center; gap: 14px; padding-top: 10px; padding-bottom: 12px; }
  #pttDisc { flex: 0 0 var(--disc); width: var(--disc); height: var(--disc); border-radius: 50%; background: var(--accent); color: var(--accent-ink); border: none; font-size: 27px; display: flex; align-items: center; justify-content: center; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
  #pttDisc.listening { animation: pulse 1.1s ease-in-out infinite; }
  #voicebar[data-mode="off"] #pttDisc { background: var(--border2); color: var(--muted); border-color: var(--border2); }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent);} 50% { box-shadow: 0 0 0 14px transparent;} }
  #hfBtn { flex: 0 0 46px; width: 46px; height: 46px; border-radius: 50%; padding: 0; font-size: 19px; }
  #hfBtn.on { background: var(--accent); color: var(--accent-ink); }
  #micOffBtn { border-color: var(--danger); color: var(--danger); background: var(--surface); }
  #voicebar[data-mode="off"] #micOffBtn { background: var(--danger); color: #fff; }
  #micState { font-size: 13.5px; }
  #micState .mode { font-weight: 800; letter-spacing: .05em; text-transform: uppercase; font-size: 12px; }
  #micState .off { color: var(--danger); } #micState .on { color: var(--accent); }
  #wave { display: none; align-items: flex-end; gap: 3px; height: 22px; }
  #wave.on { display: flex; }
  #wave span { width: 4px; background: var(--accent); border-radius: 2px; animation: wv 0.9s ease-in-out infinite; }
  #wave span:nth-child(2) { animation-delay: .12s; } #wave span:nth-child(3) { animation-delay: .24s; }
  #wave span:nth-child(4) { animation-delay: .36s; } #wave span:nth-child(5) { animation-delay: .48s; }
  @keyframes wv { 0%,100% { height: 6px; } 50% { height: 21px; } }
  .sr-note { font-size: 12.5px; color: var(--muted); }
`;

/** Client JS: mic modes (push-to-talk disc + hands-free), card-stack swipe. */
const CLIENT_JS = `
(function () {
  // --- dictation target: the last focused text field on the page ---
  var target = null;
  document.addEventListener("focusin", function (e) {
    if (e.target && (e.target.tagName === "TEXTAREA" || (e.target.tagName === "INPUT" && e.target.type === "text"))) target = e.target;
  });
  function setText(t) {
    var el = target || document.querySelector("textarea, input[type=text]");
    if (!el) return;
    el.value = el.value ? el.value.replace(/\\s*$/, "") + " " + t : t;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // --- mic modes ---
  var bar = document.getElementById("voicebar");
  var disc = document.getElementById("pttDisc");
  var hfBtn = document.getElementById("hfBtn");
  var offBtn = document.getElementById("micOffBtn");
  var stateEl = document.getElementById("micStateText");
  var modeEl = document.getElementById("micMode");
  var wave = document.getElementById("wave");
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var mode = "off";            // "off" | "ptt" | "handsfree"
  var recog = null, listening = false, pttLatched = false, downAt = 0;

  function say(modeLabel, text, on) {
    modeEl.textContent = modeLabel;
    modeEl.className = "mode " + (on ? "on" : "off");
    stateEl.textContent = text;
  }
  function newRecog(continuous) {
    var r = new SR();
    r.lang = "en-US"; r.interimResults = true; r.continuous = continuous;
    r.onresult = function (ev) {
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) setText(ev.results[i][0].transcript.trim());
      }
    };
    r.onend = function () {
      listening = false; disc.classList.remove("listening"); wave.classList.remove("on");
      if (mode === "handsfree") { try { r.start(); listening = true; disc.classList.add("listening"); wave.classList.add("on"); } catch (e) {} }
      else if (mode === "ptt" && !pttLatched) say("Push-to-talk", "Mic idle — hold the disc to dictate.", true);
    };
    r.onerror = function () { listening = false; disc.classList.remove("listening"); wave.classList.remove("on"); };
    return r;
  }
  function start(modeWanted) {
    if (!SR) { say("Unavailable", "Speech recognition is not supported in this browser — typing works everywhere instead.", false); return; }
    stop(true);
    mode = modeWanted; bar.dataset.mode = mode;
    recog = newRecog(mode === "handsfree");
    try { recog.start(); listening = true; disc.classList.add("listening"); wave.classList.add("on"); } catch (e) {}
    hfBtn.classList.toggle("on", mode === "handsfree");
    say(mode === "handsfree" ? "Hands-free · listening" : "Push-to-talk · listening", mode === "handsfree" ? "Listening continuously — tap the small mic to stop." : "Listening — release to stop, or tap to latch.", true);
  }
  function stop(silent) {
    if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
    listening = false; pttLatched = false;
    disc.classList.remove("listening"); wave.classList.remove("on"); hfBtn.classList.remove("on");
    if (!silent) { mode = "off"; bar.dataset.mode = "off"; say("Mic off", "Microphone is OFF. Nothing is being listened to.", false); }
  }
  window.setMicMode = function (m) { if (m === "off") stop(false); else start(m); };
  if (disc) {
    disc.addEventListener("pointerdown", function (e) { e.preventDefault(); downAt = Date.now(); if (mode === "off" || mode === "handsfree") start("ptt"); });
    disc.addEventListener("pointerup", function () {
      if (mode !== "ptt") return;
      if (Date.now() - downAt < 250) { pttLatched = true; say("Push-to-talk · latched", "Listening — tap the disc again to stop.", true); }
      else if (!pttLatched) stop(true), mode = "ptt", bar.dataset.mode = "ptt", say("Push-to-talk", "Mic idle — hold the disc to dictate.", true);
      else { pttLatched = false; stop(false); }
    });
  }
  if (hfBtn) hfBtn.addEventListener("click", function () { mode === "handsfree" ? stop(false) : start("handsfree"); });
  if (offBtn) offBtn.addEventListener("click", function () { stop(false); });
  if (!SR) say("Typing mode", "This browser has no speech recognition — every field still works by typing.", false);
  // --- approval card stack: swipe right = approve, left = reject ---
  var top = document.querySelector(".stack .decision-card");
  if (top) {
    var sx = null;
    top.addEventListener("pointerdown", function (e) { sx = e.clientX; });
    top.addEventListener("pointerup", function (e) {
      if (sx === null) return;
      var dx = e.clientX - sx; sx = null;
      var form = top.querySelector("form.decide");
      if (!form) return;
      if (dx > 90) form.querySelector("button[value=approved]").click();
      else if (dx < -90) form.querySelector("button[value=denied]").click();
    });
  }
})();
`;

function voiceBar(): string {
  return `<div id="voicebar" data-mode="off"><div class="wrap">
    <button id="pttDisc" type="button" aria-label="Push to talk — hold, or tap to latch">🎤</button>
    <button id="hfBtn" type="button" class="outline" aria-label="Hands-free mode toggle">🎙</button>
    <button id="micOffBtn" type="button" class="small">Mic off</button>
    <div id="micState"><span id="micMode" class="mode off">Mic off</span><br><span id="micStateText">Microphone is OFF. Nothing is being listened to.</span></div>
    <div id="wave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
  </div></div>`;
}

export type ConsoleTheme = "clean" | "signal";

function layoutImpl(title: string, body: string, theme: ConsoleTheme): string {
  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Steward Mission Control</title><style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><div class="wordmark">STEWARD <span>/ Mission Control</span></div>
<form method="post" action="/settings/theme" class="theme-switch" aria-label="Console skin">
  <button name="theme" value="clean" class="small ${theme === "clean" ? "" : "outline"}">Clean</button>
  <button name="theme" value="signal" class="small ${theme === "signal" ? "" : "outline"}">Signal</button>
</form>
<nav class="main">
<a href="/">Today</a><a href="/approvals">Approvals</a><a href="/missions">Missions</a><a href="/vault">Vault</a><a href="/ledger">Ledger</a><a href="/ladder">Ladder</a><a href="/voice">Voice</a><a href="/brief">Brief</a><a href="/about">About</a>
</nav></div></header>
<main class="wrap">${body}</main>
${voiceBar()}
<script>${CLIENT_JS}</script>
</body></html>`;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/** Tiny renderer for the brief's own markdown (headings, bullets, emphasis). */
function renderBriefText(text: string): string {
  const out: string[] = [];
  let inList = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
    if (line.startsWith("## ")) { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h2>${inline(line.slice(3))}</h2>`); }
    else if (line.startsWith("# ")) { if (inList) { out.push("</ul>"); inList = false; } }
    else if (line.startsWith("- ")) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(line.slice(2))}</li>`); }
    else if (line) { if (inList) { out.push("</ul>"); inList = false; } out.push(`<p>${inline(line)}</p>`); }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const KIND_ICON: Record<string, string> = {
  "email.send": "✉", "purchase.buy": "$", "calendar.create": "▦", "task.create": "✓",
  "vault.delete": "▤", "vault.write": "▤", "ladder.demotion": "↧", "ladder.promotion": "↥",
};

const RUNGS = ["observe", "draft", "act_with_approval", "act_within_budget", "standing_authority"] as const;
const RUNG_LABEL: Record<string, string> = {
  observe: "Observe", draft: "Draft", act_with_approval: "Act with approval",
  act_within_budget: "Within budget", standing_authority: "Standing authority",
};

/** The ladder as a process-status chip row: done = solid navy, current = outlined, upcoming = muted. */
function chipRow(rung: string): string {
  const idx = RUNGS.indexOf(rung as typeof RUNGS[number]);
  return `<div class="chips">${RUNGS.map((r, i) =>
    `<span class="chip ${i < idx ? "done" : i === idx ? "current" : ""}" data-rung="${r}">${RUNG_LABEL[r]}</span>${i < RUNGS.length - 1 ? `<span class="chip-sep"></span>` : ""}`,
  ).join("")}</div>`;
}

function receiptCard(r: ReturnType<StewardSystem["receipts"]>[number]): string {
  const icon = KIND_ICON[r.actionKind] ?? "•";
  return `<div class="card receipt"><div class="tile">${esc(icon)}</div><div style="flex:1">
    <div class="title">${esc(r.summary)}</div>
    <div class="meta">${esc(r.at)} · ${esc(r.actionKind)} · agent ${esc(r.agentId)} · cost ${esc(r.cost)} · <span class="${r.verification.status === "verified" ? "verified" : "unverified"}">${esc(r.verification.status)}</span></div>
    <details class="evidence"><summary>Verification evidence</summary>
      <p class="small">${esc(r.verification.evidence)}<br>
      Checker: ${esc(r.verification.checker ?? "none")} · Authority: ${esc(r.authorityBasis)}<br>
      Hash: ${esc(String(r.hash).slice(0, 16))}… · Prev: ${esc(String(r.prevHash).slice(0, 16))}…</p></details>
  </div></div>`;
}

export function createConsoleServer(sys: StewardSystem) {
  const { core, vault } = sys;
  const layout = (title: string, body: string) => layoutImpl(title, body, sys.theme());
  let lastIntentNote: string | null = null;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const send = (html: string, status = 200) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    };
    const sendWav = (buf: Buffer) => {
      res.writeHead(200, { "content-type": "audio/wav", "content-length": buf.length });
      res.end(buf);
    };
    const redirect = (to: string) => { res.writeHead(303, { location: to }); res.end(); };

    try {
      if (req.method === "POST" && path === "/settings/theme") {
        const form = await readForm(req);
        sys.saveTheme(form.get("theme") === "signal" ? "signal" : "clean");
        const ref = req.headers.referer ? new URL(req.headers.referer).pathname : "/";
        return redirect(ref);
      }
      // ------------------------------------------------------------- home
      if (req.method === "GET" && path === "/") {
        const pending = core.listApprovals("pending");
        const promotions = core.listPromotionEligible();
        const inferred = sys.echoes.pendingInferences();
        const receipts = sys.receipts();
        const verifiedCount = receipts.filter((r) => r.verification.status === "verified").length;
        const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        const ladderSnapshot = core.listLadderStates().map((s) => `
          <div class="card"><div class="row" style="margin-top:0"><strong>${esc(s.agentId)}</strong><span class="muted">· ${esc(s.domain)}</span>
          ${s.eligibleForPromotion ? `<span class="pill gold">Promotion earned</span>` : ""}</div>${chipRow(s.rung)}
          <div class="small muted">Clean streak ${esc(s.cleanStreak)} · Incidents ${esc(s.incidents)}</div></div>`).join("");
        return send(layout("Today", `
          <p class="dateline" style="margin-top:22px">${esc(today)}</p>
          <h1 class="masthead">Morning Brief</h1>
          <p class="attention"><strong>${pending.length} decision${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} you</strong> · ${promotions.length} promotion${promotions.length === 1 ? "" : "s"} earned · ${inferred.length} inferred rule${inferred.length === 1 ? "" : "s"} to review · ${verifiedCount}/${receipts.length} actions verified</p>
          <div class="grid">
            <div class="card stat"><div class="num">${pending.length}</div><div class="lbl">Decisions waiting</div></div>
            <div class="card stat"><div class="num">${core.listMissions().length}</div><div class="lbl">Missions</div></div>
            <div class="card stat"><div class="num">${receipts.length}</div><div class="lbl">Ledger receipts</div></div>
            <div class="card stat"><div class="num">${vault.count()}</div><div class="lbl">Vault memories</div></div>
          </div>
          <div class="row">
            <a class="btn" href="/approvals">Open the approval queue</a>
            <a class="btn outline" href="/brief">Read the full brief</a>
            <a class="btn outline" href="/onboarding">Getting to know you</a>
            <a class="btn outline" href="/intent">New mission</a>
          </div>
          <h2>Authority at a glance</h2>
          ${ladderSnapshot || "<p class='muted'>No ladder state yet.</p>"}
          <h2>Latest receipts</h2>
          ${receipts.slice(-3).reverse().map(receiptCard).join("") || "<p class='muted'>No receipts yet.</p>"}`));
      }

      // -------------------------------------------------------- approvals
      if (req.method === "GET" && path === "/approvals") {
        const pending = core.listApprovals("pending");
        const stack = pending.slice(0, 3).map((a, i) => `
          <div class="card decision-card ${i > 0 ? `behind${i}` : ""}">
            <span class="pill">Approval needed</span>
            <h3>${esc(a.actionKind)} — ${esc(a.agentId)}</h3>
            <p class="detail">${esc(a.reason)}</p>
            <details class="evidence"><summary>Exact arguments (the approval binds to these)</summary>
            <pre class="args">${esc(JSON.stringify(a.argsPreview, null, 1))}</pre></details>
            <form class="row decide" method="post" action="/approvals/${esc(a.id)}/decide">
              <button name="decision" value="approved">Approve</button>
              <button class="outline" name="decision" value="denied">Reject</button>
            </form>
            ${i === 0 ? `<p class="swipe-hint">Swipe the card right to approve, left to reject — or use the buttons.</p>` : ""}
          </div>`).join("");
        const batch = pending.map((a) => `
          <div class="card"><span class="pill light">${esc(a.actionKind)}</span> <strong>${esc(a.agentId)}</strong> — ${esc(a.reason)}
            <form class="row decide" method="post" action="/approvals/${esc(a.id)}/decide">
              <button class="small" name="decision" value="approved">Approve</button>
              <button class="small outline" name="decision" value="denied">Reject</button>
            </form></div>`).join("");
        const promotions = core.listPromotionEligible().map((s) => `
          <div class="card decision-card">
            <span class="pill gold">Promotion earned</span>
            <h3>${esc(s.agentId)} — ${esc(s.domain)}</h3>
            <p class="detail">${esc(s.cleanStreak)} consecutive clean, verified actions at <strong>${esc(RUNG_LABEL[s.rung] ?? s.rung)}</strong>. Confirming promotes exactly one rung.</p>
            ${chipRow(s.rung)}
            <form class="row" method="post" action="/promotions/confirm">
              <input type="hidden" name="agentId" value="${esc(s.agentId)}"><input type="hidden" name="domain" value="${esc(s.domain)}">
              <button>Confirm promotion</button>
            </form></div>`).join("");
        const inferred = sys.echoes.pendingInferences().map((m) => `
          <div class="card decision-card">
            <span class="pill gray">Inferred rule — provisional</span>
            <h3>${esc(m.subject.replace("rule:inferred:", ""))}</h3>
            <p class="detail">${esc(m.content)}</p>
            <p class="small muted">Steward inferred this from your decisions. It governs nothing until you confirm it. Rejecting deletes it permanently.</p>
            <form class="row" method="post" action="/rules/confirm" style="display:inline">
              <input type="hidden" name="memoryId" value="${esc(m.id)}"><button>Confirm rule</button></form>
            <form class="row" method="post" action="/rules/reject" style="display:inline">
              <input type="hidden" name="memoryId" value="${esc(m.id)}"><button class="outline">Reject &amp; delete</button></form>
          </div>`).join("");
        return send(layout("Approvals", `
          <h1 class="page">Approvals</h1>
          ${pending.length ? `<p class="stack-count">Decision ${pending.length > 0 ? 1 : 0} of ${pending.length}</p><div class="stack">${stack}</div>` : "<div class='card'>Nothing needs you right now.</div>"}
          ${pending.length > 1 ? `<h2>All pending (batch view)</h2>${batch}` : ""}
          ${promotions ? `<h2>Promotions</h2>${promotions}` : ""}
          ${inferred ? `<h2>Inferred rules</h2>${inferred}` : ""}`));
      }
      if (req.method === "POST" && path === "/promotions/confirm") {
        const form = await readForm(req);
        core.confirmPromotion(form.get("agentId") ?? "", form.get("domain") ?? "", "principal");
        return redirect("/approvals");
      }
      if (req.method === "POST" && path === "/rules/confirm") {
        const form = await readForm(req);
        sys.echoes.confirmRule(form.get("memoryId") ?? "", "principal");
        return redirect("/approvals");
      }
      if (req.method === "POST" && path === "/rules/reject") {
        const form = await readForm(req);
        sys.echoes.rejectRule(form.get("memoryId") ?? "", "principal");
        return redirect("/approvals");
      }
      if (req.method === "POST" && path.startsWith("/approvals/") && path.endsWith("/decide")) {
        const id = path.split("/")[2]!;
        const form = await readForm(req);
        core.decideApproval(id, form.get("decision") === "approved" ? "approved" : "denied", "principal");
        return redirect("/approvals");
      }

      // ----------------------------------------------------------- ladder
      if (req.method === "GET" && path === "/ladder") {
        const states = core.listLadderStates();
        const byAgent = new Map<string, typeof states>();
        for (const s of states) { const arr = byAgent.get(s.agentId) ?? []; arr.push(s); byAgent.set(s.agentId, arr); }
        const sections = [...byAgent.entries()].map(([agent, rows]) => `
          <h2>${esc(agent)}</h2>
          ${rows.map((s) => {
            const demotions = sys.receipts().filter((r) => r.actionKind === "ladder.demotion" && r.agentId === s.agentId && r.summary.includes(s.domain));
            return `<div class="card">
              <div class="row" style="margin-top:0"><strong style="text-transform:capitalize">${esc(s.domain)}</strong>
              ${s.eligibleForPromotion ? `<span class="pill gold">Promotion earned — confirm in Approvals</span>` : ""}
              <span style="margin-left:auto"></span>
              <form method="post" action="/ladder/reverse"><input type="hidden" name="agentId" value="${esc(s.agentId)}"><input type="hidden" name="domain" value="${esc(s.domain)}">
              <button class="small outline">Reverse an action (demote)</button></form></div>
              ${chipRow(s.rung)}
              <div class="small muted">Clean streak ${esc(s.cleanStreak)} · Incidents ${esc(s.incidents)}</div>
              ${demotions.map((d) => `<p class="small"><span class="pill gray">Demotion</span> ${esc(d.summary)} <span class="muted">(${esc(d.at)})</span></p>`).join("")}
            </div>`;
          }).join("")}`).join("");
        const events = core.ladderEvents.slice(-10).reverse().map((e) => `<tr><td>${esc(e.at)}</td><td>${esc(e.agentId)}</td><td>${esc(e.domain)}</td><td>${esc(e.type)}</td><td>${esc(e.detail)}</td></tr>`).join("");
        return send(layout("Authority Ladder", `
          <h1 class="page">Authority Ladder</h1>
          <p class="attention">How much each agent may do, per domain. <strong>The ladder overrides every spec</strong> — effective authority is the lesser of the two. Demotion is automatic on any incident; promotion is earned by clean, verified work and confirmed by you.</p>
          ${sections || "<p class='muted'>No ladder state yet.</p>"}
          <h2>Recent ladder events</h2><div class="card"><table>${events || "<tr><td>None.</td></tr>"}</table></div>`));
      }
      if (req.method === "POST" && path === "/ladder/reverse") {
        const form = await readForm(req);
        core.recordPrincipalReversal(form.get("agentId") ?? "", form.get("domain") ?? "", "principal", "reversed from Mission Control");
        return redirect("/ladder");
      }

      // ---------------------------------------------------------- missions
      if (req.method === "GET" && path === "/missions") {
        const rows = core.listMissions().map((m) => `<tr><td><a href="/missions/${esc(m.id)}">${esc(m.title)}</a></td><td>${esc(m.agentId)}</td><td><span class="pill light">${esc(m.status)}</span></td><td>spent ${esc(m.spentTotal)}</td></tr>`).join("");
        return send(layout("Missions", `<h1 class="page">Missions</h1><div class="card"><table><tr><th>Title</th><th>Agent</th><th>Status</th><th></th></tr>${rows}</table></div>
          <p><a class="btn outline" href="/intent">Start a new mission</a></p>`));
      }
      if (req.method === "GET" && path.startsWith("/missions/")) {
        const m = core.getMission(path.split("/")[2]!);
        if (!m) return send(layout("Not found", "<h1 class='page'>Mission not found</h1>"), 404);
        const events = core.traces.filter((t) => t.missionId === m.id)
          .map((t) => `<tr><td>${esc(t.at)}</td><td>${esc(t.actionKind)}</td><td>${esc(t.decision)}</td><td>${esc(t.detail)}</td></tr>`).join("");
        const missionReceipts = sys.receipts().filter((r) => r.missionId === m.id);
        const missionCost = missionReceipts.reduce((s, r) => s + r.cost, 0).toFixed(2);
        return send(layout(m.title, `<h1 class="page">${esc(m.title)}</h1>
          <p class="muted">Status <span class="pill light">${esc(m.status)}</span> · Agent ${esc(m.agentId)} · Spent ${esc(m.spentTotal)} · Action costs ${esc(missionCost)} · Trace ${esc(m.traceId)}</p>
          <h2>Timeline</h2><div class="card"><table>${events || "<tr><td>No actions yet.</td></tr>"}</table></div>
          <h2>Receipts</h2>${missionReceipts.map(receiptCard).join("") || "<p class='muted'>No consequential actions yet.</p>"}`));
      }

      // ------------------------------------------------------------- vault
      if (req.method === "GET" && path === "/vault") {
        const mems = vault.listFor("principal");
        const rows = mems.map((m) => `<tr><td>${esc(m.subject)}</td><td>${esc(m.content)}</td><td><span class="pill ${m.state === "confirmed" ? "" : "gray"}">${esc(m.state)}</span></td><td>${esc(m.consentScope.join(", "))}</td><td>${esc(m.provenance.source)}</td>
          <td><form method="post" action="/vault/${esc(m.id)}/transition"><button class="small" name="to" value="confirmed">Confirm</button> <button class="small outline" name="to" value="contested">Contest</button></form>
          <form method="post" action="/vault/${esc(m.id)}/delete" style="margin-top:4px"><button class="small outline">Delete</button></form></td></tr>`).join("");
        return send(layout("Vault", `<h1 class="page">Context Vault</h1><p class="attention">Everything your agents may know — provenance and consent on every memory.</p><div class="card"><table><tr><th>Subject</th><th>Content</th><th>State</th><th>Readable by</th><th>Provenance</th><th></th></tr>${rows}</table></div>`));
      }
      if (req.method === "POST" && path.startsWith("/vault/") && path.endsWith("/transition")) {
        const id = path.split("/")[2]!;
        const form = await readForm(req);
        vault.transitionState(id, form.get("to") === "contested" ? "contested" : "confirmed", "principal");
        return redirect("/vault");
      }
      if (req.method === "POST" && path.startsWith("/vault/") && path.endsWith("/delete")) {
        const id = path.split("/")[2]!;
        const { proof } = vault.deleteWithProof(id, "principal");
        return send(layout("Deleted", `<h1 class="page">Memory deleted</h1><div class="card">
          <p>Subject: ${esc(proof.subject)}</p>
          <p>Residue after scan — vault rows: ${proof.residue.vaultRows}, index entries: ${proof.residue.indexEntries}, ledger refs: ${proof.residue.ledgerContentRefs}</p>
          <p class="${proof.verified ? "verified" : "unverified"}"><strong>Deletion proof ${proof.verified ? "VERIFIED — zero residue" : "FAILED"}</strong></p>
          <p><a href="/vault">Back to the vault</a></p></div>`));
      }

      // ------------------------------------------------------------ ledger
      if (req.method === "GET" && path === "/ledger") {
        const kind = url.searchParams.get("kind");
        const agent = url.searchParams.get("agent");
        const receipts = sys.receipts().slice().reverse()
          .filter((r) => (kind ? r.actionKind === kind : true))
          .filter((r) => (agent ? r.agentId === agent : true));
        const chip = (label: string, href: string, active: boolean) => `<a href="${href}"><span class="chip ${active ? "done" : ""}">${label}</span></a>`;
        return send(layout("Ledger", `<h1 class="page">Receipts Ledger</h1>
          <p class="attention">Append-only, hash-chained. Every card expands to its verification evidence.</p>
          <div class="chips filterchips">
            ${chip("All", "/ledger", !kind && !agent)} ${chip("Sends", "/ledger?kind=email.send", kind === "email.send")} ${chip("Purchases", "/ledger?kind=purchase.buy", kind === "purchase.buy")} ${chip("Calendar", "/ledger?kind=calendar.create", kind === "calendar.create")} ${chip("Tasks", "/ledger?kind=task.create", kind === "task.create")} ${chip("Ladder", "/ledger?kind=ladder.demotion", kind === "ladder.demotion")} ${chip("Ops agent", "/ledger?agent=ops", agent === "ops")} ${chip("Research agent", "/ledger?agent=research", agent === "research")}
          </div>
          ${receipts.map(receiptCard).join("") || "<p class='muted'>No receipts match.</p>"}`));
      }

      // ------------------------------------------------------------- brief
      if (req.method === "GET" && path === "/brief") {
        const brief = sys.brief();
        const pending = core.listApprovals("pending");
        const quiet = url.searchParams.get("quiet") === "1";
        const hasVoice = sys.voice.candidates().length > 0 && sys.voiceSettings().assignments.brief;
        const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        return send(layout("Brief", `
          <p class="dateline" style="margin-top:22px">${esc(today)}</p>
          <h1 class="masthead">Morning Brief</h1>
          <p class="attention"><strong>${pending.length} decision${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} you</strong> · ${esc(brief.stats.actionsExecuted)} actions yesterday (${esc(brief.stats.verified)} verified) · ${esc(brief.stats.totalCost)} total cost</p>
          ${quiet ? `<div class="card"><strong>Quiet hours are on.</strong> The spoken brief is muted — visual only, as you set it. <a href="/voice">Voice settings</a></div>` : ""}
          ${hasVoice ? `<div class="card"><strong>Listen to this brief</strong> — read by your chosen brief voice.<audio controls preload="none" src="/voice/brief.wav"></audio></div>`
            : `<div class="card"><span class="muted">Spoken brief unavailable: no local voice engine installed (run <code>tools/voice/setup.sh</code>), or no brief voice assigned on the <a href="/voice">Voice page</a>.</span></div>`}
          <div class="card brief-body">${renderBriefText(brief.text)}</div>`));
      }

      // ------------------------------------------------------------- voice
      if (req.method === "GET" && path === "/voice/sample") {
        const voiceId = url.searchParams.get("voice") ?? "";
        const line = (url.searchParams.get("line") ?? "brief") as keyof typeof CANONICAL_LINES;
        if (!(line in CANONICAL_LINES)) { res.writeHead(400); return res.end("unknown line"); }
        const cacheDir = join(voiceHome(), "cache");
        mkdirSync(cacheDir, { recursive: true });
        const file = join(cacheDir, `${voiceId}__${line}.wav`);
        if (!existsSync(file)) {
          const wav = await sys.voice.synthesize(CANONICAL_LINES[line], voiceId, 1.0);
          writeFileSync(file, wav);
        }
        return sendWav(readFileSync(file));
      }
      if (req.method === "GET" && path === "/voice/brief.wav") {
        const settings = sys.voiceSettings();
        if (inQuietHours(settings, new Date())) return redirect("/brief?quiet=1");
        const assignment = settings.assignments.brief;
        if (!assignment) { res.writeHead(503, { "content-type": "text/plain" }); return res.end("no brief voice assigned"); }
        const text = speakableBrief(sys.brief().text, settings.verbosity);
        const key = createHash("sha256").update(`${assignment.voiceId}|${settings.rate}|${settings.verbosity}|${text}`).digest("hex").slice(0, 16);
        const cacheDir = join(voiceHome(), "cache");
        mkdirSync(cacheDir, { recursive: true });
        const file = join(cacheDir, `brief__${key}.wav`);
        if (!existsSync(file)) writeFileSync(file, await sys.voice.synthesize(text, assignment.voiceId, settings.rate));
        return sendWav(readFileSync(file));
      }
      if (req.method === "GET" && path === "/voice") {
        const candidates = sys.voice.candidates();
        const settings = sys.voiceSettings();
        const lineKeys = Object.keys(CANONICAL_LINES) as (keyof typeof CANONICAL_LINES)[];
        const audition = candidates.map((c) => `
          <div class="card"><strong>${esc(c.label)}</strong>
          ${lineKeys.map((k) => `<div class="small muted" style="margin-top:8px">${esc(k)} line — “${esc(CANONICAL_LINES[k])}”</div><audio controls preload="none" src="/voice/sample?voice=${encodeURIComponent(c.voiceId)}&line=${esc(k)}"></audio>`).join("")}
          </div>`).join("");
        const options = (current: string | undefined) => candidates.map((c) =>
          `<option value="${esc(c.voiceId)}" ${c.voiceId === current ? "selected" : ""}>${esc(c.label)}</option>`).join("");
        return send(layout("Voice", `
          <h1 class="page">Voice</h1>
          <p class="attention">Steward's voice is <strong>local-first</strong>: engines run on this machine; nothing is streamed to a cloud voice. Pick by listening — every candidate reads the same three lines.</p>
          ${candidates.length === 0 ? `<div class="card"><strong>No voice engine installed in this environment.</strong> Run <code>tools/voice/setup.sh</code> to install the local runtime (Piper floor, Kokoro where it runs). The rest of Mission Control works without it.</div>` : `
          <h2>Audition</h2>${audition}
          <h2>Assignments &amp; delivery</h2>
          <form class="card" method="post" action="/voice/settings">
            <label class="f">Profile name</label><input type="text" name="profileName" value="${esc(settings.profileName)}">
            <label class="f">Brief voice</label><select name="briefVoice">${options(settings.assignments.brief?.voiceId)}</select>
            <label class="f">Alert voice</label><select name="alertVoice">${options(settings.assignments.alert?.voiceId)}</select>
            <label class="f">Interview voice</label><select name="interviewVoice">${options(settings.assignments.interview?.voiceId)}</select>
            <label class="f">Speaking rate — <span id="rateVal">${esc(settings.rate)}</span>× (engine speed control)</label>
            <input type="range" name="rate" min="0.5" max="1.5" step="0.05" value="${esc(settings.rate)}" oninput="document.getElementById('rateVal').textContent=this.value">
            <label class="f">Spoken brief verbosity</label>
            <select name="verbosity"><option value="full" ${settings.verbosity === "full" ? "selected" : ""}>Full brief</option><option value="headlines" ${settings.verbosity === "headlines" ? "selected" : ""}>Headlines only</option></select>
            <label class="f">Quiet hours — no spoken output between</label>
            <div class="row"><input type="time" name="quietStart" value="${esc(settings.quietHoursStart ?? "")}" style="max-width:150px"> and <input type="time" name="quietEnd" value="${esc(settings.quietHoursEnd ?? "")}" style="max-width:150px"></div>
            <div class="row"><button>Save to my Vault</button></div>
            <p class="sr-note">Saved as an owner preference in the Context Vault (provenance: owner-stated). Voice cloning is not offered: it would require a Vault consent artifact, and a clone would never speak AS you to third parties.</p>
          </form>`}
          <div class="card"><strong>Speaking here:</strong> use the voice bar at the bottom of any page. The big disc is push-to-talk (hold, or tap to latch); the small mic toggles hands-free listening; “Mic off” is absolute. Speech recognition uses your browser's Web Speech API when available — audio for recognition is handled by the browser, and every field also works by typing.</div>`));
      }
      if (req.method === "POST" && path === "/voice/settings") {
        const form = await readForm(req);
        const candidates = sys.voice.candidates();
        const pick = (name: string) => {
          const c = candidates.find((x) => x.voiceId === form.get(name));
          return c ? { engine: c.engine, voiceId: c.voiceId, label: c.label } : null;
        };
        sys.saveVoiceSettings({
          profileName: form.get("profileName") || "Default",
          assignments: { brief: pick("briefVoice"), alert: pick("alertVoice"), interview: pick("interviewVoice") },
          rate: Math.min(1.5, Math.max(0.5, Number(form.get("rate") ?? 1))),
          verbosity: form.get("verbosity") === "headlines" ? "headlines" : "full",
          quietHoursStart: form.get("quietStart") || null,
          quietHoursEnd: form.get("quietEnd") || null,
        });
        return redirect("/voice");
      }

      // -------------------------------------------------------- onboarding
      if (req.method === "GET" && path === "/onboarding") {
        sys.onboarding ??= new OnboardingSession({ vault, core });
        const s = sys.onboarding;
        if (s.isDone()) {
          const lines = core.listHardLines();
          return send(layout("Onboarding", `
            <h1 class="page">Getting to know you — complete</h1>
            <div class="card"><p><strong>${s.transcript.length} answers</strong> are stored in your Vault as confirmed, owner-stated memories.</p>
            <p>Domain pack: <strong>${esc(s.detectedPack()?.label ?? "none detected")}</strong></p>
            <p>Your keystone — what you'd hand off first: <em>“${esc(s.keystoneGoal() ?? "")}”</em> — seed it as a mission on the <a href="/intent">New mission</a> page.</p>
            ${s.firstMissionTemplate() ? `<p>Prepared first mission for your pack: <strong>${esc(s.firstMissionTemplate()!.template.title)}</strong> — a pre-built spec with conservative authority (sends and deletes approval-gated, spend cap ${esc(s.firstMissionTemplate()!.template.authority.spendLimit)}). ${s.keystoneSelectsTemplate() ? "Your keystone answer selects it." : ""}</p>` : ""}</div>
            <h2>Tier 0 hard lines now enforced</h2>
            ${lines.map((l) => `<div class="card"><span class="pill">Hard line</span> <strong>${esc(l.kind ?? "any action")}</strong>${l.recipient ? ` to ${esc(l.recipient)}` : ""}${l.maxAmount !== undefined ? ` over ${esc(l.maxAmount)}` : ""}<br><span class="muted">${esc(l.description)}</span></div>`).join("") || "<p class='muted'>None compiled.</p>"}
            <form method="post" action="/onboarding/reset"><button class="outline">Start a new interview</button></form>`));
        }
        const step = s.current()!;
        const n = s.transcript.length + 1;
        return send(layout("Onboarding", `
          <h1 class="page">Getting to know you</h1>
          <p class="dateline">${esc(step.tier === "tier0" ? "Tier 0 — authority & safety" : step.tier === "tier1" ? "Tier 1 — the work map" : "Domain pack")} · Question ${n}</p>
          <div class="card">
            <p style="font-size:19px;font-weight:700;margin-top:0">${esc(step.question)}</p>
            <p class="small muted"><strong>Why we ask:</strong> ${esc(step.unlocks)}</p>
            <form method="post" action="/onboarding/answer">
              <textarea name="answer" rows="3" placeholder="Type — or focus here and use the mic bar below to dictate"></textarea>
              <div class="row"><button>Save answer</button></div>
            </form>
          </div>`));
      }
      if (req.method === "POST" && path === "/onboarding/answer") {
        const form = await readForm(req);
        sys.onboarding ??= new OnboardingSession({ vault, core });
        sys.onboarding.answer(form.get("answer") ?? "");
        return redirect("/onboarding");
      }
      if (req.method === "POST" && path === "/onboarding/reset") {
        sys.onboarding = new OnboardingSession({ vault, core });
        return redirect("/onboarding");
      }

      // ------------------------------------------------------------ intent
      if (req.method === "GET" && path === "/intent") {
        const keystone = sys.onboarding?.keystoneGoal() ?? "";
        if (!sys.interview) {
          return send(layout("New mission", `
            <h1 class="page">New mission — Intent Studio</h1>
            <p class="attention">Say the goal in plain language. The interview compiles it into a spec with authority limits and acceptance criteria — uncheckable criteria are flagged <strong>before</strong> anything runs.</p>
            ${lastIntentNote ? `<div class="card">${esc(lastIntentNote)}</div>` : ""}
            <form class="card" method="post" action="/intent/start">
              <label class="f">The goal</label>
              <input type="text" name="goal" value="${esc(keystone)}" placeholder="e.g. Keep the donor thank-you letters going out on time">
              <div class="row"><button>Start the interview</button></div>
              <p class="sr-note">Focus the field and dictate with the mic bar if you prefer speaking.</p>
            </form>`));
        }
        const q = sys.interview.currentQuestion();
        return send(layout("Interview", `
          <h1 class="page">Intent Studio interview</h1>
          <div class="card">
            <p style="font-size:19px;font-weight:700;margin-top:0">${esc(q ?? "")}</p>
            <form method="post" action="/intent/answer">
              <textarea name="answer" rows="3" placeholder="Type — or focus here and dictate"></textarea>
              <div class="row"><button>Answer</button></div>
            </form>
          </div>`));
      }
      if (req.method === "POST" && path === "/intent/start") {
        const form = await readForm(req);
        const goal = (form.get("goal") ?? "").trim();
        if (goal) { sys.interview = new InterviewSession(goal); lastIntentNote = null; }
        return redirect("/intent");
      }
      if (req.method === "POST" && path === "/intent/answer") {
        const form = await readForm(req);
        const interview = sys.interview;
        if (interview) {
          const r = interview.answer(form.get("answer") ?? "");
          if (r.done) {
            const spec = interview.compile();
            sys.specs.save(spec);
            const mission = planMission(spec, core);
            lastIntentNote = `Spec compiled: "${spec.goal}" (spend limit ${spec.authority.spendLimit}; ${spec.acceptanceCriteria.length} checkable criteria${spec.uncheckableCriteria.length ? `; ${spec.uncheckableCriteria.length} flagged UNCHECKABLE` : ""}). Mission "${mission.title}" created and ${mission.status}.`;
            sys.interview = null;
            return redirect("/intent");
          }
        }
        return redirect("/intent");
      }

      // ------------------------------------------------------------- about
      if (req.method === "GET" && path === "/about") {
        return send(layout("About — the two principles", `
          <h1 class="page">The two things Steward is</h1>
          <div class="card">
            <span class="pill">Principle 1</span>
            <h2 style="margin-top:10px">ANSWERABLE</h2>
            <p>Every consequential action taken under Steward is authorized by a visible, earned authority (the <a href="/ladder">Authority Ladder</a>), mediated before execution by the Policy Core, and receipted afterward in the <a href="/ledger">hash-chained Ledger</a> with its verification evidence — or honestly marked <em>unverified</em>. You never have to trust the model; you can audit the record. Trust here is not a personality trait; it is a ledger.</p>
          </div>
          <div class="card">
            <span class="pill">Principle 2</span>
            <h2 style="margin-top:10px">YOURS</h2>
            <p>Everything Steward knows about you is your property: every memory in the <a href="/vault">Context Vault</a> carries provenance (who asserted it, how) and consent scopes (which agents may read it), is deletable with a zero-residual proof, and is exportable in full — export → wipe → import is exercised in the eval suite and the demo flow. And Steward serves exactly one principal: content arriving from the world — web pages, tool results, documents — is data, never orders. Attempts to instruct agents through content are treated as attacks and blocked.</p>
          </div>
          <div class="card">
            <h2 style="margin-top:0">What Steward does NOT govern — the honesty note</h2>
            <p class="small">The governed surface is the actions agents take <em>through</em> the Policy &amp; Mediation Core, and the memories in the Vault. Steward does not govern: what you do yourself outside it; the internal behavior of external services (email providers, banks, EHRs) beyond the receipts their effects leave here; a checker's evidence beyond the world state it inspects (verification means “the expected effect is present”, not “the real world is certainly so”); speech recognition, which happens in your browser under the browser's own privacy terms; or cloud anything — there is none by default. A supervision layer that hides its edges would fail its own first principle.</p>
          </div>`));
      }

      return send(layout("Not found", "<h1 class='page'>Not found</h1>"), 404);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const sys = createSteward(process.env.STEWARD_DB ?? ":memory:");
  if (process.env.SEED === "1") seedDemo(sys);
  const port = Number(process.env.PORT ?? 4173);
  createConsoleServer(sys).listen(port, () => console.log(`Steward Mission Control (Clean Command) on http://localhost:${port}`));
}
