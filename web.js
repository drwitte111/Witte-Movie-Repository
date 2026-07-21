/* =============================================
   WEB EXPLORER + GAME ENGINE
   Requires: app.js loaded first (DIARY, BEARER, TMDB_CACHE, fetchTMDB, IMG, escapeHtml, safeJson, starsStr)
   ============================================= */

/* =============================================
   BUILD CONNECTIONS FOR A FILM
   Returns array of { film, connections: [{type, value}] }
   ============================================= */
async function buildWebData(centerFilm, connectionType) {
  const centerTmdb    = await fetchTMDB(centerFilm);
  const centerCredits = await fetchCredits(centerFilm);

  // Get shared attributes for center film
  const centerAttrs = getAttrs(centerTmdb, centerCredits, connectionType);

  // Score every other film by shared attributes
  const scored = [];
  const pool = DIARY.filter(f => f.name !== centerFilm.name);

  // Limit to avoid too many API calls — use cached first, then fetch a batch
  const cached  = pool.filter(f => TMDB_CACHE[`${f.name}|${f.year}`]);
  const toFetch = pool.filter(f => !TMDB_CACHE[`${f.name}|${f.year}`]).slice(0, 30);

  const candidates = [...cached, ...toFetch];

  for (const film of candidates) {
    const tmdb    = await fetchTMDB(film);
    const credits = connectionType !== 'genre' ? await fetchCredits(film) : null;
    const attrs   = getAttrs(tmdb, credits, connectionType);
    const shared  = centerAttrs.filter(a => attrs.includes(a));
    if (shared.length) {
      scored.push({ film, shared, weight: shared.length });
    }
  }

  // Sort by most connections, take top 12
  scored.sort((a, b) => b.weight - a.weight);
  return scored.slice(0, 12);
}

function getAttrs(tmdb, credits, type) {
  if (!tmdb) return [];
  switch(type) {
    case 'genre':    return tmdb.genres || [];
    case 'actor':    return credits?.cast || [];
    case 'director': return credits?.director || [];
    case 'writer':   return credits?.writer || [];
    default:         return [...(tmdb.genres||[]), ...(credits?.cast||[]).slice(0,5)];
  }
}

/* =============================================
   SVG WEB RENDERER
   ============================================= */
function renderWeb(centerFilm, nodes, svg, onNodeClick, highlightName = null) {
  svg.innerHTML = '';
  const W = svg.clientWidth  || 900;
  const H = svg.clientHeight || 600;
  const cx = W / 2;
  const cy = H / 2;
  const R  = Math.min(W, H) * 0.36;

  // Define clip paths for circular images
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

  // Center node clip
  const clipC = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
  clipC.setAttribute('id', 'clip-center');
  const circC = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circC.setAttribute('cx', cx); circC.setAttribute('cy', cy); circC.setAttribute('r', 44);
  clipC.appendChild(circC);
  defs.appendChild(clipC);

  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i / nodes.length) - Math.PI / 2;
    const x     = cx + R * Math.cos(angle);
    const y     = cy + R * Math.sin(angle);
    n._x = x; n._y = y;

    const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clip.setAttribute('id', `clip-${i}`);
    const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('cx', x); circ.setAttribute('cy', y); circ.setAttribute('r', 30);
    clip.appendChild(circ);
    defs.appendChild(clip);
  });
  svg.appendChild(defs);

  // Draw connection lines
  nodes.forEach((n, i) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx); line.setAttribute('y1', cy);
    line.setAttribute('x2', n._x); line.setAttribute('y2', n._y);
    line.setAttribute('stroke', highlightName === n.film.name ? '#c8971a' : '#2a2a32');
    line.setAttribute('stroke-width', highlightName === n.film.name ? 2 : 1);
    svg.appendChild(line);

    // Connection label
    const lx = (cx + n._x) / 2;
    const ly = (cy + n._y) / 2;
    const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tag.setAttribute('x', lx); tag.setAttribute('y', ly);
    tag.setAttribute('text-anchor', 'middle');
    tag.setAttribute('font-size', '9');
    tag.setAttribute('fill', '#6b6b7a');
    tag.setAttribute('font-family', 'DM Mono, monospace');
    tag.textContent = n.shared.slice(0, 2).join(', ');
    svg.appendChild(tag);
  });

  // Draw satellite nodes
  nodes.forEach((n, i) => {
    const tmdb     = TMDB_CACHE[`${n.film.name}|${n.film.year}`];
    const poster   = tmdb?.poster;
    const isTarget = highlightName === n.film.name;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => onNodeClick(n.film));

    // Outer ring
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', n._x); ring.setAttribute('cy', n._y); ring.setAttribute('r', 33);
    ring.setAttribute('fill', isTarget ? '#c8971a' : '#1a1a1e');
    ring.setAttribute('stroke', isTarget ? '#c8971a' : '#3a3a46');
    ring.setAttribute('stroke-width', isTarget ? 3 : 1);
    g.appendChild(ring);

    if (poster) {
      const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      img.setAttribute('href', `${IMG}w92${poster}`);
      img.setAttribute('x', n._x - 30); img.setAttribute('y', n._y - 30);
      img.setAttribute('width', 60); img.setAttribute('height', 60);
      img.setAttribute('clip-path', `url(#clip-${i})`);
      img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      g.appendChild(img);
    } else {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', n._x); txt.setAttribute('y', n._y + 4);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '9');
      txt.setAttribute('fill', '#d4cfc4');
      txt.setAttribute('font-family', 'Inter, sans-serif');
      txt.textContent = n.film.name.slice(0, 12);
      g.appendChild(txt);
    }

    // Label below
    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('x', n._x); lbl.setAttribute('y', n._y + 46);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('font-size', '10');
    lbl.setAttribute('fill', isTarget ? '#c8971a' : '#8a8494');
    lbl.setAttribute('font-family', 'Inter, sans-serif');
    const words = n.film.name.split(' ');
    const line1 = words.slice(0, 3).join(' ');
    const line2 = words.slice(3, 6).join(' ');
    lbl.textContent = line1;
    g.appendChild(lbl);
    if (line2) {
      const lbl2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl2.setAttribute('x', n._x); lbl2.setAttribute('y', n._y + 57);
      lbl2.setAttribute('text-anchor', 'middle');
      lbl2.setAttribute('font-size', '10');
      lbl2.setAttribute('fill', isTarget ? '#c8971a' : '#8a8494');
      lbl2.setAttribute('font-family', 'Inter, sans-serif');
      lbl2.textContent = line2;
      g.appendChild(lbl2);
    }

    svg.appendChild(g);
  });

  // Center node
  const centerTmdb   = TMDB_CACHE[`${centerFilm.name}|${centerFilm.year}`];
  const centerPoster = centerTmdb?.poster;
  const cg = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  const cring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  cring.setAttribute('cx', cx); cring.setAttribute('cy', cy); cring.setAttribute('r', 47);
  cring.setAttribute('fill', '#111113');
  cring.setAttribute('stroke', '#c8971a');
  cring.setAttribute('stroke-width', 2);
  cg.appendChild(cring);

  if (centerPoster) {
    const cimg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    cimg.setAttribute('href', `${IMG}w92${centerPoster}`);
    cimg.setAttribute('x', cx - 44); cimg.setAttribute('y', cy - 44);
    cimg.setAttribute('width', 88); cimg.setAttribute('height', 88);
    cimg.setAttribute('clip-path', 'url(#clip-center)');
    cimg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    cg.appendChild(cimg);
  } else {
    const ctxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ctxt.setAttribute('x', cx); ctxt.setAttribute('y', cy + 4);
    ctxt.setAttribute('text-anchor', 'middle');
    ctxt.setAttribute('font-size', '11');
    ctxt.setAttribute('fill', '#e8e0cc');
    ctxt.setAttribute('font-family', 'Inter, sans-serif');
    ctxt.textContent = centerFilm.name.slice(0, 14);
    cg.appendChild(ctxt);
  }

  const clbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  clbl.setAttribute('x', cx); clbl.setAttribute('y', cy + 62);
  clbl.setAttribute('text-anchor', 'middle');
  clbl.setAttribute('font-size', '12');
  clbl.setAttribute('fill', '#e8e0cc');
  clbl.setAttribute('font-family', 'DM Serif Display, serif');
  clbl.setAttribute('font-style', 'italic');
  clbl.textContent = centerFilm.name.length > 22 ? centerFilm.name.slice(0, 22) + '…' : centerFilm.name;
  cg.appendChild(clbl);

  svg.appendChild(cg);
}

/* =============================================
   WEB EXPLORER
   ============================================= */
let webHistory   = [];
let webConnType  = 'genre';
let webSearchResults = [];

function initWebExplorer() {
  renderWebSearch('webSearchInput', 'webSearchResults', film => {
    webHistory = [];
    loadWebCenter(film);
  });

  document.getElementById('webConnType').addEventListener('change', e => {
    webConnType = e.target.value;
    if (webHistory.length) loadWebCenter(webHistory[webHistory.length - 1]);
  });

  document.getElementById('webBackBtn').addEventListener('click', () => {
    if (webHistory.length > 1) {
      webHistory.pop();
      loadWebCenter(webHistory.pop());
    }
  });
}

async function loadWebCenter(film) {
  webHistory.push(film);
  document.getElementById('webStatus').textContent = `Building web for "${film.name}"…`;
  document.getElementById('webBackBtn').style.display = webHistory.length > 1 ? 'inline-block' : 'none';
  document.getElementById('webBreadcrumb').textContent = webHistory.map(f => f.name).join(' → ');

  const svg = document.getElementById('webSvg');
  svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#6b6b7a" font-family="DM Mono,monospace" font-size="13">Loading connections…</text>`;

  const nodes = await buildWebData(film, webConnType);
  document.getElementById('webStatus').textContent = `${nodes.length} connections found`;

  renderWeb(film, nodes, svg, clickedFilm => {
    loadWebCenter(clickedFilm);
  });
}

/* =============================================
   GAME
   ============================================= */
let gameStart   = null;
let gameEnd     = null;
let gamePath    = [];
let gameMoves   = 0;
let gameActive  = false;
let gameTimer   = null;
let gameSeconds = 0;

function initGame() {
  document.getElementById('gameGiveUpBtn').addEventListener('click', giveUpGame);

  renderWebSearch('gameSearchStart', 'gameSearchStartResults', film => {
    gameStart = film;
    document.getElementById('gameStartLabel').textContent = film.name;
    checkGameReady();
  });
  renderWebSearch('gameSearchEnd', 'gameSearchEndResults', film => {
    gameEnd = film;
    document.getElementById('gameEndLabel').textContent = film.name;
    checkGameReady();
  });
}

function checkGameReady() {
  const btn = document.getElementById('gameNewBtn');
  btn.disabled = !(gameStart && gameEnd && gameStart.name !== gameEnd.name);
}

async function startNewGame() {
  if (!gameStart || !gameEnd) return;
  gamePath    = [gameStart];
  gameMoves   = 0;
  gameActive  = true;
  gameSeconds = 0;

  document.getElementById('gameSetup').style.display    = 'none';
  document.getElementById('gameActive').style.display   = 'block';
  document.getElementById('gameMoveCount').textContent  = 0;
  document.getElementById('gamePathDisplay').textContent = gameStart.name;
  document.getElementById('gameTargetName').textContent  = gameEnd.name;
  document.getElementById('gameGiveUpBtn').style.display = 'inline-block';

  // Show target poster
  const endTmdb = await fetchTMDB(gameEnd);
  const tpEl    = document.getElementById('gameTargetPoster');
  if (endTmdb?.poster) {
    tpEl.src   = `${IMG}w92${endTmdb.poster}`;
    tpEl.style.display = 'block';
  } else { tpEl.style.display = 'none'; }

  // Timer
  clearInterval(gameTimer);
  gameTimer = setInterval(() => {
    gameSeconds++;
    const m = Math.floor(gameSeconds / 60).toString().padStart(2, '0');
    const s = (gameSeconds % 60).toString().padStart(2, '0');
    document.getElementById('gameTimer').textContent = `${m}:${s}`;
  }, 1000);

  await loadGameWeb(gameStart);
}

async function loadGameWeb(film) {
  const svg = document.getElementById('gameSvg');
  svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#6b6b7a" font-family="DM Mono,monospace" font-size="13">Finding connections…</text>`;
  document.getElementById('gameCurrentName').textContent = film.name;

  const nodes = await buildWebData(film, 'genre');

  // Check if target is in this web
  const targetInWeb = nodes.find(n => n.film.name === gameEnd.name);

  renderWeb(film, nodes, svg, async clickedFilm => {
    if (!gameActive) return;
    gameMoves++;
    gamePath.push(clickedFilm);
    document.getElementById('gameMoveCount').textContent  = gameMoves;
    document.getElementById('gamePathDisplay').textContent = gamePath.map(f => f.name).join(' → ');

    if (clickedFilm.name === gameEnd.name) {
      // WIN
      gameActive = false;
      clearInterval(gameTimer);
      const m = Math.floor(gameSeconds / 60).toString().padStart(2, '0');
      const s = (gameSeconds % 60).toString().padStart(2, '0');
      document.getElementById('gameResult').innerHTML = `
        <div class="game-win">
          🎬 You got there in <strong>${gameMoves} moves</strong> and <strong>${m}:${s}</strong>!
          <br/><span style="font-size:13px;color:var(--muted)">${gamePath.map(f => f.name).join(' → ')}</span>
        </div>
      `;
      document.getElementById('gameGiveUpBtn').style.display = 'none';
    } else {
      document.getElementById('gameResult').innerHTML = '';
      await loadGameWeb(clickedFilm);
    }
  }, gameEnd.name);
}

function giveUpGame() {
  gameActive = false;
  clearInterval(gameTimer);
  document.getElementById('gameResult').innerHTML = `
    <div class="game-lose">
      Better luck next time. Path so far: ${gamePath.map(f => f.name).join(' → ')}
    </div>
  `;
  document.getElementById('gameGiveUpBtn').style.display = 'none';
  // Reveal the target film
  loadGameWeb(gamePath[gamePath.length - 1]);
}

function resetGame() {
  gameActive = false;
  clearInterval(gameTimer);
  gameStart = null; gameEnd = null;
  gamePath  = []; gameMoves = 0; gameSeconds = 0;
  document.getElementById('gameSetup').style.display  = 'block';
  document.getElementById('gameActive').style.display = 'none';
  document.getElementById('gameResult').innerHTML     = '';
  document.getElementById('gameStartLabel').textContent = 'Not chosen';
  document.getElementById('gameEndLabel').textContent   = 'Not chosen';
  document.getElementById('gameTimer').textContent      = '00:00';
  document.getElementById('gameNewBtn').disabled = true;
}

/* =============================================
   SHARED FILM SEARCH AUTOCOMPLETE
   ============================================= */
function renderWebSearch(inputId, resultsId, onSelect) {
  const input   = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results) return;

  function showMatches() {
    const q = input.value.toLowerCase().trim();
    if (!q || q.length < 2) { results.style.display = 'none'; return; }
    const matches = DIARY.filter(f => f.name.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { results.style.display = 'none'; return; }
    results._matches = matches;
    results.innerHTML = matches.map((f, i) => `
      <div class="search-result-item" data-idx="${i}">${escapeHtml(f.name)} <span style="color:var(--muted);font-size:11px;">${f.year||''}</span></div>
    `).join('');
    results.style.display = 'block';
    results.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const film = results._matches[parseInt(el.dataset.idx)];
        input.value = film.name;
        results.style.display = 'none';
        onSelect(film);
      });
    });
  }

  input.addEventListener('input', showMatches);

  // Enter key picks first result
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (results._matches && results._matches.length) {
      const film = results._matches[0];
      input.value = film.name;
      results.style.display = 'none';
      onSelect(film);
    }
  });

  document.addEventListener('click', e => {
    if (!results.contains(e.target) && e.target !== input) {
      results.style.display = 'none';
    }
  });
}

/* =============================================
   GAME RANDOM SETUP
   ============================================= */
function randomGame() {
  const pool = DIARY.filter(f => f.rating >= 3);
  gameStart  = pool[Math.floor(Math.random() * pool.length)];
  gameEnd    = pool[Math.floor(Math.random() * pool.length)];
  while (gameEnd.name === gameStart.name) {
    gameEnd = pool[Math.floor(Math.random() * pool.length)];
  }
  document.getElementById('gameStartLabel').textContent = gameStart.name;
  document.getElementById('gameEndLabel').textContent   = gameEnd.name;
  document.getElementById('gameSearchStart').value = gameStart.name;
  document.getElementById('gameSearchEnd').value   = gameEnd.name;
  checkGameReady();
}
