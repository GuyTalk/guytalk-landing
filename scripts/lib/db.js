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
  'Russell Henley':            { sport: 'golf', id: '4848715',  slug: 'russell-henley' },
  'Eric Cole':                 { sport: 'golf', id: '10122',    slug: 'eric-cole' },
  'Ben Griffin':               { sport: 'golf', id: '5769',     slug: 'ben-griffin' },
  'Ludvig Aberg':              { sport: 'golf', id: '9999001',  slug: 'ludvig-aberg' },
  'Shane Lowry':               { sport: 'golf', id: '3139',     slug: 'shane-lowry' },
  'Tommy Fleetwood':           { sport: 'golf', id: '1225',     slug: 'tommy-fleetwood' },
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

// ─────────────────────────────────────────────────────────────────────────────
// Rotating product feature for Golf + Lifestyle section
// Pick via: PRODUCTS[issueNum % PRODUCTS.length]
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCTS = [
  {
    brand: 'Peter Millar',
    name: 'Crown Sport Performance Quarter-Zip',
    desc: `Peter Millar's go-to for the range and the club. Four-way stretch moves with you, the DWR finish handles light rain, and the chest zip keeps you from committing to one temperature for 18 holes. Built for the guy who goes from the back nine straight to the back patio. <a href="https://www.petermillar.com/collections/mens-quarter-zips" class="brand">Shop Peter Millar →</a>`,
    price: '$145',
    url: 'https://www.petermillar.com/collections/mens-quarter-zips',
    cta: 'Shop Peter Millar',
    imageUrl: null,
  },
  {
    brand: 'Rhoback',
    name: 'Voltaic Performance Polo',
    desc: `Rhoback solved something the big brands haven't: a polo that's actually comfortable at 88 degrees on the 14th hole. Four-way stretch, moisture-wicking, and it doesn't look like athletic wear. The Voltaic works on the course and anywhere you go after. <a href="https://rhoback.com/collections/mens-polos" class="brand">Shop Rhoback →</a>`,
    price: '$98',
    url: 'https://rhoback.com/collections/mens-polos',
    cta: 'Shop Rhoback',
    imageUrl: 'https://cdn.shopify.com/s/files/1/1366/9275/files/POLOS_9c9327dc-59dc-4def-9fd9-b7af830b9a7e.jpg?v=1778262716',
  },
  {
    brand: 'TravisMathew',
    name: 'Coto Performance Polo',
    desc: `TravisMathew's most dialed-in polo. Cut slim without being restrictive, holds its shape through a full round, and comes in colors that don't look like they belong at a corporate outing. Hard to beat at $85. <a href="https://www.travismathew.com/collections/mens-polos" class="brand">Shop TravisMathew →</a>`,
    price: '$85',
    url: 'https://www.travismathew.com/collections/mens-polos',
    cta: 'Shop TravisMathew',
    imageUrl: 'https://travismathew.com/cdn/shop/files/Dual_Polos_2x2_7dee8cf1-6848-4531-b3bb-9e5ede7df671.jpg?v=1774466563',
  },
  {
    brand: 'Holderness & Bourne',
    name: 'The Barstool Polo',
    desc: `H&B makes the best-looking polo in golf apparel, full stop. The Barstool is slim-fit pique — proper enough for a member-guest but won't embarrass you at the airport. The button and collar details are actually good. Worth the premium. <a href="https://holdernessandbourne.com/collections/mens-polo-shirts" class="brand">Shop H&B →</a>`,
    price: '$125',
    url: 'https://holdernessandbourne.com/collections/mens-polo-shirts',
    cta: 'Shop H&B',
    imageUrl: 'https://holdernessandbourne.com/cdn/shop/files/S26_Homepage_Header_Performance_Polos_1000x.png?v=1774032939',
  },
  {
    brand: 'FootJoy',
    name: 'Pro/SL Golf Shoe',
    desc: `The best-selling golf shoe on tour for a reason. Waterproof, spikeless, and stable on courses with real elevation. The carbon rubber outsole outlasts most competitors at this price point. Buy them once and stop thinking about golf shoes. <a href="https://www.footjoy.com/collections/mens-golf-shoes/pro-sl" class="brand">Shop FootJoy →</a>`,
    price: '$170',
    url: 'https://www.footjoy.com/collections/mens-golf-shoes/pro-sl',
    cta: 'Shop FootJoy',
    imageUrl: null,
  },
  {
    brand: 'Titleist',
    name: 'Pro V1 Golf Balls',
    desc: `If you're shooting under 90 consistently, you should be on a Pro V1. The performance difference between a quality ball and a random sleeve is measurable — consistent flight, soft feel around the greens, and durability that earns the price. A dozen lasts longer than you think. <a href="https://www.titleist.com/golf-balls/pro-v1" class="brand">Shop Titleist →</a>`,
    price: '$55/dozen',
    url: 'https://www.titleist.com/golf-balls/pro-v1',
    cta: 'Shop Titleist',
    imageUrl: null,
  },
  {
    brand: 'Sun Day Red',
    name: 'Performance Polo',
    desc: `Tiger's brand, and the quality shows it. Sun Day Red hits a sweet spot: the technical performance of athletic wear with a silhouette that doesn't look like an Under Armour ad. Subtle colorblocking, clean fit. Still underrated because it launched without a tour win attached. <a href="https://sundayred.com/collections/mens-polos" class="brand">Shop Sun Day Red →</a>`,
    price: '$118',
    url: 'https://sundayred.com/collections/mens-polos',
    cta: 'Shop Sun Day Red',
    imageUrl: null,
  },
  {
    brand: 'Malbon Golf',
    name: 'Malbon Bucket Hat',
    desc: `Malbon is what golf streetwear looks like when it has actual taste. The bucket hat is lightweight, UPF 50+, and won't make you look like you're trying too hard. Worn by everyone from PGA Tour caddies to guys who haven't picked up a club in three years. Add it before the summer rounds hit. <a href="https://malbon.com/collections/hats" class="brand">Shop Malbon →</a>`,
    price: '$52',
    url: 'https://malbon.com/products/malbon-bucket-hat-black',
    cta: 'Shop Malbon',
    imageUrl: 'https://malbon.com/cdn/shop/files/M-9426-BLK.png?crop=center&height=800&v=1753723097&width=720',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Rotating "The Rec" picks — apps, gear, books, services
// Pick via: RECS[(issueNum + 3) % RECS.length]  (offset from PRODUCTS)
// ─────────────────────────────────────────────────────────────────────────────
const RECS = [
  {
    title: 'Whoop 4.0 — the fitness tracker that actually tells you something.',
    body: `Whoop skips step-counter gimmicks and tracks recovery, strain, and sleep quality. The daily recovery score — a real number based on HRV, resting heart rate, and sleep stages — is accurate enough to adjust your schedule around. If it says 35%, take the easy morning. It's usually right. No screen, no distraction, and the membership includes the hardware.`,
    url: 'https://www.whoop.com',
    cta: 'Try Whoop →',
  },
  {
    title: 'Audible — stop carrying unread books and start finishing them.',
    body: `If your commute, gym time, or morning walk is dead air, Audible solves it. One credit a month for any audiobook — the real investment is having a structured reason to use the 40 minutes you already have. The GuyTalk pick this week: anything by Michael Lewis or Ryan Holiday. Both hold up on repeat.`,
    url: 'https://www.audible.com/ep/freetrial',
    cta: 'Start Audible →',
  },
  {
    title: 'Levels — continuous glucose monitoring for people without diabetes.',
    body: `Levels puts a CGM sensor on your arm and shows what your blood sugar does in real time. The insight most people get in week one: that "healthy" food is causing major spikes. Worth one month as an experiment. You'll change two or three things and keep them changed for good. The data pays for itself.`,
    url: 'https://www.levelshealth.com',
    cta: 'Try Levels →',
  },
  {
    title: 'Oura Ring Gen 3 — the sleep tracker that fits in your lifestyle.',
    body: `Oura is the Whoop alternative for guys who don't want a wristband. The ring tracks sleep stages, body temperature, and readiness, and the daily score is accurate enough that you'll start scheduling around it. Battery lasts 5–7 days. It looks like a regular ring. Worth it if you've ever woken up after 8 hours and still felt awful.`,
    url: 'https://ouraring.com',
    cta: 'Try Oura →',
  },
  {
    title: 'Bose QuietComfort 45 — best noise-cancelling for the price right now.',
    body: `Sony and Apple get the press, but Bose is still the quietest on a plane. The QC45 isn't the newest model — which means it's $100 cheaper than a year ago. Battery is 24 hours, the fit is comfortable for long hauls, and the noise cancellation mid-flight is genuinely different from the competition. Buy them before your next trip.`,
    url: 'https://www.bose.com/c/headphones',
    cta: 'Shop Bose →',
  },
  {
    title: 'Eight Sleep Pod 4 — the mattress cover that fixes your sleep temperature.',
    body: `Most sleep problems are temperature problems. Eight Sleep actively cools or heats each side of the bed throughout the night based on your sleep stage — the cooling function alone is worth it for anyone who runs hot. Recovery scores improve measurably within the first week for most users. Expensive but cheaper than bad sleep compounding.`,
    url: 'https://www.eightsleep.com',
    cta: 'Try Eight Sleep →',
  },
  {
    title: 'Hatch Restore 2 — the sunrise alarm clock that actually works.',
    body: `The Hatch Restore gradually brightens 30 minutes before your alarm, which means you wake up at the end of a sleep cycle instead of being jolted out of one. Sounds small, but the difference in how you feel in the first hour is immediate. Also doubles as a sound machine and reading light. Replace your phone alarm with this.`,
    url: 'https://www.hatch.co/restore',
    cta: 'Try Hatch →',
  },
  {
    title: 'AG1 (Athletic Greens) — the supplement that replaces the stack you forget to take.',
    body: `One scoop covers vitamins, minerals, and adaptogens that most guys buy separately and skip half the time. The main argument for it: you take it because it's on your counter and it tastes fine. The argument against: $79/month. If you're already spending that on supplements you forget, it pays for itself in consistency alone.`,
    url: 'https://drinkag1.com',
    cta: 'Try AG1 →',
  },
];

module.exports = { PLAYERS, TICKERS, BRIEF_ROWS, FETCH_TICKERS, PRODUCTS, RECS, esc, playerLink, tickerLink, fmtPrice, fmtPct };
