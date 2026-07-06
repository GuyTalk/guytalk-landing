'use strict';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Simple in-memory cache: key = "sport|home|away|homeScore|awayScore"
const _cache = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  const { sport = '', home = '', away = '', homeScore = '', awayScore = '',
          league = '', headline = '' } = req.query || {};
  if (!home || !away) return res.status(400).json({ error: 'home and away required' });

  const cacheKey = `${sport}|${home}|${away}|${homeScore}|${awayScore}`;
  if (_cache.has(cacheKey)) return res.status(200).json(_cache.get(cacheKey));

  if (!OPENAI_API_KEY) {
    return res.status(200).json(fallback(home, away, homeScore, awayScore, league));
  }

  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) {
    return res.status(200).json(fallback(home, away, homeScore, awayScore, league));
  }

  const client = new (OpenAI.default || OpenAI)({ apiKey: OPENAI_API_KEY });
  const sportLabel = sport === 'worldcup' ? 'FIFA World Cup 2026' :
    sport === 'mlb' ? 'MLB' : sport === 'nba' ? 'NBA' :
    sport === 'nhl' ? 'NHL' : sport === 'mls' ? 'MLS' :
    sport === 'epl' ? 'Premier League' : (league || sport.toUpperCase());

  const loser = Number(homeScore) < Number(awayScore) ? home : away;
  const prompt = `You are GuyTalk's sports editor. A reader tapped for a breakdown of this game.

GAME: ${home} ${homeScore}–${awayScore} ${away} (${sportLabel})${headline ? `\nESPN: "${headline}"` : ''}

STEP 1 — Search the web RIGHT NOW for the actual match details. Search these specifically:
- "${home} ${away} ${sportLabel} 2026 goals scorers"
- "${loser} eliminated ${sportLabel.includes('World Cup') ? 'World Cup 2026' : 'standings'}"

STEP 2 — Generate the breakdown using ONLY what you found. Rules:
- If a team is ELIMINATED from the tournament, say so explicitly — do NOT write "they need to tighten up"
- Name the actual goalscorer(s) and minute(s) if you found them — do not invent
- Cite real group-stage standings math if it's a World Cup game
- BANNED phrases: "most dangerous team", "can't afford slip-ups", "the best driver/player right now"

Return ONLY valid JSON (no markdown fences):
{
  "whyItMatters": "2-3 sentences. Real standings impact. If a team is eliminated, state it here.",
  "hotTake": "One sentence naming a specific player or moment. Opinionated and specific.",
  "whatToSay": "Natural one-liner for work/bar with a specific number or minute.",
  "biggestMoment": "The key play: scorer, minute, context.",
  "keyTakeaway": "Current standings — who advances, who is eliminated, what the group math is.",
  "contextFacts": ["Specific sourced fact 1", "Specific sourced fact 2", "Specific sourced fact 3"],
  "source": "openai-search"
}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await client.responses.create({
        model: 'gpt-4.1',
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
        tool_choice: 'required',
        max_output_tokens: 1000,
        input: prompt,
      }, { signal: controller.signal });
    } finally { clearTimeout(timeout); }

    let text = response.output_text || '';
    if (!text && Array.isArray(response.output)) {
      text = response.output.filter(b => b.type === 'message')
        .flatMap(b => b.content || [])
        .filter(c => c.type === 'output_text' || c.type === 'text')
        .map(c => c.text || '').join('');
    }
    text = text.replace(/```json\s*/gi, '').replace(/```/g, '');
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e < 0) throw new Error('no JSON');
    const data = JSON.parse(text.slice(s, e + 1));
    _cache.set(cacheKey, data);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json(fallback(home, away, homeScore, awayScore, league));
  }
};

function fallback(home, away, homeScore, awayScore, league) {
  const homeN = Number(homeScore), awayN = Number(awayScore);
  const winner = homeN > awayN ? home : (awayN > homeN ? away : null);
  const loser  = homeN > awayN ? away : (awayN > homeN ? home : null);
  const score  = `${homeScore}–${awayScore}`;
  return {
    whyItMatters: winner
      ? `${winner} beat ${loser} ${score}${league ? ' (' + league + ')' : ''}.`
      : `${home} and ${away} drew ${score}.`,
    hotTake: winner ? `${winner} earned this result.` : `A draw that suits neither side.`,
    whatToSay: `"${winner || home} ${score} — check the highlights."`,
    biggestMoment: winner ? `${winner} took the lead and held on.` : `Neither side could find a winner.`,
    keyTakeaway: `Check the live standings for the full picture.`,
    contextFacts: [`Final: ${home} ${score} ${away}`],
    source: 'fallback',
  };
}
