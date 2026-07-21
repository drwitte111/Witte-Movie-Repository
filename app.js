/* =============================================
   STATE
   ============================================= */
let BEARER = localStorage.getItem('tmdb_token') || '';
let TMDB_CACHE = JSON.parse(localStorage.getItem('tmdb_cache') || '{}');
let currentView = 'home';
let wallFiltered = [];

const IMG = 'https://image.tmdb.org/t/p/';

/* =============================================
   INIT
   ============================================= */
document.addEventListener('DOMContentLoaded', () => {
  if (BEARER) {
    const inp = document.getElementById('tokenInput');
    inp.value = '••••••••••••••••••';
    inp.classList.add('connected');
    document.getElementById('tokenSave').textContent = 'Connected';
    document.getElementById('tokenSave').classList.add('connected');
  }

  // Nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Token save
  document.getElementById('tokenSave').addEventListener('click', handleTokenSave);

  // Compute hero stats
  const rated = DIARY.filter(f => f.rating >= 1);
  const avg = rated.reduce((s, f) => s + f.rating, 0) / rated.length;
  document.getElementById('heroAvg').textContent = avg.toFixed(2);
  document.getElementById('heroRated').textContent = rated.length;
  document.getElementById('heroFives').textContent = rated.filter(f => f.rating === 5).length;

  renderMosaic();
  renderRecent();
  renderFiveStars();
  renderWall();
  renderStats();
});

/* =============================================
   TOKEN
   ============================================= */
function handleTokenSave() {
  const val = document.getElementById('tokenInput').value.trim();
  if (!val || val.startsWith('•')) return;
  BEARER = val;
  localStorage.setItem('tmdb_token', BEARER);
  const inp = document.getElementById('tokenInput');
  inp.value = '••••••••••••••••••';
  inp.classList.add('connected');
  const btn = document.getElementById('tokenSave');
  btn.textContent = 'Connected';
  btn.classList.add('connected');
  // Refresh enriched content
  TMDB_CACHE = {};
  localStorage.removeItem('tmdb_cache');
  renderMosaic();
  renderRecent();
  renderFiveStars();
  renderWall();
}

/* =============================================
   VIEWS
   ============================================= */
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view' + view.charAt(0).toUpperCase() + view.slice(1)).classList.add('active');
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  currentView = view;
  window.scrollTo(0, 0);
}

/* =============================================
   TMDB FETCH
   ============================================= */
async function fetchTMDB(film) {
  const key = `${film.name}|${film.year}`;
  if (TMDB_CACHE[key]) return TMDB_CACHE[key];
  if (!BEARER) return null;

  try {
    const q = encodeURIComponent(film.name);
    const yr = film.year ? `&year=${film.year}` : '';
    const r = await fetch(
      `https://api.themoviedb.org/3/search/movie?query=${q}${yr}&page=1`,
      { headers: { Authorization: `Bearer ${BEARER}` } }
    );
    const data = await r.json();
    const match = (data.results || [])[0];
    if (!match) { TMDB_CACHE[key] = null; return null; }

    // Get full details
    const det = await fetch(
      `https://api.themoviedb.org/3/movie/${match.id}`,
      { headers: { Authorization: `Bearer ${BEARER}` } }
    );
    const full = await det.json();
    const result = {
      id: full.id,
      poster: full.poster_path,
      backdrop: full.backdrop_path,
      overview: full.overview,
      tmdbRating: full.vote_average ? parseFloat(full.vote_average.toFixed(1)) : null,
      genres: (full.genres || []).map(g => g.name),
      runtime: full.runtime
    };
    TMDB_CACHE[key] = result;
    // Persist every 20 entries
    if (Object.keys(TMDB_CACHE).length % 20 === 0) {
      try { localStorage.setItem('tmdb_cache', JSON.stringify(TMDB_CACHE)); } catch(e) {}
    }
    return result;
  } catch(e) { return null; }
}

/* =============================================
   POSTER MOSAIC (hero)
   ============================================= */
async function renderMosaic() {
  const mosaic = document.getElementById('posterMosaic');
  // Pick 25 films — mix of 5-star and recent
  const fives = DIARY.filter(f => f.rating === 5);
  const others = DIARY.filter(f => f.rating >= 3.5 && f.rating < 5);
  const pool = [...fives, ...others].slice(0, 25);
  
  mosaic.innerHTML = pool.map((f, i) => `
    <div class="mosaic-poster ${f.rating === 5 ? 'five-star' : ''}" 
         id="mosaic-${i}" 
         onclick="openModal(${JSON.stringify(f).replace(/"/g, '&quot;')})">
      <div class="no-img">${f.name.slice(0, 20)}</div>
    </div>
  `).join('');

  // Enrich with posters
  for (let i = 0; i < pool.length; i++) {
    const tmdb = await fetchTMDB(pool[i]);
    const el = document.getElementById(`mosaic-${i}`);
    if (el && tmdb?.poster) {
      el.innerHTML = `<img src="${IMG}w200${tmdb.poster}" alt="${pool[i].name}" loading="lazy" />`;
    }
  }
}

/* =============================================
   RECENT WATCHES
   ============================================= */
async function renderRecent() {
  const grid = document.getElementById('recentGrid');
  const recent = DIARY.slice(0, 18);
  grid.innerHTML = recent.map((f, i) => `
    <div class="film-card" id="rc-${i}" onclick='openModal(${JSON.stringify(f)})'>
      <div class="film-card-poster blank" id="rcp-${i}">${f.name.slice(0,30)}</div>
      <div class="film-card-info">
        <div class="film-card-title">${f.name}</div>
        <div class="film-card-meta">${f.year || '—'}</div>
        <div class="film-card-stars">${starsStr(f.rating)}</div>
      </div>
    </div>
  `).join('');

  for (let i = 0; i < recent.length; i++) {
    const tmdb = await fetchTMDB(recent[i]);
    const pEl = document.getElementById(`rcp-${i}`);
    if (pEl && tmdb?.poster) {
      pEl.className = 'film-card-poster';
      pEl.innerHTML = `<img src="${IMG}w200${tmdb.poster}" alt="${recent[i].name}" loading="lazy" />`;
    }
  }
}

/* =============================================
   FIVE STAR LIST
   ============================================= */
async function renderFiveStars() {
  const list = document.getElementById('fiveStarList');
  const fives = DIARY.filter(f => f.rating === 5);
  list.innerHTML = fives.map((f, i) => `
    <div class="five-star-row" onclick='openModal(${JSON.stringify(f)})'>
      <span class="fsr-num">${String(i+1).padStart(2,'0')}</span>
      <img class="fsr-thumb" id="fst-${i}" src="" alt="${f.name}" />
      <span class="fsr-title">${f.name}</span>
      <span class="fsr-year">${f.year || '—'}</span>
      <span class="fsr-stars">★★★★★</span>
    </div>
  `).join('');

  for (let i = 0; i < fives.length; i++) {
    const tmdb = await fetchTMDB(fives[i]);
    const el = document.getElementById(`fst-${i}`);
    if (el && tmdb?.poster) {
      el.src = `${IMG}w92${tmdb.poster}`;
    } else if (el) {
      el.style.display = 'none';
    }
  }
}

/* =============================================
   POSTER WALL
   ============================================= */
function renderWall() {
  wallFiltered = [...DIARY];
  drawWall();
  // Lazy-load posters as we render
  enrichWall();
}

function filterWall() {
  const q = document.getElementById('wallSearch').value.toLowerCase();
  const sort = document.getElementById('wallSort').value;
  const ratingF = document.getElementById('wallRatingFilter').value;

  wallFiltered = DIARY.filter(f => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (ratingF === '5' && f.rating !== 5) return false;
    if (ratingF === '4' && f.rating < 4) return false;
    if (ratingF === '3' && f.rating < 3) return false;
    if (ratingF === 'unrated' && f.rating !== 0.5) return false;
    return true;
  });

  wallFiltered.sort((a, b) => {
    if (sort === 'date-desc') return b.watchedDate.localeCompare(a.watchedDate);
    if (sort === 'date-asc')  return a.watchedDate.localeCompare(b.watchedDate);
    if (sort === 'rating-desc') return b.rating - a.rating;
    if (sort === 'rating-asc')  return a.rating - b.rating;
    if (sort === 'year-desc') return (b.year||0) - (a.year||0);
    if (sort === 'year-asc')  return (a.year||0) - (b.year||0);
    return 0;
  });

  drawWall();
  enrichWall();
}

function drawWall() {
  document.getElementById('wallCount').textContent = `${wallFiltered.length} films`;
  const grid = document.getElementById('wallGrid');
  grid.innerHTML = wallFiltered.map((f, i) => {
    const cacheKey = `${f.name}|${f.year}`;
    const cached = TMDB_CACHE[cacheKey];
    const posterSrc = cached?.poster ? `${IMG}w200${cached.poster}` : null;
    const rStr = f.rating >= 1 ? f.rating.toString() : '0.5';
    return `
      <div class="wall-card ${posterSrc ? '' : 'no-poster'}" 
           data-rating="${rStr}"
           data-idx="${i}"
           onclick='openModal(${JSON.stringify(f)})'>
        ${posterSrc
          ? `<img src="${posterSrc}" alt="${f.name}" loading="lazy" />`
          : escapeHtml(f.name.slice(0, 30))}
        <div class="wall-card-overlay">
          <div class="wall-card-overlay-title">${escapeHtml(f.name)}</div>
          <div class="wall-card-overlay-stars">${starsStr(f.rating)}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function enrichWall() {
  // Only enrich visible / first 80 for performance
  const cards = document.querySelectorAll('.wall-card.no-poster');
  const toEnrich = Array.from(cards).slice(0, 80);
  for (const card of toEnrich) {
    const idx = parseInt(card.dataset.idx);
    const film = wallFiltered[idx];
    if (!film) continue;
    const tmdb = await fetchTMDB(film);
    if (tmdb?.poster && card.isConnected) {
      card.classList.remove('no-poster');
      card.innerHTML = `
        <img src="${IMG}w200${tmdb.poster}" alt="${film.name}" loading="lazy" />
        <div class="wall-card-overlay">
          <div class="wall-card-overlay-title">${escapeHtml(film.name)}</div>
          <div class="wall-card-overlay-stars">${starsStr(film.rating)}</div>
        </div>
      `;
    }
  }
}

/* =============================================
   STATS
   ============================================= */
function renderStats() {
  renderTimeline();
  renderRatingDist();
  renderDecades();
  renderMonths();
}

function renderTimeline() {
  const byMonth = {};
  DIARY.forEach(f => {
    const ym = f.watchedDate.slice(0, 7);
    byMonth[ym] = (byMonth[ym] || 0) + 1;
  });
  const months = Object.keys(byMonth).sort();
  const max = Math.max(...Object.values(byMonth));

  document.getElementById('chartTimeline').innerHTML = `
    <div class="bar-chart">
      ${months.map(m => `
        <div class="bar-row">
          <div class="bar-label">${m}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(byMonth[m]/max*100).toFixed(1)}%"></div>
          </div>
          <div class="bar-val">${byMonth[m]}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRatingDist() {
  const rated = DIARY.filter(f => f.rating >= 1);
  const counts = {};
  [1,1.5,2,2.5,3,3.5,4,4.5,5].forEach(r => counts[r] = 0);
  rated.forEach(f => { counts[f.rating] = (counts[f.rating] || 0) + 1; });
  const max = Math.max(...Object.values(counts));

  document.getElementById('chartRatings').innerHTML = `
    <div class="bar-chart">
      ${Object.entries(counts).map(([r, c]) => `
        <div class="bar-row">
          <div class="bar-label short">${starsStr(parseFloat(r))}</div>
          <div class="bar-track">
            <div class="bar-fill ${parseFloat(r) >= 4 ? '' : 'accent'}" style="width:${max ? (c/max*100).toFixed(1) : 0}%"></div>
          </div>
          <div class="bar-val">${c}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDecades() {
  const byDecade = {};
  DIARY.forEach(f => {
    if (!f.year) return;
    const dec = Math.floor(f.year / 10) * 10;
    byDecade[dec] = (byDecade[dec] || 0) + 1;
  });
  const decades = Object.keys(byDecade).sort();
  const max = Math.max(...Object.values(byDecade));

  document.getElementById('chartDecades').innerHTML = `
    <div class="bar-chart">
      ${decades.map(d => `
        <div class="bar-row">
          <div class="bar-label">${d}s</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(byDecade[d]/max*100).toFixed(1)}%"></div>
          </div>
          <div class="bar-val">${byDecade[d]}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMonths() {
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const byMonth = new Array(12).fill(0);
  DIARY.forEach(f => {
    const m = parseInt(f.watchedDate.slice(5, 7)) - 1;
    byMonth[m]++;
  });
  const max = Math.max(...byMonth);

  document.getElementById('chartMonths').innerHTML = `
    <div class="bar-chart">
      ${byMonth.map((c, i) => `
        <div class="bar-row">
          <div class="bar-label short">${names[i]}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${max ? (c/max*100).toFixed(1) : 0}%"></div>
          </div>
          <div class="bar-val">${c}</div>
        </div>
      `).join('')}
    </div>
  `;
}

/* =============================================
   MODAL
   ============================================= */
async function openModal(film) {
  const overlay = document.getElementById('modalOverlay');
  const inner = document.getElementById('modalInner');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Skeleton
  inner.innerHTML = `
    <div style="height:180px;background:var(--surface2);border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:center;">
      <div class="spinner"></div>
    </div>
    <div class="modal-body">
      <div class="modal-poster blank"></div>
      <div class="modal-info">
        <div class="modal-title">${escapeHtml(film.name)}</div>
        <div class="modal-year">${film.year || '—'}</div>
        <div class="modal-rating-row"><span class="modal-stars">${starsStr(film.rating)}</span></div>
        <div class="modal-overview" style="color:var(--muted)">Loading details…</div>
      </div>
    </div>
  `;

  const tmdb = await fetchTMDB(film);

  const myStars = film.rating >= 1 ? film.rating * 2 : null; // out of 10
  let diffBadge = '';
  if (myStars && tmdb?.tmdbRating) {
    const d = myStars - tmdb.tmdbRating;
    if (d > 1) diffBadge = `<span class="diff-badge diff-pos">+${d.toFixed(1)} vs crowd</span>`;
    else if (d < -1) diffBadge = `<span class="diff-badge diff-neg">${d.toFixed(1)} vs crowd</span>`;
    else diffBadge = `<span class="diff-badge diff-neu">inline with crowd</span>`;
  }

  const backdropSrc = tmdb?.backdrop ? `${IMG}w780${tmdb.backdrop}` : null;
  const posterSrc   = tmdb?.poster   ? `${IMG}w200${tmdb.poster}`   : null;

  inner.innerHTML = `
    ${backdropSrc
      ? `<img class="modal-backdrop" src="${backdropSrc}" alt="" />`
      : `<div style="height:120px;background:var(--surface2);border-radius:12px 12px 0 0;"></div>`}
    <div class="modal-body">
      <div class="modal-poster ${posterSrc ? '' : 'blank'}">
        ${posterSrc ? `<img src="${posterSrc}" alt="${escapeHtml(film.name)}" />` : '🎬'}
      </div>
      <div class="modal-info">
        <div class="modal-title">${escapeHtml(film.name)}</div>
        <div class="modal-year">${film.year || '—'}${tmdb?.runtime ? ` · ${tmdb.runtime}min` : ''}</div>
        <div class="modal-rating-row">
          <span class="modal-stars">${starsStr(film.rating)}</span>
          ${tmdb?.tmdbRating ? `<span class="modal-vs">TMDB ${tmdb.tmdbRating}/10</span>` : ''}
          ${diffBadge}
        </div>
        ${tmdb?.genres?.length ? `<div class="modal-genres">${tmdb.genres.map(g => `<span class="genre-pill">${g}</span>`).join('')}</div>` : ''}
        <div class="modal-overview">${tmdb?.overview || 'No overview available.'}</div>
        <div class="modal-links">
          ${film.letterboxd ? `<a href="${film.letterboxd}" target="_blank" rel="noopener">View on Letterboxd →</a>` : ''}
        </div>
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* =============================================
   HELPERS
   ============================================= */
function starsStr(rating) {
  if (rating === 0.5) return '<span style="color:var(--muted)">–</span>';
  const full = Math.floor(rating);
  const half = rating % 1 !== 0;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
