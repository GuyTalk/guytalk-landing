'use strict';

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

const BRAND_VOICE = `You write for GuyTalk — a daily brief for men 25–45 covering sports, markets, and culture.
Today's date: ${TODAY}.

VOICE: Think Morning Brew meets a sharp group chat. Casual, confident, informed. You're the guy at the table who watched the game, checked the tape, and can hold a conversation with anyone from a banker to a bartender. Dry wit is always welcome — forced humor is cringe. Write like you know things, not like you're trying to prove it.

STYLE:
- Short sentences. Vary the rhythm: short punch, longer follow-through, short punch.
- Parenthetical asides land when they're specific: "Knicks (who haven't been here since 1999, by the way) arrived in San Antonio last night."
- Em-dashes add weight or momentum — use them deliberately.
- Drop context naturally: "The 10-year yield hit 4.6% — mortgage territory" not "The 10-year yield, which affects mortgage rates, hit 4.6%."
- Lead with the most interesting angle, not the most obvious one. The scoreline is the least interesting thing.
- End sections with a forward hook — make the reader want tomorrow's issue.

WHAT THE READER WANTS:
- Sports: they watched the game. Give them the angle they didn't quite articulate to themselves.
- Markets: they have a 401(k) and watch SPY. Tell them the why, not just the what. Make it feel useful.
- Culture: something they can drop in conversation tonight that makes them sound plugged in.

Sports coverage: NBA, MLB, NHL, PGA Tour, Formula 1, UFC, FIFA World Cup, Grand Slam tennis — whatever's actually happening right now. Write for guys who know who Brunson and Verstappen are.

HALLUCINATION RULES (non-negotiable — violations create misinformation):
- ONLY cite data explicitly given in the prompt. Never invent player names, stats, or scores.
- NEVER draw on historical rosters — "San Antonio Spurs" in 2026 means Wembanyama's team, not Tim Duncan's.
- Series records ONLY if given in [Series: ...] brackets. Never infer or guess them.
- F1: only name drivers explicitly listed in the data. No invented lap times, grid positions, or DNF reasons.
- World Cup: only describe matches shown in the data. The 2026 World Cup opens June 11.
- Timing: today is ${TODAY}. Past events are past. Future events are future. Never describe scheduled events as if they happened.
- If only team-level data is available, describe the team result. Do not name individual players or invent stats.

EVERY SECTION MUST ANSWER TWO QUESTIONS:
- Why does this matter?
- What can the reader say about it tonight?

If the copy doesn't pass both tests, rewrite it until it does.

BANNED WORDS AND PHRASES (never use these — they're AI tells):
- "pivotal", "groundbreaking", "game-changer", "seismic", "monumental", "historic" (unless genuinely historic)
- "at the end of the day", "it's worth noting", "to be clear", "make no mistake"
- "delve", "leverage" (as a verb), "nuanced", "ecosystem" (for companies), "narrative"
- "buckle up", "the stage is set", "in today's fast-paced world", "as the dust settles"
- "it remains to be seen", "fans are paying attention", "this could be interesting to watch", "keep an eye on"
- "momentum" as a standalone explanation (e.g., "this gives them momentum" — banned. Name what actually changes.)
- "worth watching", "it's unclear", "time will tell", "only time will tell"
- "Tonight's line:", "Drop this tonight:", "Drop tonight:" — never use these labels. Weave the conversational line into the copy naturally.
- "Clear your [day/night/evening]" as a Sharp Take closer — RATIONED. Only for genuine Game 7, championship final, or once-in-a-season event. On all other days, end with a specific forward observation.
- Never start a sentence with "Ultimately," "Interestingly," "Notably," or "It's important to note"
- Never use "speaks to" (as in "this speaks to the larger issue")
- No passive voice: "was won by" → "won it"
- No weak openers: "There is...", "It is...", "This was..."
- Never summarize something the reader already knows. Get to the angle.
- Never sit on the fence. If the answer is "we'll see," rewrite until you have an actual opinion.
- Sports: the scoreline is the least interesting thing. Start with what it means.
- Markets: don't say what moved. Say why it moved and what it signals for next week.
- Culture: open with the one observation that makes the story worth knowing — not a recap of the event itself.

GOOD OPENERS (rotate these, or invent similar):
- Start mid-action: "Wemby finished with 28." not "In a game that saw..."
- Challenge assumptions: "Here's what everyone is getting wrong about this."
- Give the number first: "16-2. That's how badly Milwaukee hit."
- Name the feeling: "Every Knicks fan over 30 just exhaled."
- Time reference: "First time since 1999."

FORMAT (non-negotiable — violations break the layout):
- Plain prose ONLY. Zero markdown. No # headers, no ** bold, no * italic, no - bullets, no --- dividers.
- Never open with a section label like "Sports:" or "Markets:".
- Write complete sentences. No fragments used as style.`;

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
async function generateCopy({ sports, markets, golf, trending, f1, worldCup, upcoming, boxScores, prev3 }) {
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

  // ── Repetition guard — do not repeat angles/closers from last 3 briefs ────
  const repGuard = (prev3 && prev3.length) ? `
REPETITION GUARD — the last ${prev3.length} brief(s) used these angles and closers. Do NOT repeat any of them:
${prev3.map((b, i) => `Issue from ${i + 1} day(s) ago (${b.slug}):
  Sharp Take closer: "${b.sharpTakeCloser}"
  Sports thesis angle: "${b.sportsThesis}"
  Bar Argument: "${b.barArgument}"
  Office Take: "${b.officeTake}"
  Markets Bring Up format: "${b.marketsBringUp}"
`).join('')}
If you find yourself writing something structurally identical to any of the above — same technique, same closer, same comparison style — take a completely different angle instead. Variety is a requirement.` : '';

  // ── Markets bringUp format tracker — rotate through 4 techniques ──────────
  // (1) comparison to something intuitive — e.g. "more than Portugal's GDP"
  // (2) personal implication — e.g. "if you applied for a mortgage this week..."
  // (3) historical context — e.g. "first time since 2008 that..."
  // (4) contradiction of common belief — e.g. "everyone thinks X, the actual number is Y"
  const lastBringUpFormats = (prev3 || []).map(b => b.marketsBringUpFormat || '').filter(Boolean);
  const allFormats = ['comparison', 'personal_implication', 'historical_context', 'contradiction'];
  const usedFormats = lastBringUpFormats.slice(0, 3);
  const preferredFormat = allFormats.find(f => !usedFormats.includes(f)) || allFormats[0];
  const formatInstructions = {
    comparison:           'Use a COMPARISON: translate the number into something intuitive — another event, a country\'s GDP, a familiar milestone. Make the abstract concrete.',
    personal_implication: 'Use PERSONAL IMPLICATION: connect the number directly to something in the reader\'s life — their mortgage, their 401(k), their rent, their job. One sentence, personal stakes.',
    historical_context:   'Use HISTORICAL CONTEXT: give the number a timeline — "first time since X," "hasn\'t happened since Y," "last time this occurred was Z." Makes the number feel significant.',
    contradiction:        'Use CONTRADICTION: state what most people assume, then give the actual number that disproves it. Format: "Everyone thinks [X]. The actual number is [Y]."',
  };
  const bringUpFormatInstruction = formatInstructions[preferredFormat];

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
    officeTakeR,
    extraGamesR,
    f1DetailR,
  ] = await Promise.allSettled([

    // 1. Brief headline
    ask(
      `Write the headline for today's GuyTalk issue. Max 12 words. Plain text only — no quotes, no colons, no markdown.
Style: three punchy fragments separated by periods. Name real people and events. Never vague — "Spurs steal Game 7" beats "Big win last night."
Good examples: "Wembanyama's Finals debut tomorrow. Antonelli leads Monaco. World Cup is 9 days out." / "Spurs steal Game 7. Henley leads at Schwab. Markets tread water."
Context: ${ctx}`,
      80
    ),

    // 2. Sports opening paragraph — covers NBA/F1/World Cup/Golf/all sports
    mainGame
      ? ask(
          `Write 2–3 punchy sentences opening the Sports section. Plain prose only — no markdown, no headers, no labels.
Goal: give the reader who watched the game the angle they felt but didn't quite articulate. Start with the result, but get to the meaning fast — the scoreline is the least interesting thing. End with what's coming up and why it matters.
REAL GAME DATA:
${gamesText}
${mainGameLeaders ? `CONFIRMED player stats (ONLY use these — never invent others): ${mainGameLeaders}` : 'No individual stats available — describe team result only. Do not name any individual players or invent any stats.'}
${golf?.leaders?.[0] ? `Golf: ${golf.leaders[0].name} ${golf.statusState === 'post' ? 'won' : 'leads'} ${golf.name} at ${golf.leaders[0].score}.` : ''}
${f1Text ? `${f1Text}` : ''}
${upcomingText ? upcomingText : ''}
CRITICAL: Only name players whose stats appear in the CONFIRMED line above. Never invent stats.
TONE: Give a concrete opinion. Never write "it remains to be seen" or "fans are watching." If the game revealed something about a team, say exactly what it revealed. Every sentence should either inform or give the reader something to say.
WATCH-FOR CLOSE: End with one specific thing to watch in the next game or upcoming event that confirms or disproves the thesis you just stated. Name a specific player action, coaching decision, or matchup — not "watch how the team responds." Something falsifiable and observable. Example: "Watch whether Thibodeau switches to zone in the first quarter — he's never done it in a playoff series and if he does, it signals he's genuinely worried about Wembanyama's pick-and-roll angles."${repGuard ? `\n${repGuard}` : ''}`,
          420
        )
      : ask(
          `Write 2–3 punchy sentences for the Sports section. No games last night — write a preview/context piece instead. Plain prose only, no markdown.
Cover the 2–3 most compelling storylines from this data — something the reader can actually say at work today, not a schedule read-out:
${f1Text ? `F1: ${f1Text}` : ''}
${upcomingText ? `NBA: ${upcomingText}` : ''}
World Cup context: ${wcText}
${golf?.leaders?.[0] ? `Golf: ${golf.leaders[0].name} ${golf.statusState === 'post' ? 'won' : 'leads'} ${golf.name} at ${golf.leaders[0].score}.` : ''}
Trending: ${trendText || 'No data.'}
Name real athletes. Be specific about what's upcoming and when. No invented results or future events described as if they happened. No fence-sitting — give opinions.
End with one specific thing to watch for in the first game or event that proves whether the storyline you described is real.${repGuard ? `\n${repGuard}` : ''}`,
          420
        ),

    // 3. Markets opening paragraph
    markets && mktText
      ? ask(
          `Write 2 punchy sentences opening the Markets section. Plain prose only — no markdown, no headers.
Data: ${mktText}
Lead with the most interesting story, not necessarily the biggest number. Find the WHY — what's driving it and what it means next week. A guy with a 401(k) should finish reading this and feel informed. Sharp and direct: "SPY slipped on Fed caution before Thursday's CPI" not "Markets were lower." Name specific stocks or macro events. Barron's voice, not Bloomberg vague.`,
          300
        )
      : Promise.resolve(null),

    // 4. Golf one-liner or pre-tournament teaser
    golf?.leaders?.[0] && golf?.statusState !== 'pre'
      ? ask(
          (() => {
            const lb = golf.leaders.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ');
            if (golf.statusState === 'post') {
              return `GuyTalk voice. ${golf.name} is finished.
Final leaderboard: ${lb}.
Write exactly one sentence (max 20 words). Past tense.
PLAYER RULE: If the winner is not a household name, do NOT write about their career or biography. Instead write about the winning score relative to par, the tournament's prestige, or the FedEx Cup impact. You always have enough data to write one good sentence about a completed tournament.
Plain text only. No markdown. No refusals — a leaderboard is always enough to write one sentence.`;
            }
            return `GuyTalk voice. ${golf.name} in progress.
Status: ${golf.status || 'In Progress'}. Current leaderboard: ${lb}.
Write exactly one sentence (max 20 words). Present tense.
ACCESSIBILITY RULE: Write the sentence so someone who doesn't play golf can understand it immediately. Translate scoring terms if needed ("leads at -8" → "eight under par — the best score in the field"). The fact should land for a non-golfer first, with golfer detail as a bonus.
PLAYER RULE: If the leader is not a household name, write about the tournament situation and course, not the player's career.
Plain text only. No markdown. No refusals.`;
          })(),
          80
        )
      : golf?.name
      ? ask(
          `GuyTalk voice. One punchy sentence (max 20 words) about ${golf.name} teeing off this week. Why does a golf fan mark their calendar? Mention the course, the defending champion, or FedEx Cup stakes if you know them. If not, write about the tournament's reputation or prestige. Plain text — no markdown. No refusals.`,
          80
        )
      : Promise.resolve(null),

    // 5. Sharp Take (closing) — JSON with prose + key bullets
    ask(
      `Write the "Sharp Take" for today's GuyTalk brief. This is the closer — the part the reader forwards to a friend.
Return ONLY valid JSON, no markdown, no code fences:
{
  "p1": "3-4 sentences. Pick the ONE biggest story and give the non-obvious take — a point of view, not a score recap. The reader should think 'exactly' when they read it. Be specific to today's data. A parenthetical aside is fine if it lands.",
  "p2": "2-3 sentences. Connect today's story to something the reader can actually use or watch for. End with one punchy, specific call-to-action — the kind of line that makes someone look forward to tomorrow: 'Clear your Saturday. Monaco doesn't get better on replay.' Not generic advice.",
  "bullets": ["Sports takeaway in 12 words or less — specific", "Markets/money takeaway in 12 words or less — specific", "One to-watch item in 12 words or less — builds anticipation"]
}

CRITICAL — SCHEDULED EVENTS: Any game or event labeled "today," "tonight," or "tomorrow" in the context has NOT happened yet. Write about it as a preview, not a result. Never invent scores, winners, or outcomes for events that haven't been played. Only write results for completed past events (yesterday, last night, this weekend's completed rounds).
CLOSER RULE: "Clear your [day/night/evening]" is RATIONED — only use it if tonight or tomorrow holds a Game 7, championship final, World Cup knockout match, or a genuinely once-in-a-season moment. On all other days, end p2 with a specific forward observation — something the reader can look for, not just a time block to protect.
Rules: Do not use the word 'ultimately.' Pick ONE story for p1, don't recap everything. Make bullets feel like items you'd screenshot. No filler.${repGuard ? `\n${repGuard}` : ''}
Context: ${ctx}${trendText ? `\nTrending: ${trendText}` : ''}`,
      700
    ),

    // 6. Sports detail (JSON) — only when we have a real game
    mainGame
      ? ask(
          (() => {
            const gameOneLiner = gamesText.split('\n')[0];
            const statsLine = mainGameLeaders
              ? `Player stats (ONLY use these — never invent others): ${mainGameLeaders}`
              : 'No player stats available. Describe team result only — do not name individual players or invent stats.';
            const keyNumInstruction = mainGameLeaders
              ? 'The defining stat from the stats above — the number that explains the win or loss.'
              : 'A team-level observation about the game — no invented player stats.';
            const seriesInstruction = mainGame.seriesNote
              ? `Series context: ${mainGame.seriesNote}. What this result means and what is at stake for the next game.`
              : 'What this result means for the team — standings, trajectory, what changes. If this is a regular season game, do NOT invent playoff series context.';
            return `GuyTalk voice. Game: ${gameOneLiner}
${statsLine}

Return ONLY valid JSON, no markdown, no code fences. Five fields exactly:

{
  "keyNumber": "${keyNumInstruction}",
  "seriesSituation": "${seriesInstruction}",
  "howToWatch": "When and where to watch the next game — Day, Time ET, Network. If no next game is scheduled, skip or say 'check ESPN.'",
  "groupChatAngle": "One sharp, non-obvious observation the kind of thing someone screenshots and sends. Not a recap of the final score.",
  "barArgument": "One assertion (NOT a question) a guy would defend at a bar for 10 minutes. Must end with a period. Example: 'Pittsburgh is the best story in baseball right now and nobody is paying attention.' State the more interesting side. Never end with a question mark."
}`;
          })(),
          500
        )
      : Promise.resolve(null),

    // 7. Markets detail (JSON)
    markets && mktText
      ? ask(
          `GuyTalk voice. Market data today: ${mktText}
Return ONLY valid JSON, no markdown, no code fences:
{
  "headline": "One punchy market story from today. Name a stock or macro event — not just SPY. Max 10 words.",
  "secondPara": "One forward-looking sentence — name a specific upcoming catalyst (data print, Fed meeting, earnings). Include the day of the week.",
  "stockSpotlight": "Pick the most interesting individual stock from today's data. Name it, give the move%, and one sharp sentence on what's driving it — is this a trend or a blip? Be direct.",
  "watchNextWeek": "The one macro event or print that traders are watching. Name the day and exactly what the number could mean for the market.",
  "bringUp": "One specific, quotable market fact using a real number from today. ${bringUpFormatInstruction} One sentence. Slightly surprising — if someone who reads financial news already knows this, find a different angle.",
  "bringUpFormat": "${preferredFormat}"
}${repGuard ? `\n${repGuard}` : ''}`,
          500
        )
      : Promise.resolve(null),

    // 8. Golf detail (JSON)
    golf?.leaders?.[0] && golf?.statusState !== 'pre'
      ? ask(
          (() => {
            const lb = golf.leaders.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ');
            if (golf.statusState === 'post') {
              return `GuyTalk voice. FINAL — ${golf.name} complete.
Final leaderboard: ${lb}.
Return ONLY valid JSON, no markdown, no code fences:
{
  "whyItMatters": "What this tournament result means — FedEx Cup points, prestige, major implications. One concrete sentence. If the winner is not a household name, write about the tournament's significance, not their biography.",
  "recap": "How the final score looks relative to par. Was the winning margin comfortable or tight? Write from the numbers — do not invent narrative you weren't given.",
  "bringUp": "Write TWO connected sentences: FIRST a fact accessible to someone who has never played golf (a story about the venue's history, a streak being broken, a context comparison — something anyone can picture). THEN one sentence that rewards actual golfers with a specific technical detail. The non-golfer sentence comes first.",
  "groupChatAngle": "One observation about the leaderboard situation or a score relative to par. Accessible to non-golfers — if it requires knowing what 'FedEx Cup points' are, add a brief explanation."
}`;
            }
            return `GuyTalk voice. ${golf.name} in progress. Status: ${golf.status || 'In Progress'}.
Leaderboard: ${lb}.
Return ONLY valid JSON, no markdown, no code fences:
{
  "whyItMatters": "Field quality, FedEx Cup points, or historic venue — one concrete sentence on why this tournament matters this week. Use what you know about this tournament, not about the current leader's career.",
  "tvSchedule": "Broadcast: 'Round X: TIME ET, Golf Channel/Peacock. Final round: TIME ET, NBC/CBS.'",
  "bringUp": "Write TWO connected sentences: FIRST a fact accessible to someone who doesn't play golf — a story about the venue, a historical detail, a streak or record at stake. Then one sentence of golfer-specific detail (course difficulty, scoring average, what the winning score usually looks like here). Non-golfer sentence first.",
  "groupChatAngle": "One observation about the leaderboard or the score. Accessible to non-golfers — translate any golf-specific terms with a brief parenthetical if needed."
}`;
          })(),
          400
        )
      : golf?.name
      ? ask(
          `GuyTalk voice. ${golf.name} tees off this week — tournament hasn't started yet.
Return ONLY valid JSON, no markdown, no code fences:
{
  "whyItMatters": "Why this tournament is worth watching — FedEx Cup stakes, iconic course, strong field, or defending champion. One concrete sentence using what you know about this tournament.",
  "bringUp": "One inside-knowledge fact about the course design, the tournament's history, or a notable past champion. The kind of detail that sounds good on the first tee.",
  "groupChatAngle": "One opinionated line about the week's storyline — who to watch, why the course matters, or what the leaderboard usually looks like here. Not just 'it should be a good tournament.'"
}`,
          300
        )
      : Promise.resolve(null),

    // 9. Culture (JSON array)
    ask(
      `GuyTalk culture section. Write 3 items for men 25–45. Today is ${TODAY}.

CRITICAL RULE: Each object in the array MUST have its "head", "source", and "body" all about the SAME story. Do NOT split a story across objects. Write each object completely before moving to the next.

Return ONLY a valid JSON array, no markdown, no code fences, exactly 3 objects. Write them in this order — complete each one fully before starting the next:

Each object has these fields: "head", "source", "body", "tag".
- "tag" must be ONE of: Celebrity, Music, Sports Biz, Streaming, TV, Tech, Culture — pick the best fit.

ITEM 1: Pick the first story from the trending data. Write "head", "source", "tag", then "body":
BODY STRUCTURE FOR ITEMS 1 AND 2:
- Open with the one observation that makes this story worth knowing — the implication, the non-obvious read, or the business/cultural shift underneath the surface event. NOT a recap of what happened.
- Then give just enough context (1-2 sentences) for the observation to land — who was involved, what actually happened, what the stakes are.
- End with one specific, conversation-ready sentence that's woven naturally into the copy — NOT labeled "Tonight's line:" or "Drop this:". It should read like a natural conclusion, not an announced appendix.
- Total: 3-4 sentences. If it could have run on any news site as a recap, rewrite it.

ITEM 2: Pick a second story (different territory from item 1 — if item 1 is sports biz, item 2 should be music, tech, TV, or celebrity). Same structure as item 1.

ITEM 3 (streaming/theater pick) — STRICT RULES:
- "head" must be "Watch this: [exact title]"
- "source" must be the streaming service or theater
- "tag" must be "Streaming"
- "body" must be about THAT SAME title — two sentences max: what it is and the ONE thing that makes it worth the time
- BANNED: animated, kids, family, rom-com, musical, Disney/Pixar/DreamWorks titles
- ALLOWED: action, thriller, heist, sports doc, war, crime, sci-fi, prestige drama
- Good examples: Sinners, The Accountant 2, Zero Day, The Brutalist, The Day of the Jackal, Black Bag

Items 1–2 rules:
- Only use stories confirmed in the Trending data below — never invent trades, hirings, or contracts
- Each item should be different territory (don't do two sports business stories)
Trending: ${trendText || 'No trending data — use your best knowledge of June 2026 current events.'}`,
      900
    ),

    // 10. Numbers context (JSON array)
    ask(
      `GuyTalk voice. Return ONLY a valid JSON array, no markdown, no code fences, exactly 3 objects:
[{"context": "2 sentences on what this number means and why it matters. Specific — not 'this was a big game.' Only use data given."}]

Numbers (write context for each, in order):
${mainGame ? (() => { const w = mainGame.home.winner ? mainGame.home : mainGame.away; const l = mainGame.home.winner ? mainGame.away : mainGame.home; return `${w.score}–${l.score}: ${w.team} beat ${l.team} (${mainGame.note || mainGame.shortName})`; })() : ''}
${markets?.SPY?.dayChangePct !== undefined ? `${markets.SPY.dayChangePct >= 0 ? '+' : ''}${markets.SPY.dayChangePct.toFixed(1)}%: SPY daily move` : ''}
${golf?.leaders?.[0] ? `${golf.leaders[0].score}: ${golf.leaders[0].name} ${golf.statusState === 'post' ? 'wins' : 'leads'} ${golf.name}` : upcoming?.length ? `Game 1: ${upcoming[0].note || upcoming[0].shortName} tips off ${upcoming[0].daysAhead === 0 ? 'today' : upcoming[0].daysAhead === 1 ? 'tomorrow' : 'in 2 days'}` : ''}
${f1?.results?.[0] ? `${f1.results[0].driver} wins ${f1.name}` : ''}`,
      350
    ),

    // 11. Office Take — mild-surprise test required
    ask(
      `Complete this sentence using today's data. Output ONLY the completed sentence — nothing before it, nothing after it.

"The one non-sports thing worth knowing today: ___."

Fill the blank with a specific fact from markets or culture. 15 words maximum in the blank.

MILD SURPRISE TEST: Before finalizing, ask yourself — would someone who follows the news every day already know this exact fact phrased this way? If yes, find a different angle. The goal is mild surprise: a fact the reader hasn't quite articulated, or a familiar thing stated in a way that makes them go "huh, I hadn't thought of it like that." Not shocking — just slightly sharper than what's obvious.

${mktText ? `Markets today: ${mktText.slice(0, 120)}.` : ''}
${trendText ? `Top culture stories: ${trendText.split('\n').slice(0, 2).join('. ')}.` : ''}${repGuard ? `\n${repGuard}` : ''}`,
      80
    ),

    // 12. Additional game notes (plain text, separated by |||)
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

    // 13. F1 detail (JSON) — post-race results or pre-race preview
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
    sharpTake:        parseJson(get(sharpTakeR)),
    sportsDetail:     parseJson(get(sportsDetailR)),
    marketsDetail:    parseJson(get(marketsDetailR)),
    golfDetail:       parseJson(get(golfDetailR)),
    culture:          parseJson(get(cultureR)),
    numbersContext:   parseJson(get(numbersR)),
    marketsBringUpFormat: (() => {
      const md = parseJson(get(marketsDetailR));
      return md?.bringUpFormat || preferredFormat;
    })(),
    officeTake:       (() => {
      const raw = clean(get(officeTakeR));
      if (!raw) return null;
      // Take only the first sentence — Haiku often ignores word-count constraints
      const first = raw.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/)[0];
      return (first && first.length > 10) ? first : raw.slice(0, 180);
    })(),
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
