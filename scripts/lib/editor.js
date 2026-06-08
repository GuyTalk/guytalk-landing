'use strict';

/**
 * GuyTalk Editorial Pass — the FINAL writing pass.
 *
 * Pipeline role:
 *   Claude (copy.js)  → gathers facts, drafts raw stories  →  copy{}
 *   OpenAI (this file) → final writing pass: edits every section to follow
 *                        GUYTALK_EDITORIAL_BIBLE.md, then flags anything that
 *                        still can't meet the standard.
 *   qa-brief.js        → hard-blocks publish if the editor flagged a violation.
 *
 * Behavior (set by Jake, 2026-06-04):
 *   - Rewrite + hard-block: editor rewrites to comply; sections that still fail
 *     the Bible are returned in report.blocking, and QA blocks the publish.
 *   - Fail-open: if OPENAI_API_KEY is missing or OpenAI errors, the Claude draft
 *     is returned untouched with reviewed:false so the brief can still ship with
 *     a loud "NOT editor-reviewed" warning. The streak survives an OpenAI outage.
 *
 * The Editorial Bible is loaded from disk every run, so editing the markdown
 * changes the standard with no code change.
 */

const fs   = require('fs');
const path = require('path');

const BIBLE_PATH = path.join(__dirname, '..', '..', 'GUYTALK_EDITORIAL_BIBLE.md');

// Default editor model — override with OPENAI_EDITOR_MODEL in .env.local
const DEFAULT_MODEL = 'gpt-4o';

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

// ── Main entry ────────────────────────────────────────────────────────────────
// Returns { copy, editor } where editor = {
//   reviewed, model, ts, changed:[], blocking:[{section,reason}], notes:[], reason?
// }
async function editBrief({ copy, context }) {
  const skip = (reason) => ({
    copy,
    editor: { reviewed: false, blocking: [], changed: [], notes: [], reason },
  });

  if (!copy) return skip('no copy to edit');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('your_') || apiKey.includes('_here')) {
    return skip('OPENAI_API_KEY missing — brief NOT editor-reviewed');
  }

  const bible = loadBible();
  if (!bible) return skip('GUYTALK_EDITORIAL_BIBLE.md not found — editor cannot enforce standard');

  let OpenAI;
  try {
    OpenAI = require('openai');
  } catch (_) {
    return skip('openai package not installed (run: npm install)');
  }

  const model  = process.env.OPENAI_EDITOR_MODEL || DEFAULT_MODEL;
  const client = new (OpenAI.default || OpenAI)({ apiKey });
  const editable = extractEditable(copy);

  const system = `You are the GuyTalk Editor — the final editorial gate before a daily brief publishes.

You are given:
1. THE GUYTALK EDITORIAL BIBLE — the single source of truth. Follow it exactly.
2. RAW FACTS — the only facts you may use. Never add a name, number, score, or event that is not in RAW FACTS.
3. DRAFT — JSON the writer produced. You rewrite the text to follow the Bible.

YOUR JOB
- Make every section read like GuyTalk: "what happened, why it matters, and what to say about it."
- Tighten wording. Cut filler. Keep it casual, confident, useful. 2–5 sentences per item.
- Sports: every item must have a specific player, play, moment, or storyline AND why it matters. If the RAW FACTS lack any specific detail for an item, flag it — do not invent one.
- Markets: observational ONLY. Never advise. No buy/sell/hold, no "buying opportunity", no price targets, no "investors should". Use "markets moved / investors watched / the read-through was / the concern was".
- Culture: never a bare headline. Each item needs what happened, why people care, and what to say.
- Top Hits / taglines: short, punchy, specific. No vague fragments.

HARD RULE — CONVERSATIONAL VALUE
A section may only stay if it answers at least TWO of:
- Why does this matter?
- Why would people be talking about this?
- What is the simple takeaway?
- What could I say in a group chat / at work / at a bar?
If you cannot make a section meet that bar using only the RAW FACTS, add it to report.blocking instead of faking it.

OUTPUT — return ONLY valid JSON, no markdown, exactly this shape:
{
  "copy": { ...the DRAFT object with the same keys, text rewritten to follow the Bible... },
  "report": {
    "blocking": [ { "section": "markets|lead|sportsOther|golf|f1|culture|finalSharpTake|...", "reason": "why this section still fails the Bible and must not publish as-is" } ],
    "changed":  [ "names of sections you meaningfully rewrote" ],
    "notes":    [ "short editor notes, optional" ]
  }
}

Rules for the "copy" object:
- Keep EXACTLY the same keys and array lengths as the DRAFT. Do not add or drop sections.
- Only change text values. Preserve any non-text fields.
- If a section is fine as-is, return it unchanged.
- "blocking" is for sections that CANNOT be made compliant from the RAW FACTS (e.g. a sports item with no specific detail available, or unavoidable advice language). Prefer to FIX rather than block — block only when facts won't allow a fix.`;

  const user = `=== GUYTALK EDITORIAL BIBLE ===
${bible}

=== RAW FACTS (only facts you may use) ===
${context || '(none provided)'}

=== DRAFT (rewrite text to follow the Bible) ===
${JSON.stringify(editable)}`;

  let raw;
  try {
    const res = await client.chat.completions.create({
      model,
      temperature: 0.4,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    });
    raw = res.choices?.[0]?.message?.content;
  } catch (err) {
    return skip(`OpenAI editor call failed: ${err.message}`);
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

  return {
    copy: mergedCopy,
    editor: {
      reviewed: true,
      model,
      ts: new Date().toISOString(),
      blocking,
      changed,
      notes,
    },
  };
}

module.exports = { editBrief, loadBible, BIBLE_PATH };
