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

  for (const data of responses) {
    if (!data?.events) continue;

    for (const event of data.events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const statusName = comp.status?.type?.name;
      const detail     = comp.status?.type?.shortDetail || '';
      const competitors = comp.competitors || [];
      if (competitors.length < 2) continue;

      if (statusName === 'STATUS_FINAL') {
        const sorted   = [...competitors].sort((a, b) => Number(b.score) - Number(a.score));
        const winner   = sorted[0].team.abbreviation.toUpperCase();
        const winScore = sorted[0].score;
        const loseScore = sorted[1].score;
        const ot = /ot/i.test(detail) ? ' IN OT' : '';
        finals.push({ label: `${winner} WIN${ot} · ${winScore}–${loseScore}` });

      } else if (statusName === 'STATUS_SCHEDULED') {
        const home = competitors.find(c => c.homeAway === 'home')?.team?.abbreviation?.toUpperCase();
        const away = competitors.find(c => c.homeAway === 'away')?.team?.abbreviation?.toUpperCase();
        const time = formatGameTime(comp.date);
        if (home && away && time) {
          scheduled.push({ label: `${away} AT ${home} · ${time} ET` });
        }
      }
    }
  }

  // Cap finals at 4 and scheduled at 4 to avoid MLB flooding the ticker
  const combined = [...finals.slice(0, 4), ...scheduled.slice(0, 4)];
  return combined.length > 0 ? combined : null;
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
    return res.json({ markets, sports });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
};
