# GuyTalk — Compliance & Factuality Policy

_Last audited: 2026-06-07. Applies to **GuyTalk Live** (`/live`) and the **Daily Brief** (`/brief/*`)._

GuyTalk publishes sports, markets, and culture information. This document defines
where our data comes from, what we will and will not publish, and the technical
safeguards that keep AI-generated copy grounded in real, sourced facts.

**Core principle:** _Prefer showing nothing over showing unverified information._
Every factual claim must trace to an identified source. AI may summarize, explain,
and suggest conversation — it may never invent facts.

---

## 1. Approved data sources

| Section | Source | Type | Live? |
|---|---|---|---|
| Live Now | ESPN public scoreboard API | Sourced data | Yes (≤60s) |
| Formula 1 (race/grid/results) | ESPN racing API | Sourced data | Yes (≤60s) |
| Formula 1 (standings) | Jolpica/Ergast API (`api.jolpi.ca`) | Sourced data | Yes |
| Golf | ESPN golf API | Sourced data | Yes (≤60s) |
| Scoreboard (MLB/NFL/NBA/NHL/CFB/CBB) | ESPN public scoreboard API | Sourced data | Yes (≤60s) |
| Markets | Yahoo Finance chart API (real indices/futures, not ETF proxies) | Sourced data | Yes (≤60s) |
| Trending Stories | ESPN news API + NewsAPI | Sourced headlines + links | Yes (≤15m) |
| Trending "why it matters" | Claude (Anthropic) | **AI interpretation** (grounded) | Yes (≤15m) |
| The Rundown | Claude (Anthropic) | **AI summary** (grounded) | Yes (≤15m) |
| What Everyone's Talking About | Claude (Anthropic) | **AI interpretation** (grounded) | Yes (≤15m) |
| Daily Brief (all copy) | Claude (Haiku writer + Sonnet editor) | **AI copy** over sourced facts | Daily |

**Sourced data vs. AI interpretation are visibly separated** in the UI: every
section shows a source label ("Updated X ago · ESPN / NewsAPI / Finnhub /
Claude AI / Derived"), and AI synthesis lives in clearly marked modules
("The Rundown", "The GuyTalk Read", "What to say").

### Source provenance is machine-tracked
`/api/live` and `/api/talk` each return a `sources` object tagging every section
(`espn`, `espn+jolpica`, `finnhub`, `ESPN · NewsAPI`, `ai`, `derived`). The page
renders these as the visible labels above.

---

## 2. Prohibited content

We never publish, and AI is instructed never to generate:

- Fabricated **scores, standings, statistics, injuries, rankings, quotes, player
  news, or market data**.
- **Predictions or speculation presented as fact** or as reporting.
- Any **investment advice** (see §4).
- An event marked **"Final"** that the source has not confirmed as completed.
- **Stale / wrong-season** standings or results (see §5).

---

## 3. AI guardrails

**AI is used only in:** the Rundown, Trending "why it matters", "What Everyone's
Talking About" (`/api/talk`), and Daily Brief copy (`scripts/lib/copy.js`).
**AI is never used** to produce scores, standings, or market numbers — those are
direct API pass-through with no model in the loop.

AI **may**: summarize sourced material, explain why something matters, and write
"What to say" conversation lines (opinion is allowed and labeled as such).

AI **may not**: invent facts; present speculation or predictions as fact; present
opinion as reporting; give financial advice.

**Enforcement (in the prompts):**
- `/api/talk` (`buildAI`) system prompt — "COMPLIANCE RULES (non-negotiable)":
  use only provided facts; never invent scores/stats/standings/injuries/rankings/
  quotes/player-news/events; no speculation-as-fact; financial restrictions; omit
  unsupported claims.
- The AI is given the **real headlines + real market numbers as its only inputs**;
  "why it matters" is mapped back onto the real story (which keeps its real link).
- Daily Brief (`scripts/lib/copy.js`) — "HALLUCINATION RULES (non-negotiable)":
  only use supplied data; never invent player names/stats/scores; describe teams,
  not players, when only team-level data exists; "Only use stories confirmed in
  trending data — never invent events."

**Fallback when AI is unavailable or fails:** `/api/talk` degrades to a
deterministic `derived` mode built **only** from real headlines (no model), and
the Rundown is **hidden entirely** (we do not fake it). Labeled `Derived`.

---

## 4. Financial-content restrictions

**GuyTalk is informational only. It is not an investment advisor.**

The Markets section and any market commentary describe **what happened, not what
to do**. We never publish:

- Buy / sell / hold language or recommendations
- Price targets or valuations ("undervalued/overvalued")
- "Buying opportunity", "smart money move", "consider adding/reducing"
- Portfolio allocation, tax, or retirement advice

**Enforcement:**
- Markets data is raw value / change / % (Finnhub) with an on-page disclaimer:
  _"Market data is informational only and is not investment advice. Values via
  index-tracking proxies; figures may be delayed."_ (`live/app.js`)
- The Rundown AI prompt forbids advice/targets and requires "observe and explain,
  never advise."
- **Server-side guard (defense-in-depth):** `api/talk.js` runs every AI output
  (Rundown, "why", talking points) through a financial-advice regex (`FIN_ADVICE`).
  Any line containing buy/sell/hold, price target, valuation, "investors should",
  etc. is dropped before it ships — the Rundown is removed entirely; offending
  talking points are filtered out. Prompt + code, not prompt alone.
- The Daily Brief prompt (`scripts/lib/copy.js`) carries an explicit banned-phrase
  list (price target, buying opportunity, portfolio, investors should, etc.) and
  "ALWAYS frame markets as what happened and why — never what the reader should do."

---

## 5. Sports & event accuracy (source verification)

- **Event state** comes from the source's own status (`pre` / `in` / `post`).
  "Final" is shown **only** when the source reports the session completed.
- **Formula 1 — current-season safeguard:** if the event's `season.year` ≠ the
  current year, the entire F1 section is dropped (guards against stale/cached
  cross-season events). (`api/live.js` SAFEGUARD 1)
- **Formula 1 — correct session:** the API reads the actual Race / Qualifying /
  Practice session (never `competitions[0]` blindly), and only labels a result
  "Final" when that race session is completed; otherwise it's treated as upcoming
  (grid + next session time). (`api/live.js` SAFEGUARD 2)
- **Standings** are pulled live and labeled with the validated season year.
- **No fabrication on miss:** any section the API can't verify returns `null`;
  the page then shows an honest empty state (production) — never invented scores.

---

## 6. Hallucination safeguards (summary)

1. Scores / standings / markets are **API pass-through, no AI** → zero hallucination surface.
2. AI inputs are **restricted to real fetched data**; prompts forbid invention.
3. AI **"why"** is attached to the **real** story it references (keeps the real link).
4. **Graceful degradation:** AI failure → deterministic `derived` mode from real
   headlines; Rundown hidden.
5. **Production never shows MOCK/editorial placeholder content.** MOCK data exists
   only for local development and always renders with a visible "Mock Data" badge
   (dev-only). In production, missing data → honest empty state.
6. **Source + freshness labels** on every section so readers can judge recency.

---

## 7. Verification status

| System | Status | Evidence |
|---|---|---|
| Live — scores/markets are sourced, no AI | ✅ | `api/live.js` pass-through |
| Live — AI grounded + compliance prompt | ✅ | `api/talk.js` `buildAI` system prompt |
| Live — financial restrictions | ✅ | markets disclaimer + AI prompt + no advice |
| Live — F1 season/session safeguards | ✅ | `api/live.js` SAFEGUARD 1 & 2 |
| Live — no fabricated fallback in prod | ✅ | `live/app.js` `renderTalk` (this audit) |
| Live — source transparency | ✅ | `sources{}` + visible labels |
| Brief — hallucination rules | ✅ | `scripts/lib/copy.js` HALLUCINATION RULES |
| Brief — financial restrictions | ✅ | `scripts/lib/copy.js` banned-phrase list |
| Brief — human VERIFY checklist | ✅ | `scripts/generate-brief.js` `[VERIFY]` items |

**Both GuyTalk Live and the Daily Brief follow the rules in this document.**

---

## 8. Remaining risk areas & recommendations

- **AI tone drift on opinion lines.** "What to say" is intentionally opinionated.
  Opinions are permitted, but a confidently-worded opinion can read as fact.
  _Mitigation in place:_ grounded inputs + compliance prompt. _Recommended:_
  periodic spot-check of `/api/talk` output; consider a lightweight post-generation
  validator that rejects any "say" line containing buy/sell/price-target tokens.
- **Upstream source errors.** ESPN/Jolpica/NewsAPI/Finnhub can themselves be wrong
  or delayed. We label freshness and source; we cannot independently verify their
  data. _Recommended:_ keep the daily-brief human `[VERIFY]` step.
- **Derived "what to say" is generic.** Safe but low-value when AI is off.
  _Recommended:_ keep the Anthropic key funded so AI mode stays on.
- **Financial-term guard is regex-based.** A server-side `FIN_ADVICE` filter now
  blocks advice language in AI output (implemented this audit). Regexes can miss
  novel phrasings. _Recommended:_ expand the pattern list as new cases surface.
- **Real player/driver imagery** would require a licensed feed (e.g., SportsData.io).
  Until then we use flags/logos/colors only — no scraping of copyrighted images.

---

_Owner: GuyTalk. Questions: guytalkdaily@gmail.com. Review this document whenever a
new data source or AI surface is added._
