'use strict';

/**
 * Shared Yahoo Finance quote fetcher — used by api/live.js (Markets tab) and
 * api/talk.js (AI Rundown market context) so both always report the same
 * numbers for the same symbols. Real indices/futures, not ETF proxies —
 * ETFs like USO/GLD/SPY diverge from the underlying (futures-roll costs,
 * fund fees, tracking error), which is why oil in particular used to read
 * differently in the Rundown than in the Markets tiles a few pixels away.
 *
 * Works without auth for index symbols (^GSPC, ^DJI, etc.) and crypto.
 */
async function fetchYahooQuote(json, yahooSymbol) {
  const yj = await json(
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=2d`
  );
  const result = yj?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const closes = (result.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  const value = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
  const prev  = meta.previousClose ?? meta.chartPreviousClose ?? closes[closes.length - 2] ?? null;
  if (value == null || prev == null) return null;
  const change        = value - prev;
  const changePercent = prev ? (change / prev) * 100 : 0;
  return { value: Number(value), change: Number(change), changePercent: Number(changePercent) };
}

module.exports = { fetchYahooQuote };
