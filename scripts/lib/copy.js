'use strict';

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

const BRAND_VOICE = `You write for GuyTalk: a daily brief for men aged 25–45 on sports, markets, golf, and culture.
Today's date: ${TODAY}.

Voice rules:
- Direct and confident. No hedging. No "it seems like" or "you might want to."
- Short sentences. Active voice. Maximum 3 sentences per paragraph.
- Name specific people, teams, and numbers. Never "a CEO," "a player," "sources say."
- Dry wit is welcome. Forced humor is not.
- No hot takes for shock value. Be right.
- Sports: write for guys who watched the game. Don't explain who Brunson is.
- Markets: clear, not jargon-heavy. Readers have 401(k)s and watch the tape.
- Golf: assume they play. No birdie definitions.
- Culture: what happened, what it means, what the correct take is. Not "both sides."

CRITICAL FORMAT RULES — violations will break the layout:
- Plain prose ONLY. Zero markdown. No # headers, no ** bold, no * italic, no - bullets, no --- dividers.
- Never start a response with a section label like "Sports:" or "Markets:".
- Write in complete sentences. No sentence fragments used as style.`;

// Strip any markdown that slips through despite instructions
function clean(text) {
  if (!text) return text;
  return text
    .replace(/^#{1,6}\s+.*/gm, '')          // # headers
    .replace(/\*\*(.*?)\*\*/gs, '$1')        // **bold**
    .replace(/\*(.*?)\*/gs, '$1')            // *italic*
    .replace(/^[-*]\s+/gm, '')              // bullet list items
    .replace(/^---+$/gm, '')                // horizontal rules
    .replace(/^\s*(Sports|Markets|Golf|Culture|GuyTalk)\s*:\s*/i, '') // stray section labels
    .replace(/\n{3,}/g, '\n\n')             // collapse excess blank lines
    .trim();
}

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

  const mainGame   = sports?.[0];
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
      `Write the headline for today's GuyTalk issue. Max 12 words. Plain text only — no quotes, no colons, no markdown.
Style examples: "Both series tied. Scheffler leads at The Memorial. Weekend's stacked."
Context: ${ctx}`,
      80
    ),

    // 2. Sports opening paragraph
    mainGame
      ? ask(
          `Write 2–3 sentences opening the Sports section. Plain prose only — no markdown, no headers, no labels.
Games:\n${gamesText}
Lead with the most important result. Name the best player with their actual stat line. End with what this sets up next.
CRITICAL: Only cite a series record if explicitly given in [Series: ...] brackets. Never guess or infer series records.`,
          200
        )
      : ask(
          `Write 2–3 sentences for the Sports section — no games last night. Plain prose only, no markdown.
Recap the most notable sports story from this past weekend. Be specific: real team names, real players, real scores you know happened.
End with what to watch for this week.
Context: ${ctx}${trendText ? `\nTrending: ${trendText}` : ''}`,
          200
        ),

    // 3. Markets opening paragraph
    markets && mktText
      ? ask(
          `Write 2 sentences opening the Markets section. Plain prose only — no markdown, no headers.
Data: ${mktText}
What's the main story? What's the one thing to watch next week?`,
          180
        )
      : Promise.resolve(null),

    // 4. Golf one-liner
    golf?.leaders?.[0]
      ? ask(
          golf.statusState === 'post'
            ? `One sentence, max 20 words, about ${golf.leaders[0].name} winning ${golf.name} at ${golf.leaders[0].score}. Past tense. Plain text — no markdown.`
            : `One sentence, max 20 words, about ${golf.leaders[0].name} leading ${golf.name} at ${golf.leaders[0].score}. Plain text — no markdown.`,
          60
        )
      : Promise.resolve(null),

    // 5. Sharp Take (closing)
    ask(
      `Write the "Sharp Take" closing section — two short paragraphs synthesizing today.
End with one punchy action line specific to what happened today ("Clear Saturday afternoon. If someone asks, the answer is no." energy).
Plain prose ONLY — absolutely no markdown, no headers, no asterisks, no bullets, no labels.
Context: ${ctx}${trendText ? `\nTrending: ${trendText}` : ''}`,
      260
    ),

    // 6. Sports detail (JSON)
    mainGame
      ? ask(
          `GuyTalk voice. Game: ${gamesText.split('\n')[0]}
Return ONLY valid JSON, no markdown, no code fences:
{
  "keyNumber": "The defining stat — specific player, specific number.",
  "seriesSituation": "${mainGame.seriesNote ? `Series: ${mainGame.seriesNote}. ` : ''}Next game context — what this result means going forward.",
  "howToWatch": "Game label · Day · Venue · Time ET · Network.",
  "groupChatAngle": "One inside-knowledge fact. Drop-it-once energy — specific, not obvious."
}`,
          400
        )
      : Promise.resolve(null),

    // 7. Markets detail (JSON)
    markets && mktText
      ? ask(
          `GuyTalk voice. Market data: ${mktText}
Return ONLY valid JSON, no markdown, no code fences:
{
  "headline": "One-line market story headline. Max 10 words.",
  "secondPara": "One forward-looking sentence — specific upcoming event or data release that matters.",
  "watchNextWeek": "The one thing that moves markets next week. Name the date.",
  "tradeToWatch": "One ticker with notable behavior. What it's doing and why it matters.",
  "bringUp": "One specific market fact — a real number, conversational, something to say at dinner."
}`,
          450
        )
      : Promise.resolve(null),

    // 8. Golf detail (JSON)
    golf?.leaders?.[0]
      ? ask(
          golf.statusState === 'post'
            ? `GuyTalk voice. FINAL — ${golf.name} complete. Winner: ${golf.leaders[0].name} at ${golf.leaders[0].score}.
Final leaderboard: ${golf.leaders.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ')}.
Return ONLY valid JSON, no markdown, no code fences:
{
  "whyItMatters": "What this win means — season trajectory, FedEx Cup, major chances. One concrete sentence.",
  "recap": "How the final round played out — wire-to-wire, collapse, Sunday charge? Specific.",
  "bringUp": "One inside-knowledge fact about the winner or course. Specific, not obvious.",
  "groupChatAngle": "One drop-it-once insight. Sounds like you watched every round."
}`
            : `GuyTalk voice. Tournament: ${golf.name}. Status: ${golf.status}.
Leaderboard: ${golf.leaders.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ')}.
Return ONLY valid JSON, no markdown, no code fences:
{
  "whyItMatters": "Field quality, FedEx Cup points, historic venue — one concrete sentence.",
  "tvSchedule": "Broadcast info: 'Round 3: TIME ET, Golf Channel/Peacock. Round 4: TIME ET, NBC/CBS.'",
  "bringUp": "One inside-knowledge fact about the leader or course. Specific.",
  "groupChatAngle": "Drop-it-once insight about the leader or field. Sounds like you've been watching."
}`,
          400
        )
      : Promise.resolve(null),

    // 9. Culture (JSON array)
    ask(
      `GuyTalk culture section. Write 3 items for men 25–45.
Return ONLY a valid JSON array, no markdown, no code fences, exactly 3 objects:
[
  {"head": "Specific headline — name the real person/company/moment", "source": "Platform · Source", "body": "3–4 sentences. What happened. Why it matters. The correct take — one right answer, not both sides. End with one line the reader drops in conversation."},
  {"head": "Specific headline", "source": "Platform · Source", "body": "Same format as above."},
  {"head": "This weekend: [real title currently available]", "source": "Netflix / HBO / Theater · Genre", "body": "What it is, who made it, who it's for. One sentence why it's worth your time. Don't oversell."}
]
Item 3 must be a real currently-available movie, show, or event.
Items 1–2: prioritize sports/business/culture crossovers.
Trending stories: ${trendText || 'No data — use your judgment on major current events.'}`,
      900
    ),

    // 10. Numbers context (JSON array)
    ask(
      `GuyTalk voice. Return ONLY a valid JSON array, no markdown, no code fences, exactly 3 objects:
[{"context": "2 sentences on what this number means and why the reader should care. Specific."}]

Numbers:
${mainGame ? `${mainGame.home.score}–${mainGame.away.score} (${mainGame.note || mainGame.shortName})` : ''}
${markets?.SPY?.dayChangePct !== undefined ? `SPY ${markets.SPY.dayChangePct >= 0 ? '+' : ''}${markets.SPY.dayChangePct.toFixed(1)}% today` : ''}
${golf?.leaders?.[0] ? `${golf.leaders[0].name} ${golf.leaders[0].score}, ${golf.name}` : ''}`,
      350
    ),

    // 11. Additional game notes (plain text, separated by |||)
    extraGames.length
      ? ask(
          `GuyTalk voice. Write 2–3 sentence notes for each game below. Plain prose — no markdown. Separate game notes with "|||".
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
    title:            clean(get(titleR)),
    sportsAngle:      clean(get(sportsAngleR)),
    marketsTake:      clean(get(marketsTakeR)),
    golfNote:         clean(get(golfNoteR)),
    sharpTake:        clean(get(sharpTakeR)),
    sportsDetail:     parseJson(get(sportsDetailR)),
    marketsDetail:    parseJson(get(marketsDetailR)),
    golfDetail:       parseJson(get(golfDetailR)),
    culture:          parseJson(get(cultureR)),
    numbersContext:   parseJson(get(numbersR)),
    sportsAdditional: get(extraGamesR)?.split('|||').map(s => clean(s)).filter(Boolean) || [],
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
    const verb = golf.statusState === 'post' ? 'won' : 'leads';
    parts.push(`Golf: ${golf.name} — ${golf.leaders[0].name} ${verb} at ${golf.leaders[0].score}`);
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
