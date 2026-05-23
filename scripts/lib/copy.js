'use strict';

const BRAND_VOICE = `You write for GuyTalk: a daily brief for men aged 25–45 who want to stay sharp on sports, markets, golf, and culture without wading through noise.

Voice rules:
- Direct and confident. No hedging. No "it seems like" or "you might want to."
- Short sentences. Active voice. Maximum 3 sentences per paragraph.
- Name specific people, teams, and numbers. Never "a CEO," "a player," "sources say."
- End each sports/markets section with one line the reader can bring up in conversation — something specific, not obvious.
- Dry wit is welcome. Forced humor is not.
- No hot takes for shock value. Be right.
- Sports: write for guys who watched the game. Don't explain who Brunson is.
- Markets: clear, not jargon-heavy. Readers have 401(k)s and watch the tape.
- Golf: assume they play. No birdie definitions.
- Culture: what happened, what it means, what the correct take is. Not "both sides."`;

// ─────────────────────────────────────────────────────────────────────────────
// Generate GuyTalk-voice copy for each section using Claude Haiku (cheap/fast)
// Returns null if ANTHROPIC_API_KEY is missing.
// ─────────────────────────────────────────────────────────────────────────────
async function generateCopy({ sports, markets, golf, trending }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('your_') || apiKey.includes('_here')) return null;

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (_) {
    console.log('   ⚠  @anthropic-ai/sdk not installed. Run: npm install');
    return null;
  }

  const client = new (Anthropic.default || Anthropic)({ apiKey });

  async function ask(prompt, maxTokens = 300) {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: `${BRAND_VOICE}\n\n${prompt}` }],
    });
    return res.content[0].text.trim();
  }

  const ctx = buildContext({ sports, markets, golf });
  const results = {};

  // 1. Brief headline — the H1
  results.title = await ask(
    `Write a brief headline for today's GuyTalk issue. Max 12 words. No quotes, no "Issue #", no colons.
Mimic this style: "Both series tied. Scheffler leads at The Memorial. Weekend's stacked."
Context: ${ctx}`,
    80
  );

  // 2. Sports opening paragraph (first game, key story)
  if (sports?.length) {
    const gamesText = sports.map(g => {
      const w = g.home.winner ? g.home : g.away;
      const l = g.home.winner ? g.away : g.home;
      return `${g.note || g.name}: ${w.team} ${w.score}, ${l.team} ${l.score} (${g.status})`;
    }).join('\n');

    results.sportsAngle = await ask(
      `Write 2–3 sentences as the opening paragraph for the Sports section.
Last night's games:\n${gamesText}
Lead with the most important result. Name the best player. End with what Game X sets up.`,
      250
    );
  }

  // 3. Markets opening paragraph
  if (markets && Object.values(markets).some(q => q?.price)) {
    const mktText = Object.entries(markets)
      .filter(([, q]) => q?.dayChangePct !== null && q?.dayChangePct !== undefined)
      .map(([sym, q]) => `${sym} ${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(1)}%`)
      .join(', ');

    results.marketsTake = await ask(
      `Write 2 sentences as the opening paragraph for the Markets section.
Today's closes: ${mktText}
What's the main story? What should readers watch or remember going into next week?`,
      200
    );
  }

  // 4. Golf note (one line used in TL;DR / angle)
  if (golf?.leaders?.length) {
    const leader = golf.leaders[0];
    results.golfNote = await ask(
      `Write one sentence — max 20 words — about ${leader.name} leading ${golf.name} at ${leader.score}.
GuyTalk voice: direct, knowledgeable, confident.`,
      60
    );
  }

  // 5. Sharp Take — the closing section (2 short paragraphs)
  const trendText = trending?.slice(0, 3).map(t => t.title).join('; ') || '';
  results.sharpTake = await ask(
    `Write the "Sharp Take" closing section for this GuyTalk issue.
Two short paragraphs. Synthesize the weekend: sports, markets, what to do Saturday.
End with one action line ("Clear Saturday afternoon. If someone asks, the answer is no." energy).
Context: ${ctx}${trendText ? `\nTrending topics: ${trendText}` : ''}`,
    220
  );

  return results;
}

function buildContext({ sports, markets, golf }) {
  const parts = [];
  if (sports?.length) {
    parts.push(sports.map(g => {
      const w = g.home.winner ? g.home : g.away;
      const l = g.home.winner ? g.away : g.home;
      return `${g.note || g.shortName}: ${w.team} ${w.score}–${l.team} ${l.score}`;
    }).join('; '));
  }
  if (golf?.leaders?.[0]) {
    parts.push(`Golf: ${golf.name} — ${golf.leaders[0].name} leads at ${golf.leaders[0].score}`);
  }
  if (markets) {
    const spy = markets.SPY;
    if (spy != null && spy.dayChangePct != null) {
      parts.push(`Markets: SPY ${spy.dayChangePct >= 0 ? '+' : ''}${spy.dayChangePct.toFixed(1)}%`);
    }
  }
  return parts.join('. ') || 'No data available.';
}

module.exports = { generateCopy };
