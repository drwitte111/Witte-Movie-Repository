/* =============================================
   STATE
   ============================================= */
const IMG       = 'https://image.tmdb.org/t/p/';
const TMDB_API  = 'https://api.themoviedb.org/3';
const DIARY_URL = 'diary.csv';

const LS = {
  token:   'tmdb_token',
  diary:   'diary_data',
  tmdb:    'tmdb_cache',
  credits: 'tmdb_credits',
};

let DIARY   = [];   // every logged film (the whole collection)
let WATCHED = [];   // films with a rating: 0.5 = seen/unrated, 1–5 = rated
let FILM_BY_ID = new Map();
let BEARER  = localStorage.getItem(LS.token) || '';

const TMDB_CACHE    = loadJson(LS.tmdb);
const CREDITS_CACHE = loadJson(LS.credits);
const INFLIGHT      = new Map();

// Merge pre-built cache from cache.js if available
if (typeof TMDB_PRECACHE !== 'undefined') {
  for (const key in TMDB_PRECACHE) {
    if (!(key in TMDB_CACHE)) TMDB_CACHE[key] = TMDB_PRECACHE[key];
  }
}

/* =============================================
   INIT
   ============================================= */
document.addEventListener('DOMContentLoaded', async () => {
  if (BEARER) markTokenConnected();
  document.getElementById('tokenSave').addEventListener('click', handleTokenSave);

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('csvInput').addEventListener('change', handleCsvUpload);
  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (!confirm('Clear your saved diary and start over?')) return;
    localStorage.removeItem(LS.diary);
    location.reload();
  });

  // Any element with data-film opens that film's modal
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-film]');
    if (el && FILM_BY_ID.has(el.dataset.film)) openModal(FILM_BY_ID.get(el.dataset.film));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Prefer the diary.csv published with the site, then a previously uploaded export
  const csv = await fetchRepoDiary();
  if (csv) {
    setDiary(parseLetterboxdCsv(csv));
    return showApp();
  }

  const saved = localStorage.getItem(LS.diary);
  if (saved) {
    try {
      setDiary(JSON.parse(saved));
      return showApp();
    } catch (e) {
      localStorage.removeItem(LS.diary);
    }
  }
  showUploadScreen();
});

// Offline support + "Add to Home Screen" app (needs https or localhost)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

async function fetchRepoDiary() {
  try {
    const r = await fetch(DIARY_URL, { cache: 'no-cache' });
    if (!r.ok) return null;
    const text = await r.text();
    return text.startsWith('Date,') ? text : null;
  } catch (e) {
    return null;   // e.g. opened via file://
  }
}

function setDiary(records) {
  DIARY = records.map((f, i) => ({ ...f, id: f.id || String(i) }));
  WATCHED = DIARY.filter(isWatched);
  FILM_BY_ID = new Map(DIARY.map(f => [f.id, f]));
}

/* =============================================
   UPLOAD / CSV PARSE
   ============================================= */
function showUploadScreen() {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('uploadScreen').style.display = 'flex';
  if (localStorage.getItem(LS.diary)) {
    document.getElementById('clearDataBtn').style.display = 'inline-block';
  }
}

function handleCsvUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const records = parseLetterboxdCsv(evt.target.result);
      if (!records.length) throw new Error('No films found in this export');
      setDiary(records);
      localStorage.setItem(LS.diary, JSON.stringify(DIARY));
      showApp();
    } catch (err) {
      const box = document.querySelector('.upload-box');
      box.querySelector('.upload-error')?.remove();
      const msg = document.createElement('p');
      msg.className = 'upload-error';
      msg.textContent = 'Could not read file: ' + err.message;
      box.appendChild(msg);
    }
  };
  reader.readAsText(file);
}

function parseLetterboxdCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) return [];

  const header = rows[0].map(h => h.trim());
  const col = name => header.indexOf(name);
  const idx = {
    date:        col('Date'),
    name:        col('Name'),
    year:        col('Year'),
    rating:      col('Rating'),
    watchedDate: col('Watched Date'),
    letterboxd:  col('Letterboxd URI'),
  };
  if (idx.name < 0) throw new Error('Missing "Name" column — is this a Letterboxd diary export?');

  const get = (cols, i) => (i >= 0 ? (cols[i] || '').trim() : '');

  const records = [];
  rows.slice(1).forEach((cols, row) => {
    const name = get(cols, idx.name);
    if (!name) return;
    const rating = parseFloat(get(cols, idx.rating));
    const year   = parseInt(get(cols, idx.year), 10);
    records.push({
      row,
      name,
      year:        isNaN(year) ? null : year,
      rating:      isNaN(rating) ? null : rating,
      loggedDate:  get(cols, idx.date),
      watchedDate: get(cols, idx.watchedDate) || get(cols, idx.date),
      letterboxd:  get(cols, idx.letterboxd) || null,
    });
  });

  // Newest first; entries logged on the same day keep their latest-logged-first order
  records.sort((a, b) => b.watchedDate.localeCompare(a.watchedDate) || b.row - a.row);
  return records;
}

// RFC 4180 parser: quoted fields may contain commas, quotes and newlines
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

/* =============================================
   SHOW APP
   ============================================= */
function showApp() {
  document.getElementById('uploadScreen').style.display = 'none';
  switchView('home');

  const rated  = WATCHED.filter(f => f.rating >= 1);
  const avg    = rated.length ? rated.reduce((s, f) => s + f.rating, 0) / rated.length : 0;
  const fives  = rated.filter(f => f.rating === 5);

  setText('heroTotal',   DIARY.length);
  setText('heroWatched', WATCHED.length);
  setText('heroRated',   rated.length);
  setText('heroAvg',     avg.toFixed(2));
  setText('heroFives',   fives.length);

  const years = DIARY.map(f => f.watchedDate.slice(0, 4)).filter(Boolean).sort();
  const first = years[0], last = years[years.length - 1];
  const range = first === last ? first : `${first}–${last}`;
  const backlog = DIARY.length - WATCHED.length;
  setText('heroDesc',
    `${DIARY.length} films collected across ${range}, ${backlog} still waiting to be watched. ` +
    `Logged on Letterboxd, enriched with TMDB.`);

  renderHome();
  renderStats();

  // Defined in web.js
  if (typeof initWebExplorer === 'function') initWebExplorer();
  if (typeof initGame        === 'function') initGame();
}

function renderHome() {
  renderMosaic();
  renderRecent();
  renderFiveStars();
}

/* =============================================
   TOKEN
   ============================================= */
function handleTokenSave() {
  const val = document.getElementById('tokenInput').value.trim();
  if (!val || val.startsWith('•')) return;
  BEARER = val;
  localStorage.setItem(LS.token, BEARER);
  markTokenConnected();

  // Forget lookups that failed without a token so they are retried
  for (const k in TMDB_CACHE) if (TMDB_CACHE[k] === null) delete TMDB_CACHE[k];

  if (DIARY.length) {
    renderHome();
    if (isVisible('viewWall')) filterWall();
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
const VIEWS = ['home', 'wall', 'stats', 'web', 'game'];

function switchView(view) {
  VIEWS.forEach(v => {
    const el = document.getElementById(viewId(v));
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  window.scrollTo(0, 0);
  if (view === 'wall')  filterWall();
  if (view === 'stats') renderGenres();
}

const viewId    = v  => 'view' + v.charAt(0).toUpperCase() + v.slice(1);
const isVisible = id => document.getElementById(id).style.display !== 'none';

/* =============================================
   TMDB FETCH
   ============================================= */
async function tmdbGet(path) {
  const r = await fetch(`${TMDB_API}${path}`, { headers: { Authorization: `Bearer ${BEARER}` } });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

// Runs fn once per key at a time; concurrent callers share the same promise
function once(key, fn) {
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = fn().finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}

async function fetchTMDB(film) {
  const key = filmKey(film);
  if (key in TMDB_CACHE) return TMDB_CACHE[key];
  if (!BEARER) return null;

  return once('movie:' + key, async () => {
    try {
      const q    = encodeURIComponent(film.name);
      const yr   = film.year ? `&year=${film.year}` : '';
      const data = await tmdbGet(`/search/movie?query=${q}${yr}&page=1`);
      const match = (data.results || [])[0];
      if (!match) return cacheSet(TMDB_CACHE, LS.tmdb, key, null);

      const full = await tmdbGet(`/movie/${match.id}`);
      return cacheSet(TMDB_CACHE, LS.tmdb, key, {
        id:         full.id,
        poster:     full.poster_path,
        backdrop:   full.backdrop_path,
        overview:   full.overview,
        tmdbRating: full.vote_average ? parseFloat(full.vote_average.toFixed(1)) : null,
        genres:     (full.genres || []).map(g => g.name),
        runtime:    full.runtime,
      });
    } catch (e) { return null; }
  });
}

async function fetchCredits(film) {
  const key = filmKey(film);
  if (key in CREDITS_CACHE) return CREDITS_CACHE[key];
  if (!BEARER) return null;

  return once('credits:' + key, async () => {
    try {
      const tmdb = await fetchTMDB(film);
      if (!tmdb?.id) return null;
      const data = await tmdbGet(`/movie/${tmdb.id}/credits`);
      const crew = data.crew || [];
      return cacheSet(CREDITS_CACHE, LS.credits, key, {
        cast:     (data.cast || []).slice(0, 10).map(p => p.name),
        director: crew.filter(p => p.job === 'Director').map(p => p.name),
        writer:   crew.filter(p => ['Writer', 'Screenplay', 'Story'].includes(p.job)).slice(0, 3).map(p => p.name),
      });
    } catch (e) { return null; }
  });
}

/* =============================================
   PERSISTENT CACHES
   ============================================= */
const pendingSaves = new Map();

function cacheSet(cache, storageKey, key, value) {
  cache[key] = value;
  // Debounce writes so a burst of lookups costs one localStorage write
  clearTimeout(pendingSaves.get(storageKey));
  pendingSaves.set(storageKey, setTimeout(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(cache)); } catch (e) { /* quota */ }
  }, 1000));
  return value;
}

function loadJson(storageKey) {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; }
  catch (e) { return {}; }
}

/* =============================================
   POSTER HYDRATION
   Elements with data-poster="<film id>" get their poster filled in once TMDB answers.
   Each call bumps a generation per container so stale loops stop when it re-renders.
   ============================================= */
const hydrateGen = new WeakMap();

async function hydratePosters(container, limit = Infinity) {
  const gen = (hydrateGen.get(container) || 0) + 1;
  hydrateGen.set(container, gen);

  const els = Array.from(container.querySelectorAll('[data-poster]')).slice(0, limit);
  await mapLimit(els, 6, async el => {
    if (hydrateGen.get(container) !== gen || !el.isConnected) return;
    const film = FILM_BY_ID.get(el.dataset.poster);
    const tmdb = film && await fetchTMDB(film);
    if (hydrateGen.get(container) === gen) applyPoster(el, tmdb?.poster);
  });
}

function applyPoster(el, poster) {
  const film = FILM_BY_ID.get(el.dataset.poster);
  delete el.dataset.poster;
  if (el.tagName === 'IMG') {
    if (poster) el.src = `${IMG}${el.dataset.size || 'w92'}${poster}`;
    else el.style.display = 'none';
    return;
  }
  if (!poster) return;
  el.querySelector('.ph')?.remove();
  el.classList.remove('blank', 'no-poster');
  el.insertAdjacentHTML('afterbegin', posterImg(poster, film?.name || '', el.dataset.size));
}

function posterImg(poster, alt, size = 'w200') {
  return `<img src="${IMG}${size}${poster}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

function cachedPoster(film) {
  return TMDB_CACHE[filmKey(film)]?.poster || null;
}

/* =============================================
   HOME
   ============================================= */
function renderMosaic() {
  const mosaic = document.getElementById('posterMosaic');
  const pool   = [
    ...WATCHED.filter(f => f.rating === 5),
    ...WATCHED.filter(f => f.rating >= 3.5 && f.rating < 5),
  ].slice(0, 25);

  mosaic.innerHTML = pool.map(f => {
    const poster = cachedPoster(f);
    return `
      <div class="mosaic-poster ${f.rating === 5 ? 'five-star' : ''}" data-film="${f.id}"
           ${poster ? '' : `data-poster="${f.id}"`}>
        ${poster ? posterImg(poster, f.name) : `<div class="no-img ph">${escapeHtml(f.name.slice(0, 20))}</div>`}
      </div>`;
  }).join('');
  hydratePosters(mosaic);
}

function renderRecent() {
  const grid = document.getElementById('recentGrid');
  grid.innerHTML = DIARY.slice(0, 18).map(f => {
    const poster = cachedPoster(f);
    return `
      <div class="film-card" data-film="${f.id}">
        <div class="film-card-poster ${poster ? '' : 'blank'}" ${poster ? '' : `data-poster="${f.id}"`}>
          ${poster ? posterImg(poster, f.name) : `<span class="ph">${escapeHtml(f.name.slice(0, 30))}</span>`}
        </div>
        <div class="film-card-info">
          <div class="film-card-title">${escapeHtml(f.name)}</div>
          <div class="film-card-meta">${f.year || '—'}</div>
          <div class="film-card-stars">${starsStr(f.rating)}</div>
        </div>
      </div>`;
  }).join('');
  hydratePosters(grid);
}

function renderFiveStars() {
  const list  = document.getElementById('fiveStarList');
  const fives = WATCHED.filter(f => f.rating === 5);

  list.innerHTML = fives.map((f, i) => {
    const poster = cachedPoster(f);
    return `
      <div class="five-star-row" data-film="${f.id}">
        <span class="fsr-num">${String(i + 1).padStart(2, '0')}</span>
        <img class="fsr-thumb" alt="${escapeHtml(f.name)}" data-size="w92"
             ${poster ? `src="${IMG}w92${poster}"` : `data-poster="${f.id}"`} />
        <span class="fsr-title">${escapeHtml(f.name)}</span>
        <span class="fsr-year">${f.year || '—'}</span>
        <span class="fsr-stars">★★★★★</span>
      </div>`;
  }).join('');
  hydratePosters(list);
}

/* =============================================
   POSTER WALL
   ============================================= */
const WALL_FILTERS = {
  all:       () => true,
  watched:   f => isWatched(f),
  5:         f => f.rating === 5,
  4:         f => f.rating >= 4,
  3:         f => f.rating >= 3,
  unrated:   f => f.rating === 0.5,
  unwatched: f => !isWatched(f),
};

// Unwatched films (null rating) always sort to the end
const byRating = dir => (a, b) =>
  (a.rating === null) - (b.rating === null) || dir * ((a.rating || 0) - (b.rating || 0));

const WALL_SORTS = {
  'date-desc':   (a, b) => b.watchedDate.localeCompare(a.watchedDate) || b.row - a.row,
  'date-asc':    (a, b) => a.watchedDate.localeCompare(b.watchedDate) || a.row - b.row,
  'rating-desc': byRating(-1),
  'rating-asc':  byRating(1),
  'year-desc':   (a, b) => (b.year || 0) - (a.year || 0),
  'year-asc':    (a, b) => (a.year || 0) - (b.year || 0),
  'title-asc':   (a, b) => sortTitle(a.name).localeCompare(sortTitle(b.name)),
};

function filterWall() {
  const q      = document.getElementById('wallSearch').value.toLowerCase().trim();
  const sort   = WALL_SORTS[document.getElementById('wallSort').value] || WALL_SORTS['date-desc'];
  const filter = WALL_FILTERS[document.getElementById('wallRatingFilter').value] || WALL_FILTERS.all;

  const films = DIARY
    .filter(f => filter(f) && (!q || f.name.toLowerCase().includes(q)))
    .sort(sort);

  setText('wallCount', `${films.length} film${films.length === 1 ? '' : 's'}`);
  const grid = document.getElementById('wallGrid');
  grid.innerHTML = films.map(f => {
    const poster = cachedPoster(f);
    return `
      <div class="wall-card ${poster ? '' : 'no-poster'}" data-film="${f.id}"
           data-rating="${f.rating ?? 'none'}" ${poster ? '' : `data-poster="${f.id}"`}>
        ${poster ? posterImg(poster, f.name) : `<span class="ph">${escapeHtml(f.name.slice(0, 30))}</span>`}
        <div class="wall-card-overlay">
          <div class="wall-card-overlay-title">${escapeHtml(f.name)}</div>
          <div class="wall-card-overlay-stars">${starsStr(f.rating)}</div>
        </div>
      </div>`;
  }).join('');
  hydratePosters(grid, 80);
}

/* =============================================
   STATS
   ============================================= */
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderStats() {
  const byMonth = countBy(DIARY, f => f.watchedDate.slice(0, 7));
  barChart('chartTimeline', Object.keys(byMonth).sort().map(m => [m, byMonth[m]]));

  const ratings = countBy(WATCHED.filter(f => f.rating >= 1), f => f.rating);
  barChart('chartRatings',
    [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(r => [starsStr(r), ratings[r] || 0, r >= 4 ? '' : 'accent']),
    { short: true, rawLabels: true });

  const byDecade = countBy(DIARY.filter(f => f.year), f => Math.floor(f.year / 10) * 10);
  barChart('chartDecades', Object.keys(byDecade).sort().map(d => [`${d}s`, byDecade[d]]));

  const byCalMonth = countBy(DIARY, f => parseInt(f.watchedDate.slice(5, 7), 10) - 1);
  barChart('chartMonths', MONTH_NAMES.map((m, i) => [m, byCalMonth[i] || 0]), { short: true });

  renderGenres();
}

// Genres come from whatever TMDB data is cached so far
function renderGenres() {
  const withData = DIARY.filter(f => TMDB_CACHE[filmKey(f)]?.genres?.length);
  const note = document.getElementById('genreNote');
  if (!withData.length) {
    note.textContent = BEARER ? 'Genre data appears as posters load from TMDB' : 'Connect TMDB to see genre data';
    document.getElementById('chartGenres').innerHTML = '';
    return;
  }
  note.textContent = `Based on ${withData.length} of ${DIARY.length} films with TMDB data`;
  const counts = {};
  withData.forEach(f => TMDB_CACHE[filmKey(f)].genres.forEach(g => counts[g] = (counts[g] || 0) + 1));
  barChart('chartGenres', Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15));
}

// rows: [label, count, extraFillClass?]
function barChart(containerId, rows, { short = false, rawLabels = false } = {}) {
  const max = Math.max(0, ...rows.map(r => r[1]));
  document.getElementById(containerId).innerHTML = `
    <div class="bar-chart">
      ${rows.map(([label, count, cls = '']) => `
        <div class="bar-row">
          <div class="bar-label ${short ? 'short' : ''}">${rawLabels ? label : escapeHtml(label)}</div>
          <div class="bar-track"><div class="bar-fill ${cls}" style="width:${max ? (count / max * 100).toFixed(1) : 0}%"></div></div>
          <div class="bar-val">${count}</div>
        </div>`).join('')}
    </div>`;
}

function countBy(items, keyFn) {
  const out = {};
  items.forEach(item => {
    const k = keyFn(item);
    if (k === '' || k === null || Number.isNaN(k)) return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

/* =============================================
   MODAL
   ============================================= */
let modalToken = 0;

async function openModal(film) {
  const token   = ++modalToken;
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
    </div>`;

  const [tmdb, credits] = await Promise.all([fetchTMDB(film), fetchCredits(film)]);
  if (token !== modalToken) return;   // another film was opened meanwhile

  const myScore = film.rating >= 1 ? film.rating * 2 : null;
  let diffBadge = '';
  if (myScore && tmdb?.tmdbRating) {
    const d = myScore - tmdb.tmdbRating;
    if (d > 1)       diffBadge = `<span class="diff-badge diff-pos">+${d.toFixed(1)} vs crowd</span>`;
    else if (d < -1) diffBadge = `<span class="diff-badge diff-neg">${d.toFixed(1)} vs crowd</span>`;
    else             diffBadge = `<span class="diff-badge diff-neu">in line with crowd</span>`;
  }

  const backdropSrc = tmdb?.backdrop ? `${IMG}w780${tmdb.backdrop}` : null;
  const posterSrc   = tmdb?.poster   ? `${IMG}w200${tmdb.poster}`   : null;
  const directorStr = credits?.director?.length ? credits.director.join(', ') : null;
  const castStr     = credits?.cast?.length     ? credits.cast.slice(0, 5).join(', ') : null;
  const dateLabel   = isWatched(film) ? 'Logged' : 'Added';

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
        ${directorStr ? `<div class="modal-credit"><span class="modal-credit-label">Director</span> ${escapeHtml(directorStr)}</div>` : ''}
        ${castStr     ? `<div class="modal-credit"><span class="modal-credit-label">Cast</span> ${escapeHtml(castStr)}</div>` : ''}
        ${film.watchedDate ? `<div class="modal-credit"><span class="modal-credit-label">${dateLabel}</span> ${escapeHtml(film.watchedDate)}</div>` : ''}
        <div class="modal-overview">${escapeHtml(tmdb?.overview || 'No overview available.')}</div>
        <div class="modal-links">
          ${film.letterboxd ? `<a href="${escapeHtml(film.letterboxd)}" target="_blank" rel="noopener">View on Letterboxd →</a>` : ''}
        </div>
      </div>
    </div>`;
}

function closeModal() {
  modalToken++;
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* =============================================
   HELPERS
   ============================================= */
const filmKey   = film => `${film.name}|${film.year}`;
const isWatched = film => film.rating !== null && film.rating !== undefined;
const sortTitle = name => name.replace(/^(the|a|an)\s+/i, '');

function starsStr(rating) {
  if (rating === null || rating === undefined) return '<span style="color:var(--muted)">not seen</span>';
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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// Like Promise.all(items.map(fn)) but with at most `limit` calls in flight
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
