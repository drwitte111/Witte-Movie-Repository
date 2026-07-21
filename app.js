/* =============================================
   STATE
   ============================================= */
let DIARY  = [];
let BEARER = localStorage.getItem('tmdb_token') || '';
let TMDB_CACHE = {};
let wallFiltered = [];

const IMG = 'https://image.tmdb.org/t/p/';

try {
  TMDB_CACHE = JSON.parse(localStorage.getItem('tmdb_cache') || '{}');
} catch(e) { TMDB_CACHE = {}; }

/* =============================================
   INIT
   ============================================= */
document.addEventListener('DOMContentLoaded', () => {

  // Token UI
  if (BEARER) markTokenConnected();
  document.getElementById('tokenSave').addEventListener('click', handleTokenSave);

  // Nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // CSV input
  document.getElementById('csvInput').addEventListener('change', handleCsvUpload);

  // Clear data button
  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (!confirm('Clear your saved diary and start over?')) return;
    localStorage.removeItem('diary_data');
    localStorage.removeItem('tmdb_cache');
    DIARY = [];
    TMDB_CACHE = {};
    showUploadScreen();
  });

  // Check for saved diary
  const saved = localStorage.getItem('diary_data');
  if (saved) {
    try {
      DIARY = JSON.parse(saved);
      showApp();
    } catch(e) {
      localStorage.removeItem('diary_data');
      showUploadScreen();
    }
  } else {
    showUploadScreen();
  }
});

/* =============================================
   UPLOAD / CSV PARSE
   ============================================= */
function showUploadScreen() {
  document.getElementById('uploadScreen').style.display = 'flex';
  document.getElementById('viewHome').style.display = 'none';
  document.getElementById('viewWall').style.display = 'none';
  document.getElementById('viewStats').style.display = 'none';
}

function handleCsvUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const records = parseLetterboxdCsv(evt.target.result);
      if (!records.length) throw new Error('No films found in this export');
      DIARY = records;
      localStorage.setItem('diary_data', JSON.stringify(DIARY));
      showApp();
    } catch(err) {
      const box = document.querySelector('.upload-box');
      const existing = box.querySelector('.upload-error');
      if (existing) existing.remove();
      const msg = document.createElement('p');
      msg.className = 'upload-error';
      msg.textContent = 'Could not read file: ' + err.message;
      box.appendChild(msg);
    }
  };
  reader.readAsText(file);
}

function parseLetterboxdCsv(text) {
  const lines = text.split('\n');
  if (!lines.length) return [];

  // Parse header
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  const idx = {
    name:        header.indexOf('Name'),
    year:        header.indexOf('Year'),
    rating:      header.indexOf('Rating'),
    watchedDate: header.indexOf('Watched Date'),
    letterboxd:  header.indexOf('Letterboxd URI'),
  };

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);

    const ratingRaw = parseFloat(cols[idx.rating]);
    const rating = isNaN(ratingRaw) ? null : ratingRaw;

    // Only include watched: 0.5 (seen/unrated) or 1-5 (rated)
    if (rating === null) continue;

    const yearRaw = parseInt(cols[idx.year]);
    records.push({
      name:        (cols[idx.name] || '').trim(),
      year:        isNaN(yearRaw) ? null : yearRaw,
      rating:      rating,
      watchedDate: (cols[idx.watchedDate] || '').trim(),
      letterboxd:  (cols[idx.letterboxd] || '').trim() || null,
    });
  }

  // Sort newest watched first
  records.sort((a, b) => b.watchedDate.localeCompare(a.watchedDate));
  return records;
}

function parseCsvLine(line) {
  // Handles quoted fields with commas inside
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/* =============================================
   SHOW APP
   ============================================= */
function showApp() {
  document.getElementById('uploadScreen').style.display = 'none';
  document.getElementById('clearDataBtn').style.display = 'inline-block';

  // Activate home view
  document.getElementById('viewHome').style.display = 'block';
  document.querySelector('[data-view="home"]').classList.add('active');

  // Hero stats
  const rated = DIARY.filter(f => f.rating >= 1);
  const avg   = rated.length ? rated.reduce((s, f) => s + f.rating, 0) / rated.length : 0;
  const fives = rated.filter(f => f.rating === 5);

  document.getElementById('heroTotal').textContent = DIARY.length;
  document.getElementById('heroRated').textContent = rated.length;
  document.getElementById('heroAvg').textContent   = avg.toFixed(2);
  document.getElementById('heroFives').textContent  = fives.length;

  // Date range for desc
  const dates = DIARY.map(f => f.watchedDate).filter(Boolean).sort();
  const fromYear = dates[dates.length - 1]?.slice(0, 4);
  const toYear   = dates[0]?.slice(0, 4);
  const yearRange = fromYear === toYear ? fromYear : `${fromYear}–${toYear}`;
  document.getElementById('heroDesc').textContent =
    `${DIARY.length} films purchased across ${yearRange}. Logged on Letterboxd, enriched with TMDB.`;

  renderMosaic();
  renderRecent();
  renderFiveStars();
  renderStats();

  // Init web explorer and game (defined in web.js)
  if (typeof initWebExplorer === 'function') initWebExplorer();
  if (typeof initGame        === 'function') initGame();
}

/* =============================================
   TOKEN
   ============================================= */
function handleTokenSave() {
  const val = document.getElementById('tokenInput').value.trim();
  if (!val || val.startsWith('•')) return;
  BEARER = val;
  localStorage.setItem('tmdb_token', BEARER);
  markTokenConnected();
  TMDB_CACHE = {};
  localStorage.removeItem('tmdb_cache');
  if (DIARY.length) {
    renderMosaic();
    renderRecent();
    renderFiveStars();
    if (document.getElementById('viewWall').style.display !== 'none') renderWall();
  }
}

function markTokenConnected() {
  const inp = document.getElementById('tokenInput');
  inp.value = '••••••••••••••••••';
  inp.classList.add('connected');
  const btn = document.getElementById('tokenSave');
  btn.textContent = 'Connected';
  btn.classList.add('connected');
}

/* =============================================
   VIEWS
   ============================================= */
function switchView(view) {
  ['home','wall','stats','web','game'].forEach(v => {
    const el = document.getElementById('view' + v.charAt(0).toUpperCase() + v.slice(1));
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  window.scrollTo(0, 0);
  if (view === 'wall') renderWall();
}

/* =============================================
   TMDB FETCH
   ============================================= */
async function fetchTMDB(film) {
  const key = `${film.name}|${film.year}`;
  if (key in TMDB_CACHE) return TMDB_CACHE[key];
  if (!BEARER) return null;

  try {
    const q  = encodeURIComponent(film.name);
    const yr = film.year ? `&year=${film.year}` : '';
    const r  = await fetch(
      `https://api.themoviedb.org/3/search/movie?query=${q}${yr}&page=1`,
      { headers: { Authorization: `Bearer ${BEARER}` } }
    );
    const data  = await r.json();
    const match = (data.results || [])[0];
    if (!match) { TMDB_CACHE[key] = null; return null; }

    const det  = await fetch(`https://api.themoviedb.org/3/movie/${match.id}`,
      { headers: { Authorization: `Bearer ${BEARER}` } });
    const full = await det.json();

    const result = {
      id:         full.id,
      poster:     full.poster_path,
      backdrop:   full.backdrop_path,
      overview:   full.overview,
      tmdbRating: full.vote_average ? parseFloat(full.vote_average.toFixed(1)) : null,
      genres:     (full.genres || []).map(g => g.name),
      runtime:    full.runtime,
    };
    TMDB_CACHE[key] = result;
    if (Object.keys(TMDB_CACHE).length % 20 === 0) {
      try { localStorage.setItem('tmdb_cache', JSON.stringify(TMDB_CACHE)); } catch(e) {}
    }
    return result;
  } catch(e) { return null; }
}

/* =============================================
   POSTER MOSAIC
   ============================================= */
async function renderMosaic() {
  const mosaic = document.getElementById('posterMosaic');
  const fives  = DIARY.filter(f => f.rating === 5);
  const others = DIARY.filter(f => f.rating >= 3.5 && f.rating < 5);
  const pool   = [...fives, ...others].slice(0, 25);

  mosaic.innerHTML = pool.map((f, i) => `
    <div class="mosaic-poster ${f.rating === 5 ? 'five-star' : ''}"
         id="mosaic-${i}"
         onclick='openModal(${safeJson(f)})'>
      <div class="no-img">${escapeHtml(f.name.slice(0, 20))}</div>
    </div>
  `).join('');

  for (let i = 0; i < pool.length; i++) {
    const tmdb = await fetchTMDB(pool[i]);
    const el   = document.getElementById(`mosaic-${i}`);
    if (el && tmdb?.poster) {
      el.innerHTML = `<img src="${IMG}w200${tmdb.poster}" alt="${escapeHtml(pool[i].name)}" loading="lazy" />`;
    }
  }
}

/* =============================================
   RECENT WATCHES
   ============================================= */
async function renderRecent() {
  const grid   = document.getElementById('recentGrid');
  const recent = DIARY.slice(0, 18);

  grid.innerHTML = recent.map((f, i) => `
    <div class="film-card" onclick='openModal(${safeJson(f)})'>
      <div class="film-card-poster blank" id="rcp-${i}">${escapeHtml(f.name.slice(0, 30))}</div>
      <div class="film-card-info">
        <div class="film-card-title">${escapeHtml(f.name)}</div>
        <div class="film-card-meta">${f.year || '—'}</div>
        <div class="film-card-stars">${starsStr(f.rating)}</div>
      </div>
    </div>
  `).join('');

  for (let i = 0; i < recent.length; i++) {
    const tmdb = await fetchTMDB(recent[i]);
    const el   = document.getElementById(`rcp-${i}`);
    if (el && tmdb?.poster) {
      el.className = 'film-card-poster';
      el.innerHTML = `<img src="${IMG}w200${tmdb.poster}" alt="${escapeHtml(recent[i].name)}" loading="lazy" />`;
    }
  }
}

/* =============================================
   FIVE STAR LIST
   ============================================= */
async function renderFiveStars() {
  const list  = document.getElementById('fiveStarList');
  const fives = DIARY.filter(f => f.rating === 5);

  list.innerHTML = fives.map((f, i) => `
    <div class="five-star-row" onclick='openModal(${safeJson(f)})'>
      <span class="fsr-num">${String(i + 1).padStart(2, '0')}</span>
      <img class="fsr-thumb" id="fst-${i}" src="" alt="${escapeHtml(f.name)}" />
      <span class="fsr-title">${escapeHtml(f.name)}</span>
      <span class="fsr-year">${f.year || '—'}</span>
      <span class="fsr-stars">★★★★★</span>
    </div>
  `).join('');

  for (let i = 0; i < fives.length; i++) {
    const tmdb = await fetchTMDB(fives[i]);
    const el   = document.getElementById(`fst-${i}`);
    if (el && tmdb?.poster) el.src = `${IMG}w92${tmdb.poster}`;
    else if (el) el.style.display = 'none';
  }
}

/* =============================================
   POSTER WALL
   ============================================= */
function renderWall() {
  wallFiltered = [...DIARY];
  drawWall();
  enrichWall();
}

function filterWall() {
  const q       = document.getElementById('wallSearch').value.toLowerCase();
  const sort    = document.getElementById('wallSort').value;
  const ratingF = document.getElementById('wallRatingFilter').value;

  wallFiltered = DIARY.filter(f => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (ratingF === '5'       && f.rating !== 5)  return false;
    if (ratingF === '4'       && f.rating < 4)    return false;
    if (ratingF === '3'       && f.rating < 3)    return false;
    if (ratingF === 'unrated' && f.rating !== 0.5) return false;
    return true;
  });

  wallFiltered.sort((a, b) => {
    if (sort === 'date-desc')   return b.watchedDate.localeCompare(a.watchedDate);
    if (sort === 'date-asc')    return a.watchedDate.localeCompare(b.watchedDate);
    if (sort === 'rating-desc') return b.rating - a.rating;
    if (sort === 'rating-asc')  return a.rating - b.rating;
    if (sort === 'year-desc')   return (b.year || 0) - (a.year || 0);
    if (sort === 'year-asc')    return (a.year || 0) - (b.year || 0);
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
    const cached   = TMDB_CACHE[cacheKey];
    const posterSrc = cached?.poster ? `${IMG}w200${cached.poster}` : null;
    const rStr = f.rating >= 1 ? f.rating.toString() : '0.5';

    return `
      <div class="wall-card ${posterSrc ? '' : 'no-poster'}"
           data-rating="${rStr}"
           data-idx="${i}"
           onclick='openModal(${safeJson(f)})'>
        ${posterSrc
          ? `<img src="${posterSrc}" alt="${escapeHtml(f.name)}" loading="lazy" />`
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
  const cards    = document.querySelectorAll('.wall-card.no-poster');
  const toEnrich = Array.from(cards).slice(0, 80);
  for (const card of toEnrich) {
    const idx  = parseInt(card.dataset.idx);
    const film = wallFiltered[idx];
    if (!film) continue;
    const tmdb = await fetchTMDB(film);
    if (tmdb?.poster && card.isConnected) {
      card.classList.remove('no-poster');
      card.innerHTML = `
        <img src="${IMG}w200${tmdb.poster}" alt="${escapeHtml(film.name)}" loading="lazy" />
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
    if (ym) byMonth[ym] = (byMonth[ym] || 0) + 1;
  });
  const months = Object.keys(byMonth).sort();
  const max    = Math.max(...Object.values(byMonth));

  document.getElementById('chartTimeline').innerHTML = `
    <div class="bar-chart">
      ${months.map(m => `
        <div class="bar-row">
          <div class="bar-label">${m}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(byMonth[m]/max*100).toFixed(1)}%"></div></div>
          <div class="bar-val">${byMonth[m]}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRatingDist() {
  const rated  = DIARY.filter(f => f.rating >= 1);
  const counts = {};
  [1,1.5,2,2.5,3,3.5,4,4.5,5].forEach(r => counts[r] = 0);
  rated.forEach(f => { counts[f.rating] = (counts[f.rating] || 0) + 1; });
  const max = Math.max(...Object.values(counts));

  document.getElementById('chartRatings').innerHTML = `
    <div class="bar-chart">
      ${Object.entries(counts).map(([r, c]) => `
        <div class="bar-row">
          <div class="bar-label short">${starsStr(parseFloat(r))}</div>
          <div class="bar-track"><div class="bar-fill ${parseFloat(r) >= 4 ? '' : 'accent'}" style="width:${max ? (c/max*100).toFixed(1) : 0}%"></div></div>
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
  const max     = Math.max(...Object.values(byDecade));

  document.getElementById('chartDecades').innerHTML = `
    <div class="bar-chart">
      ${decades.map(d => `
        <div class="bar-row">
          <div class="bar-label">${d}s</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(byDecade[d]/max*100).toFixed(1)}%"></div></div>
          <div class="bar-val">${byDecade[d]}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMonths() {
  const names   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const byMonth = new Array(12).fill(0);
  DIARY.forEach(f => {
    const m = parseInt(f.watchedDate.slice(5, 7)) - 1;
    if (!isNaN(m)) byMonth[m]++;
  });
  const max = Math.max(...byMonth);

  document.getElementById('chartMonths').innerHTML = `
    <div class="bar-chart">
      ${byMonth.map((c, i) => `
        <div class="bar-row">
          <div class="bar-label short">${names[i]}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${max ? (c/max*100).toFixed(1) : 0}%"></div></div>
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
  const inner   = document.getElementById('modalInner');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

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

  const myStars = film.rating >= 1 ? film.rating * 2 : null;
  let diffBadge = '';
  if (myStars && tmdb?.tmdbRating) {
    const d = myStars - tmdb.tmdbRating;
    if (d > 1)       diffBadge = `<span class="diff-badge diff-pos">+${d.toFixed(1)} vs crowd</span>`;
    else if (d < -1) diffBadge = `<span class="diff-badge diff-neg">${d.toFixed(1)} vs crowd</span>`;
    else             diffBadge = `<span class="diff-badge diff-neu">inline with crowd</span>`;
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
        ${tmdb?.genres?.length ? `<div class="modal-genres">${tmdb.genres.map(g => `<span class="genre-pill">${escapeHtml(g)}</span>`).join('')}</div>` : ''}
        <div class="modal-overview">${escapeHtml(tmdb?.overview || 'No overview available.')}</div>
        <div class="modal-links">
          ${film.letterboxd ? `<a href="${escapeHtml(film.letterboxd)}" target="_blank" rel="noopener">View on Letterboxd →</a>` : ''}
        </div>
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeJson(obj) {
  return JSON.stringify(obj).replace(/'/g, '&#39;');
}
