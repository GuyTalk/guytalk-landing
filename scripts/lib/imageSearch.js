'use strict';

/**
 * Web-search-powered image finder.
 *
 * Given a plain-language query ("FIFA World Cup England Croatia match photo"),
 * asks OpenAI web_search to find recent news articles, then extracts og:images
 * from the cited URLs. Falls back to a caller-supplied URL on failure.
 *
 * This is the right way to get contextually correct images: ask GPT to search,
 * then scrape the og:image from whatever news pages it found. Don't ask GPT to
 * invent direct image URLs — CDN links hallucinate badly.
 */

const { extractOgImage, isLiveImage, looksIrrelevant, resolveWikimedia, cleanImageUrl, IMAGE_EXT_RE } = require('./images');

const SEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1';

/**
 * Search for a contextually relevant action/news photo.
 *
 * @param {string} query   Plain-language description, e.g. "England Croatia World Cup 2026 match photo"
 * @param {object} opts
 * @param {string|null} opts.fallback  URL to return if search fails
 * @returns {Promise<string|null>}
 */
async function searchWebImage(query, { fallback = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) { return fallback; }

  const client = new (OpenAI.default || OpenAI)({ apiKey });
  if (typeof client.responses?.create !== 'function') return fallback;

  const prompt = `Search for recent news coverage of: "${query}"

Find the most recent articles (today or yesterday) from major sports/news outlets.
I need articles that include good action or news photos.
Just search and summarize what you found — I'll use the source URLs.`;

  try {
    const response = await client.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
      input: [{ role: 'user', content: prompt }],
    });

    // Extract citation URLs from annotations — this is the proven extraction pattern.
    const citedUrls = [];
    (response.output || []).forEach(block => {
      if (block.type === 'message') {
        (block.content || []).forEach(c => {
          (c.annotations || []).forEach(a => {
            if (a.type === 'url_citation' && a.url) {
              const clean = a.url.replace(/[?&]utm_source=openai/, '').replace(/[?&]$/, '');
              citedUrls.push(clean);
            }
          });
        });
      }
    });

    // Also scan response text for direct .jpg/.png/.webp URLs (rare but fast)
    const text = response.output_text || (response.output || [])
      .filter(b => b.type === 'message')
      .flatMap(b => Array.isArray(b.content) ? b.content : [])
      .filter(c => c?.type === 'output_text' || c?.type === 'text')
      .map(c => c.text || '')
      .join('');

    const directImgUrls = (text.match(/https?:\/\/[^\s"'<>)]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'<>)]*)?/gi) || []);

    // Try direct image URLs first (fastest path — usually CDN links in og:image values)
    for (const url of directImgUrls) {
      const resolved = cleanImageUrl(resolveWikimedia(url) || url);
      if (!looksIrrelevant(resolved) && await isLiveImage(resolved)) {
        console.log(`   🖼  imageSearch hit (direct): ${resolved.slice(0, 80)}`);
        return resolved;
      }
    }

    // Try og:image from each cited article — this is the main path
    for (const url of citedUrls.slice(0, 6)) {
      try {
        const og = await extractOgImage(url);
        if (og && !looksIrrelevant(og)) {
          const ogResolved = cleanImageUrl(resolveWikimedia(og) || og);
          if (await isLiveImage(ogResolved)) {
            console.log(`   🖼  imageSearch hit (og): ${ogResolved.slice(0, 80)}`);
            return ogResolved;
          }
        }
      } catch (_) { /* skip this URL */ }
    }

    console.log(`   ⚠  imageSearch: no valid image for "${query.slice(0, 60)}"`);
    return fallback;
  } catch (err) {
    console.error(`[imageSearch] "${query.slice(0, 60)}": ${err.message}`);
    return fallback;
  }
}

/**
 * Build a sport-specific image search query from a dynamicSports candidate object.
 */
function buildSportImageQuery(s) {
  // Normalize sport type from _sport / sportType fields or label/name fallback
  const label = (s.label || s.name || '').toLowerCase();
  const sport = s._sport || s.sportType ||
    (/world.?cup|soccer|fifa/.test(label) ? 'worldcup' :
     /\bf1\b|formula/.test(label) ? 'f1' :
     /golf|pga/.test(label) ? 'golf' :
     /\bmlb\b|baseball/.test(label) ? 'mlb' :
     /\bnba\b|basketball/.test(label) ? 'nba' :
     /\bnhl\b|hockey/.test(label) ? 'nhl' :
     /tennis/.test(label) ? 'tennis' : '');
  const name    = s.name    || '';
  const hl      = s.headline || '';

  if (sport === 'worldcup') {
    // Try to extract home team from headline like "England 4–2 Croatia"
    const m = hl.match(/^([A-Za-z ]+?)\s+\d/);
    const teams = m ? m[1].trim() : '';
    return teams
      ? `FIFA World Cup 2026 ${teams} match action photo soccer`
      : 'FIFA World Cup 2026 soccer match action photo players';
  }
  if (sport === 'f1') {
    // Extract winner name from headline like "Charles Leclerc wins British Grand Prix"
    const winnerM = hl.match(/^([A-Za-z ]+?)\s+wins/i);
    const winner = winnerM ? winnerM[1].trim() : '';
    return winner
      ? `${winner} ${name} 2026 F1 race winner podium action photo site:formula1.com OR site:autosport.com OR site:crash.net OR site:motorsport.com`
      : `Formula 1 ${name} 2026 race winner podium action photo site:formula1.com OR site:autosport.com OR site:crash.net`;
  }
  if (sport === 'golf') {
    const leaderM = hl.match(/^([A-Za-z ]+?)\s+(wins|leads)/i);
    const leader = leaderM ? leaderM[1].trim() : '';
    return leader
      ? `${leader} ${name} 2026 golf action photo site:pgatour.com OR site:cbssports.com OR site:golfchannel.com OR site:golf.com`
      : `${name} 2026 PGA Tour golf leaderboard action photo player`;
  }
  if (sport === 'mlb') {
    const m = hl.match(/^(.+?)\s+\d+[–\-]/);
    const team = m ? m[1].trim() : name;
    return `${team} MLB baseball game action photo 2026`;
  }
  if (sport === 'nba') return 'NBA basketball playoff action photo 2026';
  if (sport === 'nhl') return 'NHL Stanley Cup hockey action photo 2026';
  if (sport === 'tennis') return `${name} tennis action photo 2026`;
  return `${name} sports action photo`;
}

/**
 * Build an image search query for a non-sports lead (markets, politics, tech).
 */
function buildLeadImageQuery(heroOverride) {
  if (!heroOverride) return null;
  const title = heroOverride.title || '';
  const eyebrow = heroOverride.eyebrow || '';
  if (!title) return null;

  const lower = title.toLowerCase();
  if (/fed\b|federal reserve|rate|powell|warsh/.test(lower)) {
    return `Federal Reserve press conference photo ${title.slice(0, 40)} 2026`;
  }
  if (/market|stocks?|nasdaq|s&p|dow/.test(lower)) {
    return `stock market news photo Wall Street 2026`;
  }
  if (/white house|president|executive/.test(lower)) {
    return `White House president news photo 2026`;
  }
  return `${eyebrow} ${title.slice(0, 50)} news photo 2026`;
}

/**
 * Search YouTube for highlight/recap video of a sports event.
 * Returns a youtube.com/watch?v=... URL or null.
 */
async function searchWebVideo(query, { fallback = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) { return fallback; }
  const client = new (OpenAI.default || OpenAI)({ apiKey });
  if (typeof client.responses?.create !== 'function') return fallback;

  const prompt = `Find a YouTube highlight or recap video for: "${query}"

I need the direct YouTube URL (youtube.com/watch?v=...) for an actual video — not a search results page. Look for official league channels, ESPN, or broadcast highlight clips.`;

  try {
    const response = await client.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      tool_choice: 'required',
      input: [{ role: 'user', content: prompt }],
    });

    const text = (response.output_text || (response.output || [])
      .filter(b => b.type === 'message')
      .flatMap(b => Array.isArray(b.content) ? b.content : [])
      .map(c => c.text || '')
      .join(''));

    // YouTube watch URLs only (11-char video ID)
    const ytMatch = text.match(/https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      console.log(`   🎬  videoSearch hit: ${ytMatch[0].slice(0, 80)}`);
      return ytMatch[0];
    }

    // Try citation URLs for YouTube
    const citedUrls = [];
    (response.output || []).forEach(block => {
      if (block.type === 'message') {
        (block.content || []).forEach(c => {
          (c.annotations || []).forEach(a => {
            if (a.type === 'url_citation' && a.url) citedUrls.push(a.url);
          });
        });
      }
    });

    const ytCitation = citedUrls.find(u => /youtube\.com\/watch\?v=/.test(u));
    if (ytCitation) {
      console.log(`   🎬  videoSearch hit (citation): ${ytCitation.slice(0, 80)}`);
      return ytCitation;
    }

    return fallback;
  } catch (err) {
    console.error(`[searchWebVideo] "${query.slice(0, 60)}": ${err.message}`);
    return fallback;
  }
}

/**
 * Build a sport-specific video search query for YouTube highlights.
 */
function buildSportVideoQuery(s) {
  const sport = s._sport || '';
  const hl    = s.headline || '';
  const name  = s.name || '';

  if (sport === 'worldcup') {
    const m = hl.match(/^([A-Za-z ]+?)\s+\d/);
    const teams = m ? m[1].trim() : '';
    return teams ? `${teams} FIFA World Cup 2026 highlights YouTube` : null;
  }
  if (sport === 'f1') return `Formula 1 ${name} 2026 race highlights YouTube`;
  if (sport === 'golf') return `${name} 2026 golf highlights YouTube`;
  if (sport === 'mlb') {
    const m = hl.match(/^(.+?)\s+\d+[–\-]/);
    const team = m ? m[1].trim() : name;
    return team ? `${team} MLB highlights 2026 YouTube` : null;
  }
  if (sport === 'nba') return `NBA ${name} highlights 2026 YouTube`;
  if (sport === 'nhl') return `NHL ${name} highlights 2026 YouTube`;
  return null;
}

module.exports = { searchWebImage, buildSportImageQuery, buildLeadImageQuery, searchWebVideo, buildSportVideoQuery };
