'use strict';

/**
 * Daily research layer — pipeline-v2 cost rewrite.
 *
 * Cost target: <$0.50/run
 *   fetchDynamicSports  — ZERO model/search calls; built from structured feeds.
 *   fetchTopStories     — NewsAPI headlines → 1 Haiku call + 1 Sonnet search (market depth only).
 *   fetchSectionStories — NewsAPI entertainment (culture) + og:image for hero; zero web searches.
 *
 * All knobs are env-overridable:
 *   ANTHROPIC_RESEARCH_MODEL   — override SYNTH_MODEL  (default: claude-sonnet-4-6)
 *   ANTHROPIC_EXTRACT_MODEL    — override EXTRACT_MODEL (default: claude-haiku-4-5-20251001)
 *   RESEARCH_MAX_CONTINUATIONS — max pause_turn resumes per call (default: 2)
 *   RESEARCH_MAX_SPORTS        — max sports sections (default: 3)
 *
 * Fail-open: any error returns [] / {} so generation never blocks.
 */

const SYNTH_MODEL   = process.env.ANTHROPIC_RESEARCH_MODEL || 'claude-sonnet-4-6';
const EXTRACT_MODEL = process.env.ANTHROPIC_EXTRACT_MODEL  || 'claude-haiku-4-5-20251001';

const MAX_CONTINUATIONS = parseInt(process.env.RESEARCH_MAX_CONTINUATIONS || '2', 10);
const MAX_SPORTS        = parseInt(process.env.RESEARCH_MAX_SPORTS        || '4', 10);

const { isExcluded, scoreImportance } = require('./editorial-config');
const { extractOgImage, isLiveImage, resolveAthleteImage, SECTION_FALLBACKS } = require('./images');
const { PLAYERS } = require('./db');

function extractJsonArray(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('[');
  if (start < 0) return null;
  const body = cleaned.slice(start);
  const end = body.lastIndexOf(']');
  if (end > 0) {
    try { const v = JSON.parse(body.slice(0, end + 1)); if (Array.isArray(v)) return v; } catch { /* fall through */ }
  }
  const lastObj = body.lastIndexOf('}');
  if (lastObj > 0) {
    try { const v = JSON.parse(body.slice(0, lastObj + 1) + ']'); if (Array.isArray(v)) return v; } catch { /* give up */ }
  }
  return null;
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  if (end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function getText(res) {
  return (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

function sourceTier(url) {
  if (!url) return 2;
  const u = String(url).toLowerCase();
  const t1 = ['espn.com', 'nba.com', 'nfl.com', 'mlb.com', 'nhl.com', 'pgatour.com', 'formula1.com', 'reuters.com', 'apnews.com', 'cnbc.com', 'sec.gov'];
  const t3 = ['twitter.com', 'x.com', 'reddit.com', 'tiktok.com', 'youtube.com', 'barstool', 'instagram.com'];
  if (t1.some(d => u.includes(d))) return 1;
  if (t3.some(d => u.includes(d))) return 3;
  return 2;
}

// Shared runner for web_search calls — caps usage via max_uses.
// allowed_callers:'direct' required for Haiku (lacks programmatic tool calling).
async function runSearch(client, { model, messages, maxTokens, maxUses, useThinking = false }) {
  const toolDef = { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses, allowed_callers: ['direct'] };
  const base = {
    model,
    max_tokens: maxTokens,
    tools: [toolDef],
    ...(useThinking ? { thinking: { type: 'adaptive' } } : {}),
  };
  let res = await client.messages.create({ ...base, messages });
  let c = 0;
  while (res.stop_reason === 'pause_turn' && c < MAX_CONTINUATIONS) {
    messages.push({ role: 'assistant', content: res.content });
    res = await client.messages.create({ ...base, messages });
    c += 1;
  }
  return res;
}

// NewsAPI helper — fetch headlines from one or more categories.
async function fetchNewsHeadlines(categories, { pageSize = 10 } = {}) {
  const newsKey = process.env.NEWS_API_KEY;
  if (!newsKey) return [];
  const items = [];
  for (const cat of categories) {
    try {
      const res = await fetch(
        `https://newsapi.org/v2/top-headlines?country=us&category=${cat}&pageSize=${pageSize}&apiKey=${newsKey}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      (data.articles || []).forEach(a => {
        if (a.title && a.url && !a.title.includes('[Removed]')) {
          items.push({
            title:       a.title.replace(/\s*[\-\|]\s*[^-|]+$/, '').trim(),
            url:         a.url,
            description: a.description || '',
            source:      a.source?.name || '',
          });
        }
      });
    } catch (_) {}
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top stories — NewsAPI headlines → Haiku ranking (text-only) +
//               ONE Sonnet search for lead market/business depth.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTopStories({ dateLabel } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('   ⚠  Research skipped — ANTHROPIC_API_KEY missing'); return []; }

  const today = dateLabel || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // Step 1 — fetch headlines via NewsAPI (business, tech, general)
  const headlines = await fetchNewsHeadlines(['business', 'technology', 'general'], { pageSize: 10 });
  if (!headlines.length) {
    console.log('   ⚠  NewsAPI returned no headlines — falling back to web search');
    return fetchTopStoriesViaSearch({ today, apiKey });
  }

  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch { console.log('   ⚠  Research skipped — @anthropic-ai/sdk not installed'); return []; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  // Step 2 — Haiku ranks + formats (no web_search, text-only)
  const bulletList = headlines.slice(0, 20).map(
    (h, i) => `${i + 1}. [${h.source}] ${h.title}${h.description ? ` — ${h.description.slice(0, 120)}` : ''} (${h.url})`
  ).join('\n');

  const rankPrompt = `You are the lead editor of GuyTalk, a daily brief for men 25-45. Today is ${today}.

Here are today's top news headlines:
${bulletList}

Pick the 4-6 most important stories for a male 25-45 audience (business, tech, world, culture — NOT routine sports scores). Rank by genuine importance; #1 is what a smart man most needs to know today.

For the single biggest MARKET or BUSINESS story, set "depth" to 2-4 sentences on: how it affects the S&P 500/major indices, how a regular person can participate, and a historical comparison. Set "depth": "" for all other stories.

Return ONLY a JSON array (no prose, no markdown fence):
[{
  "category": "Markets" | "Business" | "Tech" | "World" | "Culture",
  "headline": "tight, specific headline",
  "whatHappened": "1-2 factual sentences",
  "whyItMatters": "1-2 sentences why a guy should care",
  "depth": "market depth for the lead business/market story; empty string otherwise",
  "whatToSay": "one opinionated line a guy would actually say",
  "sources": ["<url from the list above>"],
  "isLead": true for the single biggest story, false for others
}]`;

  let stories = [];
  try {
    const messages = [{ role: 'user', content: rankPrompt }];
    const res = await client.messages.create({ model: EXTRACT_MODEL, max_tokens: 3000, messages });
    stories = extractJsonArray(getText(res)) || [];
    stories = stories.filter(s => s?.headline).map(s => ({ ...s, tier: sourceTier(Array.isArray(s.sources) ? s.sources[0] : '') }));
  } catch (e) {
    console.log(`   ⚠  Haiku ranking failed: ${e.message}`);
    return [];
  }
  if (!stories.length) return [];

  // Step 3 — ONE Sonnet search for market depth on the lead business/market story
  const marketStory = stories.find(s => s.isLead && ['Markets', 'Business'].includes(s.category))
    || stories.find(s => ['Markets', 'Business'].includes(s.category));
  if (marketStory && !marketStory.depth) {
    try {
      const depthMessages = [{
        role: 'user',
        content: `For this story: "${marketStory.headline}" — search for:
1. How it affects the S&P 500 and other major indices
2. How a regular person might participate or is affected
3. Historical comparison: how similar events played out weeks/months later

Return ONLY: {"depth":"2-4 concrete sentences covering all three points"}`,
      }];
      const depthRes = await runSearch(client, {
        model: SYNTH_MODEL, messages: depthMessages, maxTokens: 800, maxUses: 2, useThinking: false,
      });
      const depthObj = extractJsonObject(getText(depthRes));
      if (depthObj?.depth) marketStory.depth = depthObj.depth;
    } catch (_) { /* non-blocking — depth stays empty */ }
  }

  const lead = stories.find(s => s.isLead) || stories[0];
  console.log(`   ✓ Top stories: ${stories.length} from NewsAPI (lead: "${lead.headline.slice(0, 55)}…")`);
  return stories;
}

// Fallback: original web_search path when NEWS_API_KEY is absent.
async function fetchTopStoriesViaSearch({ today, apiKey }) {
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch { return []; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const prompt = `You are the lead editor of GuyTalk, a daily brief for men 25-45. Today is ${today}.

Search for the BIGGEST news stories right now — business, markets, tech, world, culture. Exclude routine sports scores. Only include stories with real source URLs.

Return ONLY a JSON array of 4-6 objects:
[{
  "category": "Markets" | "Business" | "Tech" | "World" | "Culture",
  "headline": "tight, specific headline",
  "whatHappened": "1-2 factual sentences",
  "whyItMatters": "1-2 sentences",
  "depth": "2-4 sentences for the biggest market/business story; empty string otherwise",
  "whatToSay": "one opinionated line",
  "sources": ["https://..."],
  "isLead": true for the single biggest story
}]`;

  try {
    const messages = [{ role: 'user', content: prompt }];
    const res = await runSearch(client, { model: SYNTH_MODEL, messages, maxTokens: 8000, maxUses: 3, useThinking: false });
    const clean = (extractJsonArray(getText(res)) || [])
      .filter(s => s?.headline && Array.isArray(s.sources) && s.sources.length)
      .map(s => ({ ...s, tier: sourceTier(s.sources[0]) }));
    if (clean.length) {
      const lead = clean.find(s => s.isLead) || clean[0];
      console.log(`   ✓ Top stories (web search fallback): ${clean.length} (lead: "${lead.headline.slice(0, 48)}…")`);
    }
    return clean;
  } catch (e) {
    console.log(`   ⚠  Top stories (web search) failed: ${e.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section stories — NewsAPI entertainment (culture) + og:image for hero.
// Zero model calls, zero web searches.
// ─────────────────────────────────────────────────────────────────────────────
// Headlines that should never appear as culture items — tabloid filler with zero
// conversation value for a 25-45 male audience. Checked case-insensitively.
const CULTURE_BLOCKLIST = [
  'horoscope', 'zodiac', 'astrology',
  'custody battle', 'custody fight', 'custody dispute',
  'cheating scandal', 'cheating on',
  'divorce filing', 'files for divorce', 'finalizes divorce',
  'baby shower', 'gender reveal',
  'dating rumor', 'spotted together', 'romance rumor', 'new couple',
  'breakup', 'split from', 'calls it quits',
  'plastic surgery', 'cosmetic surgery',
  'red carpet look', 'best dressed', 'worst dressed',
];

function isCultureBlocked(title) {
  const t = (title || '').toLowerCase();
  return CULTURE_BLOCKLIST.some(b => t.includes(b));
}

async function fetchSectionStories({ dateLabel, leadSubject, issueNum, prevImageUrls = [], golf, topStories = [] } = {}) {
  const SPORTS_RE = /\b(nba|nfl|nhl|mlb|mls|soccer|ufc|mma|fight(?:er|s)?|boxing|game\s+\d|match|playoff|championship|score|world\s+cup)\b/i;

  // Culture from NewsAPI — filter out sports AND low-quality filler.
  // This is the fallback path used only when OpenAI research doesn't supply culture items.
  // Primary: entertainment. If < 3 quality items, extend with technology then general.
  const culture = [];
  const CULTURE_CATEGORIES = ['entertainment', 'technology', 'general'];
  for (const cat of CULTURE_CATEGORIES) {
    if (culture.length >= 3) break;
    const newsItems = await fetchNewsHeadlines([cat], { pageSize: 15 });
    for (const a of newsItems) {
      if (culture.length >= 3) break;
      if (SPORTS_RE.test(a.title)) continue;
      if (isCultureBlocked(a.title)) continue;
      if (culture.some(c => c.url === a.url)) continue; // no dupes across categories
      culture.push({
        headline:   a.title,
        source:     a.source,
        url:        a.url,
        fact:       a.description || a.title,
        background: '',
        no_data:    false,
      });
    }
  }

  // Hero image: og:image from the top story's first source URL
  let heroImage = null;
  if (leadSubject) {
    const prevSet = new Set((prevImageUrls || []).filter(Boolean));
    const stories = Array.isArray(topStories) ? topStories : [];
    const leadStory = stories.find(s => s.isLead) || stories[0];
    const sourceUrl = leadStory?.sources?.[0];
    if (sourceUrl) {
      try {
        const og = await extractOgImage(sourceUrl);
        if (og && !prevSet.has(og) && await isLiveImage(og)) {
          heroImage = { url: og, no_data: false };
        }
      } catch (_) {}
    }
    if (!heroImage) heroImage = { no_data: true };
  }

  const out = { culture: culture.slice(0, 3), cultureNoData: culture.length === 0, heroImage };
  console.log(`   ✓ Section research: culture:${out.culture.length} hero:${out.heroImage && !out.heroImage.no_data ? 'ok' : 'none'}`);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic sports — built from structured feed data. Zero model calls.
//
// Accepts the same feed objects generate-brief.js already fetches:
//   sports   = NBA/MLB game array (from fetchNBA / fetchMLB)
//   nhl      = { final, next } (from fetchNHL)
//   f1       = race object (from fetchF1)
//   golf     = leaderboard (from fetchGolf)
//   tennis   = { anyMajor, tours } (from fetchTennis)
//   worldCup = match array (from fetchWorldCup)
//   upcoming = upcoming NBA/MLB games (from fetchNBAUpcoming)
//
// Returns { lead, sports } — same shape as before so html.js / copy.js are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

function lookupPlayer(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const hit = Object.entries(PLAYERS).find(([n]) => n.toLowerCase() === lower);
  return hit ? hit[1] : null; // { sport, id, slug }
}

async function fetchDynamicSports({ sports, nhl, f1, golf, tennis, worldCup, upcoming, issueNum, prevImageUrls = [] } = {}) {
  const empty = { lead: null, sports: [] };
  const candidates = [];

  // ── NBA / MLB ──────────────────────────────────────────────────────────────
  if (sports?.length) {
    const g = sports[0];
    const isPost = g.home.winner !== undefined && (g.home.winner || g.away.winner);
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const sportLabel = String(g.sport || 'NBA').toUpperCase();
    const seriesPart = g.seriesNote ? ` (${g.seriesNote})` : '';
    const note       = g.note || g.shortName || `${g.away.team} at ${g.home.team}`;
    const headline   = isPost
      ? `${w.team} ${w.score}–${l.score} over ${l.team}${seriesPart}`
      : `${g.away.team} vs. ${g.home.team} tonight${seriesPart}`;
    const facts      = isPost
      ? `${w.team} beat ${l.team} ${w.score}–${l.score}${seriesPart}`
      : `${g.away.team} vs. ${g.home.team}${seriesPart}`;
    const { score: imp } = scoreImportance({ name: `${sportLabel} ${note}`, headline, facts, isFinalResult: isPost });
    candidates.push({
      name: note, label: sportLabel, category: 'team',
      headline, facts, background: '', source: 'ESPN', url: '', imageUrl: null, videoUrl: null, isLead: false,
      _score: imp, _isFinal: isPost, _sport: String(g.sport || 'nba').toLowerCase(),
    });
  }

  // ── NHL ───────────────────────────────────────────────────────────────────
  const nhlGame = nhl?.final || nhl?.next;
  if (nhlGame) {
    const isPost     = !!nhl.final;
    const g          = nhlGame;
    const seriesPart = g.seriesNote ? ` (${g.seriesNote})` : '';
    const note       = g.note || g.shortName || '';
    const notePart   = note ? ` [${note}]` : '';
    let headline, facts;
    if (isPost) {
      const w = g.home.winner ? g.home : g.away;
      const l = g.home.winner ? g.away : g.home;
      // If this is the Stanley Cup Final and Carolina won, add their last win year
      // so copy writers don't invent "first in franchise history" (they won in 2006).
      const isSCFinal  = note?.includes('Stanley Cup Final') || seriesPart.includes('wins series');
      const carNote    = isSCFinal && w.team?.toLowerCase().includes('carolina') ? ' [CAR last won in 2006 — this is their 2nd title]' : '';
      headline = `${w.team} ${w.score}–${l.score}${seriesPart}${notePart}${carNote}`;
      facts    = `${w.team} beat ${l.team} ${w.score}–${l.score}${seriesPart}${notePart}${carNote}`;
    } else {
      headline = `${g.away?.team} at ${g.home?.team}${seriesPart}${notePart}`;
      facts    = headline;
    }
    const { score: imp } = scoreImportance({ name: `NHL ${note}`, headline, facts, isFinalResult: isPost });
    candidates.push({
      name: note || headline, label: 'NHL', category: 'team',
      headline, facts, background: '', source: 'ESPN', url: '', imageUrl: null, videoUrl: null, isLead: false,
      _score: imp, _isFinal: isPost, _sport: 'nhl',
    });
  }

  // ── F1 ────────────────────────────────────────────────────────────────────
  if (f1?.name) {
    const isPost   = f1.statusState === 'post' && !!f1.results?.length;
    const winner   = isPost ? f1.results[0] : null;
    const headline = isPost
      ? `${winner.driver} wins ${f1.shortName || f1.name}`
      : `${f1.name} — this weekend`;
    const facts    = isPost
      ? `P1 ${winner.driver} (${winner.team}), P2 ${f1.results[1]?.driver || '—'}, P3 ${f1.results[2]?.driver || '—'}`
      : `${f1.name} upcoming`;
    const { score: imp } = scoreImportance({ name: f1.name, headline, facts, isFinalResult: isPost });
    candidates.push({
      name: f1.name, label: 'F1', category: 'individual',
      headline, facts, background: '', source: 'ESPN', url: '', imageUrl: null, videoUrl: null, isLead: false,
      _score: imp, _isFinal: isPost, _sport: 'f1', _f1Winner: winner,
    });
  }

  // ── Golf ──────────────────────────────────────────────────────────────────
  if (golf?.name) {
    const isPost   = golf.statusState === 'post';
    const isIn     = golf.statusState === 'in';
    const leader   = golf.leaders?.[0];
    const headline = isPost && leader
      ? `${leader.name} wins ${golf.name}`
      : `${golf.name}${isIn ? ' — in progress' : ' — this week'}`;
    const hasStarted = golf.hasStarted === true;
    const topThree = (golf.leaders || []).slice(0, 3);
    const leaderStr = topThree.length
      ? topThree.map(l2 => `${l2.pos || ''} ${l2.name}: ${l2.score}`.trim()).join(', ')
      : golf.name;
    // Prefix facts with explicit status so Haiku never invents scores or winners
    const facts = isPost
      ? `FINAL RESULT: ${leaderStr}`
      : (isIn && hasStarted)
        ? `LEADERBOARD (IN PROGRESS — no winner yet): ${leaderStr}`
        : `PREVIEW ONLY — tournament has not started. No scores or leaders exist yet. Write as a preview: course, favorites, what to watch.`;
    const { score: imp } = scoreImportance({ name: golf.name, headline, facts, isFinalResult: isPost });
    candidates.push({
      name: golf.name, label: 'Golf', category: 'individual',
      headline, facts, background: '', source: 'ESPN', url: '', imageUrl: null, videoUrl: null, isLead: false,
      _score: imp, _isFinal: isPost, _sport: 'golf', _golfLeader: leader,
    });
  }

  // ── Tennis (Grand Slams only) ─────────────────────────────────────────────
  if (tennis?.anyMajor) {
    const slam = tennis.tours?.find(t => t.isMajor);
    if (slam?.results?.length) {
      const r        = slam.results[slam.results.length - 1];
      const headline = `${r.winner} at ${slam.name}`;
      const facts    = slam.results.map(r2 => `${r2.winner} d. ${r2.loser}`).join('; ');
      const { score: imp } = scoreImportance({ name: `Grand Slam ${slam.name}`, headline, facts, isFinalResult: false });
      candidates.push({
        name: slam.name, label: 'Tennis', category: 'individual',
        headline, facts, background: '', source: 'ESPN', url: '', imageUrl: null, videoUrl: null, isLead: false,
        _score: imp, _isFinal: false, _sport: 'tennis',
      });
    }
  }

  // ── World Cup ─────────────────────────────────────────────────────────────
  if (worldCup?.length) {
    const USA_RE = /\bunited states\b|\busmnt\b|\busa\b/i;

    // Prefer completed games — biggest result first (highest combined goals = most exciting)
    const completed = worldCup.filter(m => m.statusState === 'post');
    const scheduled = worldCup.filter(m => m.statusState === 'pre' || m.statusState === 'in');

    // Pick the most compelling completed match: US game first, then highest-scoring
    const featured = completed.find(m => USA_RE.test(m.home.team) || USA_RE.test(m.away.team))
      || completed.sort((a, b) => {
          const goalsB = (parseInt(b.home.score,10)||0) + (parseInt(b.away.score,10)||0);
          const goalsA = (parseInt(a.home.score,10)||0) + (parseInt(a.away.score,10)||0);
          return goalsB - goalsA;
        })[0]
      || scheduled.find(m => USA_RE.test(m.home.team) || USA_RE.test(m.away.team))
      || scheduled[0];

    if (featured) {
      const isPost = featured.statusState === 'post';
      let headline, facts;

      if (isPost) {
        // Rich recap: headline on the biggest game, full yesterday slate + scorers as facts
        const hs = parseInt(featured.home.score, 10) || 0;
        const as = parseInt(featured.away.score, 10) || 0;
        const [wt, ws, lt, ls] = hs >= as
          ? [featured.home.team, hs, featured.away.team, as]
          : [featured.away.team, as, featured.home.team, hs];
        headline = `${wt} ${ws}–${ls} ${lt}`;

        // Full results recap with scorers
        const recapLines = completed.map(m => {
          const mh = parseInt(m.home.score, 10) || 0;
          const ma = parseInt(m.away.score, 10) || 0;
          const [wt2, ws2, lt2, ls2] = mh >= ma ? [m.home.team, mh, m.away.team, ma] : [m.away.team, ma, m.home.team, mh];
          const scorers = (m.goals || [])
            .filter(g => g.player)
            .map(g => `${g.player} (${g.clock}${g.type.includes('Penalty') ? ' pen' : ''})`)
            .join(', ');
          const note = m.espnNote ? ` NOTE: ${m.espnNote.slice(0, 120)}` : '';
          return `${wt2} ${ws2}–${ls2} ${lt2}${scorers ? ` | Scorers: ${scorers}` : ''}${note}`;
        }).join('\n');

        // Today's upcoming slate for "what to watch next"
        const upcomingLines = scheduled.length
          ? `\nTODAY'S FIXTURES: ${scheduled.map(m => {
              const t = m.date ? new Date(m.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '';
              return `${m.away.team} vs. ${m.home.team}${t ? ` (${t} EDT)` : ''}`;
            }).join('; ')}`
          : '';

        facts = `YESTERDAY'S WORLD CUP RESULTS:\n${recapLines}${upcomingLines}\n\nPLAYERS TO KNOW (link these in copy using class="entity-person" on first mention):\n- Harry Kane (England captain): wikipedia.org/wiki/Harry_Kane\n- Jude Bellingham (England): wikipedia.org/wiki/Jude_Bellingham\n- Cristiano Ronaldo (Portugal): wikipedia.org/wiki/Cristiano_Ronaldo\n- Luis Díaz (Colombia): wikipedia.org/wiki/Luis_D%C3%ADaz_(footballer,_born_1997)\n- Romano Schmid (Austria): en.wikipedia.org/wiki/Romano_Schmid\nInclude 2-3 of these as "Players to Know" in the section. Write a proper recap, not a fixture list.`;
      } else {
        // No completed results — preview today's slate with group context
        const allMatches = scheduled;
        headline = allMatches.length > 1
          ? `FIFA World Cup 2026 — ${allMatches.length} matches today`
          : `${featured.away.team} vs. ${featured.home.team}`;
        facts = `TODAY'S WORLD CUP SLATE:\n${allMatches.map(m => {
          const t = m.date ? new Date(m.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '';
          return `${m.away.team} vs. ${m.home.team}${t ? ` (${t} EDT)` : ''}`;
        }).join('\n')}\nWrite as a World Cup preview: group stakes, key storylines, players to watch. Do NOT invent scores.`;
      }
      const { score: imp } = scoreImportance({ name: 'World Cup FIFA 2026 championship soccer', headline, facts, isFinalResult: isPost });
      candidates.push({
        name: 'FIFA World Cup 2026', label: 'World Cup', category: 'team',
        headline, facts, background: '', source: 'ESPN', url: '', imageUrl: null, videoUrl: null, isLead: false,
        _score: imp, _isFinal: isPost, _sport: 'worldcup',
      });
    }
  }

  // All candidates built from ESPN structured feeds — Tier 1 by definition.
  candidates.forEach(c => { c.tier = 1; });

  // ── Filter, rank, take top MAX_SPORTS ─────────────────────────────────────
  const filtered = candidates.filter(c => !isExcluded(c.name) && !isExcluded(c.label));
  if (!filtered.length) {
    console.log('   ⚠  No feed data produced valid sports candidates — check feed fetchers');
    return empty;
  }
  filtered.sort((a, b) => b._score - a._score);
  const top = filtered.slice(0, MAX_SPORTS);

  // ── Resolve images in parallel ────────────────────────────────────────────
  const prevSet = new Set((prevImageUrls || []).filter(Boolean));
  await Promise.allSettled(top.map(async (s) => {
    let img = null;
    // Prefer venue/course images (Wikimedia Commons, official media) over ESPN headshots.
    // buildGolf/buildF1 in html.js have their own curated course/circuit fallbacks,
    // so null here means html.js falls back cleanly — no ESPN thumbnail or headshot needed.
    if (s.label === 'Golf' || s.label === 'F1') {
      img = SECTION_FALLBACKS[s._sport] || null;
    } else {
      // Team sport: use sport-specific hero fallback
      img = SECTION_FALLBACKS[s._sport] || SECTION_FALLBACKS.sports;
    }
    // Skip if URL was used in the previous issue
    s.imageUrl = (img && !prevSet.has(img)) ? img : null;
    // Clean internal bookkeeping fields
    delete s._score; delete s._isFinal; delete s._sport; delete s._golfLeader; delete s._f1Winner;
  }));

  top[0].isLead = true;
  console.log(`   ✓ Feed sports (${top.length}): ${top.map(s => `${s.isLead ? '★ ' : ''}${s.label}${s.imageUrl ? ' 🖼' : ''}`).join(', ')}`);
  return { lead: top[0], sports: top };
}

module.exports = { fetchTopStories, fetchSectionStories, fetchDynamicSports };
