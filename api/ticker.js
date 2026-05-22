const SYMBOLS = [
  { display: 'NVDA',  api: 'NVDA' },
  { display: 'SPY',   api: 'SPY' },
  { display: 'BTC',   api: 'BINANCE:BTCUSDT' },
  { display: 'TSLA',  api: 'TSLA' },
  { display: 'ETH',   api: 'BINANCE:ETHUSDT' },
  { display: 'QQQ',   api: 'QQQ' },
  { display: 'AAPL',  api: 'AAPL' },
];

// Update these whenever a new issue goes out
const SPORTS = [
  { label: 'CAVS 125  PISTONS 94  ·  GAME 7' },
  { label: 'CELTICS LEAD ECF  1–0' },
  { label: 'THUNDER 104  SPURS 94  ·  GAME 1' },
  { label: 'YANKEES W  6–3' },
];

module.exports = async function handler(req, res) {
  const key = process.env.FINNHUB_API_KEY;

  if (!key) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const results = await Promise.all(
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
    );

    const markets = results.filter(Boolean);

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.json({ markets, sports: SPORTS });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch market data' });
  }
};
