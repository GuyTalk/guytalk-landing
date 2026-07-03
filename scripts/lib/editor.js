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
const { addWarning } = require('./warnings');

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
      theRead:      copy.lead.theRead || '',
      ammo:         Array.isArray(copy.lead.ammo) ? [...copy.lead.ammo] : [],
      whatToSay:    copy.lead.whatToSay || '',
    } : null,
    sportsOther: Array.isArray(copy.sportsOther) ? [...copy.sportsOther] : [],
    markets: copy.markets ? {
      mood:       copy.markets.mood || '',
      whyBullet1: copy.markets.whyBullet1 || '',
      whyBullet2: copy.markets.whyBullet2 || '',
      bringUp:    copy.markets.bringUp || '',
      theRead:    copy.markets.theRead || '',
      ammo:       Array.isArray(copy.markets.ammo) ? [...copy.markets.ammo] : [],
    } : null,
    golf: copy.golf ? {
      headline:  copy.golf.headline || '',
      course:    copy.golf.course || '',
      whyCare1:  copy.golf.whyCare1 || '',
      whyCare2:  copy.golf.whyCare2 || '',
      defending: copy.golf.defending || '',
      watchFor:  copy.golf.watchFor || '',
      theRead:   copy.golf.theRead || '',
      ammo:      Array.isArray(copy.golf.ammo) ? [...copy.golf.ammo] : [],
      whatToSay: copy.golf.whatToSay || '',
    } : null,
    f1: copy.f1 ? {
      headline:  copy.f1.headline || '',
      whyCare1:  copy.f1.whyCare1 || '',
      whyCare2:  copy.f1.whyCare2 || '',
      watchFor:  copy.f1.watchFor || '',
      theRead:   copy.f1.theRead || '',
      ammo:      Array.isArray(copy.f1.ammo) ? [...copy.f1.ammo] : [],
      whatToSay: copy.f1.whatToSay || '',
    } : null,
    nhl: copy.nhl ? {
      headline:  copy.nhl.headline || '',
      whyCare1:  copy.nhl.whyCare1 || '',
      whyCare2:  copy.nhl.whyCare2 || '',
      watchFor:  copy.nhl.watchFor || '',
      theRead:   copy.nhl.theRead || '',
      ammo:      Array.isArray(copy.nhl.ammo) ? [...copy.nhl.ammo] : [],
      whatToSay: copy.nhl.whatToSay || '',
    } : null,
    upcomingPreview: copy.upcomingPreview ? {
      whyItMatters: copy.upcomingPreview.whyItMatters || '',
      watchFor:     copy.upcomingPreview.watchFor || '',
      theRead:      copy.upcomingPreview.theRead || '',
      ammo:         Array.isArray(copy.upcomingPreview.ammo) ? [...copy.upcomingPreview.ammo] : [],
      whatToSay:    copy.upcomingPreview.whatToSay || '',
    } : null,
    culture: Array.isArray(copy.culture) ? copy.culture.map(i => ({
      topic:        i.topic || i.head || '',
      whatHappened: i.whatHappened || '',
      whyItMatters: i.whyItMatters || '',
      theRead:      i.theRead || '',
      ammo:         Array.isArray(i.ammo) ? [...i.ammo] : [],
      whatToSay:    i.whatToSay || '',
    })) : null,
    finalSharpTake: copy.finalSharpTake || '',
    theTake: copy.theTake ? {
      office: copy.theTake.office || '',
      bar:    copy.theTake.bar || '',
    } : null,
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
    for (const k of ['headline', 'whatHappened', 'whyBullet1', 'whyBullet2', 'theRead', 'whatToSay']) {
      out.lead[k] = str(edited.lead[k], out.lead[k]);
    }
    if (Array.isArray(edited.lead.ammo) && edited.lead.ammo.length) out.lead.ammo = edited.lead.ammo;
  }
  if (Array.isArray(edited.sportsOther) && Array.isArray(out.sportsOther)) {
    out.sportsOther = out.sportsOther.map((orig, i) => {
      const ed = edited.sportsOther[i];
      if (orig && typeof orig === 'object') {
        const e = ed && typeof ed === 'object' ? ed : {};
        return {
          take: str(e.take, orig.take),
          why: str(e.why, orig.why),
          theRead: str(e.theRead, orig.theRead),
          ammo: Array.isArray(e.ammo) && e.ammo.length ? e.ammo : (orig.ammo || []),
          say: str(e.say, orig.say),
        };
      }
      return str(ed, orig);
    });
  }
  for (const sec of ['markets', 'golf', 'f1', 'nhl', 'upcomingPreview', 'theTake']) {
    if (edited[sec]) {
      if (!out[sec]) {
        // Editor created this section from RAW FACTS when the draft had null (e.g. due to
        // a truncated API response). Use the editor's version directly as the section copy.
        out[sec] = edited[sec];
      } else {
        for (const k of Object.keys(out[sec])) {
          if (typeof out[sec][k] === 'string') out[sec][k] = str(edited[sec][k], out[sec][k]);
        }
        if (Array.isArray(edited[sec]?.ammo) && edited[sec].ammo.length) out[sec].ammo = edited[sec].ammo;
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
        theRead:      str(e.theRead, item.theRead),
        ammo:         Array.isArray(e.ammo) && e.ammo.length ? e.ammo : (item.ammo || []),
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
  // Cap the editorial call so a slow/hung Anthropic request can't stall the whole
  // 7am pipeline (and the review email). On 2026-06-15 this call hung ~18 min with
  // no timeout. 90s/attempt × 1 retry ≈ 3 min worst case, then fail-open to the draft.
  // 120s connection timeout; streaming means this only guards the initial handshake,
  // not the full response. maxRetries:0 — we handle retries manually with backoff.
  const client = new (Anthropic.default || Anthropic)({ apiKey, timeout: 120000, maxRetries: 0 });
  const editable = extractEditable(copy);

  const system = `You are the GuyTalk Editor — the final editorial gate before a daily brief publishes.

You are given:
1. THE GUYTALK EDITORIAL BIBLE — the single source of truth. Follow it exactly.
2. RAW FACTS — the only facts you may use. Never add a name, number, score, or event that is not in RAW FACTS.
3. DRAFT — JSON the writer produced. You rewrite the text to follow the Bible.

ESPN OVERRIDE RULE — run this BEFORE the hard block check:

RAW FACTS contain structured ESPN data (scores, series results, final standings). These are ground truth and ALWAYS win over the research pack or Haiku's draft.

If the draft lead or any section references a sports event that CONTRADICTS the ESPN data in RAW FACTS (e.g., the draft says "Game 7 tonight" but RAW FACTS say "CAR wins series 4-2"), you MUST rewrite that section to use the ESPN-verified result. Do NOT keep a stale "preview" or "upcoming game" framing when RAW FACTS show the game already happened.

Examples:
- Draft: "Game 7 of the Stanley Cup Final is tonight" + RAW FACTS: "CAR wins series 4-2" → Rewrite to "Carolina wins the Stanley Cup in 6 games"
- Draft: "Team X plays tomorrow" + RAW FACTS: "Team X won 4-2" → Rewrite to recap the result

This is a REWRITE, not a block — fix the stale framing and record it in changed[].

HARD BLOCK RULE — run this check after the ESPN OVERRIDE RULE:

If a section's content contains NONE of the following three things, block it immediately. Do not attempt to fix or rewrite it. Add to blocking[] with reason "no_current_facts".

NO-AMMO BLOCK RULE — run after the hard block check:

Any news, sports, markets, or culture section (lead, markets, golf when active, f1, sportsOther entries, dynamicSportsText entries, culture items 1–2) with fewer than 3 items in its ammo[] array must be added to blocking[] with reason "no_ammo". Exception: culture item 3 (curated watch/streaming rec) and pure preview sections where no result exists yet (e.g. upcomingPreview). If ammo[] is missing or empty, that counts as zero — block it.

Required — at least one of:
  1. A named person (athlete, coach, executive, public figure)
  2. A specific number (final score, stat line, percentage move, dollar figure)
  3. A concrete event that happened (game result, announcement, trade, incident)

Generic preview filler does not satisfy these requirements. Examples that FAIL and must be blocked:
- "Barcelona-Catalunya will test tire wear and setup balance this weekend"
- "The Canadian Open begins Thursday with a strong field"
- "Markets will be watching Fed commentary this week"
- "Wembanyama is expected to be a factor"

Examples that PASS:
- "Kimi Antonelli qualified P1 at Barcelona with a 1:12.341"
- "Brooks Koepka sits at 6-under, tied for the lead after round 2"
- "AMD closed up 8% on the day"

A section with no_data: true flag from research should never reach the editor — but if it does, block it.

YOUR JOB — six things, every run:

A. CHECK FORMATTING. Plain prose only — strip any markdown (**bold**, #headers, - bullets, links), fix broken sentences, kill double spaces, ensure each item is complete sentences. 2–5 sentences per item. No leaked "undefined", "null", or template fragments.

B. IMPROVE EVERY "WHAT TO SAY". These are the lines a reader drops in a group chat, at work, or at a bar (lead.whatToSay, golf.whatToSay, f1.whatToSay, culture[].whatToSay, markets.bringUp). Make them punchy, specific, and actually sayable out loud. Cut hedging. A great one sounds like a confident friend, not a press release.

B2. SHARPEN THE GUYTALK READ (theRead). This is the most opinionated beat — what the story really means, who benefits, who looks bad, the broader signal. Every section has a theRead field. Rewrite it to be as sharp and grounded as the best take a smart person would share at a bar — 3–5 sentences, opinionated but rooted only in RAW FACTS. Markets theRead must stay observational (never advice). Never add a name, number, or event not in RAW FACTS.

B3. VERIFY CONVERSATION AMMO (ammo). Every section's ammo[] array must contain 3–5 short, specific, sourced facts that a reader could drop into real conversation (age, contract, earnings, record, stat, purse, the key play, the quote). Remove any ammo item that is a vague restatement or a take rather than a fact. Do not add facts not in RAW FACTS. If the ammo[] array has fewer than 3 verifiable items after removal, the section must go to blocking[] with reason "no_ammo".

C. IMPROVE EVERY "WHY IT MATTERS". These justify the reader's attention (lead.whyBullet1/2, markets.whyBullet1/2, golf.whyCare1/2, f1.whyCare1/2, culture[].whyItMatters). Make the stakes concrete and non-obvious. Replace "this is big" with the actual reason it's big, using only RAW FACTS.

C2. SHARPEN THE BAR ARGUMENT (theTake.bar). It must be a SPECIFIC, debatable claim about a named team, player, or result that a fan would argue back against — a prediction, ranking, overrated/underrated call, or "X over Y". REWRITE it if it's a generic meta-take about media/attention/hype (e.g. "nobody cares", "where sports attention actually lives", "tells you everything about"), a vague observation with no side, or hedged. Don't describe the news — pick a fight about it, using only RAW FACTS.

D. ENFORCE THE BIBLE on every section — voice, banned phrases, structure.

E. MARKETS COMPLIANCE. Observational ONLY. Never advise. No buy/sell/hold, "buying opportunity", price targets, or "investors should". Use "markets moved / investors watched / the read-through was / the concern was". This applies to ALL sections, not just Markets.

F. FLAG WEAK CONTENT. A section may only stay if it answers at least TWO of: Why does this matter? Why would people be talking about it? What is the simple takeaway? What could I say about it? If you cannot make a section meet that bar using only the RAW FACTS, add it to report.blocking instead of faking it. Sports items need a specific player, play, moment, or storyline AND why it matters; if RAW FACTS lack the detail, block it — do not invent.

RELEVANCE GATE (run before F): For culture items 1-2, ask: "Would a normal 30-year-old man actually bring this up at work or a bar today?" If the answer is "probably not", treat it the same as a no_ammo block — add to blocking[] with reason "low_conversation_relevance". Do not replace with another story from the blocked categories below.

EXCEPTION — the LAST Culture item is a curated streaming/watch recommendation (an editorial pick, not a sourced news story). Do NOT add it to blocking for lacking RAW FACTS. Keep it, and make the recommendation copy sharp and specific (genre/vibe, why it's worth a watch, a natural one-liner) — just never invent a plot detail, cast member, award, or box-office number.

CULTURE CONTENT RULES — mandatory. If a culture section fails no_ammo and there is no quality replacement in RAW FACTS, add it to blocking[]. Do NOT replace it with the following categories, even if they appear in TRENDING HEADLINES:
- Celebrity divorce, breakup, relationship drama, romance rumors, "spotted together", "calls it quits"
- Custody battles
- Horoscopes, astrology, zodiac
- Red carpet looks, "best dressed", fashion rankings
- Plastic surgery, cosmetic procedure stories
- Dating rumors, baby shower, gender reveal
- Celebrity personal-life revelations: celibacy, abstinence, relationship choices, "waiting for marriage", personal health/lifestyle choices — these are not mainstream conversation for men 25-45
- "Did you hear what X said about their personal life" stories that men would not realistically bring up at work or a bar
Any culture replacement story must be: a major streaming/entertainment release, significant tech/cultural moment, mainstream viral event, UFC/sports-culture crossover, music news, or notable political/internet moment that men 25-45 are actually discussing. If nothing qualifies, block the section.

GOLF STATUS RULE — check RAW FACTS for golf status BEFORE writing any golf copy:
- If RAW FACTS say "IN PROGRESS": use LIVE leaderboard data only. Write "currently leading" or "after X rounds" — NEVER say "won" or "champion" for an ongoing tournament.
- If RAW FACTS say "FINISHED": write as a completed result — "won", "claimed", "finished at X under".
- If RAW FACTS say "NOT YET STARTED" or "PREVIEW" or no scores exist: write as a PREVIEW — upcoming tournament, course context. Never state a leaderboard, scores, or results that do not exist yet.

GOLF/EVENT VENUE RULE — ALWAYS verify event date, venue, and location from RAW FACTS before writing:
- Use the venue name exactly as it appears in RAW FACTS. Do NOT substitute a different venue from memory or training data.
- If RAW FACTS say "Shinnecock Hills", write Shinnecock Hills — never Pinehurst, Oakmont, or any other course.
- If venue data is absent or uncertain, write "this week's U.S. Open" (or equivalent) rather than guessing.
- Include dates only if RAW FACTS confirm them. Never invent a tee time, round schedule, or start date.

PRE-EVENT RULE (applies to golf, F1, and all sports previews):
- If the event has NOT started (no scores, no results in RAW FACTS), you MUST write in future/preview tense only.
- Language that is ALLOWED: "tees off Thursday", "field to watch", "defending champion", "course context", "favorites heading in", "worth watching for".
- Language that is BANNED for pre-event: "won", "champion", "leads after round X", "shot a 68", "finished at X-under", any score or leaderboard position.
- If source data is stale or the event status is unclear, default to cautious preview language rather than writing a definitive recap.
- Never invent drama, round-by-round outcomes, or weather conditions for an event that hasn't happened.

EXCEPTION — a golf section for a tournament that HAS NOT STARTED is a PREVIEW. It may reference the course/venue, last year's champion, and recognizable players in the field even though those aren't in RAW FACTS — these are stable, well-documented facts and the section should have a confident voice for a casual fan. Do NOT block it for these. The only hard rule: never state a live score, a current leader, or a result for a tournament that hasn't been played. It must still satisfy the HARD BLOCK RULE above — a preview that names the defending champion and real favorites PASSES; an empty "strong field" preview with no named person FAILS.

HEADLINE STRUCTURE RULE — apply to all section headlines:
- Section h3 headlines must be SHORT and STRONG — max 8 words. "Carolina wins the Stanley Cup" not "Carolina Hurricanes 3–0 (CAR wins series 4-2) [Stanley Cup Final - Game 6]".
- Scores, series records, and bracketed ESPN data MUST NOT appear in h3 headlines. Put that detail in the "What happened" field instead.
- For multi-story digest issues the page h1 may be a multi-headline sentence summary. The section h3 must always be clean and human.

REPETITION RULE — each field must serve a distinct purpose:
- "What happened": one or two sentences of pure fact — who, what, score, result. No opinions.
- "Why it matters": the stakes, the context, the significance. NOT a restatement of what happened.
- "The GuyTalk Read": the sharpest take — who looks good, who looks bad, what this signals. NOT a summary of the above.
- "What to bring up" / "What to say": a natural, specific one-liner a real guy would actually drop in conversation. Should sound like something you'd say, NOT a compressed GuyTalk Read.
- If two fields are saying the same thing, rewrite one to serve a different purpose. Flag it in report.notes if it can't be fixed without new facts.

TODAY AT A GLANCE RULE:
- Each glance row value must be 8 words or fewer. One clean, scannable line. No brackets, parentheses, or ESPN data format strings.
- Good: "Hurricanes 3–0 Vegas in Game 6 · win Cup 4–2"
- Bad: "Carolina Hurricanes 3–0 (CAR wins series 4-2) [Stanley Cup Final - Game 6] [CAR last won in 2006]"

HYPERLINK RULE:
- First mention of every named player, driver, golfer, or individual athlete in a section should be wrapped in an <a> tag linking to their Wikipedia page or official profile. Use class="entity-person".
- First mention of every team uses the entity-team link (handled by linkifyEntities in the HTML layer — no action needed here).
- First mention of every venue or course should link to its Wikipedia page or official site. Use class="entity-venue".

VISUALS RULE:
- Major sports sections (F1, Golf, lead sport) should include a course/circuit/venue image where one is available in the asset library.
- F1: /assets/circuits/{circuit-key}.jpg (e.g. austria, silverstone, monza). Golf: courseImgHtml from golfCourseImage(). Lead sport: /assets/hero/{sport}.jpg.
- Do not invent or guess image URLs. Only use assets confirmed to exist.

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

BLOCKING vs FIXING — read carefully:
- "blocking" is ONLY for sections whose FINAL rewritten copy STILL violates the Bible or still has no real substance. It triggers a hard publish stop.
- If you fixed a problem (removed an invented stat, rewrote an advice line, corrected framing), that section is now COMPLIANT — do NOT put it in blocking. Record what you did in "changed" and optionally "notes".
- Example: draft cited a championship lead not in RAW FACTS → you remove it and keep the section qualitative → that is a FIX, not a block. Only block if the section cannot stand without the fabricated fact.
- Default to FIX. Block rarely, and only for genuinely unsalvageable sections.`;

  const user = `=== GUYTALK EDITORIAL BIBLE ===
${bible}

=== RAW FACTS (only facts you may use) ===
${context || '(none provided)'}

=== DRAFT (rewrite text to follow the Bible) ===
${JSON.stringify(editable)}`;

  // theRead + ammo across 10+ sections pushes output well past 4096 tokens.
  // 8192 gives comfortable headroom; retry once on truncation.
  const MAX_TOKENS = 8192;
  const userMsg = `${user}\n\nReturn ONLY the JSON object described above, starting with {.`;

  // Use streaming so the 90s SDK timeout only guards the initial connection,
  // not the entire response. Once streaming starts it runs to completion regardless
  // of how long token generation takes — no more false timeouts on large outputs.
  let raw;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        system,
        messages: [{ role: 'user', content: userMsg }],
      });
      const res = await stream.finalMessage();
      raw = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      if (res.stop_reason === 'max_tokens') {
        console.log(`   ⚠  Editor hit max_tokens (${MAX_TOKENS}) on attempt ${attempt}/2 — output truncated`);
        if (attempt < 2) { raw = null; continue; }
      }
      break;
    } catch (err) {
      if (attempt < 2) {
        console.log(`   ⚠  Editor call failed (attempt ${attempt}/2): ${err.message} — waiting 15s then retrying`);
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      return skip(`Claude editor call failed: ${err.message}`);
    }
  }

  const parsed = parseJson(raw);
  if (!parsed || !parsed.copy) {
    const rawLen = raw ? raw.length : 0;
    const tail = raw ? raw.slice(-200).replace(/\n/g, ' ') : '(empty)';
    console.log(`   ⚠  Editor parse failed: raw=${rawLen} chars, tail: "${tail}"`);
    return skip('editor returned unparseable output — kept Claude draft');
  }

  const mergedCopy = mergeEdited(copy, parsed.copy);
  const report = parsed.report || {};
  // Safety net: the editor sometimes puts a "fixed" item in blocking[] with a reason
  // that says "no blocking issue remains" or "now compliant after rewrite". Per the
  // system prompt, fixed items must go to changed/notes — never blocking. Filter them
  // out here so a fixed-and-logged item doesn't trigger a hard QA block.
  const blocking = Array.isArray(report.blocking)
    ? report.blocking
        .filter(b => b && b.section && b.reason)
        .filter(b => {
          const r = b.reason;
          // The editor sometimes puts quality observations in blocking[] even when the section
          // will publish — e.g. "publishes at minimum threshold", "Flagging for editorial
          // awareness", or "documents the structural correction". These are notes, not hard
          // blocks. Only keep items that are genuine publish stoppers.
          return !/no blocking issue|now compliant|has been.*rewritten|structural correction|no longer.*block|documents the (fix|change|correction)|publishes at minimum threshold|flagging for editorial awareness/i.test(r);
        })
    : [];
  // Surface hard-blocked sections in the run-wide warnings instead of letting them
  // fall through to QA silently.
  for (const b of blocking) addWarning(b.section, 'blocked', b.reason);
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
