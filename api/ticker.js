const SYMBOLS = [
  { display: 'DOW',    api: 'DIA' },
  { display: 'S&P',    api: 'SPY' },
  { display: 'NASDAQ', api: 'QQQ' },
  { display: 'R2K',    api: 'IWM' },
  { display: 'BTC',    api: 'BINANCE:BTCUSDT' },
  { display: 'ETH',    api: 'BINANCE:ETHUSDT' },
  { display: 'NVDA',   api: 'NVDA' },
  { display: 'TSLA',   api: 'TSLA' },
  { display: 'GOOGL',  api: 'GOOGL' },
  { display: 'MSFT',   api: 'MSFT' },
  { display: 'AMZN',   api: 'AMZN' },
  { display: 'IBM',    api: 'IBM' },
  { display: 'AAPL',   api: 'AAPL' },
];

// No static sports fallback — return empty array when ESPN has no live scores.
// The ticker shows markets-only on off days rather than displaying stale headlines.

const ESPN_LEAGUES = [
  { sport: 'soccer',     league: 'fifa.world' },
  { sport: 'soccer',     league: 'usa.1' },
  { sport: 'basketball', league: 'nba' },
  { sport: 'baseball',   league: 'mlb' },
  { sport: 'hockey',     league: 'nhl' },
  { sport: 'football',   league: 'nfl' },
];

function formatGameTime(dateStr) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
      hour12: true,
    }).format(new Date(dateStr)).replace(':00', '').replace(' ', '');
  } catch {
    return '';
  }
}

async function fetchSportsItems() {
  const responses = await Promise.all(
    ESPN_LEAGUES.map(({ sport, league }) =>
      fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  const finals = [];
  const scheduled = [];

  // Date-window guard. ESPN's scoreboard endpoints return the *next* slate when a
  // league is out of season — e.g. in June the NFL endpoint serves upcoming Week 1
  // (Sept) games, which surfaced as "NE AT SEA" etc. A season-year check doesn't
  // catch these (they ARE the current season year), so we bound by game date:
  // only show recent finals and the imminent slate. Off-season games dated months
  // out fall outside the window and are dropped, leaving that sport empty.
  const now = Date.now();
  const HOUR = 3600 * 1000;
  const FINAL_LOOKBACK_MS  = 48 * HOUR;  // recent results only
  const PRE_LOOKAHEAD_MS   = 36 * HOUR;  // tonight + tomorrow's slate
  const gameTime = (c) => { const t = Date.parse(c?.date || ''); return Number.isNaN(t) ? null : t; };

  for (const data of responses) {
    if (!data?.events) continue;

    for (const event of data.events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const type        = comp.status?.type || {};
      const detail      = type.shortDetail || '';
      const competitors = comp.competitors || [];
      if (competitors.length < 2) continue;

      // Short team code, with fallbacks — some soccer teams lack an abbreviation,
      // and the old `.team.abbreviation.toUpperCase()` would throw and kill the loop.
      const abbr = (c) =>
        (c?.team?.abbreviation || c?.team?.shortDisplayName || c?.team?.name || '').toUpperCase();

      // `completed` is the sport-agnostic "game is over" flag: it covers both
      // STATUS_FINAL (US sports) and STATUS_FULL_TIME (soccer), so soccer results
      // actually surface. `state === 'pre'` is the matching flag for upcoming games.
      if (type.completed === true) {
        // Drop stale finals (e.g. the last NFL game from months ago).
        const gt = gameTime(comp);
        if (gt !== null && now - gt > FINAL_LOOKBACK_MS) continue;
        const sorted = [...competitors].sort((a, b) => Number(b.score) - Number(a.score));
        const a = sorted[0], b = sorted[1];
        const aAb = abbr(a), bAb = abbr(b);
        if (!aAb || !bAb) continue;
        const ot = /ot/i.test(detail) ? ' IN OT' : '';
        // Draws are common in soccer — never crown a winner on equal scores.
        const label = Number(a.score) === Number(b.score)
          ? `${aAb} ${a.score}–${b.score} ${bAb} · DRAW`
          : `${aAb} WIN${ot} · ${a.score}–${b.score}`;
        finals.push({ label, logos: [a.team?.logo, b.team?.logo].filter(Boolean) });

      } else if (type.state === 'pre') {
        // Only the imminent slate — this is what filters out off-season leagues
        // whose "next" scheduled games are weeks or months away.
        const gt = gameTime(comp);
        if (gt === null || gt - now > PRE_LOOKAHEAD_MS || gt < now - 6 * HOUR) continue;
        const awayC = competitors.find(c => c.homeAway === 'away');
        const homeC = competitors.find(c => c.homeAway === 'home');
        const home = abbr(homeC), away = abbr(awayC);
        const time = formatGameTime(comp.date);
        if (home && away && time) {
          scheduled.push({
            label: `${away} AT ${home} · ${time} ET`,
            logos: [awayC?.team?.logo, homeC?.team?.logo].filter(Boolean),
          });
        }
      }
    }
  }

  // Cap finals at 4 and scheduled at 4 to avoid MLB flooding the ticker
  const combined = [...finals.slice(0, 4), ...scheduled.slice(0, 4)];
  return combined.length > 0 ? combined : null;
}

// ── US market hours ──────────────────────────────────────────────────────────
// The marquee shows market % change under a "Live" badge. On weekends / holidays
// / after-hours those numbers are the last close, not live movement, so we tell
// the client the real status and it relabels the badge ("Markets closed · At
// Friday's close") instead of implying live trading. NYSE regular session is
// 9:30–16:00 ET, Mon–Fri, minus the holidays below.
const MARKET_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

function etParts(d) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
}

function usMarketStatus(now = new Date()) {
  const HOUR = 3600 * 1000;
  const isTradingDay = (p) => {
    const ds = `${p.year}-${p.month}-${p.day}`;
    return p.weekday !== 'Sat' && p.weekday !== 'Sun' && !MARKET_HOLIDAYS.has(ds);
  };
  const p = etParts(now);
  const mins = Number(p.hour) * 60 + Number(p.minute);
  const open = isTradingDay(p) && mins >= 570 && mins < 960; // 9:30–16:00 ET
  if (open) return { open: true, label: 'Live', note: '' };

  // Walk back to the most recent day whose close has already passed.
  let lastClose = '';
  let probe = now;
  for (let i = 0; i < 10; i++) {
    const pp = etParts(probe);
    const closedForDay = i > 0 || (Number(pp.hour) * 60 + Number(pp.minute)) >= 960;
    if (isTradingDay(pp) && closedForDay) {
      lastClose = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(probe);
      break;
    }
    probe = new Date(probe.getTime() - 24 * HOUR);
  }
  return { open: false, label: 'Markets closed', note: lastClose ? `At ${lastClose}'s close` : '' };
}

module.exports = async function handler(req, res) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  try {
    const [marketResults, sportsItems] = await Promise.all([
      Promise.all(
        SYMBOLS.map(({ display, api }) =>
          fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(api)}&token=${key}`)
            .then(r => r.json())
            .then(data => {
              if (!data || data.dp == null) return null;
              return {
                sym: display,
                change: Math.abs(data.dp).toFixed(2),
                dir: data.dp >= 0 ? 'up' : 'down',
              };
            })
            .catch(() => null)
        )
      ),
      fetchSportsItems(),
    ]);

    // Sort by absolute % change so the biggest mover leads
    const markets = marketResults
      .filter(Boolean)
      .sort((a, b) => parseFloat(b.change) - parseFloat(a.change));

    const sports = sportsItems || [];

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.json({ markets, sports, marketStatus: usMarketStatus() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
};
