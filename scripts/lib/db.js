'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Player database: name → ESPN profile URL
// Add players here as they appear in new issues.
// ─────────────────────────────────────────────────────────────────────────────
const PLAYERS = {
  // NBA – ECF
  'Jalen Brunson':             { sport: 'nba',  id: '3934672',  slug: 'jalen-brunson' },
  'Donovan Mitchell':          { sport: 'nba',  id: '3908809',  slug: 'donovan-mitchell' },
  'Karl-Anthony Towns':        { sport: 'nba',  id: '3136193',  slug: 'karl-anthony-towns' },
  'Darius Garland':            { sport: 'nba',  id: '4277905',  slug: 'darius-garland' },
  'Evan Mobley':               { sport: 'nba',  id: '4432163',  slug: 'evan-mobley' },
  'Josh Hart':                 { sport: 'nba',  id: '2578578',  slug: 'josh-hart' },
  'Mikal Bridges':             { sport: 'nba',  id: '3134870',  slug: 'mikal-bridges' },
  // NBA – WCF
  'Shai Gilgeous-Alexander':   { sport: 'nba',  id: '4278073',  slug: 'shai-gilgeous-alexander' },
  'Victor Wembanyama':         { sport: 'nba',  id: '5104157',  slug: 'victor-wembanyama' },
  'Stephon Castle':            { sport: 'nba',  id: '4845367',  slug: 'stephon-castle' },
  'Chet Holmgren':             { sport: 'nba',  id: '4432638',  slug: 'chet-holmgren' },
  'Luguentz Dort':             { sport: 'nba',  id: '4066409',  slug: 'luguentz-dort' },
  // NBA – other
  'LeBron James':              { sport: 'nba',  id: '1966',     slug: 'lebron-james' },
  'Stephen Curry':             { sport: 'nba',  id: '3975',     slug: 'stephen-curry' },
  'Giannis Antetokounmpo':     { sport: 'nba',  id: '3032977',  slug: 'giannis-antetokounmpo' },
  'Jayson Tatum':              { sport: 'nba',  id: '4065648',  slug: 'jayson-tatum' },
  'Kevin Durant':              { sport: 'nba',  id: '3202',     slug: 'kevin-durant' },
  'Nikola Jokic':              { sport: 'nba',  id: '3112335',  slug: 'nikola-jokic' },
  'Luka Doncic':               { sport: 'nba',  id: '3945274',  slug: 'luka-doncic' },
  'Anthony Edwards':           { sport: 'nba',  id: '4594268',  slug: 'anthony-edwards' },
  // Golf – PGA
  'Scottie Scheffler':         { sport: 'golf', id: '4686091',  slug: 'scottie-scheffler' },
  'Rory McIlroy':              { sport: 'golf', id: '3448',     slug: 'rory-mcilroy' },
  'Jon Rahm':                  { sport: 'golf', id: '4848699',  slug: 'jon-rahm' },
  'Xander Schauffele':         { sport: 'golf', id: '4848706',  slug: 'xander-schauffele' },
  'Collin Morikawa':           { sport: 'golf', id: '4848693',  slug: 'collin-morikawa' },
  'Patrick Cantlay':           { sport: 'golf', id: '4848690',  slug: 'patrick-cantlay' },
  'Viktor Hovland':            { sport: 'golf', id: '4848721',  slug: 'viktor-hovland' },
  'Brooks Koepka':             { sport: 'golf', id: '1225',     slug: 'brooks-koepka' },
  'Bryson DeChambeau':         { sport: 'golf', id: '3470310',  slug: 'bryson-dechambeau' },
  'Tony Finau':                { sport: 'golf', id: '4848696',  slug: 'tony-finau' },
  'Max Homa':                  { sport: 'golf', id: '4848704',  slug: 'max-homa' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Ticker config: display order + Morningstar links
// The BRIEF_ORDER array controls which tickers appear in the markets table.
// ─────────────────────────────────────────────────────────────────────────────
const TICKERS = {
  'SPY':  { name: 'S&P 500',   finnhub: 'SPY',              ms: 'etfs/arcx/spy/quote',        display: 'SPY' },
  'QQQ':  { name: 'Nasdaq',    finnhub: 'QQQ',              ms: 'etfs/arcx/qqq/quote',        display: 'QQQ' },
  'NVDA': { name: 'Nvidia',    finnhub: 'NVDA',             ms: 'stocks/xnas/nvda/quote',     display: 'NVDA' },
  'TSLA': { name: 'Tesla',     finnhub: 'TSLA',             ms: 'stocks/xnas/tsla/quote',     display: 'TSLA' },
  'MSFT': { name: 'Microsoft', finnhub: 'MSFT',             ms: 'stocks/xnas/msft/quote',     display: 'MSFT' },
  'AAPL': { name: 'Apple',     finnhub: 'AAPL',             ms: 'stocks/xnas/aapl/quote',     display: 'AAPL' },
  'META': { name: 'Meta',      finnhub: 'META',             ms: 'stocks/xnas/meta/quote',     display: 'META' },
  'AMZN': { name: 'Amazon',    finnhub: 'AMZN',             ms: 'stocks/xnas/amzn/quote',     display: 'AMZN' },
  'BTC':  { name: 'Bitcoin',   finnhub: 'BINANCE:BTCUSDT',  ms: 'funds/xnas/gbtc/quote',      display: 'Bitcoin' },
  '10Y':  { name: '10Y Yield', finnhub: null,               ms: null,                         display: '10Y Yield' },
};

// Which tickers appear in the brief table, in order, with dividers
const BRIEF_ROWS = [
  { type: 'ticker', key: 'SPY' },
  { type: 'ticker', key: 'QQQ' },
  { type: 'divider' },
  { type: 'ticker', key: 'NVDA' },
  { type: 'ticker', key: 'TSLA' },
  { type: 'divider' },
  { type: 'ticker', key: 'BTC' },
  { type: 'ticker', key: '10Y' },
];

// Which tickers to fetch from Finnhub
const FETCH_TICKERS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'MSFT', 'AAPL', 'BTC'];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: HTML-escape a string
// ─────────────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: generate <a class="player"> for a known player, plain text if unknown
// ─────────────────────────────────────────────────────────────────────────────
function playerLink(name) {
  const p = PLAYERS[name];
  if (!p) return `<span class="player">${esc(name)}</span>`;
  const base = p.sport === 'golf'
    ? `https://www.espn.com/golf/player/_/id/${p.id}/${p.slug}`
    : `https://www.espn.com/nba/player/_/id/${p.id}/${p.slug}`;
  return `<a href="${base}" class="player">${esc(name)}</a>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: generate <a class="ticker"> to Morningstar, plain text if unknown
// ─────────────────────────────────────────────────────────────────────────────
function tickerLink(symbol) {
  const t = TICKERS[symbol];
  if (!t?.ms) return `<span class="ticker">${esc(symbol)}</span>`;
  return `<a href="https://www.morningstar.com/${t.ms}" class="ticker">${esc(t.display)}</a>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: format a price for display
// ─────────────────────────────────────────────────────────────────────────────
function fmtPrice(symbol, price) {
  if (price === null || price === undefined || price === 0) return '[PRICE]';
  if (symbol === 'BTC') {
    return price > 10000 ? `$${(price / 1000).toFixed(1)}K` : `$${price.toFixed(0)}`;
  }
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (price >= 100) {
    return `$${price.toFixed(2)}`;
  }
  return `${price.toFixed(2)}%`; // 10Y yield and similar
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: format a percentage change
// ─────────────────────────────────────────────────────────────────────────────
function fmtPct(n) {
  if (n === null || n === undefined) return '[DAY%]';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

module.exports = { PLAYERS, TICKERS, BRIEF_ROWS, FETCH_TICKERS, esc, playerLink, tickerLink, fmtPrice, fmtPct };
