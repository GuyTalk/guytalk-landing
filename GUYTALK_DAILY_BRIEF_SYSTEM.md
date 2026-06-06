# GuyTalk Daily Brief — Operating Reference

> **Core value:** Tell readers what happened, why it matters, and what to say about it.
> This document is the source of truth for daily brief production. Any Claude session, agent, or editor working on GuyTalk should read this first.

---

## 1. Brand Positioning

**GuyTalk** is a daily brief for men 25–45 who want to stay sharp on sports, markets, and culture without spending 45 minutes on their phone every morning. Five minutes a day. Free. No algorithm.

The voice is: a smart friend who watched the game, checked the tape, and can hold a conversation with anyone from a banker to a bartender. Not a sports reporter. Not a financial advisor. The guy at the table who just knows things.

**The brief answers three questions for every section:**
1. What happened?
2. Why does it matter?
3. What can I say about this tonight?

If a section doesn't answer all three, it's not done.

---

## 2. Target Reader

Male, 25–45, college-educated, has a 401(k), watches sports, plays golf occasionally, works in a professional environment. He doesn't have time for sports radio, but he wants to sound informed when the game comes up at the office. He follows the market but isn't a trader. He respects good taste and hates being talked down to.

---

## 3. Architecture Overview

```
Local Mac (launchd 7am)
    └── scripts/generate-brief.js        ← fetches data + calls Claude
    └── scripts/qa-brief.js              ← blocks or warns on quality issues
    └── git push origin main             ← triggers Vercel deploy
    └── scripts/notify-review.js         ← emails Jake at j.rwilliams284@gmail.com

Jake's phone → taps approve button in review email
    └── GET /api/approve?token=TOKEN     ← confirmation page (prefetch-safe)
    └── GET /api/approve?token=TOKEN&go=1← sends to subscribers + posts to X

Manual (Jake): npm run social:queue     ← queues Instagram + TikTok via Buffer
```

**Key files:**
| File | Role |
|---|---|
| `scripts/generate-brief.js` | Main generator — fetches data, calls Claude, writes HTML + JSON |
| `scripts/lib/fetchers.js` | All data fetching (ESPN, Finnhub, Yahoo Finance, Reddit, NewsAPI) |
| `scripts/lib/copy.js` | All 13 Claude Haiku calls, BRAND_VOICE, prompt definitions |
| `scripts/lib/html.js` | HTML template builder — assembles brief from issue data |
| `scripts/lib/db.js` | Player database, ticker config, product/rec rotation lists |
| `scripts/lib/archive.js` | Builds briefs/index.html archive page |
| `scripts/qa-brief.js` | Quality gate — runs before push, exits 1 on hard failures |
| `scripts/run-brief.sh` | launchd runner — generate → QA → push → notify |
| `api/approve.js` | Vercel serverless: confirmation page + subscriber send + X post |
| `api/ticker.js` | Vercel serverless: live market + sports ticker for homepage |
| `scripts/notify-review.js` | Sends Jake the review email with approve button |
| `scripts/send-brief.js` | Gmail SMTP backup sender (dormant — launchd job disabled) |
| `scripts/queue-social-posts.js` | Queues Buffer posts for Instagram + TikTok (manual run) |

---

## 4. Section-by-Section Guide

### TL;DR
**Purpose:** Five quick-hit bullets. The scannable entry point for a reader who opens on their phone.
**Data source:** Auto-filled from ESPN (sports), Finnhub (markets), ESPN (golf), ESPN (F1/World Cup), Claude (culture).
**AI involvement:** No separate Claude call — drawn from other section data.
**Fallback:** If a section has no data, shows a neutral placeholder.
**Quality standard:** Each bullet should be specific enough to be shareable on its own.

---

### Office Take
**Purpose:** One sentence. The single sharpest non-sports observation from the day's brief. Something you can say at a coffee machine that doesn't make you sound like you only care about sports.
**Data source:** Claude Haiku, seeded by markets data + trending culture topics.
**AI involvement:** Template-fill prompt — constrained to one sentence.
**Post-processing:** Automatically truncated to first sentence if model produces multiple.
**Quality standard:** Should mention a real number (yield, stock %, price) or a specific culture event. Never "SPY was down today." Never sports scores.

---

### Sports
**Purpose:** Scoreboards, the real angle, and three conversation tools.
**Data source:**
- Scores: ESPN (NBA yesterday, MLB fallback if no NBA)
- Box scores: ESPN game summary API (real player stats)
- Upcoming games: ESPN (today + next 2 days)
**AI involvement:** Claude Haiku writes sports angle (what the game revealed), detail list (key number, series, how to watch), Group Chat Angle, Bar Argument.
**Fallback:** MLB fallback if no NBA games. F1/World Cup/upcoming NBA if no completed games.
**CRITICAL:** Only name players whose stats appear in confirmed box score data. Never invent stats.
**Quality standard:**
- Sports angle should be the take the reader felt but didn't articulate
- Doesn't lead with the scoreline
- Group Chat Angle = the specific thing that makes you go "yeah exactly"
- Bar Argument = the debatable point, not who won

---

### Group Chat Angle
**Location:** Inside the Sports section, for the primary game.
**Purpose:** One observation that someone would screenshot and send to a group chat.
**Quality standard:** Specific, non-obvious, not a recap. Should make the reader feel like they saw something others missed.

---

### Bar Argument
**Location:** Inside the Sports section, after Group Chat Angle.
**Purpose:** The debate the game creates. Two guys at a bar, actually arguing.
**Quality standard:** Should be genuinely divisive. Not "who was the best player." Something about decisions, ceilings, narratives being wrong.

---

### Markets
**Purpose:** What happened in markets today, why it moved, and one number worth repeating.
**Data source:**
- Prices + day%: Finnhub API (SPY, QQQ, NVDA, TSLA, MSFT, AAPL, BTC)
- Week%: Finnhub candle data (5-day lookback)
- 10Y yield: Yahoo Finance (^TNX)
**AI involvement:** Claude Haiku writes opening paragraph, headline, second paragraph, stock spotlight, watch-next-week, and "What to bring up."
**Quality standard:**
- Opening paragraph must include at least one real number AND explain why it moved
- "What to bring up" should be a fact specific enough to quote at dinner
- Never "markets were mixed" or "SPY moved today"

---

### What to Bring Up
**Location:** Inside Markets section and Golf section.
**Purpose:** One specific, quotable fact. Drop it in conversation, sound informed.
**Quality standard:** Should have a real number, real name, or real date. If it could describe any day, rewrite it.

---

### Golf + Lifestyle
**Location:** Embedded in the Sports section.
**Purpose:** PGA Tour leaderboard, why the tournament matters, and a product/gear pick.
**Data source:** ESPN golf scoreboard API.
**AI involvement:** Claude writes the golf note (one sentence), detail list (why it matters, TV schedule, bring up), and Group Chat Angle.
**Known issue:** ESPN sometimes returns amateur/Pro-Am players as leaders. Prompts are player-agnostic — if the player is unknown, Claude writes about the tournament and course instead.
**Product card:** Rotates through a hardcoded list in `db.js` (PRODUCTS array). Manual additions needed.
**Quality standard:** Golf note should mention the tournament name, current status, and something interesting about the course or field. Never a refusal.

---

### Culture
**Purpose:** Three items: two current stories + one streaming/theater pick.
**Data source:** Reddit (8 subreddits: nba, formula1, soccer, investing, golf, baseball, movies, entertainment) + optional NewsAPI headlines.
**AI involvement:** Claude writes all three items from trending context.
**Quality standard:**
- Item 1: Named person/event + take + conversation line
- Item 2: Different category from item 1
- Item 3: "Watch this: [title]" — must be adult, not animated/kids
- Each body should name the specific thing that happened in sentence 1, give the take in sentences 2-3, end with one conversation-ready line
**Known issue:** Reddit trending can surface low-quality posts. Culture items should always be checked before publishing.

---

### The Rec
**Purpose:** One weekly recommendation — app, gear, book, food, service, experience.
**Data source:** Hardcoded rotation in `db.js` (RECS array) — rotates by issue number.
**AI involvement:** None — fully pre-written.
**Manual action required:** Add new items to the RECS array in `db.js` as they're discovered.

---

### Sharp Take
**Purpose:** The closer. The part the reader forwards to a friend. Two paragraphs + three bullets.
**Data source:** All of today's data combined (sports, markets, golf, trending).
**AI involvement:** Claude Haiku writes structured JSON: p1 (the non-obvious take on ONE big story), p2 (forward hook + call-to-action), bullets (3 screenshot-worthy one-liners).
**CRITICAL:** Never describes scheduled/upcoming games as completed results. "Tonight" games are previews, not results.
**Quality standard:**
- p1 should make the reader think "exactly, that's what I was thinking"
- p2 should end with one specific, punchy action line
- Bullets should feel like items to screenshot — specific numbers, real names, clear stakes

---

### Numbers Worth Stealing
**Purpose:** Three data points with context. The reader can drop these in conversation to sound informed.
**Data source:** Auto-built from sports scores + SPY change + golf score + Claude context commentary.
**Quality standard:** Numbers should be specific. Context should be more than "this was a big game."

---

### F1 (when active)
**Purpose:** Race results or race preview.
**Data source:** ESPN racing API.
**AI involvement:** Claude writes headline, angle, bring-up, championship context, driver to watch.
**Quality standard:** Bring-up should be a specific circuit fact, not generic F1 trivia.

**⚠️ EVENT STATUS RULE — REQUIRED CHECK BEFORE WRITING:**
Before writing about F1, golf, tennis, tournaments, races, playoffs, or any live or scheduled event, verify `statusState` from the data source:
- `"pre"` = event has not started → use preview/upcoming language
- `"in"` = event is currently active → use live/current-leaderboard language
- `"post"` = event has officially concluded → use final-result language

**Never use final-result language ("wins," "finished," "beat," "took home," "champion") unless `statusState === "post"` is confirmed in the data.** If the ESPN API returns `"post"` but the date suggests the event hasn't occurred yet, treat it as unreliable and default to preview language. Fabricated or mis-labeled results are worse than a preview.

---

### Live Top 5 Leaderboard Module
**When to use:** For F1, golf, NASCAR, tennis, and any event where a current standings/position list is available and verified from the data source.
**CSS class:** `.live-top5` (defined in `brief.css`)
**Format:**
```html
<div class="live-top5">
  <div class="live-top5-hd">
    <span class="live-top5-badge">Round 2 Complete</span>  <!-- or "After Qualifying", "Live", etc. -->
    <span class="live-top5-title">Tournament Name · Top 5</span>
  </div>
  <!-- Repeat .live-top5-row for each entry (max 5) -->
  <div class="live-top5-row">
    <span class="lt5-pos lt5-pos-1">1</span>       <!-- lt5-pos-1 for amber highlight on leader -->
    <span class="lt5-name">Player Name</span>
    <span class="lt5-score under">-9</span>          <!-- .under = green, .over = red, .even = grey -->
  </div>
</div>
```
**Rules:**
- Only use when real data is available from the fetcher. Never fabricate positions or scores.
- If live data is unavailable, skip the module and write a plain text preview/update instead.
- For golf: use `.under` / `.over` / `.even` on `.lt5-score` to color the score.
- For F1 qualifying: show "Pole" for P1, team name as the right column (no lap times unless available).
- For F1 race: only render if `statusState === "post"` — use positions and gap times from ESPN data.

---

### World Cup (when active)
**Purpose:** Match results and tournament context.
**Data source:** ESPN FIFA scoreboard API.
**Note:** 2026 World Cup opened June 11 — this section is active June 11–July 19, 2026.

---

## 5. Voice and Tone Rules

**Do:**
- Short sentences. Vary the rhythm: short punch, longer follow-through, short punch.
- Name specific people, teams, numbers.
- Start with the most interesting angle — the scoreline is the least interesting thing.
- Every section ends with something the reader can actually say.
- Dry wit is welcome. Forced humor is not.
- Parenthetical asides when they're specific: "(who haven't been here since 1999, by the way)"

**Don't:**
- Sit on the fence. If the answer is "we'll see," rewrite until you have an actual opinion.
- Start with "There is...", "It is...", "This was..."
- Use passive voice: "was won by" → "won it"
- Name a player without real data backing it up

**Full banned phrases list** (see `BRAND_VOICE` in `scripts/lib/copy.js`):
pivotal, groundbreaking, game-changer, seismic, monumental, at the end of the day, it's worth noting, to be clear, make no mistake, delve, leverage (verb), nuanced, ecosystem (companies), narrative, buckle up, the stage is set, in today's fast-paced world, as the dust settles, it remains to be seen, fans are paying attention, this could be interesting to watch, keep an eye on, momentum (as a standalone explanation), worth watching, it's unclear, time will tell, only time will tell, ultimately, interestingly, notably, it's important to note, speaks to the larger issue

---

## 6. Daily Workflow (Step by Step)

```
7:00 AM   launchd fires scripts/run-brief.sh on local Mac
7:00-7:05 generate-brief.js runs (ESPN + Finnhub + Reddit + 13 Claude calls)
7:05-7:06 qa-brief.js runs
          → FAIL: opens brief in browser, macOS alert, NO push, NO review email
             Fix manually, then: npm run brief:qa && git add -A && git commit && git push
          → PASS: continues
7:06-7:08 git commit + push → Vercel deploys brief to guytalkmedia.com
7:08      notify-review.js → sends review email to j.rwilliams284@gmail.com
7:08      macOS alert: "issue-NNN live — review email sent to your phone"

Jake reads review email on phone (anytime after 7am)
          Step 1: taps "Send to subscribers" → sees confirmation page + subscriber count
          Step 2: taps "Confirm" → brief sent to all active subscribers via Resend
                                  → X auto-post fires
                                  → idempotency lock written (/tmp/gt-sent-{slug}.lock)

Optional (Jake, anytime after sending):
          npm run social:queue → queues Instagram + TikTok posts in Buffer
          Posts scheduled at 9am and 5pm slots across next 5 days
```

---

## 7. Jake's Daily Responsibilities (Manual Steps)

Every day:
- [ ] Review the brief in browser before approving (brief opens automatically at 7am)
- [ ] Verify golf leaderboard is accurate (ESPN can return obscure players)
- [ ] Verify sports scoreboards match actual results on ESPN
- [ ] Spot-check market prices + weekly % (SPY/QQQ)
- [ ] Read culture items — confirm they're current, relevant, and not off-brand
- [ ] Tap "Confirm Send" on phone to distribute to subscribers
- [ ] Optional: `npm run social:queue` to batch-queue Buffer posts

Weekly:
- [ ] Check that The Rec and product card are fresh (add new items to db.js as needed)
- [ ] Review subscriber count in Beehiiv dashboard
- [ ] Check PostHog for brief read depth and signup conversion

Before each subscriber send:
- [ ] Ensure `PO_BOX` env var is set in both `.env.local` and Vercel (CAN-SPAM requirement)

---

## 8. Approval Workflow (Two-Step)

The approval system is designed to prevent email-client prefetch from accidentally triggering a subscriber send.

**Step 1 (confirmation):** Tapping the approve link shows a confirmation page with:
- Brief title and date
- Quick-look bullets
- Subscriber count from Beehiiv
- "Confirm: Send to N subscribers" button

**Step 2 (send):** Tapping "Confirm" fires the actual send via Resend batch API.

**Idempotency:** After a successful send, a lock file is written to `/tmp/gt-sent-{slug}.lock`. Subsequent taps show "Already sent" instead of re-sending. Lock survives for the duration of the warm Vercel instance (~5-10 minutes). After a cold start, a second send is theoretically possible but Jake would not be tapping approve again hours later.

---

## 9. Email and Social Distribution

**Subscriber emails (Resend):**
- From: `brief@guytalkmedia.com`
- Beehiiv pub ID: `pub_d4c6a5c9-3ff9-4986-b17a-9e5650d915be`
- Sends: Resend batch API, 100/batch
- Unsubscribe: Beehiiv per-subscriber URL in footer

**X (auto on approval):**
- Fires immediately after subscriber send
- Format: "GuyTalk #NNN\n→ [sports bullet]\n→ [market bullet]\n→ [golf/F1 bullet]\n\n[brief URL]"
- Pulls from `sharpTake.bullets` if available, falls back to raw data

**Instagram + TikTok (Buffer, manual):**
- Run `npm run social:queue` after approving to schedule posts
- Requires social card images to exist in `assets/social-cards/` and `assets/tiktok-cards/`
- Run `npm run tiktok:img` first to generate cards from brief data
- Posts scheduled at 9am and 5pm slots, up to 5 days ahead

**Review email (Jake only):**
- From: `brief@guytalkmedia.com`
- To: `j.rwilliams284@gmail.com` (hardcoded — not subscriber list)
- Content: issue title, quick-look bullets, approve button

---

## 10. Integration / Access Status

| Service | Status | Notes |
|---|---|---|
| **Vercel** | ✅ Connected and working | MCP tools + git push deployment |
| **GitHub** | ✅ Connected and working | git CLI, auto-deploy on push |
| **Local files** | ✅ Full access | Read/write, can run all scripts |
| **launchd (macOS)** | ✅ Connected and working | Can load/unload via Bash |
| **Anthropic / Claude** | ✅ Connected and working | ANTHROPIC_API_KEY in .env.local |
| **ESPN** | ✅ Connected and working | Public API, no key required |
| **Finnhub** | ✅ Connected and working | FINNHUB_API_KEY in .env.local + Vercel |
| **Yahoo Finance** | ✅ Connected and working | Public API, no key required (10Y yield) |
| **Reddit** | ✅ Connected and working | Public JSON API, no key required |
| **Resend** | ✅ Connected and working | RESEND_API_KEY in .env.local + Vercel |
| **Beehiiv** | ✅ Connected and working | BEEHIIV_API_KEY in .env.local + Vercel; MCP also connected |
| **X / Twitter** | ✅ Connected and working | 4 keys in Vercel, auto-posts on approval |
| **Buffer** | ⚠️ Connected, needs update | `buffer_API_KEY` in Vercel must be renamed to `BUFFER_API_KEY` (uppercase B) |
| **Instagram** | ⚠️ Indirect only | Via Buffer queue — no direct API |
| **TikTok** | ⚠️ Indirect only | Via Buffer queue — no direct API |
| **NewsAPI** | ⚠️ Optional, low priority | NEWS_API_KEY in .env.local (100 req/day free) |
| **PostHog** | ✅ Connected and working | Analytics on site, MCP connected |
| **Higgsfield** | ❓ Unknown | CLI installed, scripts exist, not recently tested |
| **Google (Gmail, Drive, Calendar)** | ⚠️ MCP connected, no code integration | MCPs available but not wired into brief pipeline |
| **Notion / Canva** | ⚠️ MCP connected, no code integration | Available but not used |

---

## 11. Environment Variables Reference

**Local `.env.local` (full list):**
```
ANTHROPIC_API_KEY=...         # Claude Haiku copy generation
FINNHUB_API_KEY=...           # Market data (prices + weekly candles)
NEWS_API_KEY=...              # Optional culture headlines (100/day free)
BEEHIIV_API_KEY=...           # Subscriber list for email sends
GMAIL_APP_PASSWORD=...        # Gmail SMTP backup (dormant — not in launchd)
RESEND_API_KEY=...            # Primary email sending
APPROVAL_TOKEN=...            # Secure token for approve endpoint
BUFFER_API_KEY=...            # Buffer social queue (manual use only)
PO_BOX=...                    # CAN-SPAM mailing address — REQUIRED before sending
```

**Vercel Production (required):**
```
RESEND_API_KEY
APPROVAL_TOKEN
BEEHIIV_API_KEY
FROM_EMAIL=GuyTalk <brief@guytalkmedia.com>
FINNHUB_API_KEY
X_API_KEY
X_API_KEY_SECRET
X_ACCESS_TOKEN
X_ACCESS_TOKEN_SECRET
BUFFER_API_KEY                # Rename from buffer_API_KEY (lowercase b) — pending
PO_BOX                        # Add before next subscriber send
```

---

## 12. Daily Production Checklist

```
MORNING (7am–9am)
□ Mac is awake at 7am (launchd won't fire if Mac is asleep)
□ Brief generates and QA passes (check macOS notification)
□ If QA fails: fix issues manually, push manually:
    npm run brief:qa
    git add -A && git commit -m "fix issue-NNN" && git push
□ Review brief in browser — verify:
    □ Sports scoreboards correct (confirm on ESPN if needed)
    □ Golf leaderboard is accurate / not an obscure player
    □ Market prices + weekly % look real
    □ Culture items are current and on-brand
    □ All four conversation sections present:
        □ Office Take
        □ Group Chat Angle
        □ Bar Argument
        □ What to Bring Up (markets + golf)
□ Tap "Send to subscribers" in review email
□ Verify "Brief sent" confirmation page loads

AFTER SENDING
□ X post auto-fired (check @guytalkmedia)
□ Optional: npm run social:queue → Instagram + TikTok scheduled in Buffer

WEEKLY
□ Beehiiv dashboard: new subscriber count
□ PostHog: brief read depth, email signup rate
□ Update RECS array in db.js with fresh picks
□ Add new products to PRODUCTS array in db.js if needed
```

---

## 13. Recommended Throughout-the-Day Schedule

**Current capability (what's wired):**
- 7am: Brief generates, QA runs, Vercel deploys
- Morning (Jake-triggered): subscriber send + X post
- Optional (Jake-triggered): Buffer social queue

**Recommended additions (not yet built, safe to implement when ready):**

| Time | Action | How |
|---|---|---|
| 7:00 AM | Brief generation | ✅ Already automated |
| 7:30 AM | Jake approval + send | ✅ Already working |
| 9:00 AM | Instagram/TikTok posts live | ⚠️ Manual Buffer queue step |
| 4:00 PM | Market close X post | ❌ Not built — 1 ticker API call → tweet (simple) |
| 5:00 PM | Second Instagram post | ⚠️ Buffer handles via queue |
| 9:00 PM | Sports recap tweet (if evening games) | ❌ Not built |

**Weekend version:** No changes needed. The system already pulls F1, golf, and MLB which are the weekend sports. The brief naturally becomes golf/F1-heavy on weekends. No separate weekend mode needed.

**Market close tweet (recommended next build):** A simple endpoint that calls `api/ticker.js`, formats the top movers, and posts to X at 4:30pm ET. One new Vercel cron job + 20 lines of code.

---

## 14. Current Weak Points

| Issue | Severity | Status |
|---|---|---|
| PO Box missing from email footer | 🔴 Legal | Pending — Jake adding soon |
| Vercel env: `buffer_API_KEY` should be `BUFFER_API_KEY` | 🟡 Minor | Rename in Vercel dashboard |
| OG card is SVG not PNG | 🟡 UX | Convert once, fix forever |
| Social card images not auto-generated | 🟡 Quality | Run `npm run tiktok:img` before `social:queue` |
| officeTake can occasionally be multi-sentence | 🟡 Quality | Post-processing truncation is in place |
| Golf statusState 'pre' despite showing leaders | 🟡 Data | ESPN API quirk on tournament start day — handled |
| Lock file doesn't survive Vercel cold starts | 🟠 Risk | Acceptable at current scale — fix with KV store at 1K+ subscribers |
| The Rec and product cards are hardcoded lists | 🟡 Maintenance | Add new items to db.js quarterly |
| Dead codebase at `~/Documents/GitHub/guytalk-landing/` | 🟢 Low | Archive or delete when convenient |
| Higgsfield ad content not tested recently | 🟢 Low | Not needed until ad revenue stage |

---

## 15. Known Data Reliability

| Source | Reliability | Notes |
|---|---|---|
| ESPN NBA scores | ✅ High | Checks yesterday only (1-day window) |
| ESPN box scores | ✅ High | Real player stats — anti-hallucination guard |
| ESPN MLB scores | ✅ High | Falls back to last 2 days |
| ESPN Golf | ⚠️ Medium | Sometimes returns Pro-Am/amateur players as leaders |
| ESPN F1 | ✅ High | Reliable for race results + upcoming |
| ESPN World Cup | ✅ High | Active June 11–July 19, 2026 |
| Finnhub market data | ✅ High | Free tier: 60 req/min. Brief uses ~9 sequential calls with 220ms delays |
| Yahoo Finance 10Y yield | ✅ High | Public API, no key, occasionally slow |
| Reddit trending | ⚠️ Medium | Quality varies. Used as editorial suggestions only, not auto-published |
| NewsAPI | ⚠️ Medium | 100 req/day on free tier |

---

## 16. Future Improvements (Ordered by Impact)

**Do soon:**
1. Add PO Box to `.env.local` + Vercel — CAN-SPAM compliance
2. Rename `buffer_API_KEY` → `BUFFER_API_KEY` in Vercel
3. Convert `assets/og-card.svg` → `og-card.png` for proper social link previews
4. Wire social card generation into the daily run

**Do when subscriber list grows:**
5. Replace `/tmp` idempotency lock with Vercel KV store
6. Add 4:30pm market close X post (one cron job, 20 lines)
7. SEO overhaul — site is under-optimized for organic search
8. Advertise/partner page on website

**Do when revenue stage:**
9. Beehiiv premium tiers / paid newsletter tier
10. Brand deals integration (Rhoback, Peter Millar, etc. — product card becomes revenue)
11. Higgsfield ad content for Instagram/TikTok
12. Optional morning audio brief (text-to-speech on Sharp Take)

---

## 17. Quality Audit — Current Brief Assessment

**Strong sections:**
- Sports angle: Specific, opinionated, gives the angle the reader felt but didn't articulate
- Markets take: Real numbers, explains the why, doesn't just report the what
- Bar Argument: Genuinely debatable, not "who won"
- Golf notes: Now player-agnostic — writes about tournament/course when leader is unknown
- Sharp Take bullets: Screenshot-worthy, specific, builds anticipation
- F1 bring-up: Specific circuit facts (Monaco pit lane, sector times, etc.)
- Golf bring-up: Course design facts from Nicklaus archive knowledge

**Sections that need human review every issue:**
- Culture items: Reddit trending quality is inconsistent. The AI selects from what's there, but what's there varies. Always read before publishing.
- Series situation: For MLB regular season games, can occasionally imply playoff context. QA flagged; prompt now guards against this.
- Golf leaderboard: On tournament start day, ESPN returns 'pre' status even with leaders showing. Verify the golf leader is an actual PGA Tour player before publishing.

**Sections that are structurally weak:**
- officeTake: Haiku sometimes ignores the 20-word constraint. Post-processing truncates to first sentence, but quality varies. Consider upgrading to Sonnet for this single call.
- Product cards in Golf section: Still rotating from a hardcoded list. Needs manual refresh quarterly.
- The Rec: Pre-written, no AI, needs fresh picks added to db.js.

---

*Last updated: 2026-06-03 — after workflow cleanup, golf fix, and prompt tightening session.*
