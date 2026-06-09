'use strict';

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

const BRAND_VOICE = `You write for GuyTalk — a daily brief for men 25–45. Today: ${TODAY}.

VOICE: Sharp, casual, confident. A smart friend who watched the game, checked the markets, and can hold any conversation. Not a reporter. Not an advisor. The guy at the table who just knows things.

WRITING RULES:
- Short sentences. Vary rhythm: short punch, longer follow-through, short punch.
- Name specific people, teams, numbers. Vague = useless.
- Lead with the most interesting angle. Scores are the least interesting thing.
- Every piece of writing answers: What happened? Why does it matter? What do I say?
- Casual language: "The Knicks got exposed" beats "New York underperformed."
- Clarity over sounding clever.

FORMAT: Plain prose ONLY — no markdown, no bold, no bullets, no headers, no dividers. Complete sentences.

HALLUCINATION RULES (non-negotiable):
- ONLY use data explicitly given in the prompt. Never invent player names, stats, or scores.
- "San Antonio Spurs" in 2026 means Wembanyama's team, not Tim Duncan's.
- Series records ONLY if given in [Series: ...] brackets.
- F1: only name drivers listed in the data.
- If only team-level data is available, describe the team — do not name individual players.

BANNED PHRASES (never use):
- "pivotal", "groundbreaking", "game-changer", "seismic", "monumental"
- "at the end of the day", "it's worth noting", "to be clear", "make no mistake"
- "delve", "leverage" (verb), "nuanced", "ecosystem" (companies), "narrative"
- "buckle up", "the stage is set", "it remains to be seen", "keep an eye on"
- "momentum" as standalone explanation, "canary in the coal mine"
- "Tonight's line:", "What you're saying tonight:", "Drop this:", "Next:", "The takeaway:"
- No passive voice. No weak openers: "There is...", "It is...", "This was..."
- Never sit on the fence. Have an actual opinion.

MARKETS COMPLIANCE (applies to every section, not just Markets):
GuyTalk is NOT an investment advisor. Never write anything that could be interpreted as a recommendation to buy, sell, or hold a security.
NEVER use: "buying opportunity", "investors should buy/sell/hold", "looks undervalued", "looks overvalued", "now may be a good time to buy", "great long-term investment", "we like this stock", "our favorite", "consider adding shares", "consider reducing exposure", "smart money move", "the smart trade is", "price target", "portfolio allocation".
ALWAYS frame markets as: what happened, why it happened, why it's being discussed. Observe and explain. Never advise.`;

function clean(text) {
  if (!text) return text;
  return text
    .replace(/^#{1,6}\s+[^\n]*/gm, '')
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/\*(.*?)\*/gs, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/^\s*(Sports|Markets|Golf|Culture|GuyTalk|F1|Formula)\s*:\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
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

async function generateCopy({ sports, markets, golf, trending, f1, worldCup, nhl, upcoming, boxScores, prev3, streamingPick }) {
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

  // ── Build context ───────────────────────────────────────────────────────────
  const mainGame  = sports?.[0];
  const extraGames = sports?.slice(1) || [];

  const gamesText = (sports || []).map(g => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    let line = `${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score} (${g.status})`;
    if (g.seriesNote) line += ` [Series: ${g.seriesNote}]`;
    return line;
  }).join('\n');

  const mainGameLeaders = mainGame && boxScores?.[mainGame.id]
    ? boxScores[mainGame.id].map(p =>
        `${p.name} (${p.team}): ${p.pts}pts${p.reb ? ` ${p.reb}reb` : ''}${p.ast ? ` ${p.ast}ast` : ''}`
      ).join(', ')
    : null;

  const mktText = markets
    ? Object.entries(markets)
        .filter(([, q]) => q?.dayChangePct !== null && q?.dayChangePct !== undefined)
        .map(([sym, q]) => {
          const day = `${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(1)}%`;
          const wk  = q.weekChangePct !== null && q.weekChangePct !== undefined
            ? ` / ${q.weekChangePct >= 0 ? '+' : ''}${q.weekChangePct.toFixed(1)}% wk` : '';
          return `${sym} ${day}${wk}`;
        }).join(', ')
    : '';

  const trendText = (trending || []).slice(0, 8)
    .map((t, i) => `${i + 1}. [${t.source}] ${t.title}`)
    .join('\n');

  const f1Text = f1?.results?.length && f1.statusState === 'post'
    ? `F1 ${f1.name} (Finished): ${f1.results.slice(0, 3).map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`
    : f1?.name ? `F1 ${f1.name} — this weekend` : null;

  const upcomingText = upcoming?.length
    ? `${upcoming[0].shortName}${upcoming[0].note ? ` (${upcoming[0].note})` : ''} — ${upcoming[0].daysAhead === 0 ? 'tonight' : upcoming[0].daysAhead === 1 ? 'tomorrow' : 'in 2 days'}`
    : null;

  const golfText = golf?.leaders?.[0]
    ? `${golf.name}: ${golf.leaders[0].name} leads at ${golf.leaders[0].score} (${golf.statusState === 'post' ? 'Finished' : golf.statusState === 'in' ? 'In Progress' : 'Starting this week'})`
    : golf?.name ? `${golf.name} — starts this week` : null;

  const wcText = worldCup?.length
    ? `World Cup 2026 opens June 11 — ${worldCup.filter(m => m.statusState === 'in' || m.statusState === 'post').length} match(es) played`
    : null;

  const ctx = [
    gamesText || (upcomingText ? `Upcoming: ${upcomingText}` : null),
    upcomingText && gamesText ? `Upcoming: ${upcomingText}` : null,
    f1Text,
    golfText,
    wcText,
    mktText ? `Markets: ${mktText}` : null,
  ].filter(Boolean).join(' | ');

  // Repetition guard from last 3 briefs
  const repGuard = (prev3 && prev3.length) ? `
REPETITION GUARD — avoid these angles used in recent issues:
${prev3.map((b, i) => `${i + 1} day(s) ago — Lead angle: "${b.sportsThesis || b.lead || ''}" | Bring-up: "${b.marketsBringUp || b.bringUp || ''}"`).join('\n')}` : '';

  // ── 10 parallel calls ───────────────────────────────────────────────────────
  const [
    titleR,
    topModuleR,
    leadR,
    sportsOtherR,
    marketsR,
    golfR,
    f1R,
    cultureR,
    finalTakeR,
    glanceR,
    theTakeR,
    nhlR,
    upcomingPreviewR,
  ] = await Promise.allSettled([

    // 1. Brief headline
    ask(
      `Write the headline for today's GuyTalk issue. Plain text — no quotes, no colons, no markdown. Max 12 words.
Three punchy fragments separated by periods. Name real people and events. Never vague.
Good examples: "Wembanyama's Finals debut tonight. Pirates demolish Astros. World Cup in nine days." / "Knicks stole Game 1. Nvidia craters on yields. Memorial starts Thursday."
Context: ${ctx}`,
      80
    ),

    // 2. Key Takeaway + Today's Hits taglines (single call)
    ask(
      `Today's GuyTalk context: ${ctx}
Trending: ${trendText || 'none'}

CATEGORY RULES (strictly enforced):
- "sports": baseball, basketball, NHL, NFL trades/news — NOT culture, NOT gaming
- "markets": stocks, rates, crypto, economy ONLY
- "golf": golf tournaments ONLY
- "f1": Formula 1 ONLY
- "worldcup": FIFA World Cup ONLY (do not put culture content here)
- "culture": movies, TV, music, gaming, celebrity, tech trends, streaming

Return ONLY valid JSON on one line — no markdown, no code fences:
{"keyTakeaway":"2-3 sentences max. Big picture across sports, markets, culture. 20-second summary. No hype.","sports":"Tagline for sports section. Under 12 words.","markets":"Tagline for markets. Under 10 words. Include a number.","golf":"Tagline for golf. Under 10 words.","f1":"Tagline for F1. Under 10 words.","worldcup":"Tagline for World Cup (countdown, teams, venues). Under 10 words.","culture":"Tagline for culture/entertainment. Under 10 words. Must be about entertainment/gaming/TV/music — NOT sports scores."}`,
      350
    ),

    // 3. The Lead — strongest story, full structured treatment
    ask(
      `THE LEAD for today's GuyTalk. Pick the strongest story from today's data and write it up.
${gamesText ? `Games:\n${gamesText}` : ''}
${mainGameLeaders ? `Player stats (ONLY use these — never invent): ${mainGameLeaders}` : 'No individual stats — describe teams only.'}
${upcomingText ? `Upcoming: ${upcomingText}` : ''}
${f1Text ? f1Text : ''}
${golfText ? golfText : ''}

Games are listed 0-indexed: ${(sports || []).map((g, i) => {
  const w = g.home.winner ? g.home : g.away;
  return `[${i}] ${g.note || g.name}: ${w.team} wins`;
}).join(' | ')}

Return ONLY valid JSON on one line — no markdown:
{"gameIndex":0,"headline":"Max 10 words. The angle, not the score.","whatHappened":"1-2 sentences. Plain language. Most interesting angle first.","whyBullet1":"One sentence. The main reason this matters today.","whyBullet2":"One sentence. A different angle.","whatToSay":"One natural conversational line."}

gameIndex must be the index number (0, 1, 2...) of the game your headline and copy are about. If headline is about game at index 1, set gameIndex:1.${repGuard}`,
      400
    ),

    // 4. Other sports — one sharp sentence per extra game (all games except the lead)
    sports?.length > 1
      ? ask(
          `GuyTalk voice. One short sentence per game below — the quickest sharp take. Max 15 words each. Separate with "|||". Plain prose.
${sports.map(g => {
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  return `${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score}`;
}).join('\n')}`,
          200
        )
      : Promise.resolve(null),

    // 5. Markets
    markets && mktText
      ? ask(
          `GuyTalk markets section. Data: ${mktText}

MARKET TIMING (hard requirement): ${markets?.__meta?.framing || 'Only use the word "today" if it is accurate for the current US market session.'}
Use accurate phrasing like "closed at", "looking to open", or "as of … ET". If you say "today", it must actually be today.

COMPLIANCE RULES (hard requirements — violations will be removed before publishing):
GuyTalk is a media product. It observes and explains. It does NOT advise.
NEVER write: "buying opportunity", "investors should", "looks undervalued", "now may be a good time", "great long-term investment", "smart move is", "we like this stock", "consider adding", "consider reducing", "price target", "portfolio", "risk tolerance", "tax", "retirement advice".
ALWAYS write about what happened and why — never what the reader should do.

The Markets section answers three questions only:
1. What happened?
2. Why did it happen?
3. Why are people talking about it?

Return ONLY valid JSON on one line — no markdown:
{"mood":"One sentence — what happened in markets today and why. Include one real number. Plain English.","whyBullet1":"One sentence — why this matters in context. Explain, don't advise. Example: 'Treasury yields moved because...' not 'investors should...'","whyBullet2":"What professionals are watching in the next 2-3 days. Name a specific data print or event. Include the day of week.","bringUp":"One quotable market fact. Must include a real number. Explain something — do not tell anyone what to do with it."}`,
          300
        )
      : Promise.resolve(null),

    // 6. Golf — tight format
    golf?.name
      ? ask(
          (() => {
            const lb = golf.leaders?.slice(0, 3).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ') || 'no leaderboard yet';
            const status = golf.statusState === 'post' ? 'Finished' : golf.statusState === 'in' ? 'In Progress' : 'Starting this week';
            return `GuyTalk golf: ${golf.name} — ${status}. Leaderboard: ${lb}.
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words — what's happening at ${golf.name}.","whyCare1":"One sentence — why this tournament matters this week (FedEx Cup stakes, prestige, course reputation).","whyCare2":"One sentence — a specific angle about the course, the field, or the situation.","watchFor":"One thing to track this weekend. Specific — a player, a position battle, a scoring target.","whatToSay":"One casual line for conversation. Sounds informed without being nerdy."}`;
          })(),
          250
        )
      : Promise.resolve(null),

    // 7. F1 — tight format
    f1?.name
      ? ask(
          (() => {
            const isPost = f1.results?.length && f1.statusState === 'post';
            const raceLine = isPost
              ? `Results: ${f1.results.slice(0, 3).map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`
              : `Upcoming: ${f1.name} this weekend`;
            // Real, sourced season stats for a grounded "bring up" — never a record/streak.
            const w = f1.results?.[0];
            const bits = [];
            if (isPost && w?.seasonWins != null) bits.push(`${w.driver} now has ${w.seasonWins} win${w.seasonWins === 1 ? '' : 's'} this season`);
            if (isPost && w?.champPos != null) bits.push(`sits P${w.champPos} in the championship${w.champPoints != null ? ` with ${w.champPoints} pts` : ''}`);
            if (f1.champLeader?.lead != null) bits.push(`${f1.champLeader.name} leads the title race by ${f1.champLeader.lead} pts`);
            const statLine = bits.length ? `\nReal season stats (use ONLY these for any numbers/records): ${bits.join('; ')}.` : '';
            return `GuyTalk F1: ${f1.name}. ${raceLine}.${statLine}
A driver's team/constructor is ONLY the name shown in parentheses next to them. NEVER guess or state a driver's team if it is not given.
STATS RULE (hard): you may include ONE interesting stat in "whatToSay" or "whyCare2", but ONLY using the season stats provided above. NEVER invent records, streaks, "first/most/youngest/oldest", or any number not given. If no stat is provided, don't cite one.
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words.","whyCare1":"One sentence — what makes this race or result significant.","whyCare2":"One sentence — championship battle or circuit-specific detail.","watchFor":"One thing to track. Specific.","whatToSay":"One casual conversation line — weave in the real season stat if available."}`;
          })(),
          220
        )
      : Promise.resolve(null),

    // 8. Culture — 3 quick hits
    ask(
      `GuyTalk culture: 3 quick hits for men 25-45. Today: ${TODAY}.
Return ONLY valid JSON array with exactly 3 objects — no markdown, no extra text:
[{"topic":"Headline. Max 8 words.","whatHappened":"One sentence — what actually happened.","whyItMatters":"One sentence — why a guy should care.","whatToSay":"One casual conversation line. Natural, not forced.","tag":"Celebrity|Music|Sports Biz|TV|Tech|Culture|Streaming"}]

Items 1 and 2: Real stories from trending data. Different categories — don't do two of the same type.
${streamingPick ? `Item 3 EXACTLY: {"topic":"${streamingPick.head.replace('Watch this: ', '')}","whatHappened":"${streamingPick.body.split('.')[0]}.","whyItMatters":"Worth your time.","whatToSay":"Just put it on.","tag":"Streaming"}` : 'Item 3: One streaming/watch rec. Action, thriller, crime, prestige drama only — no animated, kids, or family.'}

Only use stories confirmed in trending data — never invent events.
Trending: ${trendText || 'Use knowledge of June 2026 current events.'}`,
      500
    ),

    // 9. Final Sharp Take — 80-100 words, 3-4 sentences
    ask(
      `Write the Final Sharp Take for today's GuyTalk. Hard limit: 80-100 words. 3-4 sentences only.
Connect today's main themes — one actual opinion. Do NOT recap every score or section. Sound confident and natural — the last thing you say before leaving the room.
No forced lines like "something bigger shifts" unless backed by real data. No hype. No filler. Plain prose.
Context: ${ctx}${repGuard}`,
      150
    ),

    // 10. Today at a Glance — 5 labeled bullets
    ask(
      `Write "Today at a Glance" for GuyTalk. Five short lines. Context: ${ctx}

Return compact JSON on one line. Every field is a single sentence ending with a period. No markdown:
{"sports":"[main sports result or preview — include score or key fact]","market":"[market summary — include one number]","bestConvo":"[best conversation starter from today — specific]","watchNext":"[one thing to watch in next 24-48 hours]","quickRec":"[quick rec or reminder from today's brief]"}`,
      200
    ),

    // 11. The Take — Office Take (smart, portable) + Bar Argument (spicy, debatable)
    ask(
      `Write two GuyTalk "takes" from today's brief — these are OPINIONS, not recaps. Take a real side.
Use ONLY real facts from the context below; never invent stats, records, or events. Grounded but bold.
Context: ${ctx}${repGuard}

Return ONLY valid JSON on one line — no markdown:
{"office":"The Office Take — one smart, measured sentence you can drop at work to sound like you've actually been paying attention. Insightful, slightly contrarian, not loud. Max 28 words.","bar":"The Bar Argument — one bold, debatable hot take that would genuinely start an argument among friends. Pick a side and commit. Confident and a little spicy, but grounded in today's real facts. Max 28 words."}`,
      200
    ),

    // 12. NHL — F1-style treatment (only if there's an NHL game)
    (() => {
      const g = nhl?.final || nhl?.next;
      if (!g) return Promise.resolve(null);
      const line = nhl.final
        ? `Result: ${(g.home.winner ? g.home : g.away).team} won ${Math.max(+g.home.score, +g.away.score)}–${Math.min(+g.home.score, +g.away.score)}`
        : `Upcoming: ${g.away.team} at ${g.home.team}`;
      const meta = `${g.note || ''}${g.seriesNote ? ` — ${g.seriesNote}` : ''}${g.venue ? ` — ${g.venue}${g.venueCity ? `, ${g.venueCity}` : ''}` : ''}`;
      return ask(
        `GuyTalk NHL section. ${g.note || 'NHL game'}. ${line}. ${meta}.
Use ONLY the facts above — never invent scores, records, or stats not given.
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words — the angle.","whyCare1":"One sentence — why this game/series matters right now.","whyCare2":"One sentence — series state or stakes (who leads, what a win does).","watchFor":"One specific thing to track.","whatToSay":"One casual conversation line."}`,
        220
      );
    })(),

    // 13. Upcoming marquee game preview (e.g. the next NBA Finals game) — context
    (upcoming && upcoming.length)
      ? ask(
          `GuyTalk preview of an UPCOMING game: ${upcomingText}${upcoming[0].seriesNote ? ` (${upcoming[0].seriesNote})` : ''}.
Use ONLY these facts — never invent stats. This game has NOT happened yet, so do not state a result.
Return ONLY valid JSON on one line — no markdown:
{"whyItMatters":"One sentence — what's at stake in this game and why people care.","watchFor":"One specific thing to watch for.","whatToSay":"One casual conversation line about the matchup."}`,
          200
        )
      : Promise.resolve(null),
  ]);

  const get = r => r.status === 'fulfilled' ? r.value : null;

  const topModule    = parseJson(get(topModuleR));
  const leadData     = parseJson(get(leadR));
  const marketsData  = parseJson(get(marketsR));
  const golfData     = parseJson(get(golfR));
  const f1Data       = parseJson(get(f1R));
  const cultureArr   = parseJson(get(cultureR));
  const glanceData   = parseJson(get(glanceR));

  return {
    title:          clean(get(titleR)),
    keyTakeaway:    topModule?.keyTakeaway  || null,
    todaysHits: topModule ? {
      sports:   topModule.sports    || '',
      markets:  topModule.markets   || '',
      golf:     topModule.golf      || '',
      f1:       topModule.f1        || '',
      worldcup: topModule.worldcup  || '',
      culture:  topModule.culture   || '',
    } : null,
    lead:           leadData,
    sportsOther:    get(sportsOtherR)?.split('|||').map(s => clean(s)).filter(Boolean) || [],
    markets:        marketsData,
    golf:           golfData,
    f1:             f1Data,
    culture:        Array.isArray(cultureArr) ? cultureArr : null,
    finalSharpTake: clean(get(finalTakeR)),
    glance:         glanceData,
    theTake:        parseJson(get(theTakeR)),
    nhl:            parseJson(get(nhlR)),
    upcomingPreview: parseJson(get(upcomingPreviewR)),
  };
}

module.exports = { generateCopy };
