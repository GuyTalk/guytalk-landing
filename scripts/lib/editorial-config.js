'use strict';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  GuyTalk EDITORIAL CONFIG — the one place to tune what leads and what runs.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Two things live here, both meant to be edited by hand (no code change needed
 *  elsewhere):
 *
 *   1. SECTION_RULES — which leagues/topics are allowed in the brief.
 *   2. IMPORTANCE_TIERS — how a sports story is scored, so The Lead and the
 *      order of the Sports subsections reflect real significance, not recency
 *      or whatever the discovery model happened to list first.
 *
 *  Used by:
 *   - research.js   (drops EXCLUDEd sports during discovery; scores + sorts the
 *                    surviving sports so the top one becomes The Lead)
 *   - generate-brief.js (safety-net EXCLUDE filter + ranked hero selection)
 *
 *  Edit freely — higher score = closer to the top.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1) SECTION INCLUSION RULES
//
//    EXCLUDE wins over INCLUDE. Matching is case-insensitive substring against
//    the discovered sport/topic name (e.g. "WNBA", "Women's National Basketball
//    Association"). Leave INCLUDE empty to allow everything that isn't excluded.
//
//    To bring WNBA back later (a playoff/Finals run), just delete it from EXCLUDE
//    — or move it to INCLUDE to force it in.
// ─────────────────────────────────────────────────────────────────────────────
const SECTION_RULES = {
  // Always allow these even if they'd otherwise be borderline (substring match).
  // Empty = no forced inclusions.
  INCLUDE: [],

  // Never run these. Substring, case-insensitive.
  EXCLUDE: [
    'WNBA',
    "Women's National Basketball",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) STORY IMPORTANCE TIERS
//
//    Each sports story gets a score = its highest-matching tier's points, plus
//    small bonuses. The Lead is the single highest-scoring story; the Sports
//    subsections below it are ordered by score descending (NOT a fixed league
//    order). Tune the points or add/remove patterns as needed.
//
//    Tier 1 (lead candidates): championship-deciding games, title wins, series
//            clinchers, historic firsts/records, a major league's Finals.
//    Tier 2: playoff / elimination games, marquee regular-season matchups,
//            major tournament finals.
//    Tier 3: regular-season & group-stage results, undercard events.
// ─────────────────────────────────────────────────────────────────────────────
const IMPORTANCE_TIERS = [
  {
    tier: 1,
    score: 100,
    // Title-deciders, historic firsts, finals/cup wins.
    patterns: [
      /\bfinals?\b/i,
      /\bchampionship\b/i,
      /\bstanley cup\b/i,
      /\bworld series\b/i,
      /\bsuper bowl\b/i,
      /\btitle\b/i,
      /\bclinch(?:ed|er|es)?\b/i,
      /\bseries (?:win|clinch|sweep)/i,
      /\bcrowned?\b/i,
      /\bwins? the (?:cup|title|championship|series)\b/i,
      /\bfirst[- ]ever\b/i,
      /\bhistoric\b/i,
      /\brecord(?:[- ]breaking| set| books)?\b/i,
      /\bgame\s*7\b/i,
    ],
  },
  {
    tier: 2,
    score: 60,
    // Postseason / elimination / marquee matchups / tournament finals.
    patterns: [
      /\bplayoffs?\b/i,
      /\belimination\b/i,
      /\bsemifinals?\b/i,
      /\bconference (?:finals?|semifinals?)\b/i,
      /\bquarterfinals?\b/i,
      /\bknockout\b/i,
      /\bround of 16\b/i,
      /\bgame\s*[3-6]\b/i,
      /\bgrand slam\b/i,
      /\b(?:masters|open|grand prix|gp)\b/i,
      /\bderby\b/i,
      /\brivalry\b/i,
    ],
  },
  {
    tier: 3,
    score: 20,
    // Routine results, group stage, undercards. The default floor.
    patterns: [
      /\bgroup stage\b/i,
      /\bregular season\b/i,
      /\bfriendly\b/i,
      /\bundercard\b/i,
      /\bpreseason\b/i,
      /\bexhibition\b/i,
    ],
  },
];

const DEFAULT_TIER_SCORE = 20; // anything that matches nothing sits at the Tier-3 floor.

// Small additive nudges that don't belong to a tier.
const SCORE_BONUS = {
  isFinalResult: 8, // a finished result outranks a vague preview at the same tier
};

// Leagues/sports that, all else equal, a US male 25-45 audience cares most about.
// A gentle tiebreaker only (max +5) — never enough to beat a real tier gap.
const LEAGUE_AFFINITY = [
  { score: 5, patterns: [/\bnfl\b/i, /\bnba\b/i] },
  { score: 4, patterns: [/\bnhl\b/i, /\bmlb\b/i, /\bufc\b/i, /\bcollege football\b/i, /\bcfb\b/i] },
  { score: 3, patterns: [/\bf1\b/i, /formula\s*1/i, /\bgolf\b/i, /\bpga\b/i, /\bboxing\b/i] },
  { score: 2, patterns: [/\bsoccer\b/i, /\bworld cup\b/i, /\bpremier league\b/i, /\btennis\b/i] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// True if a discovered sport/topic name is on the EXCLUDE list (and not force-INCLUDEd).
function isExcluded(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  if (SECTION_RULES.INCLUDE.some((inc) => n.includes(String(inc).toLowerCase()))) return false;
  return SECTION_RULES.EXCLUDE.some((exc) => n.includes(String(exc).toLowerCase()));
}

// Score a sports story by importance. `text` should bundle every signal we have
// (name + headline + facts), since tier keywords ("clinch", "Game 7", "Finals")
// usually live in the headline/facts, not the bare league name.
function scoreImportance({ name = '', headline = '', facts = '', isFinalResult = false } = {}) {
  const text = `${name} ${headline} ${facts}`;
  let tierScore = DEFAULT_TIER_SCORE;
  let tier = 3;
  for (const t of IMPORTANCE_TIERS) {
    if (t.patterns.some((re) => re.test(text))) { tierScore = t.score; tier = t.tier; break; }
  }
  let affinity = 0;
  for (const a of LEAGUE_AFFINITY) {
    if (a.patterns.some((re) => re.test(text))) { affinity = a.score; break; }
  }
  const bonus = (isFinalResult ? SCORE_BONUS.isFinalResult : 0) + affinity;
  return { score: tierScore + bonus, tier };
}

module.exports = {
  SECTION_RULES,
  IMPORTANCE_TIERS,
  isExcluded,
  scoreImportance,
};
