'use strict';

const { addWarning } = require('./warnings');

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

const BRAND_VOICE = `You write for GuyTalk — a daily brief for men 25–45. Today: ${TODAY}.

VOICE: Sharp, casual, confident. A smart friend who watched the game, checked the markets, and can hold any conversation. Not a reporter. Not an advisor. The guy at the table who just knows things.

WRITING RULES:
- Short sentences. Vary rhythm: short punch, longer follow-through, short punch.
- Name specific people, teams, numbers. Vague = useless.
- Lead with the most interesting angle. Scores are the least interesting thing.
STRUCTURE — each body item is built from these five beats, but VARY the emphasis and length to fit the story. Don't make every item the same shape: a blowout or routine result reads short and punchy (tight whatHappened, a lean Read); a dramatic finish, an upset, or a big story earns a longer, harder-hitting Read. Some stories lead with the stakes, some with the number, some with the take. Never mechanical, never identical day to day. All five fields must still be filled:
WHAT HAPPENED: One sentence. Specific. Named person or team. Score, stat, or number if applicable. Never vague.
WHY IT MATTERS: One to two sentences. Non-obvious stakes — what changes, what it signals, why a normal person should care. Never "this matters because it's significant."
THE GUYTALK READ: 3–5 sentences. The strongest, sharpest take — what it really means, who benefits, who looks bad, the broader signal, what smart people are saying. Opinionated but grounded in fact. Markets = observational only (never advice).
CONVERSATION AMMO: A JSON array of 3–5 short fact strings. Specific, sourced facts people actually ask about: age, college, contract, earnings, purse/payout, first win, streak, record, ranking, the key play, the quote, the drama. Markets: valuation, deal size, market cap vs. a comp, the historical parallel. Facts only — no takes, no opinions. Minimum 3 items required.
WHAT TO SAY: One natural sentence a reader could say in a group chat, at work, at a bar. Has a point of view.

When a prompt asks for JSON, put each beat in its matching field (whatHappened / whyBullet1 + whyBullet2 / theRead / ammo:[] / whatToSay). Do NOT write the beat labels inside any value. Never add these labels to a headline, tagline, or any one-line field.
- Casual language: "The Knicks got exposed" beats "New York underperformed."
- Clarity over sounding clever.

FORMAT: Plain prose ONLY — no markdown, no bold, no bullets, no headers, no dividers. Complete sentences.

HALLUCINATION RULES (non-negotiable):
- ONLY use data explicitly given in the prompt. Never invent player names, stats, or scores.
- "San Antonio Spurs" in 2026 means Wembanyama's team, not Tim Duncan's.
- Series records ONLY if given in [Series: ...] brackets.
- F1: only name drivers listed in the data.
- If only team-level data is available, describe the team — do not name individual players.

FACTUAL ACCURACY — "FIRST" CLAIMS (critical — verify before writing):
Never call something someone's "first" championship, major, or title unless you are certain they have never won it before. Known recent history:
- Wyndham Clark: won the 2023 U.S. Open at LACC. Any subsequent U.S. Open win is his SECOND or later.
- Carolina Hurricanes: won the Stanley Cup in 2006. Any future Cup win is their second or later.
- Vegas Golden Knights: won the Stanley Cup in 2023. Any future Cup win is their second or later.
- When uncertain whether a "first" claim is accurate, write "wins the [event]" without the word "first" — do not fabricate firsts.

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

function cleanAmmo(text) {
  if (!text) return '';
  return String(text).replace(/\*\*(.*?)\*\*/gs, '$1').replace(/\*(.*?)\*/gs, '$1').trim();
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

async function generateCopy({ sports, markets, golf, tennis, trending, topStories, sectionStories, dynamicSports, f1, worldCup, nhl, upcoming, boxScores, prev3, streamingPick, factPack, issueNum = 0 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('your_') || apiKey.includes('_here')) return null;

  // Rotate the LEAD's opening treatment by issue number so the brief doesn't open
  // in the identical shape every day. The five beats still fill the same JSON
  // fields (rendering is unchanged) — only the WRITING approach of whatHappened/
  // theRead varies. Deterministic cycle.
  const LEAD_ANGLES = [
    'OPENING TREATMENT: Lead whatHappened with the single most surprising number or stat, stated flat, then explain what it means.',
    'OPENING TREATMENT: Open theRead with a short, confident hot take — a claim someone could argue with at a bar — then back it with the facts.',
    'OPENING TREATMENT: Drop the reader straight into the decisive moment (the shot, the trade, the print), present-tense energy, then widen out to why it matters.',
    'OPENING TREATMENT: Lead with the stakes — what was actually on the line — before you give the result.',
    'OPENING TREATMENT: Open with the sharp question this story answers, then answer it in the next breath. No throat-clearing.',
  ];
  const leadAngle = LEAD_ANGLES[Math.abs(issueNum) % LEAD_ANGLES.length];

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
    const block = res.content?.find(b => b.type === 'text') || res.content?.[0];
    // A max_tokens stop truncates the JSON mid-string — surface it so askJson retries.
    const text = (block?.text || '').trim();
    if (res.stop_reason === 'max_tokens') {
      console.log(`   ⚠  copy: hit max_tokens (${maxTokens}) — output may be truncated`);
    }
    return text;
  }

  // Count how many fields of a parsed JSON object are actually usable (non-null,
  // non-empty). For an array, the number of items.
  function usableFieldCount(parsed) {
    if (!parsed) return 0;
    if (Array.isArray(parsed)) return parsed.length;
    return Object.values(parsed).filter((v) => v != null && v !== '').length;
  }

  // For prompts that MUST return parseable JSON (glance, the take, etc.). Retries
  // once when the parse yields fewer than `minFields` usable fields, and warns
  // instead of silently yielding null — the downstream sections fall back to
  // canned copy otherwise, which is how "Today at a Glance" went 0/5 with no
  // signal. On final failure it returns the last raw response so the template's
  // own fallbacks fill any missing fields (never crashes).
  // `section`, when set, records retries/failures in GENERATION_WARNINGS so the
  // morning run/approval sees them. `delayMs` waits before the retry (the section
  // calls use 2s to ride out a transient API blip).
  async function askJson(label, prompt, maxTokens = 800, { model, minFields = 1, delayMs = 0, section } = {}) {
    let lastRaw = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let threw = false;
      let raw;
      try { raw = model ? await ask(prompt, maxTokens, model) : await ask(prompt, maxTokens); }
      catch (e) {
        threw = true;
        console.warn(`   ⚠  ${label}: API error (attempt ${attempt}/2) — ${e.message}`);
        if (section) addWarning(section, attempt < 2 ? 'retry' : 'failed', e.message);
      }
      if (!threw) {
        lastRaw = raw;
        const filled = usableFieldCount(parseJson(raw));
        if (filled >= minFields) return raw;
        console.warn(`   ⚠  ${label}: only ${filled} usable field(s), need ${minFields} (attempt ${attempt}/2)` +
          (attempt < 2 ? ' — retrying' : ' — using template fallbacks'));
        if (section) addWarning(section, attempt < 2 ? 'retry' : 'failed', `${filled}/${minFields} fields`);
      }
      if (attempt < 2 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
    return lastRaw; // partial/null → downstream parseJson() + template fallbacks
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
        p.line ? `${p.name} (${p.team}): ${p.line}` : `${p.name} (${p.team}): ${p.pts}pts${p.reb ? ` ${p.reb}reb` : ''}${p.ast ? ` ${p.ast}ast` : ''}`
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
  const leadMarketStory = (() => {
    const s = stories.find((s) => s.depth && /Market|Business/i.test(s.category || '')) || null;
    if (!s || !Array.isArray(factPack?.markets?.ammo) || !factPack.markets.ammo.length) return s;
    return { ...s, depth: [s.depth, `AMMO FACTS: ${factPack.markets.ammo.join(' | ')}`].filter(Boolean).join(' | ') };
  })();
  const SPORTS_CATS = new Set(['Sports','NBA','NHL','MLB','NFL','UFC','F1','Golf','World Cup','Soccer']);
  const leadIsNonSports = leadStory && !SPORTS_CATS.has(leadStory.category || '');
  const leadContextLine = leadIsNonSports
    ? `\n⚠ TODAY'S LEAD IS NON-SPORTS: [${leadStory.category}] "${leadStory.headline}" — this is the single biggest story today and should be the first thing discussed in the brief, before any sports.\n`
    : '';
  const topStoriesText = stories.length
    ? leadContextLine + 'BIGGEST STORIES TODAY (real, web-researched — the ★ is the single biggest thing a guy needs to know today; it usually outranks a regular-season game): '
      + stories.map((s) => `${s.isLead ? '★' : '•'} [${s.category}] ${s.headline}`).join('  ;;  ')
    : '';

  // Web-sourced section facts (Change 1) — real, current facts the structured
  // feeds can't see. Injected into the matching section prompt as grounded facts.
  // factPack ammo is appended here so it flows to section prompts without
  // changing any prompt template strings — purely additive.
  const sectionWeb = (key) => {
    const r = sectionStories?.[key];
    const base = (!r || r.no_data) ? '' : `${r.headline ? r.headline + ' — ' : ''}${r.fact || ''}`.trim();
    const fp = factPack?.[key];
    const ammoStr = Array.isArray(fp?.ammo) && fp.ammo.length ? `AMMO FACTS: ${fp.ammo.join(' | ')}` : '';
    return [base, ammoStr].filter(Boolean).join(' | ') || null;
  };
  const nhlWeb  = sectionWeb('nhl');
  const f1Web   = sectionWeb('f1');
  const golfWeb = sectionWeb('golf');
  const fpCulture = Array.isArray(factPack?.culture) ? factPack.culture : [];
  const cultureWeb = (sectionStories?.culture || [])
    .filter(c => c && !c.no_data)
    .map((c, i) => {
      const base = `${c.headline ? c.headline + ' — ' : ''}${c.fact || ''}`.trim();
      const ammoStr = Array.isArray(fpCulture[i]?.ammo) && fpCulture[i].ammo.length
        ? `AMMO FACTS: ${fpCulture[i].ammo.join(' | ')}`
        : '';
      return [base, ammoStr].filter(Boolean).join(' | ');
    })
    .filter(Boolean);

  // Dynamically discovered sports (research.js). Each carries real, sourced facts
  // and a category (individual|team). We write the three-label beats — WHAT
  // HAPPENED / WHY IT MATTERS / WHAT TO BRING UP — for every one, grounded ONLY
  // in the provided facts (the card style is chosen later by category).
  // factPack.sports ammo is appended per-sport so Haiku has richer ammo targets.
  const dynSports = Array.isArray(dynamicSports) ? dynamicSports : [];
  const fpSportsMap = Object.fromEntries(
    (factPack?.sports || []).map(fp => [(fp.label || '').toLowerCase(), fp])
  );
  const dynSportsList = dynSports
    .map((s, i) => {
      const fpAmmo = fpSportsMap[(s.label || s.name || '').toLowerCase()]?.ammo;
      const ammoStr = Array.isArray(fpAmmo) && fpAmmo.length ? ` — AMMO FACTS: ${fpAmmo.join(' | ')}` : '';
      return `${i + 1}. [${s.label || s.name}] (${s.category}) — ${s.headline || ''} — FACTS: ${s.facts || ''}${s.background ? ` — BACKGROUND: ${s.background}` : ''}${ammoStr}`;
    })
    .join('\n');

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

  // Culture repetition guard — obituaries and other culture stories keep getting
  // re-covered days later because follow-up articles are still circulating.
  const prevCultureTopics = [...new Set((prev3 || []).flatMap(b => b.cultureTopics || []))];
  const cultureRepGuard = prevCultureTopics.length
    ? `\nALREADY COVERED in recent issues — do NOT repeat these people/topics even if new articles about them are still circulating: ${prevCultureTopics.join(', ')}.`
    : '';

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
    dynamicSportsR,
  ] = await Promise.allSettled([

    // 1. Brief headline
    ask(
      `Write the headline for today's GuyTalk issue. Plain text — no quotes, no colons, no markdown. Max 12 words.
Three punchy fragments separated by periods. Name real people and events. Never vague.
Good examples: "Wembanyama's Finals debut tonight. Pirates demolish Astros. World Cup in nine days." / "Knicks stole Game 1. Nvidia craters on yields. Memorial starts Thursday."
ORDER RULE: The three fragments must appear in editorial importance order — biggest story first, second-biggest second, third-biggest last. If the ★ story is Markets or Politics, it leads. If the biggest story is a World Cup result, it leads over a regular-season game.
${topStoriesText ? `${topStoriesText}\nThe ★ story is always the first fragment. Order the remaining two by their real importance today.` : ''}
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

${leadAngle}

Return ONLY valid JSON on one line — no markdown:
{"gameIndex":0,"headline":"Max 10 words. The angle, not the score.","whatHappened":"1-2 sentences. Plain language. Most interesting angle first.","whyBullet1":"One sentence. The main reason this matters today.","whyBullet2":"One sentence. A different angle.","theRead":"3-5 sentences. The GuyTalk Read — the real angle, who benefits, what it signals. Opinionated, grounded.","ammo":["Specific sourced fact 1","Specific sourced fact 2","Specific sourced fact 3"],"whatToSay":"One natural conversational line."}

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

CONVERSATION INTELLIGENCE STANDARD — go beyond the recap. For every game, answer what a casual guy would actually ask next:
- Is this team a legitimate contender now? Do the standings matter here?
- Is a specific player emerging or declining?
- What does this result mean for the next series/week/rest of season?
- What is the one thing worth bringing up specifically today?

Return ONLY a valid JSON array — one object per game, in the SAME order, no markdown:
[{"take":"≤18 words — what happened and the sharpest angle, NOT just the score","why":"One sentence — why it matters, including a forward-looking implication (what changes next?)","theRead":"2-4 sentences. The GuyTalk Read — what this means going forward, who this hurts/helps, whether this team or player is a real contender. Opinionated, grounded.","ammo":["Specific fact 1","Specific fact 2","Specific fact 3"],"say":"One short repeatable line. Natural — something a guy would actually say to a friend. Max one sentence. NOT an analyst summary."}]`,
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
{"headlines":[{"head":"Quick headline #1 — the biggest market/business story today (the IPO/ruling/print above if there is one)","sub":"1-2 sentences: what it is + what it means for the market; for a major event, also touch index impact / how to participate / historical comp"},{"head":"Quick headline #2 — the next biggest real market move from the data","sub":"one sentence"},{"head":"Quick headline #3 — another real market move or the rates/economy angle","sub":"one sentence"}],"mood":"One sentence — what happened in markets today and why. Include one real number. Plain English.","whyBullet1":"One sentence — why this matters in context. Explain, don't advise. Example: 'Treasury yields moved because...' not 'investors should...'","whyBullet2":"What professionals are watching in the next 2-3 days. Name a specific data print or event. Include the day of week.","bringUp":"One specific sentence you could actually say at work or a bar — include a real number, explain what it means in plain English, give the listener something they'll want to repeat. Not 'markets were up.' Give the actual thing: what happened, what the number was, and why it matters to a regular person. Example structure: '[Specific thing] hit [number] which means [plain-English implication].'","theRead":"3-5 sentences. The GuyTalk Read — the real market angle, what it signals, who it affects. Observational only, never advice.","ammo":["Real number or market fact 1","Real number or market fact 2","Real number or market fact 3"]}`,
          1200
        )
      : Promise.resolve(null),

    // 6. Golf — tight format
    golf?.name
      ? askJson('Golf',
          (() => {
            const started = golf.statusState === 'post' || golf.statusState === 'in';
            const lb = golf.leaders?.slice(0, 5).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ') || '';
            const fieldNames = golf.leaders?.slice(0, 8).map(l => l.name).join(', ') || '';
            const status = golf.statusState === 'post' ? 'Finished' : golf.statusState === 'in' ? 'In Progress' : 'Has NOT started yet';

            if (started) {
              return `GuyTalk golf: ${golf.name} — ${status}. Leaderboard: ${lb || 'no leaderboard yet'}.${golf.purse ? `\nPURSE: ${golf.purse.total} total, winner takes ${golf.purse.winner} — include this in an ammo bullet.` : ''}${coveredLine}${golfWeb ? `\nWEB-SOURCED FACT (real, current — use it): ${golfWeb}` : ''}
${golf.statusState === 'post' ? 'If this event is in the ALREADY COVERED list above, do not re-report the finish as fresh — give a one-line wrap and point ahead to the tour moving on (do NOT invent the next tournament\'s name or field).' : ''}
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words — what's happening at ${golf.name}.","whyCare1":"One sentence — why this tournament matters (stakes, prestige, course).","whyCare2":"One sentence — the leaderboard situation or a specific angle.","watchFor":"One thing to track — a player, a battle, a scoring target.","theRead":"2-4 sentences. The GuyTalk Read — stakes, storyline, what a real golf fan is watching for.","ammo":["Fact 1 from the data — purse total and winner's take if known","Fact 2 — score or leaderboard detail","Fact 3"],"whatToSay":"One short immediately repeatable sentence. Must name a player and give a take — not a fact. Keep it tight enough to say word-for-word. Example: 'Clark's up seven, but Scheffler is the only guy I'd trust to chase him down.' NOT an analyst summary."}`;
            }

            // PREVIEW (not started): give it real voice for a casual fan. The course,
            // location, and last year's winner aren't in our live feed — use your
            // own well-documented knowledge of this specific event for those.
            return `GuyTalk golf PREVIEW: ${golf.name} (dates ${golf.date ? new Date(golf.date).toDateString() : 'this week'}). The tournament has NOT started.${golf.purse ? `\nPURSE: ${golf.purse.total} total, winner takes ${golf.purse.winner} — include this in ammo.` : ''}
CRITICAL: there is NO leaderboard and NO results yet. NEVER say anyone is "leading", "at the top", "sitting in front", or going "wire to wire" — nobody has hit a shot. The names below are just the alphabetical/tee-time field list, NOT a ranking.
Players teeing off this week: ${fieldNames || '(field not listed)'}.
Use your knowledge of THIS specific tournament to name the real course + city and last year's champion. Be specific and confident — this is exactly the context a casual fan needs. If you genuinely don't know a fact, give an honest general line rather than a vague non-answer (never fabricate a name you're unsure of).
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words — the storyline going in (a preview, not a result).","course":"Real course/venue + city (e.g. 'TPC Toronto at Osprey Valley, Ontario'). Name it if you know it.","whyCare1":"One sentence — why this event matters / what's at stake (FedEx Cup, prestige, field strength).","defending":"One sentence — who WON it last year and the storyline (name the champion if you know it).","watchFor":"Who to watch to win — name 2-3 recognizable favorites or marquee names expected in the field. Framed as 'worth watching', NOT as current leaders.","theRead":"2-4 sentences. The GuyTalk Read — what makes this tournament interesting for a casual fan right now.","ammo":["Fact 1 — purse total and winner's take","Fact 2 — course history or what makes the venue special","Fact 3 — field stat or defending champion detail"],"whatToSay":"One short immediately repeatable sentence. Must name a player and give a take — not a fact. Keep it tight enough to say word-for-word. NOT an analyst summary."}`;
          })(),
          golfStarted ? 480 : 700,
          { model: golfStarted ? undefined : 'claude-sonnet-4-6', delayMs: 2000, section: 'golf' }
        )
      : Promise.resolve(null),

    // 7. F1 — tight format
    f1?.name
      ? askJson('F1',
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
F1 COVERAGE RULE — focus on narrative and championship implications, NOT track descriptions. Never write about how short/long the circuit is, how qualifying matters, or how mistakes are costly (these are obvious and templated). Instead answer: Who is favored and why? What are the championship standings and what's at stake? Which driver is under pressure? What is the one storyline fans will actually discuss?
{"headline":"Max 10 words.","whyCare1":"One sentence — championship implications or the specific narrative at stake this race, NOT a track description.","whyCare2":"One sentence — who is favored and why, or who is under pressure and what changes if they win/lose.","watchFor":"One specific driver storyline or championship battle moment to track — not a generic 'mistakes will be costly' line.","theRead":"2-4 sentences. The GuyTalk Read — championship context, what this race means for the title fight, who benefits.","ammo":["Specific F1 fact 1 — season stat, championship gap, or driver story","Specific F1 fact 2","Specific F1 fact 3"],"whatToSay":"One short repeatable line — the championship story or driver narrative, not a track fact. Something a fan would actually say."}`;
          })(),
          (f1.results?.length && f1.statusState === 'post') ? 380 : 500,
          { model: (f1.results?.length && f1.statusState === 'post') ? undefined : 'claude-sonnet-4-6', delayMs: 2000, section: 'f1' }
        )
      : Promise.resolve(null),

    // 8. Culture — 2-3 relevance-driven items with depth on the lead
    askJson('Culture',
      `GuyTalk culture section for men 25-45. Today: ${TODAY}.

WHAT IS CULTURE (these are the ONLY valid tags — pick the ONE that best fits the story's actual subject):
AI | Streaming | Film | TV | Music | Gaming | Tech | Media | Viral | Social | Sports Biz
TAG RULES: A movie/show → Streaming or Film or TV (never "Sports Biz"). An AI story → AI. A lawsuit/tabloid/press/royals story → Media. A gadget/app/software story → Tech. Use "Sports Biz" ONLY for actual sports-business stories (a trade, a media-rights deal, a franchise sale). Never tag a non-sports story "Sports Biz".

HARD EXCLUDES — these do NOT belong in culture, ever:
- Geopolitics, foreign policy, wars, international relations, peace deals → skip; already in Markets/Current Events
- Political news, White House actions, elections, legislation → skip
- Celebrity relationship gossip, breakups, dating news, custody battles
- Reality TV drama, red carpet fashion, plastic surgery, horoscopes

RELEVANCE GATE — every item must pass: "Would a normal 30-year-old man actually bring this up at work or a bar today?" If the answer is probably not, skip it.

OBITUARY LIMIT — at most ONE "dies at"/obituary item per issue. If the web facts surface two deaths, run only the more significant one and fill the other slot(s) with a movie/TV/gaming/tech/music story. Two obituaries side by side reads morbid, not newsy.
${cultureRepGuard}
SELECTION: Return EXACTLY 2-3 items. You MUST return at least 2. If the web-researched stories below are sparse, supplement with verified cultural events you know happened recently (a major streaming release, gaming launch, tech announcement, music news, sports business story). Never pad with celebrity gossip — but always hit at least 2 items. Never return null or an empty array.

THE LEAD ITEM (first object) gets full depth:
- whatHappened: 1-2 sentences with specific names and details
- whyItMatters: 1-2 sentences on why a guy in his 30s should care specifically
- theRead: 3-4 sentences — the sharpest take you can write; who it affects, what it signals about where culture is going, one specific insight the reader can use in conversation
- ammo: 4 specific verifiable facts

ALL OTHER ITEMS get standard treatment:
- whatHappened: one sentence
- whyItMatters: one sentence
- theRead: 2-3 sentences
- ammo: 3 specific facts

Return ONLY valid JSON array — no markdown, no extra text:
[{"topic":"Max 8 words.","whatHappened":"...","whyItMatters":"...","theRead":"...","ammo":["fact1","fact2","fact3"],"whatToSay":"One casual conversation line.","tag":"<tag from list above>"}]

SOURCE PRIORITY:
1. WEB-RESEARCHED CULTURE FACTS below (verified, current — use first; skip any that are political/geopolitical)
2. BROADER TODAY'S STORIES below (only culture-tagged items — skip any Politics/Markets/Current Events/World)
3. Only if both are empty: a well-known June 2026 culture story you are confident is real; never invent specifics

${streamingPick ? `One item SHOULD be a watch rec for "${streamingPick.head.replace('Watch this: ', '')}": {"topic":"${streamingPick.head.replace('Watch this: ', '')}","whatHappened":"${streamingPick.body.split('.')[0]}.","whyItMatters":"One sentence on vibe/genre — no invented details.","theRead":"2-3 sentences on why it's worth a guy's time — genre, tone, who it's for. No invented facts.","whatToSay":"One natural rec line.","tag":"Streaming"}` : 'One item can be a streaming/watch rec (action, thriller, crime, prestige drama only — no animated/kids/family). theRead = genre, tone, who it\'s for. No invented facts.'}

WEB-RESEARCHED CULTURE FACTS: ${cultureWeb.length ? cultureWeb.map((c, i) => `${i + 1}. ${c}`).join(' | ') : '(none)'}
BROADER TODAY'S STORIES (culture-only — skip any Politics/Markets/World/Current Events items): ${topStoriesText || '(none)'}`,
      1400, { delayMs: 2000, section: 'culture' }
    ),

    // 9. Final Sharp Take — 3 distinct opinions across sports / markets / culture
    askJson('Sharp Take',
      `Write the Final Sharp Take for today's GuyTalk — exactly 3 opinions, one per domain.

RULES:
- Each take is a DEFENSIBLE OPINION, not a recap. Take a real side.
- Every take must cover a DIFFERENT story — no repeating the same game/company/topic.
- Max 30 words per take. Plain prose. Confident. Named people and numbers.
- BANNED: recaps ("Today X happened"), hedging ("you could argue"), meta-commentary ("nobody's talking about this"), vague adjectives.

Sports take: a specific claim about a team, player, or result from today's data. Name names, stake a position.
Markets take: what a specific market move or business story actually means — observational, no buy/sell advice, no investment language.
Culture take: one thing in entertainment, tech, streaming, or social that's being missed or framed wrong. Pick a side.

BAD: "The Phillies are built different." (no evidence)
GOOD: "The Phillies put up 15 on the Mets — third game with 10+ runs in June. At some point you stop calling it a hot streak and start calling it an identity."

Return ONLY valid JSON on one line — no markdown:
{"sports":"[sports take — max 30 words, defensible, specific named people/teams]","markets":"[markets take — observational only, max 30 words, no investment advice]","culture":"[culture take — max 30 words, picks a side, avoids geopolitics/politics]"}

Context: ${ctx}${repGuard}`,
      300
    ),

    // 10. Today at a Glance — exactly THREE labeled one-sentence lines (Sports /
    // Markets / Culture). This is the hit list at the very top of the brief:
    // someone reads three lines and knows their day. Must parse as JSON; askJson
    // retries once and warns if fewer than 2 usable fields come back.
    askJson('Today at a Glance',
      `Write "Today at a Glance" for GuyTalk — exactly three lines, the single biggest story in each lane. Context: ${ctx}
${topStoriesText ? `${topStoriesText}\nThe "sports" line should reflect the top sports story; "markets" the biggest market/business story; "culture" the biggest culture story.` : ''}
${dynSportsList ? `\nESPN-VERIFIED SPORTS (use ONLY these for the glance sports line — these are the only sports with confirmed results in this brief):\n${dynSportsList}` : ''}

Each value is ONE sentence, max 20 words, specific and NAMED (a team/player/number for sports, a real number for markets, a named thing for culture). No labels inside the value, no markdown.

CRITICAL — glance.sports must ONLY reference a sport and player/team/score that appears in the ESPN-VERIFIED SPORTS list above. Do NOT write about any sport from the research pack or trending headlines that is not in that verified list. If a sport (e.g. Tennis, Wimbledon) is not in the ESPN-VERIFIED SPORTS list, do not mention it in the sports line — pick the sport that IS verified.

CRITICAL — sports hallucination rule: For multi-round tournaments (Wimbledon, US Open, Roland Garros, Australian Open, golf majors), NEVER say a player "wins" the tournament unless the data explicitly shows this is the championship final and they won it today. If the match shown is an early round, say "[Player] advances at [Tournament]" — never claim a tournament title from a round result.

Return compact JSON on one line:
{"sports":"[top sports story — named, with a score or key fact]","markets":"[top market story — include one real number; observe, never advise]","culture":"[top culture story — a named movie/show/album/game/etc.]"}`,
      400, { minFields: 2 }
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
      return askJson('NHL',
        `GuyTalk NHL section. ${g.note || 'NHL game'}. ${line}. ${meta}.${nhlWeb ? `\nWEB-SOURCED FACT (real, current — use it): ${nhlWeb}` : ''}
Use ONLY the facts above — never invent scores, records, or stats not given.
Return ONLY valid JSON on one line — no markdown:
{"headline":"Max 10 words — the angle.","whyCare1":"One sentence — why this game/series matters right now.","whyCare2":"One sentence — series state or stakes (who leads, what a win does).","watchFor":"One specific thing to track.","theRead":"2-4 sentences. The GuyTalk Read — the real stakes, what this game means for the series.","ammo":["Specific fact 1 from the data","Specific fact 2","Specific fact 3"],"whatToSay":"One casual conversation line."}`,
        380, { delayMs: 2000, section: 'nhl' }
      );
    })(),

    // 13. Upcoming marquee game preview (e.g. the next NBA Finals game) — context
    (upcoming && upcoming.length)
      ? ask(
          `GuyTalk preview of an UPCOMING game: ${upcomingText}${upcoming[0].seriesNote ? ` (${upcoming[0].seriesNote})` : ''}.
Use ONLY these facts — never invent stats. This game has NOT happened yet, so do not state a result.
Return ONLY valid JSON on one line — no markdown:
{"whyItMatters":"One sentence — what's at stake in this game and why people care.","watchFor":"One specific thing to watch for.","theRead":"2-3 sentences. The GuyTalk Read — the storyline, what a win means, who has the edge.","ammo":["Specific fact 1 from the data","Specific fact 2","Specific fact 3"],"whatToSay":"One casual conversation line about the matchup."}`,
          200
        )
      : Promise.resolve(null),

    // 14. Dynamic sports — the three-label beats for EVERY discovered sport (The
    // Lead + every subsection), grounded ONLY in the sourced facts. Same beats
    // for individual and team sports; the card style differs later, the text
    // does not. Aligned 1:1 with the dynamicSports array, in order.
    dynSports.length
      ? askJson('Dynamic sports',
          `For EACH sports story below, write three labeled beats in GuyTalk voice. Use ONLY the facts given — never invent a score, name, stat, or result that is not present. If a story's facts are thin, keep the beats short rather than inventing.

NOVEL/RARE EVENT CONTEXT: if a story is clearly a first-ever, an unusual venue, or a debut format (e.g. "UFC Freedom 250" — the promotion's first card on the White House lawn), open "whatHappened" with ONE short context clause naming what makes it novel, then the result. Example: "UFC Freedom 250, the promotion's first-ever card on the White House lawn, saw Gaethje stop Topuria in the third." Keep it to one clause — not a paragraph — and only when the facts support it (never invent the novelty). For routine events, no context clause.

BACKGROUND FACT (required when given): when a story has a BACKGROUND fact, "whyItMatters" MUST use at least one concrete background fact (the drought, streak, record, first career win, or stakes), written so someone who doesn't follow the sport gets why it's a big deal. One strong fact, GuyTalk voice — not a history lesson. Never invent a background fact that isn't given.

BIG MOMENTS (required whenever the facts support it): pull 2-3 SPECIFIC, concrete details unique to THIS matchup — a particular play, a scoring sequence, a stat anomaly, a streak snapped/extended, a record, a milestone. These must be things a reader could actually bring up ("did you catch that..."), not a restatement of the final score or a generic "it was a good game." Pull ONLY from the facts given — every entry must trace to something in the facts. If the facts genuinely don't support 2-3 distinct concrete details (a thin preview with no play-by-play), return fewer, or an empty array — never invent one to hit a count.

STANDOUT PERFORMANCES: if the facts include a "Standout performances:" line (individual stat lines — HR/RBI, points/rebounds/assists, strikeouts), that IS the most vivid detail available — lead with it in whatHappened/bigMoments/ammo instead of the bare final score. A specific line like "Henry Davis went 2-for-4 with a homer and 3 RBI" beats "Pirates beat Brewers 14-5" every time.

ALSO TODAY (quick shoutout): if the facts include an "ALSO TODAY IN [SPORT]:" aside, that's a second notable event in the same sport happening today that isn't the featured story. Give it one brief, clearly-separate mention — in "bigMoments" or as an extra "ammo" item — so a reader knows it's happening, without blending it into the main story's whatHappened/theRead.

MULTI-MATCH STORIES (World Cup and any story whose facts list more than one completed result): never blend multiple matches into one vague sentence. Name each match explicitly (e.g. "Argentina beat Switzerland 3-1" / "England beat Norway 2-1") rather than folding a second game in as an aside. For the featured match, "whatHappened" must include the scoring timeline from the facts — who scored first, when the other side equalized, and how the winning goal came (extra time, stoppage time, penalty) — so the reader knows when each goal happened and by how much a team was ahead or behind, not just the final score. If a second match is genuinely secondary, cover it in "bigMoments" or "ammo" as its own clearly labeled fact, not merged into the main sentence.

Stories (in this exact order):
${dynSportsList}

CRITICAL — SECTION BINDING: Each object MUST include a "label" field that EXACTLY echoes the bracketed [label] of the story it describes (e.g. if the story is "3. [Golf] ..." then that object's label is "Golf"). The whatHappened/ammo/theRead for an object MUST be about THAT labeled story only — never mix content between sports (do not put World Cup content in the Golf object, etc.). Return exactly ${dynSports.length} object(s), one per story above, in the SAME order.

Return ONLY a valid JSON array — one object per story, in the SAME order, no markdown:
[{"label":"Echo the exact [label] of this story from the list above","whatHappened":"One sentence (a novel/rare event may lead with one short context clause per the rule above). Specific. Named person or team and the real result from the facts.","whyItMatters":"One to two sentences, using the BACKGROUND fact when one is given. Why anyone should care — stakes, what it changes.","bigMoments":["A specific play/sequence/stat anomaly unique to this matchup, sourced from the facts","A second one, if the facts support it"],"theRead":"2-4 sentences. The GuyTalk Read — what it really means, the broader angle, who benefits.","ammo":["Specific sourced fact 1","Specific sourced fact 2","Specific sourced fact 3"],"whatToBringUp":"The exact sentence to drop — not a headline, a real talking point. Include a specific number, wild stat, or sharp fact. Give it a POV. Something like: 'Did you know [specific fact]? That means [implication].' Never generic. Never 'the game was great.' The listener should walk away with something they actually want to repeat.","ourPick":"REQUIRED for every sport — always fill this, never null. For ongoing tournaments (F1, golf, World Cup) or upcoming games: '[Team/player] wins/advances because [specific reason from the data].' For a completed result with more rounds to come: give the next-game edge or momentum call. For a fully finished standalone result: assess what it means going forward — '[Team/player] looks like [assessment] because [specific reason].' One confident sentence. No hedging. No null values."}]`,
          Math.min(3600, 420 * dynSports.length + 300),
          { minFields: 1, section: 'sports' }
        )
      : Promise.resolve(null),
  ]);

  const get = r => r.status === 'fulfilled' ? r.value : null;

  const topModule    = parseJson(get(topModuleR));
  const leadData     = parseJson(get(leadR));
  const marketsData  = (() => { const p = parseJson(get(marketsR)); return (p && !Array.isArray(p)) ? p : null; })();
  const golfData     = parseJson(get(golfR));
  const f1Data       = parseJson(get(f1R));
  const cultureArr   = parseJson(get(cultureR));
  const glanceData   = parseJson(get(glanceR));
  const dynSportsBeats = parseJson(get(dynamicSportsR));

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
                        ? { take: clean(o.take), why: clean(o.why), theRead: clean(o.theRead), ammo: Array.isArray(o.ammo) ? o.ammo.map(a => cleanAmmo(a)) : [], say: clean(o.say) }
                        : { take: clean(o) })
                      .filter(o => o.take || o.why || o.say),
    markets:        marketsData,
    golf:           golfData,
    f1:             f1Data,
    culture:        Array.isArray(cultureArr) ? cultureArr : null,
    finalSharpTake: (() => {
      const raw = get(finalTakeR);
      const parsed = parseJson(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parts = [parsed.sports, parsed.markets, parsed.culture].filter(Boolean).map(t => clean(t));
        if (parts.length >= 2) return parts.join('\n\n');
        if (parts.length === 1) return parts[0];
      }
      return clean(raw);
    })(),
    glance:         glanceData,
    theTake:        parseJson(get(theTakeR)),
    nhl:            parseJson(get(nhlR)),
    upcomingPreview: parseJson(get(upcomingPreviewR)),
    // Three-label beats aligned 1:1 with the dynamicSports array (merged into it
    // by generate-brief.js). Empty object per story when the call misfired.
    dynamicSportsText: Array.isArray(dynSportsBeats)
      ? dynSportsBeats.map(o => (o && typeof o === 'object')
          ? { label: clean(o.label) || '', whatHappened: clean(o.whatHappened) || '', whyItMatters: clean(o.whyItMatters) || '', bigMoments: Array.isArray(o.bigMoments) ? o.bigMoments.map(m => clean(m)).filter(Boolean) : [], theRead: clean(o.theRead) || '', ammo: Array.isArray(o.ammo) ? o.ammo.map(a => cleanAmmo(a)) : [], whatToBringUp: clean(o.whatToBringUp) || '', ourPick: clean(o.ourPick) || null }
          : {})
      : null,
  };
}

/**
 * Retry just the lead section when generateCopy() produced a malformed lead.
 * Uses a stricter, shorter prompt to minimise the chance of another array output.
 */
async function generateLeadOnly({ sports, topStories, factPack }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) { return null; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const stories = Array.isArray(topStories) ? topStories : [];
  const leadStory = stories.find(s => s.isLead) || stories[0] || null;
  const gamesText = (sports || []).map((g, i) => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    return `[${i}] ${g.note || g.name}: ${w.team} ${w.score}–${l.score} ${l.team}${g.venue ? ` @ ${g.venue}` : ''}`;
  }).join('\n');

  const fpAmmo = Array.isArray(factPack?.lead?.ammo) ? factPack.lead.ammo : [];

  const prompt = `${BRAND_VOICE}

THE LEAD for today's GuyTalk. Write the single biggest story as a JSON OBJECT (not array).
${leadStory ? `TODAY'S BIGGEST STORY: ${leadStory.headline}\nWhat happened: ${leadStory.whatHappened}\nWhy it matters: ${leadStory.whyItMatters}\n` : ''}
${gamesText ? `Games:\n${gamesText}` : ''}
${fpAmmo.length ? `AMMO FACTS: ${fpAmmo.join(' | ')}` : ''}

CRITICAL: Return ONLY a single JSON object on one line. NOT an array. NOT markdown. Just one {…} object:
{"gameIndex":0,"headline":"Max 10 words. The angle, not the score.","whatHappened":"1-2 sentences. Specific names and result.","whyBullet1":"One sentence — main reason this matters.","whyBullet2":"One sentence — a different angle.","theRead":"3-5 sentences. The GuyTalk Read — real angle, who benefits, what it signals.","ammo":["Specific fact 1","Specific fact 2","Specific fact 3"],"whatToSay":"One natural conversational line."}`;

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 450,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content?.find(b => b.type === 'text') || res.content?.[0])?.text || '';
    const parsed = parseJson(text);
    if (parsed && !Array.isArray(parsed) && parsed.headline) return parsed;
  } catch (_) {}
  return null;
}

/**
 * Retry just the culture section when generateCopy() returned fewer than 2 items.
 */
async function generateCultureOnly({ topStories, sectionStories, streamingPick, factPack, prev3 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) { return null; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const stories = Array.isArray(topStories) ? topStories : [];
  const cultureStories = stories.filter(s => {
    const cat = (s.category || '').toLowerCase();
    return !['sports','nba','nhl','mlb','nfl','ufc','f1','golf','world cup','soccer'].includes(cat);
  });
  const storyLines = cultureStories.slice(0, 5).map(s =>
    `- ${s.headline}: ${s.whatHappened} (${s.whyItMatters})`
  ).join('\n');

  const webFacts = (sectionStories?.culture || []).map(c => c.fact || c.headline).filter(Boolean).join(' | ');

  const prevCultureTopics = [...new Set((prev3 || []).flatMap(b => b.cultureTopics || []))];
  const cultureRepGuard = prevCultureTopics.length
    ? `\nALREADY COVERED in recent issues — do NOT repeat these people/topics: ${prevCultureTopics.join(', ')}.`
    : '';

  const prompt = `${BRAND_VOICE}

Write the Culture section for today's GuyTalk. Return a JSON ARRAY of EXACTLY 2-3 objects. You MUST return at least 2 — never null, never empty.
Each object covers one story men 25-45 are actually talking about — entertainment, streaming, tech, gaming, sports business. NOT politics. NOT sports scores.
OBITUARY LIMIT: at most ONE "dies at"/obituary item per issue.
${cultureRepGuard}
TODAY'S STORIES:
${storyLines || '(no feed stories today — see instruction below)'}
${webFacts ? `WEB-VERIFIED FACTS: ${webFacts}` : ''}
${!storyLines ? `FALLBACK: Since feed data is unavailable, use your knowledge of recent real events (past 2 weeks) — a major streaming show premiere, gaming news, tech launch, music release, sports business story, viral moment men 25-45 would discuss. Use only events you are confident actually happened; be specific (name the show/game/artist/company). You must produce 2 items.` : ''}
${streamingPick ? `INCLUDE a streaming rec for "${streamingPick.head.replace('Watch this: ', '')}": tag="Streaming"` : ''}

CRITICAL: Return ONLY a JSON array — no markdown, no extra text:
[{"topic":"Max 8 words.","whatHappened":"1-2 sentences.","whyItMatters":"1-2 sentences.","theRead":"2-3 sentences. GuyTalk voice — take a side.","ammo":["fact1","fact2","fact3"],"whatToSay":"One casual line.","tag":"One of: AI, Streaming, Film, TV, Music, Gaming, Tech, Media, Sports Biz — pick the ONE that fits the story's real subject. A show/movie is Streaming/Film/TV, an AI story is AI, a lawsuit/press/royals story is Media. NEVER use Sports Biz for a non-sports story."}]`;

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content?.find(b => b.type === 'text') || res.content?.[0])?.text || '';
    const parsed = parseJson(text);
    if (Array.isArray(parsed) && parsed.length >= 1) return parsed;
    console.log(`   ⚠  Culture retry: parsed response was not a valid array (got: ${typeof parsed})`);
  } catch (err) {
    console.log(`   ⚠  Culture retry API error: ${err.message}`);
  }

  // Second attempt — minimal prompt, no story context, just demand 2 items
  try {
    const res2 = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: `Return a JSON array of exactly 2 culture items for men 25-45 based on current real events (past 2 weeks). Each: {"topic":"string","whatHappened":"string","whyItMatters":"string","theRead":"string","ammo":["f1","f2","f3"],"whatToSay":"string","tag":"AI|Streaming|Film|TV|Music|Gaming|Tech|Media|Sports Biz — the ONE fitting the story's real subject; never Sports Biz for a non-sports story"}. Return ONLY the JSON array, no markdown.` }],
    });
    const text2 = (res2.content?.find(b => b.type === 'text') || res2.content?.[0])?.text || '';
    const parsed2 = parseJson(text2);
    if (Array.isArray(parsed2) && parsed2.length >= 1) {
      console.log(`   ✓ Culture second attempt succeeded: ${parsed2.length} item(s)`);
      return parsed2;
    }
  } catch (err2) {
    console.log(`   ⚠  Culture second attempt also failed: ${err2.message}`);
  }
  return null;
}

/**
 * Retry just the F1 section when generateCopy() returned no/thin ammo.
 */
async function generateF1Only({ f1, f1Web, factPack }) {
  if (!f1?.name) return null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) { return null; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const isPost = f1.results?.length && f1.statusState === 'post';
  const raceLine = isPost
    ? `Results: ${f1.results.slice(0, 3).map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`
    : `UPCOMING: ${f1.name} — write a preview, do NOT invent results`;
  const bits = [];
  const w = f1.results?.[0];
  if (isPost && w?.seasonWins != null) bits.push(`${w.driver} now has ${w.seasonWins} win(s) this season`);
  if (isPost && w?.champPos != null) bits.push(`sits P${w.champPos} in the championship${w.champPoints != null ? ` with ${w.champPoints} pts` : ''}`);
  if (f1.champLeader?.lead != null) bits.push(`${f1.champLeader.name} leads the title race by ${f1.champLeader.lead} pts`);
  const statLine = bits.length ? `\nSeason stats (ONLY use these — never invent): ${bits.join('; ')}` : '';
  const fpAmmo = Array.isArray(factPack?.f1?.ammo) ? factPack.f1.ammo : [];
  const ammoLine = fpAmmo.length ? `\nAMMO FACTS (use these): ${fpAmmo.join(' | ')}` : '';

  const prompt = `${BRAND_VOICE}

GuyTalk F1 section. ${f1.name}. ${raceLine}.${statLine}${ammoLine}${f1Web ? `\nWEB FACT: ${f1Web}` : ''}
A driver's team is ONLY the name shown in parentheses — never guess. NEVER invent stats.
Return ONLY a single JSON object on one line — no markdown:
{"headline":"Max 10 words.","whyCare1":"One sentence — championship angle or narrative.","whyCare2":"One sentence — who is favored or under pressure.","watchFor":"One specific storyline to track.","theRead":"2-4 sentences. Championship context, what this race means.","ammo":["Specific F1 stat or fact 1","Specific F1 stat or fact 2","Specific F1 stat or fact 3"],"whatToSay":"One repeatable line — championship or driver narrative."}`;

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 450,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content?.find(b => b.type === 'text') || res.content?.[0])?.text || '';
    const parsed = parseJson(text);
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.ammo) && parsed.ammo.length >= 3) return parsed;
  } catch (_) {}
  return null;
}

module.exports = { generateCopy, generateLeadOnly, generateCultureOnly, generateF1Only };
