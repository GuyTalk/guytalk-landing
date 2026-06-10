'use strict';

/**
 * GuyTalk Live — securities lookup + quote/chart (keyless, via Yahoo Finance).
 *
 *   GET /api/quote?q=apple        → symbol search  → { results: [{symbol,name,exchange,type}] }
 *   GET /api/quote?symbol=AAPL    → quote + chart  → { quote: {...}, series: [...] }
 *
 * Informational only — never investment advice. Returns real data or an error;
 * never fabricates a price.
 */

const UA = { 'User-Agent': 'Mozilla/5.0 (GuyTalkLive)' };

const json = (url) =>
  fetch(url, { headers: UA }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// Symbols we don't want surfaced (options, etc.) — keep it to real, lookup-able names.
const ALLOWED_TYPES = new Set(['EQUITY', 'ETF', 'INDEX', 'CRYPTOCURRENCY', 'CURRENCY', 'MUTUALFUND', 'FUTURE']);

async function search(q) {
  const data = await json(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`
  );
  const quotes = data?.quotes || [];
  return quotes
    .filter((x) => x.symbol && ALLOWED_TYPES.has((x.quoteType || '').toUpperCase()))
    .slice(0, 8)
    .map((x) => ({
      symbol: x.symbol,
      name: x.shortname || x.longname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: (x.quoteType || '').toUpperCase(),
    }));
}

async function quote(symbol) {
  // Intraday for the chart; meta carries the headline stats.
  const data = await json(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d&includePrePost=false`
  );
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  let closes = (result.indicators?.quote?.[0]?.close || []).filter((v) => v != null);

  // Thin intraday (pre-market / closed / illiquid) → use a 1-month daily series
  // so the detail chart is always meaningful.
  let rangeLabel = 'Today';
  if (closes.length < 10) {
    rangeLabel = '1 month';
    const daily = await json(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`
    );
    const dres = daily?.chart?.result?.[0];
    closes = (dres?.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  }

  const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? closes[0] ?? null;
  if (price == null) return null;
  const change = prev != null ? price - prev : null;
  const changePercent = prev ? (change / prev) * 100 : null;

  return {
    quote: {
      symbol: meta.symbol || symbol,
      name: meta.longName || meta.shortName || meta.symbol || symbol,
      price,
      prevClose: prev,
      change,
      changePercent,
      currency: meta.currency || 'USD',
      exchange: meta.fullExchangeName || meta.exchangeName || '',
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      yearHigh: meta.fiftyTwoWeekHigh ?? null,
      yearLow: meta.fiftyTwoWeekLow ?? null,
      isYield: /\^TNX|\^TYX|\^FVX|\^IRX/i.test(symbol), // render as % not $
      rangeLabel,
    },
    // Cap the series so the payload stays small; client draws a sparkline-style line.
    series: closes.slice(-120),
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=30');

  const q = (req.query?.q || '').toString().trim();
  const symbol = (req.query?.symbol || '').toString().trim();

  try {
    if (symbol) {
      const out = await quote(symbol);
      if (!out) return res.status(404).json({ error: 'No data for that symbol.' });
      return res.json(out);
    }
    if (q) {
      return res.json({ results: await search(q) });
    }
    return res.status(400).json({ error: 'Pass ?q= to search or ?symbol= to quote.' });
  } catch (err) {
    return res.status(502).json({ error: 'Lookup failed. Try again.' });
  }
};
