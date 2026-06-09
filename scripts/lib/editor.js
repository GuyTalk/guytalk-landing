'use strict';

/**
 * GuyTalk Editorial Pass — the FINAL writing pass.
 *
 * Pipeline role:
 *   Claude Haiku (copy.js)   → gathers facts, drafts raw stories  →  copy{}
 *   Claude Sonnet (this file) → final editorial pass: checks formatting, sharpens
 *                               every "What to say" and "Why it matters", enforces
 *                               GUYTALK_EDITORIAL_BIBLE.md, flags weak content, and
 *                               (in code) detects broken source links.
 *   qa-brief.js               → hard-blocks publish if the editor flagged a violation.
 *
 * Runs entirely on the existing Anthropic infrastructure that already powers
 * brief generation — same ANTHROPIC_API_KEY, same @anthropic-ai/sdk. No OpenAI.
 *
 * Behavior (set by Jake, 2026-06-04):
 *   - Rewrite + hard-block: editor rewrites to comply; sections that still fail
 *     the Bible are returned in report.blocking, and QA blocks the publish.
 *   - Fail-open: if ANTHROPIC_API_KEY is missing or the call errors, the Claude
 *     draft is returned untouched with reviewed:false so the brief can still ship
 *     with a loud "NOT editor-reviewed" warning. The streak survives an outage.
 *   - Broken links are reported as warnings (editor.brokenLinks), not hard blocks —
 *     a dead source link shouldn't kill the whole brief.
 *
 * The Editorial Bible is loaded from disk every run, so editing the markdown
 * changes the standard with no code change.
 */

const fs   = require('fs');
const path = require('path');

const BIBLE_PATH = path.join(__dirname, '..', '..', 'GUYTALK_EDITORIAL_BIBLE.md');

// Editor model — a stronger model than the Haiku drafter, for editorial judgment.
// Override with ANTHROPIC_EDITOR_MODEL in .env.local.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ── Editable text fields, by section. The editor may only rewrite these. ──────
// Everything else in copy{} (gameIndex, tag values, structure) is preserved.
function extractEditable(copy) {
  if (!copy) return {};
  return {
    title:       copy.title || '',
    keyTakeaway: copy.keyTakeaway || '',
    todaysHits:  copy.todaysHits ? { ...copy.todaysHits } : null,
    lead: copy.lead ? {
      headline:     copy.lead.headline || '',
      whatHappened: copy.lead.whatHappened || '',
      whyBullet1:   copy.lead.whyBullet1 || '',
      whyBullet2:   copy.lead.whyBullet2 || '',
      whatToSay:    copy.lead.whatToSay || '',
    } : null,
    sportsOther: Array.isArray(copy.sportsOther) ? [...copy.sportsOther] : [],
    markets: copy.markets ? {
      mood:       copy.markets.mood || '',
      whyBullet1: copy.markets.whyBullet1 || '',
      whyBullet2: copy.markets.whyBullet2 || '',
      bringUp:    copy.markets.bringUp || '',
    } : null,
    golf: copy.golf ? {
      headline:  copy.golf.headline || '',
      whyCare1:  copy.golf.whyCare1 || '',
      whyCare2:  copy.golf.whyCare2 || '',
      watchFor:  copy.golf.watchFor || '',
      whatToSay: copy.golf.whatToSay || '',
    } : null,
    f1: copy.f1 ? {
      headline:  copy.f1.headline || '',
      whyCare1:  copy.f1.whyCare1 || '',
      whyCare2:  copy.f1.whyCare2 || '',
      watchFor:  copy.f1.watchFor || '',
      whatToSay: copy.f1.whatToSay || '',
    } : null,
    culture: Array.isArray(copy.culture) ? copy.culture.map(i => ({
      topic:        i.topic || i.head || '',
      whatHappened: i.whatHappened || '',
      whyItMatters: i.whyItMatters || '',
      whatToSay:    i.whatToSay || '',
    })) : null,
    finalSharpTake: copy.finalSharpTake || '',
    glance: copy.glance ? { ...copy.glance } : null,
  };
}

// ── Merge the editor's rewritten text back into a clone of the original copy. ──
// Only known string fields are overwritten; structure/keys from Claude survive.
function mergeEdited(original, edited) {
  if (!edited || typeof edited !== 'object') return original;
  const out = JSON.parse(JSON.stringify(original || {}));
  const str = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

  if (edited.title)       out.title       = str(edited.title, out.title);
  if (edited.keyTakeaway) out.keyTakeaway = str(edited.keyTakeaway, out.keyTakeaway);
  if (edited.finalSharpTake) out.finalSharpTake = str(edited.finalSharpTake, out.finalSharpTake);

  if (edited.todaysHits && out.todaysHits) {
    for (const k of Object.keys(out.todaysHits)) {
      out.todaysHits[k] = str(edited.todaysHits[k], out.todaysHits[k]);
    }
  }
  if (edited.lead && out.lead) {
    for (const k of ['headline', 'whatHappened', 'whyBullet1', 'whyBullet2', 'whatToSay']) {
      out.lead[k] = str(edited.lead[k], out.lead[k]);
    }
  }
  if (Array.isArray(edited.sportsOther) && Array.isArray(out.sportsOther)) {
    out.sportsOther = out.sportsOther.map((orig, i) => str(edited.sportsOther[i], orig));
  }
  for (const sec of ['markets', 'golf', 'f1']) {
    if (edited[sec] && out[sec]) {
      for (const k of Object.keys(out[sec])) {
        if (typeof out[sec][k] === 'string') out[sec][k] = str(edited[sec][k], out[sec][k]);
      }
    }
  }
  if (Array.isArray(edited.culture) && Array.isArray(out.culture)) {
    out.culture = out.culture.map((item, i) => {
      const e = edited.culture[i] || {};
      return {
        ...item,
        topic:        str(e.topic, item.topic || item.head),
        whatHappened: str(e.whatHappened, item.whatHappened),
        whyItMatters: str(e.whyItMatters, item.whyItMatters),
        whatToSay:    str(e.whatToSay, item.whatToSay),
      };
    });
  }
  if (edited.glance && out.glance) {
    for (const k of Object.keys(out.glance)) {
      out.glance[k] = str(edited.glance[k], out.glance[k]);
    }
  }
  return out;
}

function parseJson(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/^```json?\s*/m, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch (_) {} }
  return null;
}

function loadBible() {
  try { return fs.readFileSync(BIBLE_PATH, 'utf8'); }
  catch (_) { return null; }
}

// ── Formatting check (code-side) ───────────────────────────────────────────────
// Catches markdown artifacts that should never appear in the plain-prose brief.
function formattingIssues(copy) {
  const issues = [];
  const scan = (label, text) => {
    if (typeof text !== 'string' || !text) return;
    if (/\*\*|__|^#{1,6}\s|^[-*•]\s|\]\(http/m.test(text)) issues.push(`${label}: markdown artifact`);
    if (/\b(undefined|null|\[object Object\]|NaN)\b/.test(text)) issues.push(`${label}: placeholder/empty value leaked`);
  };
  const walk = (obj, prefix) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const label = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') scan(label, v);
      else if (v && typeof v === 'object') walk(v, label);
    }
  };
  walk(extractEditable(copy), '');
  return [...new Set(issues)];
}

// ── Broken-link detection (code-side) ──────────────────────────────────────────
// Validates URL format and reachability. Returns [{ url, reason }]. Warnings only.
async function checkLinks(links) {
  const urls = [...new Set((links || []).filter(u => typeof u === 'string' && u.trim()))];
  if (!urls.length) return [];
  const broken = [];

  const checkOne = async (url) => {
    let parsed;
    try { parsed = new URL(url); }
    catch (_) { broken.push({ url, reason: 'malformed URL' }); return; }
    if (!/^https?:$/.test(parsed.protocol)) { broken.push({ url, reason: `unsupported protocol ${parsed.protocol}` }); return; }

    // Browser-like UA — many publishers 403 a bot UA on otherwise-live pages.
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    };
    const attempt = async (method) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        return await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers });
      } finally { clearTimeout(timer); }
    };
    try {
      let res = await attempt('HEAD');
      // Many servers reject/blank HEAD — retry once with GET before judging.
      if ([403, 405, 501].includes(res.status)) res = await attempt('GET');
      const s = res.status;
      // Only treat genuinely-dead responses as broken. 401/403/429 are
      // auth / anti-bot / rate-limit — the page almost certainly works in a browser.
      if (s === 404 || s === 410 || s >= 500) broken.push({ url, reason: `HTTP ${s}` });
    } catch (err) {
      broken.push({ url, reason: err.name === 'AbortError' ? 'timeout' : `unreachable (${err.message})` });
    }
  };

  // Bounded concurrency so we never hammer sources or stall the 7am run.
  const POOL = 5;
  for (let i = 0; i < urls.length; i += POOL) {
    await Promise.all(urls.slice(i, i + POOL).map(checkOne));
  }
  return broken;
}

// ── Main entry ────────────────────────────────────────────────────────────────
// editBrief({ copy, context, links }) → { copy, editor }
// editor = { reviewed, model, ts, changed:[], blocking:[{section,reason}],
//            notes:[], brokenLinks:[{url,reason}], reason? }
async function editBrief({ copy, context, links }) {
  // Broken-link detection runs regardless of whether the model edit succeeds —
  // it's a code-side check on the source URLs, independent of Anthropic.
  const brokenLinks = await checkLinks(links).catch(() => []);

  const skip = (reason) => ({
    copy,
    editor: { reviewed: false, blocking: [], changed: [], notes: [], brokenLinks, reason },
  });

  if (!copy) return skip('no copy to edit');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('your_') || apiKey.includes('_here')) {
    return skip('ANTHROPIC_API_KEY missing — brief NOT editor-reviewed');
  }

  const bible = loadBible();
  if (!bible) return skip('GUYTALK_EDITORIAL_BIBLE.md not found — editor cannot enforce standard');

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (_) {
    return skip('@anthropic-ai/sdk not installed (run: npm install)');
  }

  const model  = process.env.ANTHROPIC_EDITOR_MODEL || DEFAULT_MODEL;
  const client = new (Anthropic.default || Anthropic)({ apiKey });
  const editable = extractEditable(copy);

  const system = `You are the GuyTalk Editor — the final editorial gate before a daily brief publishes.

You are given:
1. THE GUYTALK EDITORIAL BIBLE — the single source of truth. Follow it exactly.
2. RAW FACTS — the only facts you may use. Never add a name, number, score, or event that is not in RAW FACTS.
3. DRAFT — JSON the writer produced. You rewrite the text to follow the Bible.

YOUR JOB — six things, every run:

A. CHECK FORMATTING. Plain prose only — strip any markdown (**bold**, #headers, - bullets, links), fix broken sentences, kill double spaces, ensure each item is complete sentences. 2–5 sentences per item. No leaked "undefined", "null", or template fragments.

B. IMPROVE EVERY "WHAT TO SAY". These are the lines a reader drops in a group chat, at work, or at a bar (lead.whatToSay, golf.whatToSay, f1.whatToSay, culture[].whatToSay, markets.bringUp). Make them punchy, specific, and actually sayable out loud. Cut hedging. A great one sounds like a confident friend, not a press release.

C. IMPROVE EVERY "WHY IT MATTERS". These justify the reader's attention (lead.whyBullet1/2, markets.whyBullet1/2, golf.whyCare1/2, f1.whyCare1/2, culture[].whyItMatters). Make the stakes concrete and non-obvious. Replace "this is big" with the actual reason it's big, using only RAW FACTS.

D. ENFORCE THE BIBLE on every section — voice, banned phrases, structure.

E. MARKETS COMPLIANCE. Observational ONLY. Never advise. No buy/sell/hold, "buying opportunity", price targets, or "investors should". Use "markets moved / investors watched / the read-through was / the concern was". This applies to ALL sections, not just Markets.

F. FLAG WEAK CONTENT. A section may only stay if it answers at least TWO of: Why does this matter? Why would people be talking about it? What is the simple takeaway? What could I say about it? If you cannot make a section meet that bar using only the RAW FACTS, add it to report.blocking instead of faking it. Sports items need a specific player, play, moment, or storyline AND why it matters; if RAW FACTS lack the detail, block it — do not invent.

OUTPUT — return ONLY valid JSON, no markdown fences, exactly this shape:
{
  "copy": { ...the DRAFT object with the SAME keys and array lengths, text rewritten to follow the Bible... },
  "report": {
    "blocking": [ { "section": "markets|lead|sportsOther|golf|f1|culture|finalSharpTake|...", "reason": "why this section still fails the Bible and must not publish as-is" } ],
    "changed":  [ "names of sections you meaningfully rewrote" ],
    "notes":    [ "short editor notes, optional" ]
  }
}

Rules for the "copy" object:
- Keep EXACTLY the same keys and array lengths as the DRAFT. Do not add or drop sections.
- Only change text values. Preserve any non-text fields.
- If a section is already great, return it unchanged.
- Prefer to FIX rather than block — block only when RAW FACTS won't allow a compliant fix.`;

  const user = `=== GUYTALK EDITORIAL BIBLE ===
${bible}

=== RAW FACTS (only facts you may use) ===
${context || '(none provided)'}

=== DRAFT (rewrite text to follow the Bible) ===
${JSON.stringify(editable)}`;

  let raw;
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0.4,
      system,
      messages: [
        { role: 'user', content: `${user}\n\nReturn ONLY the JSON object described above, starting with {.` },
      ],
    });
    raw = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  } catch (err) {
    return skip(`Claude editor call failed: ${err.message}`);
  }

  const parsed = parseJson(raw);
  if (!parsed || !parsed.copy) {
    return skip('editor returned unparseable output — kept Claude draft');
  }

  const mergedCopy = mergeEdited(copy, parsed.copy);
  const report = parsed.report || {};
  const blocking = Array.isArray(report.blocking)
    ? report.blocking.filter(b => b && b.section && b.reason)
    : [];
  const changed = Array.isArray(report.changed) ? report.changed.filter(Boolean) : [];
  const notes   = Array.isArray(report.notes)   ? report.notes.filter(Boolean)   : [];

  // Code-side formatting backstop on the FINAL merged copy — anything the model
  // missed becomes an editor note (visible in QA) rather than shipping silently.
  const fmt = formattingIssues(mergedCopy);
  if (fmt.length) notes.push(...fmt.map(f => `formatting: ${f}`));

  return {
    copy: mergedCopy,
    editor: {
      reviewed: true,
      model,
      ts: new Date().toISOString(),
      blocking,
      changed,
      notes,
      brokenLinks,
    },
  };
}

module.exports = { editBrief, loadBible, checkLinks, BIBLE_PATH };
