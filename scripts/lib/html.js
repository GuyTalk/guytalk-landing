'use strict';

const { BRIEF_ROWS, TICKERS, PRODUCTS, RECS, esc, playerLink, tickerLink, fmtPrice, fmtPct } = require('./db');

// ─────────────────────────────────────────────────────────────────────────────
// Entry point — returns the full HTML string for a brief issue
// ─────────────────────────────────────────────────────────────────────────────
function buildHtml(issue) {
  const { num, slug, date, title, deck, sports, markets, golf, trending, copy } = issue;
  const label = `#${String(num).padStart(3, '0')}`;
  const prevSlug = num > 1 ? `issue-${String(num - 1).padStart(3, '0')}` : null;
  const prevLabel = prevSlug ? `#${String(num - 1).padStart(3, '0')}` : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Brief · ${label} — GuyTalk</title>
<meta name="description" content="${esc(title)} — GuyTalk Issue ${label}.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/brief.css">
</head>
<body>

<nav class="brief-nav">
  <div class="brief-nav-inner">
    <a href="/" class="brief-wordmark">GuyTalk<span class="dot">.</span></a>
    <div class="brief-nav-right">
      <span class="brief-nav-issue">The Brief · ${label}</span>
      <a href="/#signup" class="brief-cta">Subscribe free →</a>
    </div>
  </div>
</nav>

<article class="brief-article">

  <div class="brief-pretitle">
    <span class="brief-pretitle-dot"></span>
    ${esc(date)}
  </div>
  <h1 class="brief-title">${esc(title)}</h1>
  <p class="brief-deck">${esc(deck)}</p>
  <div class="brief-meta">
    <span>5 MIN READ</span>
    <span class="sep">·</span>
    <span>ISSUE ${label}</span>
    <span class="sep">·</span>
    <span>SPORTS · MARKETS · GOLF · CULTURE</span>
  </div>

${buildTldr(issue)}

${buildSports(issue)}

${buildMarkets(issue)}

${buildGolf(issue)}

${buildCulture(issue)}

${buildRec(issue)}

${buildSharpTake(issue)}

${buildNumbers(issue)}

</article>

<footer class="brief-footer">
  <a href="/#signup" class="footer-cta">Get the brief free →</a>
  <p class="footer-meta">
    You're reading GuyTalk — the daily brief on sports, markets, golf, and culture.<br>
    Five minutes a day. Free forever. No algorithm.
  </p>
  <p class="footer-sig">— Jake, GuyTalk</p>
  <div class="footer-nav">
    <a href="/">Home</a>
    ${prevSlug ? `<a href="/brief/${prevSlug}/">Issue ${prevLabel}</a>` : ''}
    <a href="mailto:guytalkdaily@gmail.com">Reply to Jake</a>
  </div>
</footer>

</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TL;DR
// ─────────────────────────────────────────────────────────────────────────────
function buildTldr({ sports, markets, golf, copy }) {
  const items = [];

  (sports || []).slice(0, 2).forEach(g => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const note = g.note ? g.note.replace(/^NBA\s+/i, '') : g.shortName;
    items.push({
      tag: 'Sports', anchor: '#sports',
      html: `${esc(note)}: <strong>${esc(w.team)} ${esc(w.score)}</strong>, ${esc(l.team)} ${esc(l.score)}.${g.seriesNote ? ` ${esc(g.seriesNote)}.` : ''}`,
    });
  });

  while (items.filter(i => i.tag === 'Sports').length < 2) {
    items.push({ tag: 'Sports', anchor: '#sports', html: 'No game data available.' });
  }

  if (markets?.SPY?.dayChangePct !== null && markets?.SPY?.dayChangePct !== undefined) {
    const spy = markets.SPY;
    const dir = spy.dayChangePct >= 0 ? 'up' : 'down';
    items.push({
      tag: 'Markets', anchor: '#markets',
      html: `${tickerLink('SPY')} ${dir} ${fmtPct(spy.dayChangePct)} on the day.`,
    });
  } else {
    items.push({ tag: 'Markets', anchor: '#markets', html: 'Markets data unavailable.' });
  }

  const golfLive = golf?.statusState === 'in' || golf?.statusState === 'post';
  if (golf && golfLive && golf.leaders?.[0]) {
    const l = golf.leaders[0];
    items.push({
      tag: 'Golf', anchor: '#golf',
      html: `${playerLink(l.name)} leads ${esc(golf.name)} at ${esc(l.score)} (${esc(golf.status || 'In Progress')}).`,
    });
  } else if (golf && !golfLive) {
    items.push({ tag: 'Golf', anchor: '#golf', html: `${esc(golf.name)} tees off this week.` });
  } else {
    items.push({ tag: 'Golf', anchor: '#golf', html: 'No active PGA Tour event.' });
  }

  const cultureBullet = copy?.culture?.[0]?.head
    ? esc(copy.culture[0].head)
    : 'Culture picks inside.';
  items.push({ tag: 'Culture', anchor: '#culture', html: cultureBullet });

  return `  <div class="tldr">
    <div class="tldr-label">TL;DR — Five things to know</div>
    <ul class="tldr-list">
${items.slice(0, 5).map(item => `      <li class="tldr-item">
        <a href="${item.anchor}" class="tag-link"><span class="tag tag-amber">${item.tag}</span></a>
        <span>${item.html}</span>
      </li>`).join('\n')}
    </ul>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sports
// ─────────────────────────────────────────────────────────────────────────────
function buildSports({ sports, copy }) {
  if (!sports?.length) {
    return `  <section class="brief-section" id="sports">
    <div class="section-label">Sports</div>
    <h3>No games scheduled.</h3>
    <p>Check back tomorrow — the schedule resumes soon.</p>
  </section>`;
  }

  const gameBlocks = sports.map((g, i) => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const homeLoser = !g.home.winner;
    const awayLoser = !g.away.winner;
    const metaText = g.note ? `${g.note} · ${g.status}` : g.status;

    const scoreboard = `    <div class="scoreboard">
      <div class="score-side">
        <div class="score-team${homeLoser ? ' loser' : ''}">${esc(g.home.team)}</div>
        <div class="score-num${homeLoser ? ' loser' : ''}">${esc(g.home.score)}</div>
      </div>
      <div class="score-center">
        <div class="score-meta">${esc(metaText)}</div>
        <div class="score-badge">${esc(w.abbrev)} Win</div>
      </div>
      <div class="score-side right">
        <div class="score-team${awayLoser ? ' loser' : ''}">${esc(g.away.team)}</div>
        <div class="score-num${awayLoser ? ' loser' : ''}">${esc(g.away.score)}</div>
      </div>
    </div>`;

    if (i === 0) {
      const angleText = copy?.sportsAngle || 'Full recap inside.';
      const d = copy?.sportsDetail || {};

      const keyNumber       = d.keyNumber       || `${esc(w.team)} take the win.`;
      const seriesSituation = d.seriesSituation || (g.seriesNote ? esc(g.seriesNote) : 'Series continues.');
      const howToWatch      = d.howToWatch      || 'Check ESPN for next game details.';
      const groupChat       = d.groupChatAngle  || 'Full series breakdown at ESPN.com.';

      return `
    <h3>${esc(g.note || g.name)}</h3>

${scoreboard}

    <p>${esc(angleText)}</p>

    <ul class="detail-list">
      <li><span><span class="dl-label">Key number:</span>${esc(keyNumber)}</span></li>
      <li><span><span class="dl-label">Series situation:</span>${esc(seriesSituation)}</span></li>
      <li><span><span class="dl-label">How to watch:</span>${esc(howToWatch)}</span></li>
    </ul>

    <div class="angle-box">
      <span class="angle-label">Group Chat Angle</span>
      <p class="angle-text">${esc(groupChat)}</p>
    </div>`;
    }

    const extraNote = copy?.sportsAdditional?.[i - 1] || `${esc(w.team)} win, ${esc(w.score)}–${esc(l.score)}.`;
    return `
    <h3>${esc(g.note || g.name)}</h3>

${scoreboard}

    <p>${esc(extraNote)}</p>`;
  });

  return `  <section class="brief-section" id="sports">
    <div class="section-label">Sports</div>
${gameBlocks.join('\n')}
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markets
// ─────────────────────────────────────────────────────────────────────────────
function buildMarkets({ markets, copy, date }) {
  const md = copy?.marketsDetail || {};

  const headline    = md.headline    || 'Markets wrap.';
  const openingPara = copy?.marketsTake || 'Market data below.';
  const secondPara  = md.secondPara  || 'Watch for key economic data next week.';
  const watchNext   = md.watchNextWeek || 'Monitor upcoming Fed commentary and economic releases.';
  const tradeWatch  = md.tradeToWatch  || 'Check earnings calendars for standouts next week.';
  const bringUp     = md.bringUp       || `SPY closed at ${markets?.SPY?.price ? fmtPrice('SPY', markets.SPY.price) : 'N/A'}.`;

  const rows = BRIEF_ROWS.map(row => {
    if (row.type === 'divider') return '        <div class="mkt-div"></div>';

    const sym = row.key;
    const cfg = TICKERS[sym];
    const q   = markets?.[sym];

    const price  = q?.price       ? fmtPrice(sym, q.price)       : '—';
    const dayPct = q?.dayChangePct !== undefined ? fmtPct(q.dayChangePct) : '—';
    const dayDir = q?.dayChangePct !== undefined ? (q.dayChangePct >= 0 ? 'up' : 'dn') : '';
    const wkPct  = q?.weekChangePct !== null && q?.weekChangePct !== undefined
      ? fmtPct(q.weekChangePct) : '—';
    const wkDir  = q?.weekChangePct !== null && q?.weekChangePct !== undefined
      ? (q.weekChangePct >= 0 ? 'up' : 'dn') : '';

    const nameHtml = cfg?.ms
      ? `<a href="https://www.morningstar.com/${cfg.ms}" class="ticker">${esc(cfg.display)}</a>`
      : esc(cfg?.display || sym);

    return `        <div class="mkt-row">
          <div class="m-name">${nameHtml}</div>
          <div class="m-val">${esc(price)}</div>
          <div class="m-day ${dayDir}">${esc(dayPct)}</div>
          <div class="m-wk ${wkDir}">${esc(wkPct)}</div>
        </div>`;
  }).join('\n');

  return `  <section class="brief-section" id="markets">
    <div class="section-label">Markets</div>

    <h3>${esc(headline)}</h3>

    <p>${esc(openingPara)}</p>

    <p>${esc(secondPara)}</p>

    <div class="mkt-table">
      <div class="mkt-table-hd">
        <div class="mkt-table-title">Daily Close</div>
        <div class="mkt-table-sub">${esc(date)}</div>
      </div>
      <div class="mkt-table-body">
        <div class="mkt-cols">
          <div class="th">Asset</div>
          <div class="th">Price</div>
          <div class="th">Day</div>
          <div class="th">Week</div>
        </div>
${rows}
      </div>
    </div>

    <ul class="detail-list">
      <li><span><span class="dl-label">Watch next week:</span>${esc(watchNext)}</span></li>
      <li><span><span class="dl-label">Trade to watch:</span>${esc(tradeWatch)}</span></li>
      <li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Golf + Lifestyle
// ─────────────────────────────────────────────────────────────────────────────
function buildGolf({ golf, copy, num }) {
  const gd = copy?.golfDetail || {};
  let leaderboardHtml;
  const golfInProgress = golf?.statusState === 'in' || golf?.statusState === 'post';

  if (golf && golfInProgress && golf.leaders?.length) {
    const top5 = golf.leaders.slice(0, 5);
    const leader = top5[0];
    const leaderLineHtml = top5.map(p =>
      `${playerLink(p.name)} ${esc(p.score)} (${esc(p.pos)})`
    ).join(', ');

    const aiNote      = copy?.golfNote      || `${esc(leader.name)} holds the lead at ${esc(leader.score)}.`;
    const whyMatters  = gd.whyItMatters     || `${esc(golf.name)} carries full FedEx Cup points.`;
    const tvSchedule  = gd.tvSchedule       || 'Round 3: Golf Channel/Peacock. Round 4: NBC/CBS. Check local listings.';
    const bringUp     = gd.bringUp          || `${esc(leader.name)} leads at ${esc(leader.score)}.`;
    const groupChat   = gd.groupChatAngle   || `Watch ${esc(leader.name)} this weekend.`;

    leaderboardHtml = `
    <h3>${esc(golf.name)}: ${playerLink(leader.name)} leads at ${esc(leader.score)}.</h3>

    <p>${esc(aiNote)}</p>

    <ul class="detail-list">
      <li><span><span class="dl-label">Leaderboard (${esc(golf.status || 'In Progress')}):</span>${leaderLineHtml}.</span></li>
      <li><span><span class="dl-label">Why it matters:</span>${esc(whyMatters)}</span></li>
      <li><span><span class="dl-label">TV schedule:</span>${esc(tvSchedule)}</span></li>
      <li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>
    </ul>

    <div class="angle-box">
      <span class="angle-label">Group Chat Angle</span>
      <p class="angle-text">${esc(groupChat)}</p>
    </div>`;

  } else if (golf && !golfInProgress) {
    leaderboardHtml = `
    <h3>${esc(golf.name)} — tees off this week.</h3>
    <p>${gd.whyItMatters || `${esc(golf.name)} is the featured event this week on the PGA Tour.`} ${gd.bringUp || 'Watch for the early rounds to set the weekend field.'}</p>`;

  } else {
    leaderboardHtml = `
    <h3>No active tournament this week.</h3>
    <p>The PGA Tour schedule resumes next week. Check <a href="https://www.pgatour.com/schedule" class="brand">pgatour.com</a> for upcoming events.</p>`;
  }

  // Product card — rotate by issue number
  const product = PRODUCTS[num % PRODUCTS.length];

  return `  <section class="brief-section" id="golf">
    <div class="section-label">Golf + Lifestyle</div>
${leaderboardHtml}

    <h3>The product worth knowing about.</h3>

    <div class="product-card">
      <div class="product-img">
        <div class="product-img-ph" style="display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3);text-align:center;padding:20px;">${esc(product.brand)}</div>
      </div>
      <div class="product-info">
        <div class="product-brand">${esc(product.brand)}</div>
        <div class="product-name">${esc(product.name)}</div>
        <p class="product-desc">${product.desc}</p>
        <span class="product-price">${esc(product.price)}</span>
        <a href="${esc(product.url)}" target="_blank" rel="noopener" class="product-link">${esc(product.cta)} →</a>
      </div>
    </div>

    <p style="font-size:14px; color:var(--text-3);">Other brands worth knowing: <a href="https://www.petermillar.com" class="brand">Peter Millar</a>, <a href="https://rhoback.com" class="brand">Rhoback</a>, <a href="https://www.travismathew.com" class="brand">TravisMathew</a>, <a href="https://holdernessandbourne.com" class="brand">Holderness &amp; Bourne</a>.</p>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Culture
// ─────────────────────────────────────────────────────────────────────────────
function buildCulture({ copy }) {
  const items = copy?.culture;

  if (!items?.length || !Array.isArray(items)) {
    return `  <section class="brief-section" id="culture">
    <div class="section-label">Culture</div>
    <p>Culture picks are being updated — check back shortly.</p>
  </section>`;
  }

  const itemsHtml = items.slice(0, 3).map(item => `
      <li class="culture-item">
        <div>
          <div class="culture-head">${esc(item.head || '')}</div>
          <span class="culture-source">${esc(item.source || '')}</span>
          <p class="culture-body">${esc(item.body || '')}</p>
        </div>
      </li>`).join('');

  return `  <section class="brief-section" id="culture">
    <div class="section-label">Culture</div>
    <ul class="culture-list">
${itemsHtml}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The Rec — rotates by issue number
// ─────────────────────────────────────────────────────────────────────────────
function buildRec({ num }) {
  const rec = RECS[(num + 3) % RECS.length];

  return `  <section class="brief-section" id="the-rec">
    <div class="section-label">The Rec</div>

    <div class="brief-rec">
      <div class="rec-label">This week's pick</div>
      <div class="rec-title">${esc(rec.title)}</div>
      <p class="rec-body">${esc(rec.body)}</p>
      <a href="${esc(rec.url)}" target="_blank" rel="noopener" class="rec-link">${esc(rec.cta)}</a>
    </div>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharp Take
// ─────────────────────────────────────────────────────────────────────────────
function buildSharpTake({ copy }) {
  const content = copy?.sharpTake
    ? copy.sharpTake
        // Strip markdown artifacts
        .replace(/^#+\s.*$/gm, '')
        .replace(/^---+$/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/^- /gm, '')
        .trim()
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => `    <p>${esc(p)}</p>`)
        .join('\n')
    : `    <p>The week had its moments. Check back tomorrow.</p>`;

  return `  <div class="sharp-take">
    <div class="sharp-take-label">The Sharp Take</div>
${content}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers worth stealing
// ─────────────────────────────────────────────────────────────────────────────
function buildNumbers({ sports, markets, golf, copy }) {
  const ctxArr = copy?.numbersContext;
  const items = [];

  if (sports?.length) {
    const g = sports[0];
    const note = g.note || g.shortName;
    const ctx = ctxArr?.[0]?.context || `${esc(note)} final score.`;
    items.push({
      num: `${g.home.score}–${g.away.score}`,
      html: `<strong>${esc(note)}.</strong> ${esc(ctx)}`,
    });
  }

  if (markets?.SPY?.dayChangePct !== undefined && markets.SPY.dayChangePct !== null) {
    const pct = markets.SPY.dayChangePct;
    const dir = pct >= 0 ? 'gain' : 'drop';
    const ctx = ctxArr?.[1]?.context || `S&amp;P 500 closed ${dir === 'gain' ? 'higher' : 'lower'} on the day.`;
    items.push({
      num: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
      html: `<strong>S&amp;P 500 ${dir} today.</strong> ${esc(ctx)}`,
    });
  }

  if (golf?.leaders?.[0]) {
    const l = golf.leaders[0];
    const ctx = ctxArr?.[2]?.context || `${esc(l.name)} leads ${esc(golf.name)}.`;
    items.push({
      num: l.score,
      html: `<strong>${esc(l.name)}, ${esc(golf.name)}.</strong> ${esc(ctx)}`,
    });
  }

  while (items.length < 3) {
    items.push({ num: '—', html: '<strong>Check today&#39;s full issue for more.</strong>' });
  }

  return `  <div class="brief-section">
    <div class="section-label">Numbers worth stealing</div>
    <ul class="numbers-list">
${items.slice(0, 3).map(item => `      <li class="numbers-item">
        <div class="n-num">${esc(item.num)}</div>
        <div>${item.html}</div>
      </li>`).join('\n')}
    </ul>
  </div>`;
}

module.exports = { buildHtml };
