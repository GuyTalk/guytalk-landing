'use strict';

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

const BRAND_VOICE = `You write for GuyTalk: a daily brief for men aged 25–45 on sports, markets, and culture.
Today's date: ${TODAY}.

Sports covers everything: NFL, NBA, MLB, NHL, PGA Tour, Formula 1, UEFA Champions League, FIFA World Cup, Grand Slam tennis, UFC, and any major sporting moment. Cover what is ACTUALLY happening right now — not just one sport.

Voice rules:
- Direct and confident. No hedging. No "it seems like" or "you might want to."
- Short sentences. Active voice. Maximum 3 sentences per paragraph.
- Name specific people, teams, and numbers. Never "a CEO," "a player," "sources say."
- Dry wit is welcome. Forced humor is not.
- No hot takes for shock value. Be right.
- Sports: write for guys who watched the game. Don't explain who Brunson or Verstappen is.
- Markets: clear, not jargon-heavy. Readers have 401(k)s and watch the tape.
- Culture: what happened, what it means, what the correct take is. Not "both sides."

CRITICAL FACTCHECK RULES — violations create misinformation that embarrasses readers:
- NEVER invent player names, stats, or scores. Only cite data explicitly provided below.
- If you only have a final score with no box score, describe the TEAM result without naming individual players or inventing stats.
- Do NOT draw on a team's historical roster. If data says "San Antonio Spurs won," that is Wembanyama's 2026 Spurs — not the Tim Duncan or Tony Parker era.
- Only cite a series record if it is explicitly given in [Series: ...] brackets. Never infer it.
- For F1: only name drivers and results given in the data. Never invent lap times or positions.
- For World Cup: only describe matches shown in the data. The 2026 World Cup opens June 11.
- Today is ${TODAY}. Describe scheduled events as "tomorrow" or "this weekend," not as if they already happened.

CRITICAL FORMAT RULES — violations will break the layout:
- Plain prose ONLY. Zero markdown. No # headers, no ** bold, no * italic, no - bullets, no --- dividers.
- Never start a response with a section label like "Sports:" or "Markets:".
- Write in complete sentences. No sentence fragments used as style.`;

// Strip any markdown that slips through despite instructions
function clean(text) {
  if (!text) return text;
  return text
    .replace(/^#{1,6}\s+[^\n]*/gm, '')       // # headers
    .replace(/\*\*(.*?)\*\*/gs, '$1')         // **bold**
    .replace(/\*(.*?)\*/gs, '$1')             // *italic*
    .replace(/^[-*]\s+/gm, '')               // bullet list items
    .replace(/^---+$/gm, '')                  // horizontal rules
    .replace(/^\s*(Sports|Markets|Golf|Culture|GuyTalk|F1|Formula)\s*:\s*/i, '') // stray section labels
    .replace(/\n{3,}/g, '\n\n')              // collapse excess blank lines
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
// Generate all GuyTalk copy in parallel using Claude Haiku
// ─────────────────────────────────────────────────────────────────────────────
async function generateCopy({ sports, markets, golf, trending, f1, worldCup, upcoming, boxScores }) {
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

  // ── Build context strings ───────────────────────────────────────────────
  const ctx = buildContext({ sports, markets, golf, f1, worldCup, upcoming });

  const gamesText = (sports || []).map(g => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    let line = `${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score} (${g.status})`;
    if (g.seriesNote) line += ` [Series: ${g.seriesNote}]`;
    return line;
  }).join('\n');

  // Box score data for the main game (real player stats — use these, do not invent)
  const mainGame = sports?.[0];
  const mainGameLeaders = mainGame && boxScores?.[mainGame.id]
    ? boxScores[mainGame.id].map(p => `${p.name} (${p.team}): ${p.pts}pts${p.reb ? ` ${p.reb}reb` : ''}${p.ast ? ` ${p.ast}ast` : ''}`).join(', ')
    : null;

  const extraGames = sports?.slice(1) || [];

  const mktText = markets
    ? Object.entries(markets)
        .filter(([, q]) => q?.dayChangePct !== null && q?.dayChangePct !== undefined)
        .map(([sym, q]) => {
          const day = `${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(1)}%`;
          const wk = q.weekChangePct !== null && q.weekChangePct !== undefined
            ? ` / ${q.weekChangePct >= 0 ? '+' : ''}${q.weekChangePct.toFixed(1)}% wk`
            : '';
          return `${sym} ${day}${wk}`;
        }).join(', ')
    : '';

  const trendText = (trending || []).slice(0, 10)
    .map((t, i) => `${i + 1}. [${t.source}] ${t.title}`)
    .join('\n');

  // F1 context string
  const f1Text = f1?.results?.length
    ? `F1 — ${f1.name} (${f1.status || f1.statusState}): ${f1.results.map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`
    : f1?.name
    ? `F1 — ${f1.name} upcoming (${f1.status || 'scheduled'})`
    : null;

  // World Cup context
  const wcText = worldCup?.length
    ? `FIFA World Cup 2026 matches: ${worldCup.map(m => `${m.away.team} vs ${m.home.team} (${m.status || m.statusState})`).join('; ')}`
    : 'FIFA World Cup 2026 opens June 11 in USA/Canada/Mexico — squads confirmed, tournament 9 days away.';

  // Upcoming NBA context
  const upcomingText = upcoming?.length
    ? `Upcoming NBA: ${upcoming.map(g => `${g.shortName}${g.note ? ` (${g.note})` : ''} — ${g.daysAhead === 0 ? 'today' : g.daysAhead === 1 ? 'tomorrow' : 'in 2 days'}`).join(', ')}`
    : null;

  // ── All calls in parallel ───────────────────────────────────────────────
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
    f1DetailR,
  ] = await Promise.allSettled([

    // 1. Brief headline
    ask(
      `Write the headline for today's GuyTalk issue. Max 12 words. Plain text only — no quotes, no colons, no markdown.
Style examples: "Wembanyama's Finals debut tomorrow. Antonelli leads Monaco. World Cup is 9 days out."
Context: ${ctx}`,
      80
    ),

    // 2. Sports opening paragraph — covers NBA/F1/World Cup/Golf/all sports
    mainGame
      ? ask(
          `Write 2–3 sentences opening the Sports section. Plain prose only — no markdown, no headers, no labels.
REAL GAME DATA:
${gamesText}
${mainGameLeaders ? `CONFIRMED player stats (only use these — do not invent others): ${mainGameLeaders}` : 'No individual player stats available. Describe the team result only — do not name any individual players or invent stats.'}
${golf?.leaders?.[0] ? `Golf: ${golf.leaders[0].name} ${golf.statusState === 'post' ? 'won' : 'leads'} ${golf.name} at ${golf.leaders[0].score}.` : ''}
${f1Text ? `${f1Text}` : ''}
${upcomingText ? upcomingText : ''}
Lead with the most important result. End with what's coming up next (Finals, Monaco, World Cup).
CRITICAL: Only name players whose stats are in the CONFIRMED player stats line above. Never invent stats.`,
          220
        )
      : ask(
          `Write 2–3 sentences for the Sports section. No games last night. Plain prose only, no markdown.
Cover the biggest sports stories happening RIGHT NOW based on this data:
${f1Text ? `F1: ${f1Text}` : ''}
${upcomingText ? `NBA schedule: ${upcomingText}` : ''}
World Cup context: ${wcText}
${golf?.leaders?.[0] ? `Golf: ${golf.leaders[0].name} ${golf.statusState === 'post' ? 'won' : 'leads'} ${golf.name} at ${golf.leaders[0].score}.` : ''}
Trending: ${trendText || 'No data.'}
Pick the 2–3 most compelling storylines. Name real athletes. Be specific about what's upcoming and when.
Do NOT invent game results or stats that haven't happened yet.`,
          220
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
      `Write the "Sharp Take" — EXACTLY TWO paragraphs. That means TWO paragraph breaks and no more. Plain prose ONLY — no markdown.

Paragraph 1 (3-4 sentences): Pick the ONE biggest story today and give the non-obvious take on it. Not a score recap — a point of view. Something the reader thinks "exactly" when they read it. Be specific to what actually happened today.

Paragraph 2 (2-3 sentences): Connect something from today — sports, markets, culture — to a real insight the reader can use. End with ONE punchy action line specific to today. Example energy: "Clear your Saturday. Monaco doesn't get better on replay." Do NOT end with generic advice.

Do not use the word "ultimately." Do not recap every game — pick one story.

Context: ${ctx}${trendText ? `\nTrending: ${trendText}` : ''}`,
      350
    ),

    // 6. Sports detail (JSON) — only when we have a real game
    mainGame
      ? ask(
          `GuyTalk voice. Game: ${gamesText.split('\n')[0]}
${mainGameLeaders ? `Player stats (ONLY use these — do not invent any other stats): ${mainGameLeaders}` : 'No player stats available. Use team-level observations only.'}
Return ONLY valid JSON, no markdown, no code fences:
{
  "keyNumber": "${mainGameLeaders ? 'The defining stat — use a real number from the stats provided above.' : 'A team-level stat or series context — do not invent individual player numbers.'}",
  "seriesSituation": "${mainGame.seriesNote ? `Series: ${mainGame.seriesNote}. ` : ''}Next game context — what this result means.",
  "howToWatch": "Game label · Day · Venue · Time ET · Network.",
  "groupChatAngle": "One inside-knowledge observation. Specific, not obvious."
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
  "recap": "How the final round played out. Specific.",
  "bringUp": "One inside-knowledge fact about the winner or course. Not obvious.",
  "groupChatAngle": "One drop-it-once insight. Sounds like you watched every round."
}`
            : `GuyTalk voice. Tournament: ${golf.name}. Status: ${golf.status}.
Leaderboard: ${golf.leaders.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ')}.
Return ONLY valid JSON, no markdown, no code fences:
{
  "whyItMatters": "Field quality, FedEx Cup points, historic venue — one concrete sentence.",
  "tvSchedule": "Broadcast info: 'Round X: TIME ET, Golf Channel/Peacock. Final round: TIME ET, NBC/CBS.'",
  "bringUp": "One inside-knowledge fact about the leader or course. Specific.",
  "groupChatAngle": "Drop-it-once insight about the leader or field."
}`,
          400
        )
      : Promise.resolve(null),

    // 9. Culture (JSON array)
    ask(
      `GuyTalk culture section. Write 3 items for men 25–45.
Return ONLY a valid JSON array, no markdown, no code fences, exactly 3 objects:
[
  {"head": "Specific headline — name the real person/company/moment", "source": "Platform · Source", "body": "3–4 sentences. What happened. Why it matters. The correct take. End with one line the reader drops in conversation."},
  {"head": "Specific headline", "source": "Platform · Source", "body": "Same format."},
  {"head": "Watch this: [real title — action / thriller / sports / war / crime / sci-fi]", "source": "Streaming service or Theater · Genre", "body": "What it is, who made it, who it's for. One sentence on why it earns your two hours. Don't oversell."}
]
Item 3 MUST be a real currently-available movie, show, or event — and must be guy-oriented: action, thriller, heist, sports doc, war, crime, sci-fi. No animated films, romantic comedies, or children's content unless it has strong crossover appeal for men. Today is ${TODAY}.
Good examples: "In the Grey" (Henry Cavill + Jake Gyllenhaal, Guy Ritchie heist thriller — just dropped on Prime Video June 2), "Masters of the Universe" (theaters June 5).
Items 1–2: prioritize sports/business/culture crossovers. Avoid repeating stories from trending that were in the last brief.
Trending: ${trendText || 'No data — use your judgment on major current events.'}`,
      900
    ),

    // 10. Numbers context (JSON array)
    ask(
      `GuyTalk voice. Return ONLY a valid JSON array, no markdown, no code fences, exactly 3 objects:
[{"context": "2 sentences on what this number means and why the reader should care. Specific. Only reference real data given."}]

Numbers:
${mainGame ? `${mainGame.home.score}–${mainGame.away.score} (${mainGame.note || mainGame.shortName})` : ''}
${markets?.SPY?.dayChangePct !== undefined ? `SPY ${markets.SPY.dayChangePct >= 0 ? '+' : ''}${markets.SPY.dayChangePct.toFixed(1)}% today` : ''}
${golf?.leaders?.[0] ? `${golf.leaders[0].name} ${golf.leaders[0].score}, ${golf.name}` : ''}
${f1?.results?.[0] ? `${f1.results[0].driver} wins ${f1.name}` : ''}
${upcoming?.length ? `NBA Finals Game 1: ${upcoming[0].shortName}` : ''}`,
      350
    ),

    // 11. Additional game notes (plain text, separated by |||)
    extraGames.length
      ? ask(
          `GuyTalk voice. Write 2–3 sentence notes for each game below. Plain prose — no markdown. Separate game notes with "|||".
Only use team names and scores provided. Do not invent player stats.
${extraGames.map(g => {
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  return `${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score}`;
}).join('\n')}`,
          300
        )
      : Promise.resolve(null),

    // 12. F1 detail (JSON) — post-race results or pre-race preview
    f1?.name
      ? (function() {
          if (f1.results?.length && f1.statusState === 'post') {
            const f1ResultsLine = 'Results: ' + f1.results.map(r => 'P' + r.pos + ' ' + r.driver + ' (' + r.team + ')').join(', ') + '.';
            return ask(
              'GuyTalk voice. F1 race: ' + f1.name + ' (Final).\n' +
              f1ResultsLine + '\n' +
              'Return ONLY valid JSON, no markdown, no code fences:\n' +
              '{\n' +
              '  "headline": "One punchy sentence about the race result. Max 12 words.",\n' +
              '  "angle": "2 sentences: the key story. Only use facts given above — no invented lap times.",\n' +
              '  "bringUp": "One inside-knowledge fact about the race, driver, or championship battle.",\n' +
              '  "championship": "Championship standings context: who leads the title, by how many points, and what\'s next.",\n' +
              '  "pick": "The driver who stood out beyond the podium — who drove well, made a move, or is worth watching next race. 1 opinionated sentence."\n' +
              '}',
              350
            );
          } else {
            // Pre-race preview
            return ask(
              'GuyTalk voice. F1 preview: ' + f1.name + '.\n' +
              'Venue: ' + (f1.venue || 'Circuit') + '. Status: ' + (f1.status || 'scheduled this weekend') + '.\n' +
              'Return ONLY valid JSON, no markdown, no code fences:\n' +
              '{\n' +
              '  "headline": "One sentence about why this race matters. Max 12 words.",\n' +
              '  "angle": "2 sentences: the story to watch — championship battle, unique circuit, key rivalries. Be specific about real drivers and teams in the 2026 season.",\n' +
              '  "bringUp": "One inside-knowledge fact about Monaco or the current F1 season standings.",\n' +
              '  "championship": "Describe the championship battle storyline heading into this race — who are the top contenders and what\'s at stake. 1-2 sentences, use driver names you know.",\n' +
              '  "pick": "The driver to root for this race and why — opinionated, 1 sentence. Not just the obvious favorite."\n' +
              '}',
              350
            );
          }
        })()
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
    f1Detail:         parseJson(get(f1DetailR)),
  };
}

function buildContext({ sports, markets, golf, f1, worldCup, upcoming }) {
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

  if (upcoming?.length) {
    const game = upcoming[0];
    const when = game.daysAhead === 0 ? 'today' : game.daysAhead === 1 ? 'tomorrow' : 'in 2 days';
    parts.push(`NBA Finals: ${game.shortName}${game.note ? ` (${game.note})` : ''} — ${when}`);
  }

  if (f1?.results?.length && f1.statusState === 'post') {
    parts.push(`F1: ${f1.name} — Winner: ${f1.results[0]?.driver} (${f1.results[0]?.team})`);
  } else if (f1?.name && f1.statusState !== 'post') {
    parts.push(`F1: ${f1.name} — upcoming ${f1.status || 'this weekend'}`);
  }

  if (worldCup?.length) {
    const active = worldCup.filter(m => m.statusState === 'in' || m.statusState === 'post');
    if (active.length) parts.push(`World Cup: ${active.map(m => `${m.away.team} vs ${m.home.team} ${m.away.score}–${m.home.score}`).join('; ')}`);
    else parts.push('FIFA World Cup 2026 opens June 11 — 9 days away');
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
