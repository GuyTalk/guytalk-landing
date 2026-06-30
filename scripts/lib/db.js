'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Player database: name → ESPN profile URL
// Add players here as they appear in new issues.
// ─────────────────────────────────────────────────────────────────────────────
const PLAYERS = {
  // NBA – ECF
  'Jalen Brunson':             { sport: 'nba',  id: '3934672',  slug: 'jalen-brunson',              bio: 'Knicks · elite scorer in clutch moments' },
  'Donovan Mitchell':          { sport: 'nba',  id: '3908809',  slug: 'donovan-mitchell',           bio: 'Cavaliers · "Spida" · perennial All-Star guard' },
  'Karl-Anthony Towns':        { sport: 'nba',  id: '3136193',  slug: 'karl-anthony-towns',         bio: 'Knicks · elite shooting big man' },
  'Darius Garland':            { sport: 'nba',  id: '4277905',  slug: 'darius-garland',             bio: 'Cavaliers · facilitating point guard' },
  'Evan Mobley':               { sport: 'nba',  id: '4432163',  slug: 'evan-mobley',                bio: 'Cavaliers · Defensive Player of the Year caliber' },
  'Josh Hart':                 { sport: 'nba',  id: '2578578',  slug: 'josh-hart',                  bio: 'Knicks · motor, hustle, limitless minutes' },
  'Mikal Bridges':             { sport: 'nba',  id: '3134870',  slug: 'mikal-bridges',              bio: 'Knicks · versatile two-way wing' },
  // NBA – WCF
  'Shai Gilgeous-Alexander':   { sport: 'nba',  id: '4278073',  slug: 'shai-gilgeous-alexander',    bio: 'Thunder · MVP-caliber scorer, elite shot creator' },
  'Victor Wembanyama':         { sport: 'nba',  id: '5104157',  slug: 'victor-wembanyama',          bio: 'Spurs · alien athlete, generational defensive force' },
  'Stephon Castle':            { sport: 'nba',  id: '4845367',  slug: 'stephon-castle',             bio: 'Spurs · 2024 lottery pick, rising playmaker' },
  'Chet Holmgren':             { sport: 'nba',  id: '4432638',  slug: 'chet-holmgren',              bio: 'Thunder · stretch-5 with elite rim protection' },
  'Luguentz Dort':             { sport: 'nba',  id: '4066409',  slug: 'luguentz-dort',              bio: 'Thunder · lockdown defender, underrated scorer' },
  // NBA – other
  'LeBron James':              { sport: 'nba',  id: '1966',     slug: 'lebron-james',               bio: 'Lakers · widely considered the greatest of all time' },
  'Stephen Curry':             { sport: 'nba',  id: '3975',     slug: 'stephen-curry',              bio: 'Warriors · revolutionized the game from 3-point range' },
  'Giannis Antetokounmpo':     { sport: 'nba',  id: '3032977',  slug: 'giannis-antetokounmpo',      bio: 'Bucks · "Greek Freak" · unstoppable force to the rim' },
  'Jayson Tatum':              { sport: 'nba',  id: '4065648',  slug: 'jayson-tatum',               bio: 'Celtics · 2024 champion, face of the franchise' },
  'Kevin Durant':              { sport: 'nba',  id: '3202',     slug: 'kevin-durant',               bio: 'Suns · arguably the most skilled scorer ever' },
  'Nikola Jokic':              { sport: 'nba',  id: '3112335',  slug: 'nikola-jokic',               bio: 'Nuggets · 3× MVP · best passing big man in history' },
  'Luka Doncic':               { sport: 'nba',  id: '3945274',  slug: 'luka-doncic',                bio: 'Lakers · orchestrates offense like no one in the game' },
  'Anthony Edwards':           { sport: 'nba',  id: '4594268',  slug: 'anthony-edwards',            bio: 'Timberwolves · "Ant-Man" · ascending face of the NBA' },
  // MLB – top stars
  'Shohei Ohtani':              { sport: 'mlb', id: '4697985',  slug: 'shohei-ohtani',              bio: 'Dodgers · elite pitcher AND hitter — one-of-a-kind talent' },
  'Aaron Judge':                { sport: 'mlb', id: '4196466',  slug: 'aaron-judge',                bio: 'Yankees · AL MVP · towering power hitter' },
  'Juan Soto':                  { sport: 'mlb', id: '4195502',  slug: 'juan-soto',                  bio: 'Mets · .400-OBP machine, elite run producer' },
  'Mookie Betts':               { sport: 'mlb', id: '4157272',  slug: 'mookie-betts',               bio: 'Dodgers · Gold Glove RF, elite contact hitter' },
  'Freddie Freeman':            { sport: 'mlb', id: '4020',     slug: 'freddie-freeman',            bio: 'Dodgers · 2020 World Series MVP, beloved clubhouse leader' },
  'Ronald Acuna Jr.':           { sport: 'mlb', id: '4243706',  slug: 'ronald-acuna-jr',            bio: 'Braves · 2023 unanimous NL MVP, speed + power combo' },
  'Bryce Harper':               { sport: 'mlb', id: '33140',    slug: 'bryce-harper',               bio: 'Phillies · 2022 NL MVP, postseason performer' },
  'Fernando Tatis Jr.':         { sport: 'mlb', id: '4243770',  slug: 'fernando-tatis-jr',          bio: 'Padres · electric shortstop, must-see play-maker' },
  'Paul Skenes':                { sport: 'mlb', id: '4895670',  slug: 'paul-skenes',                bio: 'Pirates · 2024 NL ROY, elite stuff from day one' },
  'Cody Bellinger':             { sport: 'mlb', id: '4097870',  slug: 'cody-bellinger',             bio: 'Cubs · former NL MVP, strong defensive outfielder' },
  // F1 drivers
  'Max Verstappen':             { sport: 'f1',  id: '3990',     slug: 'max-verstappen',   f1Slug: 'max-verstappen',            bio: 'Red Bull · 4× world champion, dominant era driver' },
  'Lewis Hamilton':             { sport: 'f1',  id: '1025',     slug: 'lewis-hamilton',   f1Slug: 'lewis-hamilton',            bio: 'Ferrari · 7× world champion, motorsport GOAT' },
  'Charles Leclerc':            { sport: 'f1',  id: '4592730',  slug: 'charles-leclerc',  f1Slug: 'charles-leclerc',           bio: 'Ferrari · Monaco native · championship contender' },
  'Lando Norris':               { sport: 'f1',  id: '4702614',  slug: 'lando-norris',     f1Slug: 'lando-norris',              bio: 'McLaren · 2025 world champion, overtook Verstappen' },
  'Carlos Sainz':               { sport: 'f1',  id: '4429619',  slug: 'carlos-sainz',     f1Slug: 'carlos-sainz',              bio: 'Williams · 2024 Australian GP winner, consistent front-runner' },
  'George Russell':             { sport: 'f1',  id: '4686350',  slug: 'george-russell',   f1Slug: 'george-russell',            bio: 'Mercedes · technical specialist, single-lap pace machine' },
  'Kimi Antonelli':             { sport: 'f1',  id: '5073282',  slug: 'kimi-antonelli',   f1Slug: 'andrea-kimi-antonelli',     bio: 'Mercedes · 18-year-old rookie, tipped as the next star' },
  'Oscar Piastri':              { sport: 'f1',  id: '4702619',  slug: 'oscar-piastri',    f1Slug: 'oscar-piastri',             bio: "McLaren · Norris's title rival, razor-sharp race craft" },
  // Soccer / World Cup 2026
  'Harry Kane':                 { sport: 'soccer', id: '157529',  slug: 'harry-kane',        fifaSlug: 'harry-kane',       wikiSlug: 'Harry_Kane',                                     bio: 'England captain · all-time leading scorer' },
  'Jude Bellingham':            { sport: 'soccer', id: '4251614', slug: 'jude-bellingham',    fifaSlug: 'jude-bellingham',  wikiSlug: 'Jude_Bellingham',                                bio: 'Real Madrid · England · most creative force in the squad' },
  'Marcus Rashford':            { sport: 'soccer', id: '3146590', slug: 'marcus-rashford',    fifaSlug: 'marcus-rashford',  wikiSlug: 'Marcus_Rashford',                                bio: 'Man United · electric winger, pace and clinical finishing' },
  'Cristiano Ronaldo':          { sport: 'soccer', id: '93869',   slug: 'cristiano-ronaldo',  fifaSlug: 'cristiano-ronaldo', wikiSlug: 'Cristiano_Ronaldo',                             bio: 'Portugal legend · 900+ career goals, chasing a World Cup' },
  'Lionel Messi':               { sport: 'soccer', id: '45843',   slug: 'lionel-messi',       fifaSlug: 'lionel-messi',     wikiSlug: 'Lionel_Messi',                                   bio: 'Inter Miami · 2022 World Cup winner · widely the greatest ever' },
  'Kylian Mbappé':              { sport: 'soccer', id: '3729512', slug: 'kylian-mbappe',      fifaSlug: 'kylian-mbappe',    wikiSlug: 'Kylian_Mbappé',                                  bio: 'Real Madrid · France · arguably the best player alive' },
  'Erling Haaland':             { sport: 'soccer', id: '4318050', slug: 'erling-haaland',     fifaSlug: 'erling-haaland',   wikiSlug: 'Erling_Haaland',                                 bio: 'Man City · Norway · goal machine, impossible finishing rate' },
  'Bukayo Saka':                { sport: 'soccer', id: '4318088', slug: 'bukayo-saka',         wikiSlug: 'Bukayo_Saka',                                                                   bio: 'Arsenal · England · right-side tormentor, PL elite' },
  'Phil Foden':                 { sport: 'soccer', id: '3906882', slug: 'phil-foden',          wikiSlug: 'Phil_Foden',                                                                    bio: 'Man City · England · Pep Guardiola\'s most trusted creative' },
  'Vinicius Jr.':               { sport: 'soccer', id: '4217293', slug: 'vinicius-junior',     wikiSlug: 'Vini_Jr.',                                                                      bio: 'Real Madrid · Brazil · dribbler and Champions League clutch player' },
  'Romano Schmid':              { sport: 'soccer', id: '4568166', slug: 'romano-schmid',       wikiSlug: 'Romano_Schmid',                                                                 bio: 'Werder Bremen · Austria captain' },
  'Luis Díaz':                  { sport: 'soccer', id: '3943007', slug: 'luis-diaz',           wikiSlug: 'Luis_Díaz_(footballer,_born_1997)',                                             bio: "Liverpool · Colombia · most dangerous attacker in the squad" },
  'USMNT':                      { sport: 'soccer', slug: 'usmnt', wikiSlug: 'United_States_men%27s_national_soccer_team' },
  // Golf – PGA
  'Scottie Scheffler':         { sport: 'golf', id: '4686091',  slug: 'scottie-scheffler',           bio: 'World No. 1 · Masters champion · dominant on tour' },
  'Rory McIlroy':              { sport: 'golf', id: '3448',     slug: 'rory-mcilroy',                bio: '4 major titles · best iron player in the world' },
  'Jon Rahm':                  { sport: 'golf', id: '4848699',  slug: 'jon-rahm',                    bio: 'LIV Golf · former No. 1 · major winner' },
  'Xander Schauffele':         { sport: 'golf', id: '4848706',  slug: 'xander-schauffele',           bio: 'PGA champion · elite under pressure' },
  'Collin Morikawa':           { sport: 'golf', id: '4848693',  slug: 'collin-morikawa',             bio: '2-time major winner · surgical ball-striker' },
  'Patrick Cantlay':           { sport: 'golf', id: '4848690',  slug: 'patrick-cantlay',             bio: 'Former No. 1 · exceptional putter' },
  'Viktor Hovland':            { sport: 'golf', id: '4848721',  slug: 'viktor-hovland',              bio: 'Norwegian · former FedEx Cup champion' },
  'Brooks Koepka':             { sport: 'golf', id: '1225',     slug: 'brooks-koepka',               bio: '5-time major winner · raises game at major venues' },
  'Bryson DeChambeau':         { sport: 'golf', id: '3470310',  slug: 'bryson-dechambeau',           bio: 'Defending US Open champion · longest hitter in the game' },
  'Tony Finau':                { sport: 'golf', id: '4848696',  slug: 'tony-finau',                  bio: 'Multiple PGA Tour wins · powerful tee-to-green game' },
  'Max Homa':                  { sport: 'golf', id: '4848704',  slug: 'max-homa',                    bio: '6 PGA Tour wins · known for humor and consistency' },
  'Russell Henley':            { sport: 'golf', id: '4848715',  slug: 'russell-henley',              bio: 'Veteran PGA Tour winner · accurate iron player' },
  'Eric Cole':                 { sport: 'golf', id: '10122',    slug: 'eric-cole',                   bio: '2023 Rocket Classic winner · rising consistency' },
  'Ben Griffin':               { sport: 'golf', id: '5769',     slug: 'ben-griffin',                 bio: 'Tour card earner turned multiple winner' },
  'Ludvig Aberg':              { sport: 'golf', id: '9999001',  slug: 'ludvig-aberg',                bio: 'Swedish rookie · first-year PGA player with major pedigree' },
  'Shane Lowry':               { sport: 'golf', id: '3139',     slug: 'shane-lowry',                 bio: '2019 Open champion · gritty links specialist' },
  'Tommy Fleetwood':           { sport: 'golf', id: '1225',     slug: 'tommy-fleetwood',             bio: 'Ryder Cup stalwart · patient, precise ball-striker' },
  // Golf — current US Open / major contenders
  'Harry Higgs':               { sport: 'golf', id: '9095',     slug: 'harry-higgs',                 bio: 'Fan favorite · big hitter, big personality' },
  'Taylor Montgomery':         { sport: 'golf', id: '10637',    slug: 'taylor-montgomery',           bio: 'Rising PGA Tour player, strong iron game' },
  'Chandler Phillips':         { sport: 'golf', id: '10984',    slug: 'chandler-phillips',           bio: 'Web.com Tour standout, breaking through on Tour' },
  // F1 — current grid
  'Kimi Antonelli':            { sport: 'f1',   id: '5073282',  slug: 'andrea-kimi-antonelli',       bio: 'Mercedes · 18-year-old rookie, tipped as the next star' },
  'Oscar Piastri':             { sport: 'f1',   id: '4702619',  slug: 'oscar-piastri',               bio: "McLaren · Norris's title rival, razor-sharp race craft" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Entity link database: teams, venues, leagues, orgs → canonical URL
// Used by linkifyEntities() in html.js for contextual hyperlinks.
// ─────────────────────────────────────────────────────────────────────────────
const ENTITY_LINKS = {
  // NHL teams
  'Carolina Hurricanes':    { url: 'https://www.nhl.com/hurricanes',    cls: 'entity-team' },
  'Vegas Golden Knights':   { url: 'https://www.nhl.com/goldenknights', cls: 'entity-team' },
  'Florida Panthers':       { url: 'https://www.nhl.com/panthers',      cls: 'entity-team' },
  'Edmonton Oilers':        { url: 'https://www.nhl.com/oilers',        cls: 'entity-team' },
  // NBA teams
  'New York Knicks':        { url: 'https://www.nba.com/knicks',        cls: 'entity-team' },
  'San Antonio Spurs':      { url: 'https://www.nba.com/spurs',         cls: 'entity-team' },
  'Oklahoma City Thunder':  { url: 'https://www.nba.com/thunder',       cls: 'entity-team' },
  // F1 teams
  'Ferrari':                { url: 'https://www.formula1.com/en/teams/Ferrari.html', cls: 'entity-team' },
  'Mercedes':               { url: 'https://www.formula1.com/en/teams/Mercedes.html', cls: 'entity-team' },
  'McLaren':                { url: 'https://www.formula1.com/en/teams/McLaren.html', cls: 'entity-team' },
  // Leagues / orgs
  'UFC':                    { url: 'https://www.ufc.com',               cls: 'entity-org' },
  'PGA Tour':               { url: 'https://www.pgatour.com',           cls: 'entity-org' },
  'USGA':                   { url: 'https://www.usga.org',              cls: 'entity-org' },
  'Formula 1':              { url: 'https://www.formula1.com',          cls: 'entity-org' },
  // Golf venues
  'Pinehurst No. 2':        { url: 'https://www.pinehurst.com/golf/courses/no-2/', cls: 'entity-venue', context: "Donald Ross's masterpiece — crowned bentgrass greens that reject anything less than a perfect strike. The toughest U.S. Open setup in golf." },
  'Augusta National':       { url: 'https://www.masters.com',           cls: 'entity-venue', context: 'Home of The Masters — the most exclusive golf club in the world.' },
  'Royal Portrush':         { url: 'https://royalportrushgolfclub.com', cls: 'entity-venue' },
  // F1 circuits
  'Red Bull Ring':          { url: 'https://www.redbullring.com',       cls: 'entity-venue', context: "Red Bull's home circuit in Austria — short, fast, high-altitude, and one of the best overtaking venues on the calendar." },
  'Silverstone':            { url: 'https://www.silverstone.co.uk',     cls: 'entity-venue', context: 'The home of British motorsport — fast, flowing, and one of the most demanding circuits for mechanical grip.' },
  // Notable venues
  'Madison Square Garden':  { url: 'https://www.msg.com',              cls: 'entity-venue', context: "The World's Most Famous Arena — home of the New York Knicks and one of the most iconic sports venues in America." },
  // Companies
  'OpenAI':                 { url: 'https://www.cnbc.com/quotes/PRIVATE:OPENAI', cls: 'entity-company' },
  'SpaceX':                 { url: 'https://www.cnbc.com/quotes/PRIVATE:SPACEX', cls: 'entity-company' },
  'Nvidia':                 { url: 'https://www.cnbc.com/quotes/NVDA',  cls: 'entity-company' },
  'Tesla':                  { url: 'https://www.cnbc.com/quotes/TSLA',  cls: 'entity-company' },
  'Netflix':                { url: 'https://www.cnbc.com/quotes/NFLX',  cls: 'entity-company' },
};

// Wrap the FIRST occurrence of `name` in `html` with an entity link.
function entityLink(html, name) {
  const entry = ENTITY_LINKS[name];
  if (!entry) return html;
  const idx = html.indexOf(name);
  if (idx < 0) return html;
  // Don't double-link (check if already inside an <a> tag)
  const before = html.slice(0, idx);
  if ((before.match(/<a\b/g) || []).length > (before.match(/<\/a>/g) || []).length) return html;
  return before +
    `<a href="${entry.url}" class="${entry.cls}" target="_blank" rel="noopener">${name}</a>` +
    html.slice(idx + name.length);
}

// Apply entityLink for all known entities. Longest names first to avoid partial matches.
function linkifyEntities(html) {
  if (!html) return html;
  let result = html;
  const names = Object.keys(ENTITY_LINKS).sort((a, b) => b.length - a.length);
  for (const name of names) result = entityLink(result, name);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticker config: display order + Morningstar links
// The BRIEF_ORDER array controls which tickers appear in the markets table.
// ─────────────────────────────────────────────────────────────────────────────
const TICKERS = {
  // ── Core indices — ALWAYS shown ──────────────────────────────────────────
  'SPY':  { name: 'S&P 500',    finnhub: 'SPY', ms: 'etfs/arcx/spy/quote', display: 'SPY', indexYahoo: '%5EGSPC', indexDisplay: 'S&P 500' },
  'DIA':  { name: 'Dow Jones',  finnhub: 'DIA', ms: 'etfs/arcx/dia/quote', display: 'DIA', indexYahoo: '%5EDJI',  indexDisplay: 'Dow' },
  'QQQ':  { name: 'Nasdaq 100', finnhub: 'QQQ', ms: 'etfs/arcx/qqq/quote', display: 'QQQ', indexYahoo: '%5EIXIC', indexDisplay: 'Nasdaq' },
  'IWM':  { name: 'Russell 2000', finnhub: 'IWM', ms: 'etfs/arcx/iwm/quote', display: 'IWM', indexYahoo: '%5ERUT', indexDisplay: 'Russell 2000' },
  '10Y':  { name: '10Y Yield', finnhub: null,               ms: null,                         display: '10Y Treasury', yahoo: '%5ETNX' },
  // ── Movers watchlist — rotates daily by biggest move ─────────────────────
  'NVDA': { name: 'Nvidia',    finnhub: 'NVDA',             ms: 'stocks/xnas/nvda/quote',     display: 'NVDA' },
  'TSLA': { name: 'Tesla',     finnhub: 'TSLA',             ms: 'stocks/xnas/tsla/quote',     display: 'TSLA' },
  'MSFT': { name: 'Microsoft', finnhub: 'MSFT',             ms: 'stocks/xnas/msft/quote',     display: 'MSFT' },
  'AAPL': { name: 'Apple',     finnhub: 'AAPL',             ms: 'stocks/xnas/aapl/quote',     display: 'AAPL' },
  'META': { name: 'Meta',      finnhub: 'META',             ms: 'stocks/xnas/meta/quote',     display: 'META' },
  'AMZN': { name: 'Amazon',    finnhub: 'AMZN',             ms: 'stocks/xnas/amzn/quote',     display: 'AMZN' },
  'GOOGL':{ name: 'Alphabet',  finnhub: 'GOOGL',            ms: 'stocks/xnas/googl/quote',    display: 'GOOGL' },
  'AMD':  { name: 'AMD',       finnhub: 'AMD',              ms: 'stocks/xnas/amd/quote',      display: 'AMD' },
  'AVGO': { name: 'Broadcom',  finnhub: 'AVGO',             ms: 'stocks/xnas/avgo/quote',     display: 'AVGO' },
  'NFLX': { name: 'Netflix',   finnhub: 'NFLX',             ms: 'stocks/xnas/nflx/quote',     display: 'NFLX' },
  'JPM':  { name: 'JPMorgan',  finnhub: 'JPM',              ms: 'stocks/xnys/jpm/quote',      display: 'JPM' },
  'COIN': { name: 'Coinbase',  finnhub: 'COIN',             ms: 'stocks/xnas/coin/quote',     display: 'COIN' },
  'DELL': { name: 'Dell',      finnhub: 'DELL',             ms: 'stocks/xnys/dell/quote',     display: 'DELL' },
  'BTC':  { name: 'Bitcoin',   finnhub: 'BINANCE:BTCUSDT',  ms: 'funds/xnas/gbtc/quote',      display: 'Bitcoin' },
};

// Core indices always rendered, in order (S&P, Dow, Nasdaq, Russell 2000, 10Y).
const CORE_TICKERS = ['SPY', 'DIA', 'QQQ', 'IWM', '10Y'];

// Pool scanned each day; the biggest movers get featured under the indices so
// the individual names aren't the same every issue.
const MOVERS_WATCHLIST = ['NVDA', 'TSLA', 'MSFT', 'AAPL', 'META', 'AMZN', 'GOOGL', 'AMD', 'AVGO', 'NFLX', 'JPM', 'COIN', 'DELL', 'BTC'];

// How many movers to feature under the indices.
const MOVERS_COUNT = 5;

// Large-cap universe scanned for Top Gainers / Losers / Most Active (recognizable
// names only — no penny stocks) plus major crypto. Ranked daily by FMP quotes.
const LARGECAP_UNIVERSE = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','AMD','NFLX','ORCL','CRM','ADBE','INTC','MU','QCOM','PLTR','COIN','MSTR','UBER',
  'JPM','V','MA','BAC','GS','WMT','COST','HD','NKE','MCD','SBUX','DIS','XOM','CVX','UNH','LLY','JNJ','PFE','KO','PEP','BA','CAT','GE','F',
];
// FMP crypto symbol format is e.g. BTCUSD; display strips the USD.
const CRYPTO_UNIVERSE = ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','DOGEUSD'];

// Legacy fixed layout (kept for any older render paths); active brief uses
// CORE_TICKERS + selected movers.
const BRIEF_ROWS = [
  { type: 'ticker', key: 'SPY' },
  { type: 'ticker', key: 'QQQ' },
  { type: 'divider' },
  { type: 'ticker', key: 'NVDA' },
  { type: 'ticker', key: 'TSLA' },
  { type: 'ticker', key: 'MSFT' },
  { type: 'divider' },
  { type: 'ticker', key: '10Y' },
];

// Which tickers to fetch from Finnhub (core movers + indices)
const FETCH_TICKERS = [...CORE_TICKERS.filter(t => t !== '10Y'), ...MOVERS_WATCHLIST];

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
  const url = officialPlayerUrl(p);
  return `<a href="${url}" class="player" target="_blank" rel="noopener">${esc(name)}</a>`;
}

// Build the best available URL for a player, in priority order:
// FIFA → F1.com → PGA Tour → MLB.com → NBA.com → ESPN → Wikipedia
function officialPlayerUrl(p) {
  if (!p) return '#';
  if (p.sport === 'soccer') {
    // Wikipedia is more reliable for soccer — ESPN soccer IDs vary by league/region
    if (p.wikiSlug) return `https://en.wikipedia.org/wiki/${p.wikiSlug}`;
    if (p.id) return `https://www.espn.com/soccer/player/_/id/${p.id}/${p.slug}`;
  }
  if (p.sport === 'f1') {
    // Formula1.com official driver profile
    if (p.f1Slug) return `https://www.formula1.com/en/drivers/${p.f1Slug}`;
    if (p.id) return `https://www.espn.com/racing/driver/_/id/${p.id}/${p.slug}`;
  }
  if (p.sport === 'golf') {
    // PGA Tour official profile
    if (p.id) return `https://www.pgatour.com/players/player.${p.id}.${p.slug}.html`;
  }
  if (p.sport === 'mlb') {
    // MLB.com official profile
    if (p.id && p.slug) return `https://www.mlb.com/player/${p.slug}-${p.id}`;
    if (p.id) return `https://www.espn.com/mlb/player/_/id/${p.id}/${p.slug}`;
  }
  if (p.sport === 'nba') {
    // NBA.com official profile
    if (p.id) return `https://www.nba.com/player/${p.id}`;
  }
  // ESPN fallback
  if (p.id && p.slug) {
    const espnBase = { nba: 'nba', mlb: 'mlb', f1: 'racing/driver', golf: 'golf', nhl: 'nhl' };
    const path = espnBase[p.sport] || p.sport;
    return `https://www.espn.com/${path}/player/_/id/${p.id}/${p.slug}`;
  }
  // Wikipedia last resort
  if (p.wikiSlug) return `https://en.wikipedia.org/wiki/${p.wikiSlug}`;
  return '#';
}

// Build a playerLinks array for a dynamicSports card.
// Scans the combined facts+headline text for known player names and returns
// [{name, url}] using the official profile priority order.
function buildPlayerLinksFromFacts(facts, headline) {
  const text = `${facts || ''} ${headline || ''}`;
  const found = [];
  const seen  = new Set();
  for (const [name, p] of Object.entries(PLAYERS)) {
    if (seen.has(name)) continue;
    if (text.includes(name)) {
      seen.add(name);
      found.push({ name, url: officialPlayerUrl(p) });
    }
  }
  return found;
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
  if (symbol === '10Y') return `${price.toFixed(2)}%`;
  if (symbol === 'BTC') {
    return price > 10000 ? `$${(price / 1000).toFixed(1)}K` : `$${price.toFixed(0)}`;
  }
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (price >= 100) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
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
    imageUrl: 'https://www.saintbernard.com/cdn/shop/files/MS26EK87xBLUEBIRDxPrimary_187725414.jpg?v=1772780080&width=1946',
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
    desc: `The best-selling golf shoe on tour for a reason. The 2026 version dropped 29% in weight, added a new last, and kept everything that made the original worth buying: waterproof, spikeless, and stable on any terrain. Buy them once and stop thinking about golf shoes. <a href="https://www.footjoy.com/collections/mens-golf-shoes/pro-sl" class="brand">Shop FootJoy →</a>`,
    price: '$170',
    url: 'https://www.footjoy.com/collections/mens-golf-shoes/pro-sl',
    cta: 'Shop FootJoy',
    imageUrl: 'https://pluggedingolf.com/wp-content/uploads/2026/01/2026-FootJoy-Pro-SL-1123.jpg',
  },
  {
    brand: 'Titleist',
    name: 'Pro V1 Golf Balls',
    desc: `If you're shooting under 90 consistently, you should be on a Pro V1. The performance difference between a quality ball and a random sleeve is measurable — consistent flight, soft feel around the greens, and durability that earns the price. A dozen lasts longer than you think. <a href="https://www.titleist.com/golf-balls/pro-v1" class="brand">Shop Titleist →</a>`,
    price: '$55/dozen',
    url: 'https://www.titleist.com/golf-balls/pro-v1',
    cta: 'Shop Titleist',
    imageUrl: 'https://www.carlsgolfland.com/media/catalog/product/cache/d69ef9f06ed26ee571b3d9d7a80a892a/2/0/2025_titleist_pro_v1_golf_balls_dozen_box_hero.jpg',
  },
  {
    brand: 'Greyson Clothiers',
    name: 'Montauk Polo',
    desc: `Greyson makes the polo that golf guys actually pass around. The Montauk is four-way stretch, pill-resistant, and comes in colorways that look sharp on the course and don't embarrass you at the bar after. Tour players wear it because it performs. Everyone else wears it because it looks good. <a href="https://greysonclothiers.com/collections/mens-polos" class="brand">Shop Greyson →</a>`,
    price: '$115',
    url: 'https://greysonclothiers.com/collections/mens-polos',
    cta: 'Shop Greyson',
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
  {
    brand: 'Patagonia',
    name: 'Nano Puff Hoody',
    desc: `The jacket you grab without thinking. PrimaLoft insulation is warm without bulk, the packable stuff-sack fit means it disappears into your bag, and Patagonia builds theirs to last 10 years. Works for 45-degree mornings at the course, sideline of any youth sports game, or traveling through airports in June when every gate is 60 degrees. <a href="https://www.patagonia.com/shop/mens-jackets" class="brand">Shop Patagonia →</a>`,
    price: '$249',
    url: 'https://www.patagonia.com/shop/mens-jackets',
    cta: 'Shop Patagonia',
    imageUrl: 'https://wornwear.patagonia.com/cdn/shop/files/levht5b6ukbxmcyw4mwo.jpg?v=1724160922&width=1946',
  },
  {
    brand: 'YETI',
    name: 'Rambler 20 oz Tumbler',
    desc: `YETI's 20oz Rambler keeps coffee hot for 4 hours and cold drinks cold for 8. The MagSlider lid is genuinely better than every cheaper alternative. It's the most-gifted item in YETI's lineup because everyone who gets one stops using other tumblers. If you're still running grocery store drinkware, just upgrade. <a href="https://www.yeti.com/drinkware/tumblers" class="brand">Shop YETI →</a>`,
    price: '$35',
    url: 'https://www.yeti.com/drinkware/tumblers',
    cta: 'Shop YETI',
    imageUrl: 'https://southtexastack.com/cdn/shop/files/yeti-coolers-other-yeti-rambler-20oz-tumbler-1230282773.jpg?v=1775349526&width=826',
  },
  {
    brand: 'Therabody',
    name: 'Theragun Prime',
    desc: `If you play golf, lift, or run — get a percussion massager. The Theragun Prime isn't as heavy as the Pro and hits deep enough for real muscle recovery. 60 minutes of battery per charge covers a week of daily use. Works on the back, shoulders, and calves where foam rollers don't reach. Quieter than the previous generation, which matters. <a href="https://www.therabody.com/pages/theragun" class="brand">Shop Therabody →</a>`,
    price: '$299',
    url: 'https://www.therabody.com/pages/theragun',
    cta: 'Shop Therabody',
    imageUrl: 'https://www.therabody.com/cdn/shop/files/Theragun-Prime-G6-PLP-Thumbnail-1.webp?v=1758755086&width=1445',
  },
  {
    brand: 'Vuori',
    name: 'Sunday Performance Jogger',
    desc: `Vuori's Sunday jogger is the sweatpant that replaced sweatpants. The DreamKnit fabric is softer than anything in your drawer, stretches naturally, and holds its shape after a hundred washes. Wears as well on a long travel day as it does post-workout. Once you try them you'll understand the hype. <a href="https://vuoriclothing.com/collections/mens-joggers" class="brand">Shop Vuori →</a>`,
    price: '$128',
    url: 'https://vuoriclothing.com/collections/mens-joggers',
    cta: 'Shop Vuori',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0022/4008/6074/files/V416BLK_SP24_M_ECOMM_PANTS_FRONT_1.jpg?v=1743124704',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Rotating "The Rec" picks — apps, gear, books, services
// Pick via: RECS[(issueNum + 3) % RECS.length]  (offset from PRODUCTS)
// ─────────────────────────────────────────────────────────────────────────────
const RECS = [
  {
    title: 'Whoop 4.0 — recovery tracking that changes what you schedule on hard days.',
    body: `Whoop skips step-counter gimmicks and focuses on one number: your daily recovery score based on HRV, resting heart rate, and sleep stages. The honest version — it's accurate enough that you'll start adjusting your mornings around it, but it requires buying into the idea that you'll actually change behavior when the score is low. Most people don't. If you will, it's worth every cent. The flaw: it requires a $30/month membership on top of the hardware. No screen, no distraction, subscription includes the band.`,
    url: 'https://www.whoop.com',
    cta: 'Try Whoop →',
    brand: 'Whoop',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0344/8518/4748/files/WHOOP_4.0_Band_Collection_2.jpg',
  },
  {
    title: 'Levels — one month of continuous glucose monitoring changes how you eat permanently.',
    body: `Levels puts a sensor on your arm and shows what your blood sugar does in real time for 30 days. The insight most people get in week one: that the "healthy" foods they eat are causing major spikes, and the foods they thought were bad aren't. You'll change two or three things and keep them changed for years. The honest flaw: $199 for the first month is a lot for data you could get cheaper elsewhere — but the visual feedback loop is what actually creates behavior change. Worth one month as an experiment.`,
    url: 'https://www.levelshealth.com',
    cta: 'Try Levels →',
    brand: 'Levels',
    imageUrl: 'https://static.levels.com/og/levels.jpg',
  },
  {
    title: 'Oura Ring Gen 3 — sleep tracking for guys who won\'t wear a wristband.',
    body: `Oura tracks sleep stages, body temperature, and readiness in a ring that looks like jewelry. Battery lasts 5–7 days. The daily readiness score is accurate enough to schedule around — if it says 45%, you probably feel like 45%. The honest trade-off: the ring is $349 upfront plus $6/month for the app, and the heart-rate workout tracking is genuinely inferior to Apple Watch or Garmin. If you want sleep data and don't want a wristband, it's the best option. If you want workout tracking too, get the Whoop instead.`,
    url: 'https://ouraring.com',
    cta: 'Try Oura →',
    brand: 'Oura',
    imageUrl: 'https://ouraring.com/img/pages/homepage/hero-ring-gen3.jpg',
  },
  {
    title: 'Bose QuietComfort 45 — the headphones that are better than the ones getting reviews.',
    body: `Sony and Apple dominate the review cycle right now, but Bose still wins on actual noise cancellation on a plane. The QC45 isn't the newest model — which means it's $100 cheaper than a year ago and $150 cheaper than the Ultra. Battery is 24 hours, the fit doesn't hurt after four hours, and the cancellation mid-flight is genuinely quieter than Sony's. Honest flaw: the sound profile favors mids over bass, which matters if you're an audiophile and doesn't matter at all if you just want to sleep through a flight. Buy them before your next trip.`,
    url: 'https://www.bose.com/c/headphones',
    cta: 'Shop Bose →',
    brand: 'Bose',
    imageUrl: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/5765/5765427cv11d.jpg',
  },
  {
    title: 'Eight Sleep Pod 4 — the most direct solution to waking up hot at 3am.',
    body: `Eight Sleep actively cools or heats each side of the bed based on your sleep stage — not just a fixed temperature, but adjusting through the night. The cooling alone is worth it for anyone who runs hot. Most users report measurably better deep sleep scores within the first week. The honest flaw: it costs $2,500 and you have to buy it yourself because no one will believe you when you try to explain it. Expensive but empirically cheaper than years of bad sleep compounding into every other health decision.`,
    url: 'https://www.eightsleep.com',
    cta: 'Try Eight Sleep →',
    brand: 'Eight Sleep',
    imageUrl: 'https://res.cloudinary.com/eightsleep/image/upload/c_fill,w_1200,h_630,f_jpg,q_auto/v1747147611/Homepage_c0dril.png',
  },
  {
    title: 'Hatch Restore 2 — replace your phone alarm with something that doesn\'t make you miserable.',
    body: `The Hatch gradually brightens 30 minutes before your alarm, which means you wake up at the end of a sleep cycle instead of being jolted out of the middle of one. The difference in how you feel in the first hour is real and immediate — not placebo. It also functions as a sound machine, reading light, and breathing coach. The honest flaw: $200 for an alarm clock sounds insane until you've used one for two weeks, at which point you stop thinking about the price. Replace your phone alarm with this before you go to bed tonight.`,
    url: 'https://www.hatch.co/restore',
    cta: 'Try Hatch →',
    brand: 'Hatch',
    imageUrl: 'https://www.datocms-assets.com/98401/1769721785-restore-3-carousel-putty-1-v2.webp',
  },
  {
    title: 'AG1 — the supplement that works because it\'s the one you\'ll actually take.',
    body: `One scoop of AG1 covers vitamins, minerals, probiotics, and adaptogens that most guys buy separately and skip four days a week. The honest version: it's not dramatically better than a quality multivitamin at $15/month — the real advantage is the $79/month cost is high enough that you actually use it, and it tastes fine mixed with water. The argument against: if you already have a consistent supplement routine, this is redundant and overpriced. If you don't — and most guys don't — this is cheaper than the stack you're already forgetting to take.`,
    url: 'https://drinkag1.com',
    cta: 'Try AG1 →',
    brand: 'AG1',
    imageUrl: 'https://drinkag1.com/cdn/shop/files/AG1-Pouch-Travel-Packets-Primary_001.jpg',
  },
  {
    title: 'Peloton App — the gym content that works in any hotel room.',
    body: `Forget the bike. The Peloton app without hardware is $13/month and the strength training library is legitimately better programmed than what most gym PTs write. The honest trade-off: the app has too much content and you'll spend time browsing instead of working out if you don't have a specific class bookmarked before you open it. Fix that by picking one 20-minute strength class before your trip, saving it, and opening it cold. Download it before any hotel stay and you'll stop skipping workouts on the road.`,
    url: 'https://www.onepeloton.com/app',
    cta: 'Try Peloton App →',
    brand: 'Peloton',
    imageUrl: 'https://images.ctfassets.net/7vk8puwnesgc/2a4M7YoVbnUJmdHbaaP57z/68b46399c7860116075e48dfdc58860b/Metadata_small.jpg',
  },
  {
    title: 'ThermoWorks Thermapen ONE — if you grill, this is the only thermometer you should own.',
    body: `One-second reads, accurate to ±0.5°F, folds into a pocket. ThermoWorks sells this hardware to professional kitchens and food labs — $109 puts the same probe in your hands for home use. The honest case against: if you've cooked the same proteins the same way for 20 years and you're satisfied, skip it. If you ever cook steak, fish, pork, or chicken and care whether it's right, this raises the ceiling on everything you pull off the grill. You stop guessing. One of the rare products that actually performs better than its reviews.`,
    url: 'https://www.thermoworks.com/thermapen-one/',
    cta: 'Get Thermapen ONE →',
    brand: 'ThermoWorks',
    imageUrl: 'https://www.thermoworks.com/cdn/shop/files/Thermapen_Instant_Read_Nav_2.webp?v=1773843804',
  },
  {
    title: '1Password — fix your password situation before something forces you to.',
    body: `If you're reusing passwords or relying on your browser's keychain, you're one data breach away from a bad month. 1Password generates, stores, and autofills unique passwords across every device. The family plan covers five people for $5/month. Honest trade-off: takes one focused hour to migrate everything over from wherever you currently store passwords, and that hour is genuinely annoying. After that you stop thinking about it forever. Do it before you're forced to by something worse.`,
    url: 'https://1password.com',
    cta: 'Try 1Password →',
    brand: '1Password',
    imageUrl: 'https://images.ctfassets.net/2h488pz7kgfv/4JAm44Htcrinu0sTomaEGi/1f7be85af3138e1d38bb31fe5ad6425b/open-graph-1password-business.jpg',
  },
  {
    title: 'Napper Pro (iOS) — the 20-minute nap timer that actually wakes you up.',
    body: `Napper tracks sleep onset using your phone's microphone and vibration — it detects when you fall asleep and times your nap from that moment, not from when you hit start. The result: a 20-minute nap that actually lands at 20 minutes post-sleep, which is the window that leaves you refreshed instead of groggy. Costs $4.99 once. Most people who try it use it multiple times per week. The honest flaw: you have to be somewhere quiet, which limits the use case. But for the home office, couch, or a hotel room on a travel day, this is the most useful $5 you'll spend on your phone.`,
    url: 'https://apps.apple.com/us/app/napper-power-nap-timer/id1498961328',
    cta: 'Get Napper →',
    brand: 'Napper',
    imageUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/1d/2a/cc/1d2acc3e-1d37-dff5-f948-cfe49a26aef9/AppIcon-1x_U007emarketing-0-7-0-85-220.png/1200x630wa.png',
  },
  {
    title: 'Theragun Relief — the entry point into recovery that actually works.',
    body: `Four attachments, quiet enough to use in a hotel room, three speed settings, 120-minute battery. Therabody makes the Theragun Pro for athletes and physical therapists — the Relief is the same percussion therapy at $149 instead of $399. The honest case: if you sit at a desk, fly regularly, or train more than twice a week, the upper back and hip flexor work alone justifies the price inside six months. The honest flaw: it won't fix an actual injury — it's recovery and maintenance, not treatment. For the price, it outperforms every foam roller and massage ball alternative by a significant margin.`,
    url: 'https://www.therabody.com/us/en-us/theragun-relief.html',
    cta: 'Get Theragun Relief →',
    brand: 'Therabody',
    imageUrl: 'https://www.therabody.com/cdn/shop/files/preview_images/dddb1c47bce8413c98c7314e9bdf7e10.thumbnail.0000000000_2048x.jpg?v=1738871778',
  },
  {
    title: 'MasterClass — one weekend, one class, actually useful.',
    body: `$120/year covers every class across every category. The honest pitch isn't the celebrity instructors — it's the specificity. Gordon Ramsay's knife-work module will change how you cook. Matthew Walker's sleep class distills his book into 90 minutes. Phil Ivey on poker reads. Steph Curry breaking down shooting mechanics from the feet up. The flaw: most guys buy it, watch two classes, and forget about it entirely. Fix that by picking one class to finish before you buy. If you can commit to three complete classes in a year, it's worth every dollar. If you can't, it isn't — honest answer.`,
    url: 'https://www.masterclass.com',
    cta: 'Try MasterClass →',
    brand: 'MasterClass',
    imageUrl: null,
  },
  {
    title: 'Weber Kettle Premium 22" — the only grill most guys actually need.',
    body: `Charcoal, 363 square inches of cooking space, built-in thermometer, one-touch cleaning system. Weber has been making this grill since 1952 and hasn't meaningfully changed it because it doesn't need changing. The honest comparison: a gas grill is faster and more convenient. A charcoal grill produces better results and teaches you to actually cook — timing, airflow, indirect vs. direct heat. The Premium is $229, which is less than one month of a gas grill's propane and maintenance costs over five years. If you can only own one grill, this is the one that makes you better at grilling.`,
    url: 'https://www.weber.com/en-us/grills/charcoal-grills/kettle-series/original-kettle-premium-charcoal-grill-22-inch/OLP22.html',
    cta: 'Shop Weber →',
    brand: 'Weber',
    imageUrl: 'https://dw-images.weber.com/navigation/default/charcoal-grills/FY26_NPD_Kettle_MegaMenu_Image_207x165.png?w=800&auto=compress,format',
    guideUrl: 'https://www.guytalkmedia.com/guide/',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Curated streaming picks — verified descriptions, no AI hallucination
// Pick via: STREAMING_PICKS[issueNum % STREAMING_PICKS.length]
// ─────────────────────────────────────────────────────────────────────────────
const STREAMING_PICKS = [
  {
    head: 'Watch this: Adolescence',
    source: 'Netflix',
    body: "Four episodes, each shot in a single continuous take — no cuts, no edits, no hiding. The story follows a 13-year-old arrested for stabbing a classmate, told from four different perspectives across one day. The interrogation episode is 45 minutes of the best acting you'll see this year. It's technically unprecedented and emotionally punishing in the best way. Clear two hours.",
  },
  {
    head: 'Watch this: Landman',
    source: 'Paramount+',
    body: "Billy Bob Thornton running Texas oil country — part business thriller, part character study about men who operate by a code that predates HR departments. Handshake deals, brutal honesty, high stakes. Jon Hamm plays the wildcatter who funds it all. If you've ever dealt with people who say exactly what they mean, this will feel familiar. Ten episodes.",
  },
  {
    head: 'Watch this: Ripley',
    source: 'Netflix',
    body: "Eight episodes shot entirely in black and white across Italy. Andrew Scott plays Tom Ripley — con man, forger, and one of fiction's most compelling sociopaths — with a stillness that makes you feel like you're watching someone think. Steven Zaillian directed all eight episodes himself. One of the most beautiful things Netflix has made.",
  },
  {
    head: 'Watch this: The Day of the Jackal',
    source: 'Peacock',
    body: "Eddie Redmayne as a freelance assassin — methodical, charming, completely untraceable — until one investigator gets close. Ten episodes, European locations, and a cat-and-mouse structure that holds pressure without cheap reveals. Better than the original film. Start it and you'll finish it in a weekend.",
  },
  {
    head: 'Watch this: Severance — Season 2',
    source: 'Apple TV+',
    body: "The show about surgical work-life separation — employees literally split their memories at the office door — came back and picked up exactly where it left off. If you watched Season 1 and then forgot about it, Season 2 is the reason you subscribed. Watch both seasons back to back if you haven't started.",
  },
  {
    head: 'Watch this: Zero Day',
    source: 'Netflix',
    body: "Robert De Niro as a former president called back in to investigate a massive cyberattack on American infrastructure. More grounded than it sounds — less action movie, more political thriller with actual stakes. Six episodes. The first one hooks you before the credits finish.",
  },
  {
    head: 'Watch this: Black Bag',
    source: 'Peacock',
    body: "Steven Soderbergh's spy thriller: Michael Fassbender and Cate Blanchett as intelligence agents who are married to each other — until one of them is suspected of being a mole. Tight, clever, and built like a chess match. 90 minutes with no wasted scenes.",
  },
  {
    head: 'Watch this: The Accountant 2',
    source: 'Netflix',
    body: "Ben Affleck returns as the autistic forensic accountant who's also a lethal contractor. Better than the first film — sharper script, Jon Bernthal back making the most of every scene he's in. The premise sounds ridiculous and the execution is genuinely good. Two hours that don't drag.",
  },
  {
    head: 'Watch this: The Studio',
    source: 'Apple TV+',
    body: "Seth Rogen plays a film studio exec who genuinely loves movies but runs a company that exists to make sequels and IP. Each episode is a specific industry absurdity — AI integration, awards season politics, prestige film financing — played straight enough to be funny and true enough to be uncomfortable. Best comedy of 2025.",
  },
  {
    head: 'Watch this: Sinners',
    source: 'In Theaters / Max',
    body: "Ryan Coogler's supernatural horror film set in 1930s Mississippi Delta. Two brothers come home to open a juke joint and encounter something ancient and evil. Shot on analog film, uses blues music as a weapon, and works as both a genuine horror film and a story about Black American culture in the Jim Crow South. It's doing something the genre rarely tries.",
  },
  {
    head: 'Watch this: The Brutalist',
    source: 'Peacock',
    body: "Adrien Brody as a Hungarian-Jewish architect who arrives in America after WWII and tries to build something real. Three and a half hours including intermission, and it earns every minute. Best film of 2024 by most measures. Watch it on the biggest screen you have — it was shot in VistaVision specifically so you'd feel the scale.",
  },
  {
    head: 'Watch this: Dept. Q',
    source: 'Netflix',
    body: "Danish crime series following a cold case unit in Copenhagen — Scandinavian noir with an odd-couple detective pairing and cases that spiral in directions you don't see coming. Six episodes, subtitled, and the kind of show that makes two hours disappear. Season 2 is already confirmed.",
  },
];

module.exports = { PLAYERS, TICKERS, BRIEF_ROWS, FETCH_TICKERS, CORE_TICKERS, MOVERS_WATCHLIST, MOVERS_COUNT, LARGECAP_UNIVERSE, CRYPTO_UNIVERSE, PRODUCTS, RECS, STREAMING_PICKS, esc, playerLink, officialPlayerUrl, buildPlayerLinksFromFacts, tickerLink, fmtPrice, fmtPct, ENTITY_LINKS, entityLink, linkifyEntities };
