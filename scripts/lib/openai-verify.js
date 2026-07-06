'use strict';

/**
 * OpenAI verification layer — the FINAL gate before publish.
 *
 * Cross-checks the built brief's factual claims against:
 *   1. The OpenAI research pack (what was actually found with source URLs)
 *   2. ESPN structured feed data (ground truth for scores/results)
 *
 * Returns { pass, blocking: [], warnings: [], ... }
 * pass = false → qa-brief.js hard-blocks the push to pending.
 *
 * Fail-open: if OpenAI is unavailable the call returns pass:true with skipped:true
 * so the brief can still ship with a loud warning — the streak survives an outage.
 */

const VERIFY_MODEL = process.env.OPENAI_VERIFY_MODEL || 'gpt-4o';

async function verifyBrief({ issueData, researchPack }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { pass: true, skipped: true, reason: 'no OPENAI_API_KEY — verification skipped', blocking: [], warnings: [] };
  }

  let OpenAI;
  try { OpenAI = require('openai'); }
  catch (_) { return { pass: true, skipped: true, reason: 'openai not installed', blocking: [], warnings: [] }; }

  const client = new (OpenAI.default || OpenAI)({ apiKey });
  const copy = issueData.copy || {};

  // ── Build brief claims list ──────────────────────────────────────────────────
  const claims = [];

  if (copy.lead?.headline)   claims.push(`LEAD: ${copy.lead.headline} — ${copy.lead.whatHappened || ''}`);
  if (copy.markets?.mood)    claims.push(`MARKETS: ${copy.markets.mood}`);
  if (Array.isArray(copy.markets?.headlines)) {
    copy.markets.headlines.forEach(h => h?.head && claims.push(`MARKETS HEADLINE: ${h.head}`));
  }
  (issueData.dynamicSports || []).forEach(s => {
    claims.push(`SPORT [${s.label}]: ${s.headline || ''} — ${s.whatHappened || s.facts || ''}`);
    (s.ammo || []).filter(Boolean).forEach(a => claims.push(`  AMMO: ${a}`));
  });
  // topStories are background research inputs used to generate copy, not published
  // content. Verifying raw feed headlines against ESPN creates false blocks (e.g.
  // a NewsAPI preview headline published before the game ended). Skip them here.
  (copy.culture || []).forEach((c, i) =>
    claims.push(`CULTURE ${i + 1}: ${c.topic || c.head || ''} — ${c.whatHappened || ''}`)
  );
  if (copy.f1?.headline) claims.push(`F1: ${copy.f1.headline} — ${copy.f1.whyCare1 || ''}`);
  if (copy.golf?.headline) claims.push(`GOLF: ${copy.golf.headline} — ${copy.golf.whyCare1 || ''}`);
  if (copy.nhl?.headline) claims.push(`NHL: ${copy.nhl.headline}`);
  // Final Sharp Take is a condensed section — verify it explicitly against the main story data
  if (copy.finalSharpTake) claims.push(`FINAL_SHARP_TAKE: ${copy.finalSharpTake}`);
  // Culture items are separate AI passes — cross-check them for consistency with Markets
  if (Array.isArray(copy.culture)) {
    copy.culture.forEach((c, i) => {
      if (c?.whatHappened) claims.push(`CULTURE_ITEM_${i + 1}: ${c.head || ''} — ${c.whatHappened}`);
    });
  }
  // Glance rows (Today at a Glance) can independently introduce facts — verify them too
  if (copy.glance?.markets) claims.push(`GLANCE_MARKETS: ${copy.glance.markets}`);
  if (copy.glance?.sports)  claims.push(`GLANCE_SPORTS: ${copy.glance.sports}`);

  // ── Build market feed facts ──────────────────────────────────────────────────
  const marketFacts = [];
  if (issueData.markets && typeof issueData.markets === 'object') {
    const LABELS = { SPY: 'S&P 500', DIA: 'Dow', QQQ: 'Nasdaq/QQQ', IWM: 'Russell 2000', '10Y': '10-Year Treasury' };
    const tickers = Object.entries(issueData.markets)
      .filter(([, v]) => typeof v?.dayChangePct === 'number')
      .map(([sym, v]) => {
        const label = LABELS[sym] || sym;
        const daily = `${v.dayChangePct >= 0 ? '+' : ''}${v.dayChangePct.toFixed(2)}% today`;
        const weekly = typeof v.weekChangePct === 'number'
          ? ` / ${v.weekChangePct >= 0 ? '+' : ''}${v.weekChangePct.toFixed(2)}% on the week`
          : '';
        return `${label} ${daily}${weekly}`;
      });
    if (tickers.length) marketFacts.push(`MARKET FEED (real-time tickers — daily and weekly changes): ${tickers.join(', ')}`);
  }

  // ── Build ESPN structured data ───────────────────────────────────────────────
  const espnFacts = [];
  (issueData.sports || []).forEach(g => {
    const w = g.home?.winner ? g.home : g.away, l = g.home?.winner ? g.away : g.home;
    espnFacts.push(`ESPN: ${w.team} ${w.score}–${l.score} ${l.team} (${g.status})${g.seriesNote ? ' [' + g.seriesNote + ']' : ''}`);
  });
  if (issueData.nhl?.final) {
    const g = issueData.nhl.final;
    const w = g.home?.winner ? g.home : g.away, l = g.home?.winner ? g.away : g.home;
    const context = [g.note, g.seriesNote].filter(Boolean).join(' | ');
    espnFacts.push(`ESPN NHL: ${w.team} ${w.score}–${l.score} ${l.team}${context ? ' [' + context + ']' : ''}`);
  }
  if (issueData.f1?.results?.length && issueData.f1.statusState === 'post') {
    const f1Podium = issueData.f1.results.slice(0, 3).map((r, i) => `P${i + 1}: ${r.driver} (${r.team})`).join(', ');
    espnFacts.push(`ESPN F1: ${issueData.f1.name} — ${f1Podium} — venue: ${issueData.f1.venue || issueData.f1.name}`);
  }
  if (issueData.golf?.leaders?.[0]) {
    const top3 = issueData.golf.leaders.slice(0, 5).map(l => `${l.name} ${l.score}`).join(', ');
    espnFacts.push(`ESPN Golf: ${issueData.golf.name} — Top: ${top3} (${issueData.golf.statusState})`);
  }

  // ── Build research pack evidence ─────────────────────────────────────────────
  const researchEvidence = (researchPack?.stories || []).map(s =>
    `RESEARCHED [conf:${s.scores?.confidence || '?'}/5]: ${s.headline} — sources: ${(s.sourceNames || []).join(', ')}`
  );

  const verifyPrompt = `You are the final fact-checker for GuyTalk. Today is ${issueData.date || 'today'}.

CRITICAL RULES — READ BEFORE EVALUATING ANYTHING:

1. ESPN STRUCTURED DATA IS GROUND TRUTH FOR SPORTS SCORES AND SERIES RESULTS.
   If ESPN says "CAR wins series 4-2", that is correct, even if the research pack says otherwise.
   When research pack conflicts with ESPN data on a sports score/result: trust ESPN, warn about the research pack inconsistency — do NOT block the ESPN-aligned copy.

2. ESPN data is SPORT-SPECIFIC.
   Hockey (NHL) data CANNOT contradict basketball (NBA) claims.
   Baseball (MLB) data cannot contradict soccer or any other sport.
   If ESPN data for the relevant sport is absent, that is "unverifiable" → WARNING, not a block.
   Only use sport X's ESPN data to evaluate sport X's claims.

3. PRIORITY HIERARCHY for sports: ESPN structured data > research pack > no evidence.

ESTABLISHED FACTS (do not flag these as errors):
- Donald Trump is the 47th President of the United States (won 2024 election, second term 2025–2029). References to "Trump" in current political news are correct.
- The 2026 FIFA World Cup is currently in progress (hosted by USA/Canada/Mexico, begins June 11 2026).
- Lewis Hamilton drives for Ferrari in F1 in 2025–2026 (left Mercedes after 2024 season).
- Carolina Hurricanes previously won the Stanley Cup in 2006. Any 2026 win would be their SECOND championship, not their first. Claims of "first in franchise history" are WRONG and should be flagged.
- A 2026 Carolina Hurricanes Stanley Cup win ends a 20-YEAR drought (2006–2026 = 20 years). References to "20-year drought" or "first since 2006" are CORRECT — do NOT flag them.
- U.S. Open Golf 2026 is held at Shinnecock Hills in Southampton, New York (June 18–21).
- J.J. Spaun won the 2025 U.S. Open at Oakmont Country Club. He is the defending champion for the 2026 U.S. Open. Claims that Bryson DeChambeau or any other player is the 2026 U.S. Open defending champion are WRONG — flag as contradicts_established_fact.

CONDENSED SECTION RULE:
The FINAL_SHARP_TAKE and any Today at a Glance, hero dek, or social copy claims represent condensed summaries. Apply an extra check: every specific factual claim in a condensed section (score, winner, loser, defending champion, ranking, market level, date) must appear in the main brief claims above. If a condensed section introduces a new factual claim (a team or player not mentioned in the main story, a score not in ESPN data, a defending champion not in established facts), flag it as a BLOCKING error with flag "condensed_section_new_claim". Be especially strict about: scores, win/loss results, "demolished / blowout / obliterated" language with specific numbers, and defending champion claims.

CROSS-SECTION CONSISTENCY RULE:
Compare the CULTURE_ITEM_* claims against the MARKETS claim for the same event. If a culture item about the Fed, markets, or economic data contradicts the markets section on any of the following, flag it as BLOCKING with flag "cross_section_contradiction":
- Fed rate level (e.g. culture says 5.25-5.5% but markets says 3.5-3.75%)
- Rate direction (culture says "cuts" but markets says "hike")
- Dot plot projection (culture says "two cuts" but markets says "one hike")
- Index performance direction (culture says markets rose but markets says markets fell)
Any CULTURE_ITEM that reuses the same Fed/market event as the main Markets section must match it exactly on rate level, direction, and percentage. Contradictions are blocking — not warnings.

Cross-check the BRIEF CLAIMS against the EVIDENCE below. Flag anything invented, stale, future-projected, or unverified.

=== MARKET FEED DATA (real-time ticker prices — these are correct, treat like ESPN for sports) ===
${marketFacts.length ? marketFacts.join('\n') : '(none)'}

=== ESPN STRUCTURED DATA (ground truth for scores/results — these are correct) ===
${espnFacts.length ? espnFacts.join('\n') : '(none)'}

=== OPENAI RESEARCH EVIDENCE (real stories with confirmed sources) ===
${researchEvidence.length ? researchEvidence.join('\n') : '(no research pack — higher risk of unverified claims)'}

=== BRIEF CLAIMS TO VERIFY ===
${claims.join('\n')}

IMPORTANT — calibrate strictly based on what evidence is available:

IF research evidence IS provided (several RESEARCHED lines above):
  BLOCKING: claim contradicts research evidence OR claims a championship/death/major deal/IPO that research marked unverified.
  WARNING: plausible but not confirmed in evidence.

IF NO research evidence (the RESEARCHED section says "(no research pack — higher risk of unverified claims)"):
  BLOCKING: ONLY if a claim directly contradicts ESPN scores/winners/teams. Nothing else is a block.
  WARNING: anything plausible but unverifiable from the available data.
  DO NOT use unverified_major, invented, stale, or future flags on business/culture/political news stories when there is no research pack — you have no evidence to contradict them, so they must be warnings only.

FLAG as BLOCKING in all cases:
- A market claim (index level, ticker %, direction) that directly contradicts MARKET FEED DATA above: use flag "contradicts_market_feed". If the feed says AMD +2.83%, copy claiming AMD fell is wrong. IMPORTANT ROUNDING RULE: The brief rounds percentages to one decimal place. "+0.7%" when the feed shows "+0.66%" is CORRECT ROUNDING — do NOT flag it. "-1.8%" when the feed shows "-1.75%" is CORRECT ROUNDING — do NOT flag it. Only flag if the direction is wrong (positive vs negative), or if the rounded value would be ≥0.1 off from correct one-decimal rounding (e.g. feed says +0.66% and brief says +0.9% — that would be wrong).
- A sports result where ESPN data for THAT SPORT explicitly says something DIFFERENT: e.g. ESPN says "CAR wins series 4-2" but the copy says "VGK won". SILENT ≠ CONTRADICTION — if ESPN data doesn't mention the sport at all (e.g. no NBA entry), or doesn't mention a specific stat (e.g., consecutive shutouts), that is a WARNING, not a block. NEVER use flag "contradicts_espn" when ESPN data is simply absent for the sport/event being claimed.
- A claim that directly contradicts an ESTABLISHED FACT listed above (e.g. "Hurricanes' first title" when they won in 2006; "Oakmont" or "Pinehurst" when the U.S. Open is at Shinnecock Hills). These are blocking, not warnings, even without an ESPN entry.
- A clearly FORWARD-LOOKING event presented as already completed — e.g. "Election results in" when the election hasn't happened, or language like "will happen" treated as past tense. NOT just "unverified" news.
- A story flagged as "stale" ONLY if it is more than 48 hours old. Stories from yesterday (within 36 hours) are NOT stale for this brief — that is our deliberate window. Never flag yesterday's news as stale.
- Content clearly from a Britannica "Major Events of 2026"-style speculative page (future projections)
- A fabricated player stat (specific points/goals/yards) that directly contradicts ESPN box scores
- A golf section claiming a winner or champion when ESPN golf statusState is NOT 'post' (in-progress tournaments have no winner yet). Block if copy says "won" or "champion" for an in-progress event.
- A culture story that covers celebrity personal-life content (celibacy, abstinence, dating choices, relationship status reveals) that is not confirmed as a genuinely massive national conversation story. Use flag "low_relevance". This applies even with a research pack.

FLAG as WARNING (never blocking):
- A real-seeming current news story not confirmed in the research pack or ESPN data (could be real, just unverified here)
- Minor unverifiable details (salary, age, exact dollar amount)
- Editorial framing or tone

NEVER block a story just because it's "not in provided evidence" — that's a warning. Block only when the story is demonstrably wrong or clearly forward-looking speculation presented as news.

DO NOT flag:
- Claims matching ESPN structured data
- Reasonable editorial framing of confirmed facts
- Subjective takes, opinions, or voice choices
- Stories that are likely real but just not in the provided evidence
- Current political events or major national news (Iran deal, executive actions, major policy news) — these are real current news; only block if directly contradicted by verified evidence

Return ONLY valid JSON:
{
  "pass": true,
  "blocking": [
    {
      "section": "lead|sports|markets|culture|f1|golf|topStories",
      "claim": "exact claim text",
      "flag": "invented|stale|future|contradicts_espn|unverified_major",
      "reason": "specific reason"
    }
  ],
  "warnings": [
    { "section": "section", "note": "concern" }
  ],
  "verificationSummary": "one-sentence overall confidence assessment"
}`;

  try {
    const completion = await client.chat.completions.create({
      model: VERIFY_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: verifyPrompt }],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    const result = JSON.parse(raw);

    const hasResearch = researchPack?.stories?.length > 0;
    // In feed-only mode the only valid blocking flags are ESPN/market-feed/established-fact contradictions.
    // Demote everything else (unverified_major, invented, stale, future) to warnings.
    const FEED_ONLY_BLOCK_FLAGS = new Set(['contradicts_espn', 'contradicts_established_fact', 'contradicts_market_feed', 'low_relevance', 'condensed_section_new_claim', 'cross_section_contradiction']);
    const rawBlocking = Array.isArray(result.blocking)
      ? result.blocking.filter(b => b?.claim && b?.reason)
      : [];
    const demoted = [];
    const blocking = rawBlocking.filter(b => {
      // Drop self-contradictory blocks where the model's own reason says ESPN confirms
      // the claim (happens when gpt-4o confuses itself on ambiguous framing).
      if (b.reason && /espn.*confirm|confirm.*espn|should pass|thus.*pass/i.test(b.reason)) {
        demoted.push(b);
        return false;
      }
      if (!hasResearch && !FEED_ONLY_BLOCK_FLAGS.has(b.flag)) {
        demoted.push(b);
        return false;
      }
      return true;
    });
    const warnings = [
      ...(Array.isArray(result.warnings) ? result.warnings.filter(w => w?.note) : []),
      ...demoted.map(b => ({ section: b.section, note: `[demoted] ${b.flag}: ${b.reason}` })),
    ];
    const pass = result.pass !== false && blocking.length === 0;

    if (pass) {
      console.log(`   ✓ Verification: PASS${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
    } else {
      console.log(`   ⛔ Verification: FAIL — ${blocking.length} blocking issue(s)`);
      blocking.forEach(b => console.log(`      ⛔ [${b.section}] ${b.flag}: ${b.reason}`));
    }
    if (warnings.length) warnings.forEach(w => console.log(`      ⚠  [${w.section}] ${w.note}`));
    if (result.verificationSummary) console.log(`      → ${result.verificationSummary}`);

    return {
      pass,
      blocking,
      warnings,
      verificationSummary: result.verificationSummary || '',
      model: VERIFY_MODEL,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`   ⚠  Verification failed: ${err.message} — treating as pass (fail-open)`);
    return {
      pass: true,
      skipped: true,
      reason: `verification crashed: ${err.message}`,
      blocking: [],
      warnings: [],
    };
  }
}

module.exports = { verifyBrief };
