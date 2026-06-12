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
STRUCTURE — every body item is built from these three beats, in this order:
WHAT HAPPENED: One sentence. Specific. Named person or team. Score, stat, or number if applicable. Never vague.
WHY IT MATTERS: One to two sentences. Non-obvious stakes — what changes, what it signals, why a normal person should care. Never "this matters because it's significant."
WHAT TO BRING UP: One sentence. A specific take or hook a 28-year-old can say out loud in a group chat or at a bar. Not a summary. Has a point of view.

The brief's template prints these three labels for you. When a prompt asks for JSON, put each beat in its matching field (e.g. whatHappened / whyBullet1 + whyBullet2 / whatToSay) — do NOT write the words "WHAT HAPPENED:", "WHY IT MATTERS:", or "WHAT TO BRING UP:" inside any value, and NEVER add these labels to a headline, tagline, or any one-line field.
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

async function generateCopy({ sports, markets, golf, tennis, trending, topStories, sectionStories, f1, worldCup, nhl, upcoming, boxScores, prev3, streamingPick }) {
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

  async function ask(prompt, maxTokens = 300, model = 'claude-haiku-4-5-20251001') {
    const res = await client.messages.create({
      model,
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

  // Tennis: lead with a Grand Slam if one's running; otherwise the week's events.
  const tennisText = tennis?.tours?.length
    ? tennis.tours.map(t => {
        const tag = t.isMajor ? `${t.tour} GRAND SLAM` : t.tour;
        const r = t.results?.[t.results.length - 1];
        return `${tag} ${t.name}${t.status ? ` (${t.status})` : ''}${r ? `: ${r.winner} def. ${r.loser} ${r.score}` : ''}`;
      }).join('; ')
    : null;

  const ctx = [
    gamesText || (upcomingText ? `Upcoming: ${upcomingText}` : null),
    upcomingText && gamesText ? `Upcoming: ${upcomingText}` : null,
    f1Text,
    golfText,
    tennisText ? `Tennis: ${tennisText}` : null,
    wcText,
    mktText ? `Markets: ${mktText}` : null,
  ].filter(Boolean).join(' | ');

  // Web-researched biggest stories of the day (real, sourced). These are the
  // organic-news layer — a guy needs to know the single biggest story (★) above
  // any regular-season game. The single biggest market/business story may carry
  // a "depth" answer (market impact / index inclusion / how to participate /
  // historical comps) — use it in the Markets section.
  const stories = Array.isArray(topStories) ? topStories : [];
  const leadStory = stories.find((s) => s.isLead) || stories[0] || null;
  const leadMarketStory = stories.find((s) => s.depth && /Market|Business/i.test(s.category || '')) || null;
  const topStoriesText = stories.length
    ? 'BIGGEST STORIES TODAY (real, web-researched — the ★ is the single biggest thing a guy needs to know today; it usually outranks a regular-season game): '
      + stories.map((s) => `${s.isLead ? '★' : '•'} [${s.category}] ${s.headline}`).join('  ;;  ')
    : '';

  // Web-sourced section facts (Change 1) — real, current facts the structured
  // feeds can't see. Injected into the matching section prompt as grounded facts.
  const sectionWeb = (key) => {
    const r = sectionStories?.[key];
    if (!r || r.no_data) return null;
    return `${r.headline ? r.headline + ' — ' : ''}${r.fact || ''}`.trim() || null;
  };
  const nhlWeb  = sectionWeb('nhl');
  const f1Web   = sectionWeb('f1');
  const golfWeb = sectionWeb('golf');
  const cultureWeb = (sectionStories?.culture || [])
    .filter(c => c && !c.no_data)
    .map(c => `${c.headline ? c.headline + ' — ' : ''}${c.fact || ''}`.trim())
    .filter(Boolean);

  // Repetition guard from last 3 briefs
  const coveredEvents = (prev3 || [])
    .flatMap(b => [b.f1State === 'post' ? b.f1Event : '', b.golfState === 'post' ? b.golfEvent : ''])
    .filter(Boolean);
  const coveredLine = coveredEvents.length
    ? `\nALREADY COVERED as results in recent issues — do NOT re-report these as fresh news; if they're the only item, pivot forward to what's next: ${[...new Set(coveredEvents)].join(', ')}.`
    : '';
  const repGuard = (prev3 && prev3.length) ? `
REPETITION GUARD — avoid these angles used in recent issues:
${prev3.map((b, i) => `${i + 1} day(s) ago — Lead angle: "${b.sportsThesis || b.lead || ''}" | Bring-up: "${b.marketsBringUp || b.bringUp || ''}"`).join('\n')}${coveredLine}` : '';

  // Golf preview leans on factual recall (course, defending champ) — use the
  // stronger model for it; live recaps stay on Haiku.
  const golfStarted = golf?.statusState === 'post' || golf?.statusState === 'in';

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
${topStoriesText ? `${topStoriesText}\nLEAD the headline with the ★ story when it's genuinely the biggest thing today (a record IPO, a major ruling, a huge launch) — it beats a regular-season score. Still include a sports fragment and one more.` : ''}
Context: ${ctx}`,
      80
    ),

    // 2. Key Takeaway + Today's Hits taglines (single call)
    ask(
      `Today's GuyTalk context: ${ctx}
Trending: ${trendText || 'none'}
${topStoriesText ? `${topStoriesText}\nThe "markets" hit MUST be the biggest market/business story above (the ★ if it's Markets/Business). The "keyTakeaway" should mention the single biggest story of the day.` : ''}

CATEGORY RULES (strictly enforced):
- "sports": ANYTHING big in sports right now — don't limit to a fixed list. Core leagues (NBA, MLB, NHL, NFL), tennis (esp. Grand Slams: Wimbledon, US/French/Australian Open), boxing/UFC marquee fights, the Olympics, college football/basketball playoffs, records broken, major trades. Lead with whatever is actually the biggest sports moment. (Golf and F1 have their own sections.) — NOT culture, NOT gaming
- "markets": stocks, rates, crypto, economy ONLY
- "golf": golf tournaments ONLY
- "f1": Formula 1 ONLY
- "worldcup": FIFA World Cup ONLY (do not put culture content here)
- "culture": what men 25-45 talk about — big movies/TV/streaming, gaming, tech & gadgets, sports business, a major music moment. AVOID celebrity gossip/breakups/who's-dating-who unless genuinely massive.

TODAY'S HITS — the "sports", "markets", and "culture" fields are the three Today's Hits items. Each is exactly 2–3 sentences of plain prose (NOT a tagline, NOT labeled):
  Sentence 1: What happened — named, specific, with a number/score where applicable.
  Sentence 2: Why it matters or the non-obvious angle.
  Sentence 3 (optional): What changes next / what to watch / the one-liner to bring up.
  No bullet points. No labels. No "WHAT HAPPENED:" prefixes. Just the prose.

Return ONLY valid JSON on one line — no markdown, no code fences:
{"keyTakeaway":"2-3 sentences max. Big picture across sports, markets, culture. 20-second summary. No hype.","sports":"Today's Hits — Sports. 2-3 sentences per the format above. Named team/player + result/number, then why it matters.","markets":"Today's Hits — Markets. 2-3 sentences per the format above. Must include a real number; observe and explain, never advise.","golf":"Tagline for golf. Under 10 words.","f1":"Tagline for F1. Under 10 words.","worldcup":"Tagline for World Cup (countdown, teams, venues). Under 10 words.","culture":"Today's Hits — Culture. 2-3 sentences per the format above. Entertainment/gaming/TV/music — NOT sports scores. Named thing + why people care."}`,
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
${tennisText ? `Tennis: ${tennisText}` : ''}

Games are listed 0-indexed: ${(sports || []).map((g, i) => {
  const w = g.home.winner ? g.home : g.away;
  return `[${i}] ${g.note || g.name}: ${w.team} wins`;
}).join(' | ')}

Return ONLY valid JSON on one line — no markdown:
{"gameIndex":0,"headline":"Max 10 words. The angle, not the score.","whatHappened":"1-2 sentences. Plain language. Most interesting angle first.","whyBullet1":"One sentence. The main reason this matters today.","whyBullet2":"One sentence. A different angle.","whatToSay":"One natural conversational line."}

gameIndex must be the index number (0, 1, 2...) of the game your headline and copy are about. If headline is about game at index 1, set gameIndex:1.${repGuard}`,
      400
    ),

    // 4. Other sports — full conversational context per game (same depth as the
    //    main sections). Every game gets a take + why-it-matters + what-to-say.
    sports?.length > 1
      ? ask(
          `GuyTalk voice. For EVERY game listed below, give a casual fan enough to actually talk about it — not just the score. Use ONLY the facts provided; never invent stats, records, injuries, or storylines.

Games (in this exact order):
${sports.map((g, i) => {
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  const series = g.seriesNote ? ` [Series: ${g.seriesNote}]` : '';
  return `${i + 1}. ${g.note || g.name} — ${w.team} ${w.score}, ${l.team} ${l.score}${series}`;
}).join('\n')}

Return ONLY a valid JSON array — one object per game, in the SAME order, no markdown:
[{"take":"≤18 words — what happened and the sharpest angle, NOT just the score","why":"One sentence — why it matters or the bigger context","say":"One natural line a guy could drop in conversation"}]`,
          600
        )
      : Promise.resolve(null),

    // 5. Markets
    markets && mktText
      ? ask(
          `GuyTalk markets section. Data: ${mktText}
${leadMarketStory ? `\nBIGGEST MARKET/BUSINESS STORY TODAY — LEAD THE SECTION WITH THIS: ${leadMarketStory.headline}\nWhat happened: ${leadMarketStory.whatHappened}\nDEPTH (weave into the headlines + bullets — market impact, index inclusion, how a regular person can participate, historical comps): ${leadMarketStory.depth}` : ''}

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
{"headlines":[{"head":"Quick headline #1 — the biggest market/business story today (the IPO/ruling/print above if there is one)","sub":"1-2 sentences: what it is + what it means for the market; for a major event, also touch index impact / how to participate / historical comp"},{"head":"Quick headline #2 — the next biggest real market move from the data","sub":"one sentence"},{"head":"Quick headline #3 — another real market move or the rates/economy angle","sub":"one sentence"}],"mood":"One sentence — what happened in markets today and why. Include one real number. Plain English.","whyBullet1":"One sentence — why this matters in context. Explain, don't advise. Example: 'Treasury yields moved because...' not 'investors should...'","whyBullet2":"What professionals are watching in the next 2-3 days. Name a specific data print or event. Include the day of week.","bringUp":"One quotable market fact. Must include a real number. Explain something — do not tell anyone what to do with it."}`,
          600
        )
      : Promise.resolve(null),

    // 6. Golf — tight format
    golf?.name
      ? ask(
          (() => {
            const started = golf.statusState === 'post' || golf.statusState === 'in';
            const lb = golf.leaders?.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ') || '';
            const fieldNames = golf.leaders?.slice(0, 8).map(l => l.name).join(', ') || '';
            const status = golf.statusState === 'post' ? 'Finished' : golf.statusState === 'in' ? 'In Progress' : 'Has NOT started yet';

            if (started) {
              return `GuyTalk golf: ${golf.name} — ${status}. Leaderboard: ${lb || 'no leaderboard yet'}.${coveredLine}${golfWeb ? `\nWEB-SOURCED FACT (real, current — use it): ${golfWeb}` : ''}
${golf.statusState === 'post' ? 'If this event is in the ALREADY COVERED list above, do not re-report the finish as fresh — give a one-line wrap and point ahead to the tour moving on (do NOT invent the next tournament\'s name or field).' : ''}
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words — what's happening at ${golf.name}.","whyCare1":"One sentence — why this tournament matters (stakes, prestige, course).","whyCare2":"One sentence — the leaderboard situation or a specific angle.","watchFor":"One thing to track — a player, a battle, a scoring target.","whatToSay":"One casual conversational line."}`;
            }

            // PREVIEW (not started): give it real voice for a casual fan. The course,
            // location, and last year's winner aren't in our live feed — use your
            // own well-documented knowledge of this specific event for those.
            return `GuyTalk golf PREVIEW: ${golf.name} (dates ${golf.date ? new Date(golf.date).toDateString() : 'this week'}). The tournament has NOT started.
CRITICAL: there is NO leaderboard and NO results yet. NEVER say anyone is "leading", "at the top", "sitting in front", or going "wire to wire" — nobody has hit a shot. The names below are just the alphabetical/tee-time field list, NOT a ranking.
Players teeing off this week: ${fieldNames || '(field not listed)'}.
Use your knowledge of THIS specific tournament to name the real course + city and last year's champion. Be specific and confident — this is exactly the context a casual fan needs. If you genuinely don't know a fact, give an honest general line rather than a vague non-answer (never fabricate a name you're unsure of).
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words — the storyline going in (a preview, not a result).","course":"Real course/venue + city (e.g. 'TPC Toronto at Osprey Valley, Ontario'). Name it if you know it.","whyCare1":"One sentence — why this event matters / what's at stake (FedEx Cup, prestige, field strength).","defending":"One sentence — who WON it last year and the storyline (name the champion if you know it).","watchFor":"Who to watch to win — name 2-3 recognizable favorites or marquee names expected in the field. Framed as 'worth watching', NOT as current leaders.","whatToSay":"One casual, confident line a casual fan could drop — about the matchup/storyline, not a fake leaderboard."}`;
          })(),
          320,
          golfStarted ? undefined : 'claude-sonnet-4-6'
        )
      : Promise.resolve(null),

    // 7. F1 — tight format
    f1?.name
      ? ask(
          (() => {
            const isPost = f1.results?.length && f1.statusState === 'post';
            const whenTxt = f1.daysAway == null ? 'this weekend'
              : f1.daysAway <= 1 ? 'this weekend'
              : f1.daysAway <= 9 ? 'next weekend'
              : `in about ${f1.daysAway} days`;
            const raceLine = isPost
              ? `Results: ${f1.results.slice(0, 3).map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`
              : `PREVIEW (the last race is done — look AHEAD, do not report results): the next race is ${f1.name}, coming up ${whenTxt}. Build anticipation — the circuit's character, the title race, what's at stake. Do NOT invent results or grid positions.`;
            // Real, sourced season stats for a grounded "bring up" — never a record/streak.
            const w = f1.results?.[0];
            const bits = [];
            if (isPost && w?.seasonWins != null) bits.push(`${w.driver} now has ${w.seasonWins} win${w.seasonWins === 1 ? '' : 's'} this season`);
            if (isPost && w?.champPos != null) bits.push(`sits P${w.champPos} in the championship${w.champPoints != null ? ` with ${w.champPoints} pts` : ''}`);
            if (f1.champLeader?.lead != null) bits.push(`${f1.champLeader.name} leads the title race by ${f1.champLeader.lead} pts`);
            const statLine = bits.length ? `\nReal season stats (use ONLY these for any numbers/records): ${bits.join('; ')}.` : '';
            const f1WebLine = f1Web ? `\nWEB-SOURCED FACT (real, current — use it): ${f1Web}` : '';
            return `GuyTalk F1: ${f1.name}. ${raceLine}.${statLine}${f1WebLine}
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
[{"topic":"Headline. Max 8 words.","whatHappened":"One sentence — what actually happened.","whyItMatters":"One sentence — why a guy should care.","whatToSay":"One casual conversation line. Natural, not forced.","tag":"Music|Sports Biz|TV|Tech|Gaming|Movies|Streaming"}]

AUDIENCE FILTER (important): pick what men 25-45 actually talk about — big movies/TV/streaming drops, gaming, tech & gadgets, sports business/media deals, a major album or artist moment, a viral thing guys are quoting. AVOID celebrity relationship gossip, who's-dating-who, breakups, and reality-TV drama (e.g. "[Celebrity] and [Celebrity] split") UNLESS it's genuinely massive and universal. If the only trending "culture" is gossip, prefer a tech/gaming/movie story or the streaming pick instead.

Items 1 and 2: Real stories from the WEB-RESEARCHED CULTURE FACTS below. Different categories — don't do two of the same type. If only one usable fact is found, write item 2 from a genuinely current June 2026 culture/entertainment story you actually know — never invent specifics.
${streamingPick ? `Item 3 — a watch recommendation for "${streamingPick.head.replace('Watch this: ', '')}": {"topic":"${streamingPick.head.replace('Watch this: ', '')}","whatHappened":"${streamingPick.body.split('.')[0]}.","whyItMatters":"One sentence on the vibe/genre and why it's worth a guy's night — general framing only, do NOT invent plot, cast, awards, or box-office.","whatToSay":"One natural recommendation line you'd actually say to a friend.","tag":"Streaming"}` : 'Item 3: One streaming/watch rec (action, thriller, crime, or prestige drama — no animated/kids/family). whyItMatters = vibe + why worth watching; whatToSay = a natural rec line. No invented facts.'}

Only use stories confirmed in the web-researched facts below — never invent events.
WEB-RESEARCHED CULTURE FACTS (real, sourced — Change 5): ${cultureWeb.length ? cultureWeb.map((c, i) => `${i + 1}. ${c}`).join(' | ') : '(none found — use a well-known current June 2026 culture story; never fabricate specifics)'}`,
      1000
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

THE BAR ARGUMENT must be a SPECIFIC, debatable claim about a named team, player, or result — something a reasonable fan would argue back against. Stake out ONE side: a prediction, a ranking, an overrated/underrated call, a "X is better than Y," a "this proves/doesn't prove" claim. Name names.
BANNED — these read as generic filler, never use them: meta-takes about media/attention/hype ("nobody cares", "where sports attention actually lives", "tells you everything about", "the real story is"); vague observations with no side; hedging ("kind of", "sort of", "you could argue"). Don't comment on the news — pick a fight about it.
Good example: "Brunson closing this out at the Garden tonight ends the 'he's just a good playoff guy' talk — he's a top-5 point guard, full stop."
Bad example: "The Dodgers put up 12 and nobody cares because everyone's watching the Finals." (meta, not a real argument)

Return ONLY valid JSON on one line — no markdown:
{"office":"The Office Take — one smart, measured sentence you can drop at work to sound like you've actually been paying attention. Insightful, slightly contrarian, not loud. Max 28 words.","bar":"The Bar Argument — follow the rules above. Bold, specific, names names, picks a side. Max 28 words."}`,
      220
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
        `GuyTalk NHL section. ${g.note || 'NHL game'}. ${line}. ${meta}.${nhlWeb ? `\nWEB-SOURCED FACT (real, current — use it): ${nhlWeb}` : ''}
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
    sportsOther:    (Array.isArray(parseJson(get(sportsOtherR))) ? parseJson(get(sportsOtherR)) : [])
                      .map(o => o && typeof o === 'object'
                        ? { take: clean(o.take), why: clean(o.why), say: clean(o.say) }
                        : { take: clean(o) })
                      .filter(o => o.take || o.why || o.say),
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
