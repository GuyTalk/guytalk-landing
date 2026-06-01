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

function parseJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/^```json?\s*/m, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) try { return JSON.parse(obj[0]); } catch (_) {}
  const arr = cleaned.match(/\[[\s\S]*\]/);
  if (arr) try { return JSON.parse(arr[0]); } catch (_) {}
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate all GuyTalk copy in parallel using Claude Haiku (cheap + fast)
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

  // ── Build context strings ────────────────────────────────────────────────
  const ctx = buildContext({ sports, markets, golf });

  const gamesText = (sports || []).map(g => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    let line = `${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score} (${g.status})`;
    if (g.seriesNote) line += ` [Series: ${g.seriesNote}]`;
    return line;
  }).join('\n');

  const mktText = markets
    ? Object.entries(markets)
        .filter(([, q]) => q?.dayChangePct !== null && q?.dayChangePct !== undefined)
        .map(([sym, q]) => {
          const day = `${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(1)}%`;
          const wk  = q.weekChangePct !== null && q.weekChangePct !== undefined
            ? ` / ${q.weekChangePct >= 0 ? '+' : ''}${q.weekChangePct.toFixed(1)}% wk`
            : '';
          return `${sym} ${day}${wk}`;
        }).join(', ')
    : '';

  const trendText = (trending || []).slice(0, 10)
    .map((t, i) => `${i + 1}. [${t.source}] ${t.title}`)
    .join('\n');

  const mainGame  = sports?.[0];
  const extraGames = sports?.slice(1) || [];

  // ── All calls in parallel ─────────────────────────────────────────────────
  const [
    titleR,
    sportsAngleR,
    marketsTakeR,
    golfNoteR,
    sharpTakeR,
    sportsDetailR,
    marketsDetailR,
    golfDetailR,
    cultureR,
    numbersR,
    extraGamesR,
  ] = await Promise.allSettled([

    // 1. Brief headline
    ask(
      `Write the headline for today's GuyTalk issue. Max 12 words. No quotes, no "Issue #", no colons.
Style: "Both series tied. Scheffler leads at The Memorial. Weekend's stacked."
Context: ${ctx}`,
      80
    ),

    // 2. Sports opening paragraph (main game)
    mainGame
      ? ask(
          `Write 2–3 sentences opening the Sports section.
Last night's games:\n${gamesText}
Lead with the most important result. Name the best player. End with what this sets up.
CRITICAL: Only state a series record if explicitly given in [Series: ...] brackets. Never infer one.`,
          250
        )
      : Promise.resolve(null),

    // 3. Markets opening paragraph
    markets && mktText
      ? ask(
          `Write 2 sentences opening the Markets section.
Today's closes: ${mktText}
What's the main story? What should readers watch going into next week?`,
          200
        )
      : Promise.resolve(null),

    // 4. Golf one-liner
    golf?.leaders?.[0]
      ? ask(
          `One sentence — max 20 words — about ${golf.leaders[0].name} leading ${golf.name} at ${golf.leaders[0].score}. GuyTalk voice: direct, knowledgeable, confident.`,
          60
        )
      : Promise.resolve(null),

    // 5. Sharp Take (closing)
    ask(
      `Write the "Sharp Take" closing section. Two short paragraphs synthesizing the day/weekend.
End with one action line ("Clear Saturday afternoon. If someone asks, the answer is no." energy — specific to this issue).
Plain prose only — no markdown, no headers, no bullet points, no dashes.
Context: ${ctx}${trendText ? `\nTrending: ${trendText}` : ''}`,
      250
    ),

    // 6. Sports detail items (JSON)
    mainGame
      ? ask(
          `GuyTalk voice. Main game: ${gamesText.split('\n')[0]}
Return ONLY valid JSON (no markdown) with these exact keys:
{
  "keyNumber": "The defining stat — specific player did X on Y.",
  "seriesSituation": "${mainGame.seriesNote ? `Series: ${mainGame.seriesNote}. ` : ''}Next game context — date, venue, what this result means.",
  "howToWatch": "Game label · Day · Venue · Approximate time ET · Likely network (ESPN/ABC/TNT for NBA).",
  "groupChatAngle": "One inside-knowledge fact about these teams or players. Drop-it-once energy — specific, not obvious."
}`,
          400
        )
      : Promise.resolve(null),

    // 7. Markets detail (JSON)
    markets && mktText
      ? ask(
          `GuyTalk voice. Market data: ${mktText}
Return ONLY valid JSON (no markdown):
{
  "headline": "One-line headline capturing today's market story. Max 10 words.",
  "secondPara": "One forward-looking sentence — specific upcoming event, data release, or earnings that matters next week.",
  "watchNextWeek": "The one data point or event that will move markets. Specific: name the date and what to expect.",
  "tradeToWatch": "One ticker showing notable behavior right now. What it's doing and why it matters.",
  "bringUp": "One portable market fact — specific number, true, conversational. Something to say at dinner."
}`,
          450
        )
      : Promise.resolve(null),

    // 8. Golf detail (JSON)
    golf?.leaders?.[0]
      ? ask(
          `GuyTalk voice. Tournament: ${golf.name}. Status: ${golf.status}.
Leaderboard: ${golf.leaders.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ')}.
Return ONLY valid JSON (no markdown):
{
  "whyItMatters": "Field quality, FedEx Cup points, historic venue — one concrete sentence.",
  "tvSchedule": "Approximate broadcast info based on typical PGA Tour TV deal. Format: 'Round 3: TIME ET, Golf Channel/Peacock. Round 4: TIME ET, NBC/CBS.'",
  "bringUp": "One inside-knowledge fact about the leader or the course. Specific.",
  "groupChatAngle": "Drop-it-once insight about the leader or field. Something that sounds like you've been watching."
}`,
          400
        )
      : Promise.resolve(null),

    // 9. Culture — 3 items from trending (JSON array)
    ask(
      `GuyTalk culture section. Write 3 culture items for men aged 25–45.
Return ONLY a valid JSON array (no markdown), exactly 3 objects:
[
  {"head": "Specific headline — name the person/company/moment", "source": "Platform · Source Name", "body": "3–4 sentences. What happened exactly. Why people care. The correct take — not both sides, one right answer. End with one line the reader can use in conversation."},
  {...},
  {"head": "This weekend: [actual title]", "source": "Netflix / HBO / Theater · Genre", "body": "What it is, who made it, who it's for. One sentence on why it's worth your time. Don't oversell."}
]
The third item MUST be a weekend entertainment pick (movie, show, or event currently available).
Prioritize sports/business/culture crossovers for items 1 and 2.

Trending stories to draw from:
${trendText || 'No trending data available — use your judgment on major current events in sports, business, and entertainment.'}`,
      900
    ),

    // 10. Numbers context (JSON array)
    ask(
      `GuyTalk voice. Return ONLY a valid JSON array (no markdown), 3 objects:
[{"context": "2 sentences — what this number means in context and why the reader should care."}]

Numbers from today:
${mainGame ? `Score: ${mainGame.home.score}–${mainGame.away.score} (${mainGame.note || mainGame.shortName})` : ''}
${markets?.SPY?.dayChangePct !== undefined ? `SPY: ${markets.SPY.dayChangePct >= 0 ? '+' : ''}${markets.SPY.dayChangePct.toFixed(1)}% on the day` : ''}
${golf?.leaders?.[0] ? `${golf.leaders[0].name} at ${golf.leaders[0].score}, ${golf.name}` : ''}`,
      350
    ),

    // 11. Additional game notes (text, separated by |||)
    extraGames.length
      ? ask(
          `GuyTalk voice. Write a brief 2–3 sentence note for each game below. Separate game notes with "|||". Key player, key moment, what's next.
${extraGames.map(g => {
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  return `${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score}`;
}).join('\n')}`,
          300
        )
      : Promise.resolve(null),
  ]);

  const get = r => r.status === 'fulfilled' ? r.value : null;

  return {
    title:           get(titleR),
    sportsAngle:     get(sportsAngleR),
    marketsTake:     get(marketsTakeR),
    golfNote:        get(golfNoteR),
    sharpTake:       get(sharpTakeR),
    sportsDetail:    parseJson(get(sportsDetailR)),
    marketsDetail:   parseJson(get(marketsDetailR)),
    golfDetail:      parseJson(get(golfDetailR)),
    culture:         parseJson(get(cultureR)),
    numbersContext:  parseJson(get(numbersR)),
    sportsAdditional: get(extraGamesR)?.split('|||').map(s => s.trim()).filter(Boolean) || [],
  };
}

function buildContext({ sports, markets, golf }) {
  const parts = [];
  if (sports?.length) {
    parts.push(sports.map(g => {
      const w = g.home.winner ? g.home : g.away;
      const l = g.home.winner ? g.away : g.home;
      let s = `${g.note || g.shortName}: ${w.team} ${w.score}–${l.team} ${l.score}`;
      if (g.seriesNote) s += ` (${g.seriesNote})`;
      return s;
    }).join('; '));
  }
  if (golf?.leaders?.[0]) {
    parts.push(`Golf: ${golf.name} — ${golf.leaders[0].name} leads at ${golf.leaders[0].score}`);
  }
  if (markets) {
    const spy = markets.SPY;
    if (spy?.dayChangePct !== null && spy?.dayChangePct !== undefined) {
      parts.push(`Markets: SPY ${spy.dayChangePct >= 0 ? '+' : ''}${spy.dayChangePct.toFixed(1)}%`);
    }
  }
  return parts.join('. ') || 'No data available.';
}

module.exports = { generateCopy };
