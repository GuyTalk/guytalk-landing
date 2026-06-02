'use strict';

const { BRIEF_ROWS, TICKERS, PRODUCTS, RECS, esc, playerLink, tickerLink, fmtPrice, fmtPct } = require('./db');

// Render AI prose (possibly multi-paragraph) into proper <p> tags
function renderParas(text, fallback = '') {
  if (!text) return fallback ? `<p>${fallback}</p>` : '';
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${esc(p)}</p>`)
    .join('\n    ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point — returns the full HTML string for a brief issue
// ─────────────────────────────────────────────────────────────────────────────
function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ESPN CDN logo URL for a team abbreviation + sport
function espnLogo(abbrev, sport) {
  if (!abbrev) return null;
  const a = abbrev.toLowerCase().replace(/[^a-z]/g, '');
  const sportKey = sport === 'mlb' ? 'mlb' : 'nba';
  return `https://a.espncdn.com/i/teamlogos/${sportKey}/500/${a}.png`;
}

// ESPN recap URL from game ID + sport
function espnRecapUrl(gameId, sport) {
  const s = sport === 'mlb' ? 'mlb' : 'nba';
  return `https://www.espn.com/${s}/recap/_/gameId/${gameId}`;
}

function isoDate(dateStr) {
  try { return new Date(dateStr).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); }
}

function buildSeoTitle(issue) {
  const { title, sports, upcoming, golf, f1, worldCup } = issue;
  // Pull 2-3 real event names for a richer page title
  const parts = [];
  if (upcoming?.length) parts.push(`${upcoming[0].note || upcoming[0].shortName}`);
  else if (sports?.length) {
    const g = sports[0];
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    parts.push(`${w.team} ${w.score}-${l.score}`);
  }
  if (f1?.name) parts.push(f1.shortName || f1.name.split(' ').slice(0, 3).join(' '));
  if (golf?.leaders?.[0]) parts.push(golf.leaders[0].name + ' leads');
  if (parts.length) return `${parts.slice(0, 2).join(' · ')} — GuyTalk Daily Brief`;
  return title ? `${title.slice(0, 70)} — GuyTalk` : `GuyTalk Daily Brief`;
}

function buildSeoDesc(issue) {
  const { title, sports, upcoming, golf, f1, worldCup, markets, date } = issue;
  const pieces = [];
  if (upcoming?.length) pieces.push(`${upcoming[0].note || upcoming[0].shortName} ${upcoming[0].daysAhead <= 1 ? 'tomorrow' : 'this week'}.`);
  if (sports?.length) {
    const g = sports[0];
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    pieces.push(`${w.team} ${w.score}-${l.score} ${l.team}.`);
  }
  if (f1?.name) pieces.push(`${f1.shortName || f1.name} ${f1.statusState === 'post' ? 'results' : 'preview'}.`);
  if (golf?.leaders?.[0]) pieces.push(`${golf.leaders[0].name} leads ${(golf.name || '').replace(/pres\. by .*/i,'').trim()}.`);
  if (worldCup?.length) pieces.push('World Cup 2026 coverage.');
  pieces.push('Markets, culture, and more. Free daily brief from GuyTalk.');
  return pieces.slice(0, 4).join(' ');
}

function buildHtml(issue) {
  const { num, slug, date, title, deck, sports, markets, golf, f1, worldCup, upcoming, gameMetas, trending, copy } = issue;
  const label = `#${String(num).padStart(3, '0')}`;
  const prevSlug = num > 1 ? `issue-${String(num - 1).padStart(3, '0')}` : null;
  const nextSlug = `issue-${String(num + 1).padStart(3, '0')}`;
  const prevLabel = prevSlug ? `#${String(num - 1).padStart(3, '0')}` : null;

  const hasF1 = f1?.name != null;
  const hasWC = worldCup?.length > 0;

  const seoTitle = buildSeoTitle(issue);
  const seoDesc  = buildSeoDesc(issue);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(seoTitle)}</title>
<meta name="description" content="${esc(seoDesc)}">
<link rel="icon" href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<meta property="og:type"        content="article">
<meta property="og:url"         content="https://www.guytalkmedia.com/brief/${slug}/">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(seoDesc)}">
<meta property="og:image"       content="https://www.guytalkmedia.com/assets/og-card.png">
<meta property="og:site_name"   content="GuyTalk">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:site"        content="@guytalkmedia">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(seoDesc)}">
<meta name="twitter:image"       content="https://www.guytalkmedia.com/assets/og-card.png">
<link rel="canonical"            href="https://www.guytalkmedia.com/brief/${slug}/">
${prevSlug ? `<link rel="prev" href="https://www.guytalkmedia.com/brief/${prevSlug}/">` : ''}
<link rel="next" href="https://www.guytalkmedia.com/brief/${nextSlug}/">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":${JSON.stringify(title)},"description":${JSON.stringify(seoDesc)},"url":"https://www.guytalkmedia.com/brief/${slug}/","image":"https://www.guytalkmedia.com/assets/og-card.png","publisher":{"@type":"Organization","name":"GuyTalk","logo":{"@type":"ImageObject","url":"https://www.guytalkmedia.com/assets/logo/guytalk-icon.svg"}},"author":{"@type":"Person","name":"Jake Williams"},"datePublished":"${isoDate(date)}"}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/brief.css">
<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init me ws ys ps bs capture je Di ks register register_once register_for_session unregister unregister_for_session Ps getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty Es $s createPersonProfile Is opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing Ss debug xs getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('phc_t9vvXWz7JWBsWkHmmNXCb2KMF79puQomJnJvREWKQbq8',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'});
</script>
</head>
<body>

<div class="reading-progress" id="readingProgress"></div>

<nav class="brief-nav">
  <div class="brief-nav-inner">
    <a href="/" class="brief-wordmark">GuyTalk<span class="dot">.</span></a>
    <div class="brief-nav-right">
      <span class="brief-nav-issue">The Brief · ${label}</span>
      <a href="/#signup" class="brief-cta">Subscribe free →</a>
    </div>
  </div>
</nav>

<article class="brief-article" id="briefArticle">

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
    <span>SPORTS · MARKETS · CULTURE</span>
  </div>

  <nav class="section-jump" aria-label="Jump to section">
    <a href="#sports" class="sj-link">Sports</a>
    <a href="#markets" class="sj-link">Markets</a>${hasF1 ? `\n    <a href="#f1" class="sj-link">F1</a>` : ''}${hasWC ? `\n    <a href="#worldcup" class="sj-link">World Cup</a>` : ''}
    <a href="#culture" class="sj-link">Culture</a>
    <a href="#sharp-take" class="sj-link">Take</a>
  </nav>

${buildTldr(issue)}

${buildSports(issue)}

${buildMarkets(issue)}

${hasF1 ? buildF1Block(issue) : ''}

${hasWC ? buildWorldCupBlock(issue) : ''}

${buildCulture(issue)}

${buildRec(issue)}

${buildSharpTake(issue)}

${buildNumbers(issue)}

</article>

<div class="brief-subscribe-block">
  <div class="bsb-label">Free · Daily · 5 Minutes</div>
  <div class="bsb-headline">Get it in your inbox every morning.</div>
  <p class="bsb-sub">Sports, markets, golf, and culture — before 8am.</p>
  <form class="bsb-form" onsubmit="handleBriefSignup(event, this)">
    <input type="email" name="email" placeholder="Your email address" required class="bsb-input" autocomplete="email">
    <button type="submit" class="bsb-btn">Subscribe Free →</button>
  </form>
  <div class="bsb-success" id="briefSubSuccess">You're in. See you tomorrow morning.</div>
  <p class="bsb-hint">Free forever · No spam · Unsubscribe anytime</p>
</div>

<footer class="brief-footer">
  <a href="/briefs/" class="footer-cta">Browse all issues →</a>
  <p class="footer-meta">
    You're reading GuyTalk — the daily brief on sports, markets, and culture.<br>
    Five minutes a day. Free forever. No algorithm.
  </p>
  <p class="footer-sig">— Jake, GuyTalk</p>
  <div class="footer-nav">
    <a href="/">Home</a>
    <a href="/briefs/">All Issues</a>
    ${prevSlug ? `<a href="/brief/${prevSlug}/">Issue ${prevLabel}</a>` : ''}
    <a href="mailto:guytalkdaily@gmail.com">Reply to Jake</a>
  </div>
</footer>

<script>
window.handleBriefSignup = function(e, form) {
  e.preventDefault();
  var email = form.querySelector('input[type="email"]').value.trim();
  if (!email) return;
  form.style.display = 'none';
  document.getElementById('briefSubSuccess').style.display = 'block';
  if (window.posthog) {
    posthog.identify(email, { email: email });
    posthog.capture('email_signup', { email: email, source: 'brief_footer' });
  }
  var fd = new FormData();
  fd.append('email', email);
  fetch('https://subscribe-forms.beehiiv.com/api/v3/forms/88b2d1b6-d0c3-4d33-ac26-d69fd2158a3d/subscriptions', {
    method: 'POST', mode: 'no-cors', body: fd
  }).catch(function() {});
};

(function() {
  var bar = document.getElementById('readingProgress');
  var article = document.getElementById('briefArticle');
  if (!bar || !article) return;
  function update() {
    var rect = article.getBoundingClientRect();
    var total = article.offsetHeight - window.innerHeight;
    var pct = total > 0 ? Math.min(100, Math.max(0, (-rect.top / total) * 100)) : 0;
    bar.style.width = pct + '%';
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
})();
</script>

</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TL;DR
// ─────────────────────────────────────────────────────────────────────────────
function buildTldr({ sports, markets, golf, f1, worldCup, upcoming, copy }) {
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

  const sportsCount = items.filter(i => i.tag === 'Sports').length;
  if (sportsCount === 0) {
    items.push({ tag: 'Sports', anchor: '#sports', html: 'No games last night — check the schedule.' });
    items.push({ tag: 'Sports', anchor: '#sports', html: 'Weekend recap inside.' });
  } else if (sportsCount === 1) {
    items.push({ tag: 'Sports', anchor: '#sports', html: 'More scores inside.' });
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
    const golfVerb = golf.statusState === 'post' ? 'wins' : 'leads';
    items.push({
      tag: 'Sports', anchor: '#sports',
      html: `${playerLink(l.name)} ${golfVerb} ${esc(golf.name)} at ${esc(l.score)} (${esc(golf.status || 'Final')}).`,
    });
  } else if (golf && !golfLive) {
    items.push({ tag: 'Sports', anchor: '#sports', html: `${esc(capFirst(golf.name))} tees off this week.` });
  }

  // F1 bullet
  if (f1?.results?.length && f1.statusState === 'post') {
    items.push({
      tag: 'F1', anchor: '#f1',
      html: `${esc(f1.results[0]?.driver)} wins ${esc(f1.shortName || f1.name)}.`,
    });
  } else if (f1?.name) {
    items.push({
      tag: 'F1', anchor: '#f1',
      html: `${esc(f1.name)} — ${esc(f1.status || 'this weekend')}.`,
    });
  }

  // World Cup bullet
  if (worldCup?.length) {
    const active = worldCup.find(m => m.statusState === 'in' || m.statusState === 'post');
    if (active) {
      items.push({
        tag: 'World Cup', anchor: '#worldcup',
        html: `${esc(active.away.team)} vs ${esc(active.home.team)}: <strong>${esc(active.away.score)}–${esc(active.home.score)}</strong>.`,
      });
    } else {
      items.push({ tag: 'World Cup', anchor: '#worldcup', html: 'FIFA World Cup 2026 opens June 11 — USA hosts.' });
    }
  }

  // Upcoming NBA bullet (Finals preview)
  if (upcoming?.length && items.filter(i => i.tag === 'Sports').length === 0) {
    const g = upcoming[0];
    const when = g.daysAhead === 0 ? 'tonight' : g.daysAhead === 1 ? 'tomorrow' : 'in 2 days';
    items.push({
      tag: 'Sports', anchor: '#sports',
      html: `${esc(g.note || g.shortName)} tips off ${when}${g.daysAhead <= 1 ? ' — Game 1' : ''}.`,
    });
  }

  const cultureBullet = copy?.culture?.[0]?.head
    ? esc(copy.culture[0].head)
    : 'Culture picks inside.';
  items.push({ tag: 'Culture', anchor: '#culture', html: cultureBullet });

  // Tag color map
  const tagClass = { 'Sports': 'tag-amber', 'Markets': 'tag-blue', 'F1': 'tag-green', 'World Cup': 'tag-green', 'Culture': 'tag-amber' };

  return `  <div class="tldr">
    <div class="tldr-label">TL;DR — Five things to know</div>
    <ul class="tldr-list">
${items.slice(0, 5).map(item => `      <li class="tldr-item">
        <a href="${item.anchor}" class="tag-link"><span class="tag ${tagClass[item.tag] || 'tag-amber'}">${item.tag}</span></a>
        <span>${item.html}</span>
      </li>`).join('\n')}
    </ul>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sports
// ─────────────────────────────────────────────────────────────────────────────
function buildSports({ sports, copy, golf, num, gameMetas, upcoming }) {
  const golfBlock = buildGolfBlock({ golf, copy });
  const product = PRODUCTS[num % PRODUCTS.length];
  const productCard = `
    <h3>The gear pick.</h3>
    <div class="product-card">
      <div class="product-img">
        ${product.imageUrl
          ? `<img src="${esc(product.imageUrl)}" alt="${esc(product.name)}" loading="lazy">`
          : `<div class="product-img-ph">${esc(product.brand)}</div>`}
      </div>
      <div class="product-info">
        <div class="product-brand">${esc(product.brand)}</div>
        <div class="product-name">${esc(product.name)}</div>
        <p class="product-desc">${product.desc}</p>
        <span class="product-price">${esc(product.price)}</span>
        <a href="${esc(product.url)}" target="_blank" rel="noopener" class="product-link">${esc(product.cta)} →</a>
      </div>
    </div>`;

  // Upcoming game preview card (e.g., NBA Finals Game 1 tomorrow)
  const upcomingCard = upcoming?.length
    ? buildUpcomingGameCard(upcoming[0])
    : '';

  if (!sports?.length) {
    return `  <section class="brief-section" id="sports">
    <div class="section-label sl-sports">Sports</div>
    <h3>No games last night.</h3>
    ${renderParas(copy?.sportsAngle, '')}
${upcomingCard}
${golfBlock}
${productCard}
  </section>`;
  }

  const gameBlocks = sports.map((g, i) => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const homeLoser = !g.home.winner;
    const awayLoser = !g.away.winner;
    const metaText = g.note ? `${g.note} · ${g.status}` : g.status;
    const sport = g.sport?.toLowerCase() || 'nba';

    // Team logos from ESPN CDN
    const homeLogo = espnLogo(g.home.abbrev, sport);
    const awayLogo = espnLogo(g.away.abbrev, sport);

    const scoreboard = `    <div class="scoreboard">
      <div class="score-side">
        ${homeLogo ? `<img src="${esc(homeLogo)}" class="score-logo${homeLoser ? ' loser' : ''}" alt="${esc(g.home.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="score-team${homeLoser ? ' loser' : ''}">${esc(g.home.team)}</div>
        <div class="score-num${homeLoser ? ' loser' : ''}">${esc(g.home.score)}</div>
      </div>
      <div class="score-center">
        <div class="score-meta">${esc(metaText)}</div>
        <div class="score-badge">${esc(w.abbrev || w.team.split(' ').pop())} Win</div>
      </div>
      <div class="score-side right">
        <div class="score-team${awayLoser ? ' loser' : ''}">${esc(g.away.team)}</div>
        <div class="score-num${awayLoser ? ' loser' : ''}">${esc(g.away.score)}</div>
        ${awayLogo ? `<img src="${esc(awayLogo)}" class="score-logo${awayLoser ? ' loser' : ''}" alt="${esc(g.away.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
      </div>
    </div>`;

    // Highlights card
    const meta = gameMetas?.[g.id];
    const recapUrl = meta?.recapUrl || espnRecapUrl(g.id, sport);
    const ytQuery = encodeURIComponent(`${g.away.team} vs ${g.home.team} highlights`);
    const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;
    const highlightsCard = `    <div class="highlights-card">
      <span class="hl-label">Best Moments</span>
      <div class="hl-links">
        <a href="${esc(recapUrl)}" target="_blank" rel="noopener" class="hl-btn">▶ Watch on ESPN</a>
        <a href="${esc(ytUrl)}" target="_blank" rel="noopener" class="hl-btn hl-btn-yt">YouTube Highlights</a>
      </div>
    </div>`;

    if (i === 0) {
      const d = copy?.sportsDetail || {};
      const keyNumber       = d.keyNumber       || `${w.team} take the win.`;
      const seriesSituation = d.seriesSituation || (g.seriesNote ? g.seriesNote : '');
      const howToWatch      = d.howToWatch      || 'Check ESPN for next game details.';
      const groupChat       = d.groupChatAngle  || '';

      return `
    <h3>${esc(g.note || g.name)}</h3>

${scoreboard}

${highlightsCard}

    ${renderParas(copy?.sportsAngle, `${w.team} win.`)}

    <ul class="detail-list">
      <li><span><span class="dl-label">Key number:</span> ${esc(keyNumber)}</span></li>
      ${seriesSituation ? `<li><span><span class="dl-label">Series:</span> ${esc(seriesSituation)}</span></li>` : ''}
      <li><span><span class="dl-label">How to watch:</span> ${esc(howToWatch)}</span></li>
    </ul>

    ${groupChat ? `<div class="angle-box">
      <span class="angle-label">Group Chat Angle</span>
      <p class="angle-text">${esc(groupChat)}</p>
    </div>` : ''}`;
    }

    const extraNote = copy?.sportsAdditional?.[i - 1] || `${w.team} win, ${w.score}–${l.score}.`;
    return `
    <h3>${esc(g.note || g.name)}</h3>

${scoreboard}

${highlightsCard}

    ${renderParas(extraNote, '')}`;
  });

  return `  <section class="brief-section" id="sports">
    <div class="section-label sl-sports">Sports</div>
${gameBlocks.join('\n')}
${upcomingCard}
${golfBlock}
${productCard}
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upcoming game preview card
// ─────────────────────────────────────────────────────────────────────────────
function buildUpcomingGameCard(game) {
  if (!game) return '';
  const when = game.daysAhead === 0 ? 'Tonight' : game.daysAhead === 1 ? 'Tomorrow' : 'In 2 days';
  const sport = game.sport?.toLowerCase() || 'nba';
  const homeLogo = espnLogo(game.home.abbrev, sport);
  const awayLogo = espnLogo(game.away.abbrev, sport);
  const scheduleUrl = `https://www.espn.com/${sport}/game/_/gameId/${game.id}`;
  const isFinals = /finals/i.test(game.note || game.shortName || '');

  return `
    <div class="upcoming-card${isFinals ? ' upcoming-finals' : ''}">
      <div class="upcoming-label">${esc(when)} — ${esc(game.note || game.shortName)}</div>
      <div class="upcoming-matchup">
        <div class="upcoming-team">
          ${awayLogo ? `<img src="${esc(awayLogo)}" class="upcoming-logo" alt="${esc(game.away.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <span>${esc(game.away.team)}</span>
        </div>
        <div class="upcoming-vs">${isFinals ? 'NBA<br>FINALS' : 'VS'}</div>
        <div class="upcoming-team upcoming-home">
          <span>${esc(game.home.team)}</span>
          ${homeLogo ? `<img src="${esc(homeLogo)}" class="upcoming-logo" alt="${esc(game.home.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        </div>
      </div>
      ${game.seriesNote ? `<div class="upcoming-series">${esc(game.seriesNote)}</div>` : ''}
      <a href="${esc(scheduleUrl)}" target="_blank" rel="noopener" class="upcoming-link">Game info on ESPN →</a>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markets
// ─────────────────────────────────────────────────────────────────────────────
function buildMarkets({ markets, copy, date }) {
  const md = copy?.marketsDetail || {};

  const headline      = md.headline       || 'Markets wrap.';
  const openingPara   = copy?.marketsTake  || 'Market data below.';
  const secondPara    = md.secondPara     || 'Watch for key economic data next week.';
  const stockSpot     = md.stockSpotlight || md.tradeToWatch || '';
  const watchNext     = md.watchNextWeek  || 'Monitor upcoming Fed commentary and economic releases.';
  const bringUp       = md.bringUp        || `SPY closed at ${markets?.SPY?.price ? fmtPrice('SPY', markets.SPY.price) : 'N/A'}.`;

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
    <div class="section-label sl-markets">Markets</div>

    <h3>${esc(headline)}</h3>

    ${renderParas(openingPara, 'Market data below.')}

    ${renderParas(secondPara, '')}

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
      ${stockSpot ? `<li><span><span class="dl-label">Stock spotlight:</span>${esc(stockSpot)}</span></li>` : ''}
      <li><span><span class="dl-label">Watch next week:</span>${esc(watchNext)}</span></li>
      <li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Golf block — embedded inside Sports section (no separate section wrapper)
// ─────────────────────────────────────────────────────────────────────────────
function buildGolfBlock({ golf, copy }) {
  if (!golf) return '';

  const gd = copy?.golfDetail || {};
  const golfInProgress = golf?.statusState === 'in' || golf?.statusState === 'post';
  const hasLeaders = golf?.leaders?.length > 0;

  if (golf && (golfInProgress || hasLeaders) && hasLeaders) {
    const top5 = golf.leaders.slice(0, 5);
    const leader = top5[0];
    const leaderLineHtml = top5.map(p =>
      `${playerLink(p.name)} ${esc(p.score)} (${esc(p.pos)})`
    ).join(', ');

    const isFinished  = golf.statusState === 'post';
    const golfNameDisplay = capFirst(golf.name);
    const aiNote      = copy?.golfNote      || (isFinished ? `${esc(leader.name)} wins ${esc(golfNameDisplay)} at ${esc(leader.score)}.` : `${esc(leader.name)} holds the lead at ${esc(leader.score)}.`);
    const whyMatters  = gd.whyItMatters     || `${esc(golfNameDisplay)} carries full FedEx Cup points.`;
    const bringUp     = gd.bringUp          || `${esc(leader.name)} ${isFinished ? 'won' : 'leads'} at ${esc(leader.score)}.`;
    const groupChat   = gd.groupChatAngle   || `${isFinished ? `${esc(leader.name)} took it.` : `Watch ${esc(leader.name)} this weekend.`}`;
    const heading     = isFinished
      ? `${esc(golfNameDisplay)}: ${playerLink(leader.name)} wins at ${esc(leader.score)}.`
      : `${esc(golfNameDisplay)}: ${playerLink(leader.name)} leads at ${esc(leader.score)}.`;
    const thirdDetail = isFinished
      ? `<li><span><span class="dl-label">How it happened:</span>${esc(gd.recap || `${esc(leader.name)} closed out ${esc(golf.name)} in the final round.`)}</span></li>`
      : `<li><span><span class="dl-label">TV schedule:</span>${esc(gd.tvSchedule || 'Golf Channel/Peacock · NBC/CBS. Check local listings.')}</span></li>`;

    // Course image for known venues
    const golfImg = (() => {
      const name = (golf.name || '').toLowerCase();
      if (name.includes('memorial')) {
        return `<div class="brief-img"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Muirfield_Village_Golf_Club.jpg/1280px-Muirfield_Village_Golf_Club.jpg" alt="Muirfield Village Golf Club — host of the Memorial Tournament" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">Muirfield Village Golf Club · Dublin, Ohio · Jack Nicklaus' design · Host of the Memorial Tournament</div></div>`;
      }
      if (name.includes('masters')) {
        return `<div class="brief-img"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Augusta_National_Golf_Club_drone%2C_aerial_view.jpg/1280px-Augusta_National_Golf_Club_drone%2C_aerial_view.jpg" alt="Augusta National Golf Club" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">Augusta National Golf Club · Augusta, Georgia · Host of The Masters</div></div>`;
      }
      if (name.includes('us open') || name.includes('u.s. open')) {
        return `<div class="brief-img"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Oakmont_Country_Club_aerial_view.jpg/1280px-Oakmont_Country_Club_aerial_view.jpg" alt="US Open golf course" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">U.S. Open Golf Championship</div></div>`;
      }
      return '';
    })();

    return `
    <h3>${heading}</h3>

    ${golfImg}

    <p>${esc(aiNote)}</p>

    <ul class="detail-list">
      <li><span><span class="dl-label">Leaderboard (${esc(golf.status || 'Final')}):</span>${leaderLineHtml}.</span></li>
      <li><span><span class="dl-label">Why it matters:</span>${esc(whyMatters)}</span></li>
      ${thirdDetail}
      <li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>
    </ul>

    <div class="angle-box">
      <span class="angle-label">Group Chat Angle</span>
      <p class="angle-text">${esc(groupChat)}</p>
    </div>`;

  } else if (golf && !golfInProgress) {
    const golfNameDisplay = capFirst(golf.name);
    const whyMatters = gd.whyItMatters || `${esc(golfNameDisplay)} is the featured PGA Tour event this week.`;
    const bringUp = gd.bringUp || 'Watch for the early rounds to set the weekend field.';
    const groupChat = gd.groupChatAngle || '';
    return `
    <h3>${esc(golfNameDisplay)} — tees off this week.</h3>
    <p>${whyMatters} ${bringUp}</p>
    ${groupChat ? `<div class="angle-box">
      <span class="angle-label">Group Chat Angle</span>
      <p class="angle-text">${esc(groupChat)}</p>
    </div>` : ''}`;
  }

  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Culture
// ─────────────────────────────────────────────────────────────────────────────
function buildCulture({ copy }) {
  const items = copy?.culture;

  if (!items?.length || !Array.isArray(items)) {
    return `  <section class="brief-section" id="culture">
    <div class="section-label sl-culture">Culture</div>
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
    <div class="section-label sl-culture">Culture</div>
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
    <div class="section-label sl-markets">The Rec</div>

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
  const st = copy?.sharpTake;
  let parasHtml = `    <p>The week had its moments. Check back tomorrow.</p>`;
  let bulletsHtml = '';

  if (st && typeof st === 'object') {
    const paras = [st.p1, st.p2].filter(Boolean).map(p => `    <p>${esc(p)}</p>`).join('\n');
    parasHtml = paras || parasHtml;
    if (Array.isArray(st.bullets) && st.bullets.length) {
      bulletsHtml = `
    <ul class="sharp-bullets">
${st.bullets.map(b => `      <li>${esc(b)}</li>`).join('\n')}
    </ul>`;
    }
  } else if (typeof st === 'string' && st) {
    parasHtml = st
      .replace(/^#+\s.*$/gm, '').replace(/^---+$/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1').replace(/^- /gm, '')
      .trim().split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
      .map(p => `    <p>${esc(p)}</p>`).join('\n');
  }

  return `  <div class="sharp-take">
    <div class="sharp-take-label">The Sharp Take</div>
${parasHtml}${bulletsHtml}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers worth stealing
// ─────────────────────────────────────────────────────────────────────────────
function buildNumbers({ sports, markets, golf, upcoming, copy }) {
  const ctxArr = copy?.numbersContext;
  const items = [];

  if (sports?.length) {
    const g = sports[0];
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const note = g.note || g.shortName;
    const rawCtx = ctxArr?.[0]?.context || `${note} final score.`;
    items.push({
      num: `${w.score}–${l.score}`,
      html: `<strong>${esc(note)}.</strong> ${esc(rawCtx.replace(/&amp;/g, '&'))}`,
    });
  }

  if (markets?.SPY?.dayChangePct !== undefined && markets.SPY.dayChangePct !== null) {
    const pct = markets.SPY.dayChangePct;
    const dir = pct >= 0 ? 'gain' : 'drop';
    const rawCtx = ctxArr?.[1]?.context || `S&P 500 closed ${dir === 'gain' ? 'higher' : 'lower'} on the day.`;
    items.push({
      num: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
      html: `<strong>S&amp;P 500 ${dir} today.</strong> ${esc(rawCtx.replace(/&amp;/g, '&'))}`,
    });
  }

  if (golf?.leaders?.[0]) {
    const l = golf.leaders[0];
    const isFinished = golf.statusState === 'post';
    const rawCtx = ctxArr?.[2]?.context || `${l.name} ${isFinished ? 'won' : 'leads'} ${golf.name}.`;
    items.push({
      num: l.score,
      html: `<strong>${esc(l.name)}, ${esc(golf.name)}.</strong> ${esc(rawCtx.replace(/&amp;/g, '&'))}`,
    });
  }

  while (items.length < 3) {
    if (upcoming?.length && items.length === 2) {
      const g = upcoming[0];
      const when = g.daysAhead === 0 ? 'tonight' : g.daysAhead === 1 ? 'tomorrow' : 'this week';
      const ctx = copy?.numbersContext?.[2]?.context || `${esc(g.note || g.shortName)} is the most-anticipated game on the calendar right now.`;
      items.push({ num: 'G1', html: `<strong>${esc(g.note || g.shortName)} — ${when}.</strong> ${ctx}` });
    } else {
      items.push({ num: '—', html: '<strong>Check today&#39;s full issue for more.</strong>' });
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// F1 Section
// ─────────────────────────────────────────────────────────────────────────────
function buildF1Block({ f1, copy }) {
  if (!f1?.name) return '';

  const fd = copy?.f1Detail || {};
  const isFinished = f1.statusState === 'post';
  const isScheduled = f1.statusState === 'pre';

  if (isScheduled || !f1.results?.length) {
    const preHeadline = fd.headline || `${esc(f1.shortName || f1.name)} — this weekend.`;
    const preAngle = fd.angle || `The ${esc(f1.name)} takes place ${esc(f1.venue ? `at ${f1.venue}` : 'this weekend')}. One of the marquee events on the F1 calendar — race day is Sunday.`;
    const preBringUp = fd.bringUp || '';
    const preChamp = fd.championship || '';
    const prePick = fd.pick || '';
    const monacoImg = f1.name?.toLowerCase().includes('monaco')
      ? `    <div class="brief-img-gallery">
      <div class="brief-img-gallery-grid">
        <div class="brief-img">
          <img src="https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/content/dam/fom-website/2018-redesign-assets/Racehub%20header%20images%2016x9/Monaco.jpg" alt="Monaco Grand Prix circuit" loading="lazy" onerror="this.closest('.brief-img').style.display='none'">
        </div>
        <div class="brief-img">
          <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Monte_Carlo_Formula_1_Grand_Prix_2012.jpg/1280px-Monte_Carlo_Formula_1_Grand_Prix_2012.jpg" alt="Monaco Grand Prix starting grid" loading="lazy" onerror="this.closest('.brief-img').style.display='none'">
        </div>
      </div>
      <div class="brief-img-cap">Monaco Grand Prix · Circuit de Monaco · 78 laps through the streets of Monte Carlo · The most iconic 3.3 miles in motorsport</div>
    </div>` : '';
    return `  <section class="brief-section" id="f1">
    <div class="section-label sl-sports">Formula 1</div>
${monacoImg}
    <h3>${esc(preHeadline)}</h3>
    ${renderParas(preAngle, '')}
    <ul class="detail-list">
      <li><span><span class="dl-label">Race:</span>${esc(f1.name)}${f1.venue ? ` · ${esc(f1.venue)}` : ''} · Sunday</span></li>
      <li><span><span class="dl-label">Watch:</span>ESPN / ABC · Race day coverage begins ~9am ET</span></li>
      ${prePick ? `<li><span><span class="dl-label">Driver to watch:</span>${esc(prePick)}</span></li>` : ''}
      ${preBringUp ? `<li><span><span class="dl-label">What to bring up:</span>${esc(preBringUp)}</span></li>` : ''}
      ${preChamp ? `<li><span><span class="dl-label">Championship:</span>${esc(preChamp)}</span></li>` : ''}
    </ul>
  </section>`;
  }

  const winner = f1.results[0];
  const heading = isFinished
    ? `${esc(f1.shortName || f1.name)}: ${esc(winner.driver)} wins.`
    : `${esc(f1.shortName || f1.name)} — race weekend.`;

  const leaderboardHtml = f1.results.map(r =>
    `P${r.pos} ${playerLink(r.driver)} (${esc(r.team)})${r.time ? ` — ${esc(r.time)}` : ''}`
  ).join(', ');

  const angle = fd.angle || '';
  const bringUp = fd.bringUp || '';
  const champ = fd.championship || '';
  const pick = fd.pick || '';

  return `  <section class="brief-section" id="f1">
    <div class="section-label sl-sports">Formula 1</div>
    <h3>${heading}</h3>
    ${renderParas(angle, '')}
    <ul class="detail-list">
      <li><span><span class="dl-label">Result:</span>${leaderboardHtml}.</span></li>
      ${pick ? `<li><span><span class="dl-label">Driver to watch:</span>${esc(pick)}</span></li>` : ''}
      ${bringUp ? `<li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>` : ''}
      ${champ ? `<li><span><span class="dl-label">Championship:</span>${esc(champ)}</span></li>` : ''}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// World Cup Section
// ─────────────────────────────────────────────────────────────────────────────
function buildWorldCupBlock({ worldCup }) {
  if (!worldCup?.length) return '';

  const active = worldCup.filter(m => m.statusState === 'in' || m.statusState === 'post');
  const upcoming = worldCup.filter(m => m.statusState === 'pre');

  if (!active.length && upcoming.length) {
    // Pre-tournament preview
    const next = upcoming[0];
    return `  <section class="brief-section" id="worldcup">
    <div class="section-label sl-culture">World Cup 2026</div>
    <div class="wc-preview-banner">
      <div class="wc-banner-hosts">
        <span class="wc-flag">🇺🇸</span>
        <span class="wc-flag">🇨🇦</span>
        <span class="wc-flag">🇲🇽</span>
      </div>
      <div class="wc-banner-title">FIFA World Cup 2026</div>
      <div class="wc-banner-sub">June 11 — July 19 · USA / Canada / Mexico</div>
      <div class="wc-banner-stats">
        <div class="wc-stat"><span class="wc-stat-num">48</span><span class="wc-stat-lbl">Teams</span></div>
        <div class="wc-stat"><span class="wc-stat-num">104</span><span class="wc-stat-lbl">Matches</span></div>
        <div class="wc-stat"><span class="wc-stat-num">16</span><span class="wc-stat-lbl">Venues</span></div>
        <div class="wc-stat"><span class="wc-stat-num">9</span><span class="wc-stat-lbl">Days Away</span></div>
      </div>
    </div>
    <h3>The World Cup opens June 11.</h3>
    <p>48 teams. 104 matches. USA, Canada, and Mexico host the first expanded World Cup. The opening match: ${esc(next.away.team)} vs ${esc(next.home.team)}. USA plays June 12 at SoFi Stadium against Paraguay. This is the biggest sporting event on the planet and it's happening in your backyard.</p>
    <ul class="detail-list">
      <li><span><span class="dl-label">First match:</span>${esc(next.away.team)} vs ${esc(next.home.team)} — ${esc(next.status || 'June 11')}</span></li>
      <li><span><span class="dl-label">USA opener:</span>USA vs Paraguay, June 12 · SoFi Stadium, Los Angeles · 9pm ET · Fox</span></li>
      <li><span><span class="dl-label">To watch:</span>48 teams, group stage runs through July 2. Final is July 19 at MetLife Stadium.</span></li>
    </ul>
  </section>`;
  }

  const matchRows = active.slice(0, 4).map(m => {
    const scoreOrStatus = m.statusState === 'post'
      ? `${esc(m.away.score)}–${esc(m.home.score)} Final`
      : esc(m.status || 'In Progress');
    return `<li><span>${esc(m.away.team)} vs ${esc(m.home.team)} — <strong>${scoreOrStatus}</strong></span></li>`;
  }).join('\n      ');

  return `  <section class="brief-section" id="worldcup">
    <div class="section-label sl-culture">World Cup 2026</div>
    <h3>Group stage underway.</h3>
    <ul class="detail-list">
      ${matchRows}
    </ul>
  </section>`;
}

module.exports = { buildHtml };
