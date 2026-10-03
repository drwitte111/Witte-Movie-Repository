/* =============================================
   WEB EXPLORER + GAME ENGINE
   Requires: app.js loaded first (DIARY, WATCHED, TMDB_CACHE, CREDITS_CACHE, fetchTMDB,
   fetchCredits, filmKey, mapLimit, IMG, escapeHtml)
   ============================================= */

const SVG_NS     = 'http://www.w3.org/2000/svg';
const MAX_NODES  = 12;
const MAX_FETCH  = 30;   // uncached films looked up per web build
const MOBILE_NODES = 8;
const MIN_CANVAS   = 480; // smallest side, in SVG units, the web is laid out on
const COLORS = {
  gold:   '#c8971a',
  line:   '#2a2a32',
  ring:   '#3a3a46',
  node:   '#1a1a1e',
  center: '#111113',
  muted:  '#6b6b7a',
  label:  '#8a8494',
  text:   '#d4cfc4',
  cream:  '#e8e0cc',
};

/* =============================================
   BUILD CONNECTIONS FOR A FILM
   Returns array of { film, shared: [attr], weight }
   ============================================= */
async function buildWebData(centerFilm, connectionType) {
  const needsCredits = connectionType !== 'genre';
  const [centerTmdb, centerCredits] = await Promise.all([
    fetchTMDB(centerFilm),
    needsCredits ? fetchCredits(centerFilm) : null,
  ]);
  const centerAttrs = new Set(getAttrs(centerTmdb, centerCredits, connectionType));
  if (!centerAttrs.size) return [];

  // Use what's cached first, then look up a limited batch of new films
  const cache   = needsCredits ? CREDITS_CACHE : TMDB_CACHE;
  const pool    = DIARY.filter(f => filmKey(f) !== filmKey(centerFilm));
  const cached  = pool.filter(f => cache[filmKey(f)]);
  const toFetch = pool.filter(f => !(filmKey(f) in cache)).slice(0, MAX_FETCH);

  const scored = await mapLimit([...cached, ...toFetch], 6, async film => {
    const [tmdb, credits] = await Promise.all([
      fetchTMDB(film),
      needsCredits ? fetchCredits(film) : null,
    ]);
    const shared = getAttrs(tmdb, credits, connectionType).filter(a => centerAttrs.has(a));
    return shared.length ? { film, shared, weight: shared.length } : null;
  });

  return scored
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight || (b.film.rating || 0) - (a.film.rating || 0))
    .slice(0, MAX_NODES);
}

function getAttrs(tmdb, credits, type) {
  if (!tmdb) return [];
  switch (type) {
    case 'genre':    return tmdb.genres || [];
    case 'actor':    return credits?.cast || [];
    case 'director': return credits?.director || [];
    case 'writer':   return credits?.writer || [];
    default:         return [...(tmdb.genres || []), ...(credits?.cast || []).slice(0, 5)];
  }
}

/* =============================================
   SVG WEB RENDERER
   ============================================= */
function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (text !== undefined) el.textContent = text;
  return el;
}

function svgMessage(svg, text) {
  svg._lastRender = null;
  svg.removeAttribute('viewBox');
  svg.innerHTML = '';
  svg.appendChild(svgEl('text', {
    x: '50%', y: '50%', 'text-anchor': 'middle', fill: COLORS.muted,
    'font-family': 'DM Mono,monospace', 'font-size': 13,
  }, text));
}

// Circular poster (or title fallback) clipped to radius r at (x, y)
function svgPoster(defs, clipId, film, x, y, r, fallbackLen, fallbackSize, fallbackColor) {
  const poster = TMDB_CACHE[filmKey(film)]?.poster;
  if (!poster) {
    return svgEl('text', {
      x, y: y + 4, 'text-anchor': 'middle', 'font-size': fallbackSize,
      fill: fallbackColor, 'font-family': 'Inter, sans-serif',
    }, film.name.slice(0, fallbackLen));
  }
  const clip = svgEl('clipPath', { id: clipId });
  clip.appendChild(svgEl('circle', { cx: x, cy: y, r }));
  defs.appendChild(clip);
  return svgEl('image', {
    href: `${IMG}w92${poster}`, x: x - r, y: y - r, width: r * 2, height: r * 2,
    'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice',
  });
}

function renderWeb(centerFilm, nodes, svg, onNodeClick, highlightKey = null) {
  svg._lastRender = [centerFilm, nodes, svg, onNodeClick, highlightKey];
  svg.innerHTML = '';
  // On narrow screens draw on a larger virtual canvas and let the viewBox scale it down,
  // and show fewer satellites so posters stay tappable
  const cw    = svg.clientWidth  || 900;
  const ch    = svg.clientHeight || 600;
  const scale = Math.max(1, MIN_CANVAS / Math.min(cw, ch));
  const W  = cw * scale;
  const H  = ch * scale;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (cw < 600) nodes = nodes.slice(0, MOBILE_NODES);
  const cx = W / 2;
  const cy = H / 2;
  const R  = Math.min(W, H) * 0.36;
  // Clip ids must be unique across every SVG on the page
  const idp  = svg.id || 'web';
  const defs = svgEl('defs');
  svg.appendChild(defs);

  if (!nodes.length) {
    svg.appendChild(svgEl('text', {
      x: cx, y: cy + 90, 'text-anchor': 'middle', fill: COLORS.muted,
      'font-family': 'DM Mono,monospace', 'font-size': 12,
    }, BEARER ? 'No connections found' : 'Connect TMDB to find connections'));
  }

  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i / nodes.length) - Math.PI / 2;
    n._x = cx + R * Math.cos(angle);
    n._y = cy + R * Math.sin(angle);
  });

  // Connection lines + labels
  nodes.forEach(n => {
    const hl = highlightKey === filmKey(n.film);
    svg.appendChild(svgEl('line', {
      x1: cx, y1: cy, x2: n._x, y2: n._y,
      stroke: hl ? COLORS.gold : COLORS.line, 'stroke-width': hl ? 2 : 1,
    }));
    svg.appendChild(svgEl('text', {
      // Past the midpoint so labels clear the center film's title
      x: cx + (n._x - cx) * 0.62, y: cy + (n._y - cy) * 0.62, 'text-anchor': 'middle',
      'font-size': 9, fill: COLORS.muted, 'font-family': 'DM Mono, monospace',
    }, n.shared.slice(0, 2).join(', ')));
  });

  // Satellite nodes
  nodes.forEach((n, i) => {
    const isTarget = highlightKey === filmKey(n.film);
    const g = svgEl('g', { style: 'cursor:pointer' });
    g.addEventListener('click', () => onNodeClick(n.film));
    g.appendChild(svgEl('title', {}, `${n.film.name}${n.film.year ? ` (${n.film.year})` : ''}`));

    g.appendChild(svgEl('circle', {
      cx: n._x, cy: n._y, r: 33,
      fill:   isTarget ? COLORS.gold : COLORS.node,
      stroke: isTarget ? COLORS.gold : COLORS.ring,
      'stroke-width': isTarget ? 3 : 1,
    }));
    g.appendChild(svgPoster(defs, `${idp}-clip-${i}`, n.film, n._x, n._y, 30, 12, 9, COLORS.text));

    // Title below, wrapped onto two lines of up to three words
    const words = n.film.name.split(' ');
    [words.slice(0, 3).join(' '), words.slice(3, 6).join(' ')].forEach((line, li) => {
      if (!line) return;
      g.appendChild(svgEl('text', {
        x: n._x, y: n._y + 46 + li * 11, 'text-anchor': 'middle', 'font-size': 10,
        fill: isTarget ? COLORS.gold : COLORS.label, 'font-family': 'Inter, sans-serif',
      }, line));
    });

    svg.appendChild(g);
  });

  // Center node
  const cg = svgEl('g');
  cg.appendChild(svgEl('circle', {
    cx, cy, r: 47, fill: COLORS.center, stroke: COLORS.gold, 'stroke-width': 2,
  }));
  cg.appendChild(svgPoster(defs, `${idp}-clip-center`, centerFilm, cx, cy, 44, 14, 11, COLORS.cream));
  cg.appendChild(svgEl('text', {
    x: cx, y: cy + 62, 'text-anchor': 'middle', 'font-size': 12, fill: COLORS.cream,
    'font-family': 'DM Serif Display, serif', 'font-style': 'italic',
  }, centerFilm.name.length > 22 ? centerFilm.name.slice(0, 22) + '…' : centerFilm.name));
  svg.appendChild(cg);
}

// Redraw visible webs after rotation / resize
let webResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(webResizeTimer);
  webResizeTimer = setTimeout(() => {
    ['webSvg', 'gameSvg'].forEach(id => {
      const svg = document.getElementById(id);
      if (svg?._lastRender && svg.clientWidth) renderWeb(...svg._lastRender);
    });
  }, 200);
});

/* =============================================
   WEB EXPLORER
   ============================================= */
let webHistory  = [];
let webConnType = 'genre';
let webLoadId   = 0;

function initWebExplorer() {
  attachFilmSearch('webSearchInput', 'webSearchResults', film => {
    webHistory = [];
    loadWebCenter(film);
  });

  document.getElementById('webConnType').addEventListener('change', e => {
    webConnType = e.target.value;
    if (webHistory.length) loadWebCenter(webHistory.pop());
  });

  document.getElementById('webBackBtn').addEventListener('click', () => {
    if (webHistory.length > 1) {
      webHistory.pop();
      loadWebCenter(webHistory.pop());
    }
  });
}

async function loadWebCenter(film) {
  const loadId = ++webLoadId;
  webHistory.push(film);
  setText('webStatus', `Building web for "${film.name}"…`);
  document.getElementById('webBackBtn').style.display = webHistory.length > 1 ? 'inline-block' : 'none';
  setText('webBreadcrumb', webHistory.map(f => f.name).join(' → '));

  const svg = document.getElementById('webSvg');
  svgMessage(svg, 'Loading connections…');

  const nodes = await buildWebData(film, webConnType);
  if (loadId !== webLoadId) return;   // superseded by a newer click
  setText('webStatus', `${nodes.length} connection${nodes.length === 1 ? '' : 's'} found`);
  renderWeb(film, nodes, svg, loadWebCenter);
}

/* =============================================
   GAME
   ============================================= */
const game = {
  start: null, end: null, path: [], moves: 0,
  active: false, timer: null, seconds: 0, loadId: 0,
};

function initGame() {
  document.getElementById('gameGiveUpBtn').addEventListener('click', giveUpGame);
  attachFilmSearch('gameSearchStart', 'gameSearchStartResults', film => setGameFilm('start', film));
  attachFilmSearch('gameSearchEnd',   'gameSearchEndResults',   film => setGameFilm('end',   film));
}

function setGameFilm(which, film) {
  game[which] = film;
  setText(which === 'start' ? 'gameStartLabel' : 'gameEndLabel', film.name);
  document.getElementById(which === 'start' ? 'gameSearchStart' : 'gameSearchEnd').value = film.name;
  document.getElementById('gameNewBtn').disabled =
    !(game.start && game.end && filmKey(game.start) !== filmKey(game.end));
}

const formatTime = secs =>
  `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
const pathStr = () => game.path.map(f => escapeHtml(f.name)).join(' → ');

function stopGame() {
  game.active = false;
  clearInterval(game.timer);
  document.getElementById('gameGiveUpBtn').style.display = 'none';
}

async function startNewGame() {
  if (!game.start || !game.end) return;
  Object.assign(game, { path: [game.start], moves: 0, active: true, seconds: 0 });

  document.getElementById('gameSetup').style.display     = 'none';
  document.getElementById('gameActive').style.display    = 'block';
  document.getElementById('gameGiveUpBtn').style.display = 'inline-block';
  document.getElementById('gameResult').innerHTML        = '';
  setText('gameMoveCount',   0);
  setText('gameTimer',       formatTime(0));
  setText('gamePathDisplay', game.start.name);
  setText('gameTargetName',  game.end.name);

  clearInterval(game.timer);
  game.timer = setInterval(() => setText('gameTimer', formatTime(++game.seconds)), 1000);

  const tpEl = document.getElementById('gameTargetPoster');
  tpEl.style.display = 'none';
  fetchTMDB(game.end).then(tmdb => {
    if (!tmdb?.poster) return;
    tpEl.src = `${IMG}w92${tmdb.poster}`;
    tpEl.style.display = 'block';
  });

  await loadGameWeb(game.start);
}

async function loadGameWeb(film) {
  const loadId = ++game.loadId;
  const svg = document.getElementById('gameSvg');
  svgMessage(svg, 'Finding connections…');
  setText('gameCurrentName', film.name);

  const nodes = await buildWebData(film, 'genre');
  if (loadId !== game.loadId) return;

  renderWeb(film, nodes, svg, async clickedFilm => {
    if (!game.active) return;
    game.moves++;
    game.path.push(clickedFilm);
    setText('gameMoveCount', game.moves);
    setText('gamePathDisplay', game.path.map(f => f.name).join(' → '));

    if (filmKey(clickedFilm) === filmKey(game.end)) {
      stopGame();
      document.getElementById('gameResult').innerHTML = `
        <div class="game-win">
          🎬 You got there in <strong>${game.moves} move${game.moves === 1 ? '' : 's'}</strong>
          and <strong>${formatTime(game.seconds)}</strong>!
          <br/><span style="font-size:13px;color:var(--muted)">${pathStr()}</span>
        </div>`;
    } else {
      document.getElementById('gameResult').innerHTML = '';
      await loadGameWeb(clickedFilm);
    }
  }, filmKey(game.end));
}

function giveUpGame() {
  stopGame();
  document.getElementById('gameResult').innerHTML = `
    <div class="game-lose">
      Better luck next time. The target was <strong>${escapeHtml(game.end.name)}</strong>.
      Path so far: ${pathStr()}
    </div>`;
}

function resetGame() {
  stopGame();
  game.loadId++;
  Object.assign(game, { start: null, end: null, path: [], moves: 0, seconds: 0 });
  document.getElementById('gameSetup').style.display  = 'block';
  document.getElementById('gameActive').style.display = 'none';
  document.getElementById('gameResult').innerHTML     = '';
  document.getElementById('gameSearchStart').value    = '';
  document.getElementById('gameSearchEnd').value      = '';
  setText('gameStartLabel', 'Not chosen');
  setText('gameEndLabel',   'Not chosen');
  setText('gameTimer',      formatTime(0));
  document.getElementById('gameNewBtn').disabled = true;
}

function randomGame() {
  const pool = WATCHED.filter(f => f.rating >= 3);
  if (pool.length < 2) return;
  const pick  = () => pool[Math.floor(Math.random() * pool.length)];
  const start = pick();
  let end = pick();
  while (filmKey(end) === filmKey(start)) end = pick();
  setGameFilm('start', start);
  setGameFilm('end',   end);
}

/* =============================================
   SHARED FILM SEARCH AUTOCOMPLETE
   ============================================= */
function attachFilmSearch(inputId, resultsId, onSelect) {
  const input   = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results || input.dataset.searchBound) return;
  input.dataset.searchBound = '1';

  let matches = [];
  let active  = 0;

  const hide = () => { results.style.display = 'none'; matches = []; };
  const choose = film => {
    input.value = film.name;
    hide();
    onSelect(film);
  };
  const highlight = () => {
    results.querySelectorAll('.search-result-item').forEach((el, i) => {
      el.classList.toggle('active', i === active);
      el.style.background = i === active ? 'var(--surface3)' : '';
    });
  };

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    matches = q.length < 2 ? [] : DIARY
      .filter(f => f.name.toLowerCase().includes(q))
      // Titles that start with the query rank first
      .sort((a, b) => b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q))
      .slice(0, 8);
    if (!matches.length) return hide();

    active = 0;
    results.innerHTML = matches.map((f, i) => `
      <div class="search-result-item" data-idx="${i}">${escapeHtml(f.name)}
        <span style="color:var(--muted);font-size:11px;">${f.year || ''}</span></div>`).join('');
    results.style.display = 'block';
    highlight();
  });

  results.addEventListener('click', e => {
    const el = e.target.closest('.search-result-item');
    if (el) choose(matches[parseInt(el.dataset.idx, 10)]);
  });

  input.addEventListener('keydown', e => {
    if (!matches.length) return;
    if (e.key === 'ArrowDown')    { active = (active + 1) % matches.length; highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + matches.length) % matches.length; highlight(); e.preventDefault(); }
    else if (e.key === 'Enter')   choose(matches[active]);
    else if (e.key === 'Escape')  hide();
  });

  // pointerdown fires reliably on iOS, where taps on non-clickable areas don't send click
  document.addEventListener('pointerdown', e => {
    if (!results.contains(e.target) && e.target !== input) hide();
  });
}
