'use strict';

// One bundled OpenAI call that produces structured ammo facts for each section.
// Fail-open: any error → returns null → caller continues as Phase 1.
// Used by BOTH generateCopy() (Haiku draft) and editBrief() (Sonnet review).

async function fetchFactPack({ topStories, dynamicSports, sectionStories }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let OpenAI;
  try {
    OpenAI = require('openai');
  } catch (_) {
    console.log('   ⚠  openai package not installed — Fact Pack skipped. Run: npm install');
    return null;
  }

  const stories = Array.isArray(topStories) ? topStories : [];
  const dynSports = Array.isArray(dynamicSports) ? dynamicSports : [];
  const sectionLines = [];

  // Lead story
  const leadStory = stories.find(s => s.isLead) || stories[0];
  if (leadStory) {
    sectionLines.push(`LEAD: ${leadStory.headline}${leadStory.whatHappened ? ` — ${leadStory.whatHappened}` : ''}${leadStory.depth ? ` | DEPTH: ${leadStory.depth}` : ''}`);
  }

  // Markets story
  const mktStory = stories.find(s => /market|business|stock|finance/i.test(s.category || ''));
  if (mktStory && mktStory !== leadStory) {
    sectionLines.push(`MARKETS: ${mktStory.headline}${mktStory.whatHappened ? ` — ${mktStory.whatHappened}` : ''}${mktStory.depth ? ` | DEPTH: ${mktStory.depth}` : ''}`);
  } else if (leadStory && /market|business|stock|finance/i.test(leadStory.category || '')) {
    // Lead IS the markets story — still label it for the markets ammo slot
    sectionLines.push(`MARKETS: ${leadStory.headline}${leadStory.depth ? ` | DEPTH: ${leadStory.depth}` : ''}`);
  }

  // NHL
  if (sectionStories?.nhl && !sectionStories.nhl.no_data) {
    const r = sectionStories.nhl;
    sectionLines.push(`NHL: ${r.headline || ''}${r.fact ? ` — ${r.fact}` : ''}`);
  }

  // F1 — prefer sectionStories.f1 (web-sourced), fall back to dynSports entry.
  // fetchSectionStories does not populate sectionStories.f1, so the dynSports path
  // is almost always the one that runs — this guarantees factPack.f1 is always populated.
  if (sectionStories?.f1 && !sectionStories.f1.no_data) {
    const r = sectionStories.f1;
    sectionLines.push(`F1: ${r.headline || ''}${r.fact ? ` — ${r.fact}` : ''}`);
  } else {
    const f1s = dynSports.find(s => /\bf1\b|formula\s*1/i.test(s.label || s.name || ''));
    if (f1s) sectionLines.push(`F1: ${f1s.headline || ''}${f1s.facts ? ` — ${f1s.facts}` : ''}`);
  }

  // Golf — same pattern as F1.
  if (sectionStories?.golf && !sectionStories.golf.no_data) {
    const r = sectionStories.golf;
    sectionLines.push(`GOLF: ${r.headline || ''}${r.fact ? ` — ${r.fact}` : ''}`);
  } else {
    const golfS = dynSports.find(s => /\bgolf\b|\bpga\b/i.test(s.label || s.name || ''));
    if (golfS) sectionLines.push(`GOLF: ${golfS.headline || ''}${golfS.facts ? ` — ${golfS.facts}` : ''}`);
  }

  // Culture
  const cultureItems = (sectionStories?.culture || []).filter(c => c && !c.no_data);
  if (cultureItems.length) {
    sectionLines.push(`CULTURE: ${cultureItems.map((c, i) => `${i + 1}. ${c.headline || ''}${c.fact ? ` — ${c.fact}` : ''}`).join(' | ')}`);
  }

  // Dynamic sports
  if (dynSports.length) {
    sectionLines.push(`SPORTS: ${dynSports.map(s => `[${s.label || s.name}] ${s.headline || ''}${s.facts ? ` — ${s.facts}` : ''}`).join(' | ')}`);
  }

  if (!sectionLines.length) return null;

  const prompt = `You are a fact researcher for GuyTalk, a men's daily brief. For each section below, extract 3–5 tight, verifiable ammo facts — specific numbers, stats, streaks, firsts, contract values, ages, payouts, purse sizes, rankings — that a guy can drop in conversation. Facts only: no takes, no opinions, no vague observations. Use only data present in the section text.

PRIORITIZE THE MOST VIVID DETAIL AVAILABLE: if the section text includes an individual stat line (a player's hits/HR/RBI, strikeouts, points/rebounds/assists, a streak, a record), lead ammo[0] with that exact detail — not a restatement of the final score. A specific stat line ("Henry Davis: 2-4, 1 HR, 3 RBI") beats a generic score ("Pirates beat Brewers 14-5") every time. Only fall back to the score/result if no individual stat data is present.

${sectionLines.join('\n')}

Return ONLY valid JSON (no markdown, no code fences). Include a key for each section you have data for; omit sections with no data:
{
  "lead":    { "ammo": ["fact","fact","fact"] },
  "markets": { "ammo": ["fact","fact","fact"] },
  "nhl":     { "ammo": ["fact","fact","fact"] },
  "f1":      { "ammo": ["fact","fact","fact"] },
  "golf":    { "ammo": ["fact","fact","fact"] },
  "culture": [{ "ammo": ["fact","fact","fact"] }, { "ammo": ["fact","fact","fact"] }],
  "sports":  [{ "label": "<label from SPORTS line>", "ammo": ["fact","fact","fact"] }]
}`;

  try {
    const client = new (OpenAI.default || OpenAI)({ apiKey });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) return null;
    const pack = JSON.parse(raw);
    const filled = Object.keys(pack).filter(k => pack[k] != null).length;
    console.log(`   ✓ Fact Pack: ${filled} section(s) enriched`);
    return pack;
  } catch (err) {
    console.log(`   ⚠  Fact Pack failed (non-blocking): ${err.message}`);
    return null;
  }
}

module.exports = { fetchFactPack };
