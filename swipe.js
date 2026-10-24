/* =============================================
   SWIPE — "Tinder for movies"
   Deals films from the collection (unwatched only, or everything); yes/no swipes plus
   the taste in your existing ratings rank the rest.
   Requires: app.js loaded first (DIARY, TMDB_CACHE, BEARER, fetchTMDB, filmKey,
   isWatched, mapLimit, IMG, escapeHtml, openModal, setText)
   ============================================= */

const SWIPE_LS        = 'swipe_session';
const SWIPE_DECK_SIZE = 20;   // first round: enough to cover the main genres and eras
const SWIPE_MORE_SIZE = 10;
const SWIPE_THRESHOLD = 90;   // px of drag that counts as a swipe

let swipe = loadSwipeSession();
let swipePrepared = false;

function loadSwipeSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SWIPE_LS) || 'null');
    if (s?.deck && s.votes) return s;
  } catch (e) { /* fall through */ }
  return newSwipeSession('unwatched');
}

function newSwipeSession(mode) {
  return { mode, deck: [], index: 0, votes: {}, history: [] };
}

function saveSwipeSession() {
  try { localStorage.setItem(SWIPE_LS, JSON.stringify(swipe)); } catch (e) { /* storage full */ }
}

// 'unwatched' = not seen yet; 'all' = whole collection, rewatches included
const swipePool  = () => swipe.mode === 'all' ? DIARY : DIARY.filter(f => !isWatched(f));
const filmByKey  = key => DIARY.find(f => filmKey(f) === key);
const tmdbOf     = f => TMDB_CACHE[filmKey(f)] || null;

/* =============================================
   ENTRY
   ============================================= */
async function showSwipe() {
  if (!swipePrepared) {
    swipePrepared = true;
    document.getElementById('swipeNo').addEventListener('click', () => vote(-1));
    document.getElementById('swipeYes').addEventListener('click', () => vote(1));
    document.getElementById('swipeUndo').addEventListener('click', undoVote);
    document.getElementById('swipeRestart').addEventListener('click', restartSwipe);
    document.getElementById('swipeMore').addEventListener('click', dealMore);
    document.getElementById('swipeCopy').addEventListener('click', copySwipeSummary);
    document.querySelectorAll('.swipe-mode-btn').forEach(btn =>
      btn.addEventListener('click', () => setSwipeMode(btn.dataset.mode)));
    document.addEventListener('keydown', e => {
      if (!isVisible('viewSwipe') || document.getElementById('modalOverlay').classList.contains('open')) return;
      if (e.key === 'ArrowLeft')  vote(-1);
      if (e.key === 'ArrowRight') vote(1);
    });
  }

  swipe.mode = swipe.mode || 'unwatched';
  renderSwipeMode();

  // Drop films that have been watched or removed since the deck was dealt
  const poolKeys = new Set(swipePool().map(filmKey));
  swipe.deck = swipe.deck.filter((k, i) => poolKeys.has(k) || i < swipe.index);

  await prefetchPool();
  if (!swipe.deck.length) {
    swipe.deck = pickCards(SWIPE_DECK_SIZE);
    swipe.index = 0;
    saveSwipeSession();
  }
  renderSwipe();
}

// Genres and runtimes for the whole backlog drive both card choice and ranking.
// Cached after the first run, so later visits are instant.
async function prefetchPool() {
  const missing = swipePool().filter(f => !(filmKey(f) in TMDB_CACHE));
  if (!BEARER || !missing.length) return;
  let done = 0;
  const status = document.getElementById('swipeStatus');
  const what = swipe.mode === 'all' ? 'collection' : 'backlog';
  status.textContent = `Getting to know your ${what}… 0 / ${missing.length}`;
  status.hidden = false;
  await mapLimit(missing, 6, async f => {
    await fetchTMDB(f);
    status.textContent = `Getting to know your ${what}… ${++done} / ${missing.length}`;
  });
  status.hidden = true;
}

/* =============================================
   FEATURES + SCORING
   ============================================= */
function features(f) {
  const t = tmdbOf(f);
  const out = [];
  (t?.genres || []).forEach(g => out.push('g:' + g));
  if (f.year) out.push('d:' + (f.year < 1970 ? 'pre-1970' : `${Math.floor(f.year / 10) * 10}s`));
  if (t?.runtime) out.push('r:' + (t.runtime < 100 ? 'short' : t.runtime <= 130 ? 'medium' : 'long'));
  return out;
}

function featureLabel(feat) {
  const [type, val] = feat.split(':');
  if (type === 'r') return { short: 'Under 100 min', medium: '100–130 min', long: 'Over 130 min' }[val];
  return val;
}

// Long-term taste: how your ratings lean for each feature (−1 … 1), shrunk toward 0
function ratingPrior() {
  const sum = {}, n = {};
  DIARY.filter(f => f.rating >= 1 && tmdbOf(f)).forEach(f => {
    const w = Math.max(-1, Math.min(1, (f.rating - 3.25) / 1.75));
    features(f).forEach(k => { sum[k] = (sum[k] || 0) + w; n[k] = (n[k] || 0) + 1; });
  });
  const prior = {};
  for (const k in sum) prior[k] = sum[k] / (n[k] + 3);
  return prior;
}

// Tonight's mood: net yes/no per feature (−1 … 1), shrunk toward 0
function swipeWeights() {
  const yes = {}, no = {};
  for (const key in swipe.votes) {
    const f = filmByKey(key);
    if (!f) continue;
    const bucket = swipe.votes[key] > 0 ? yes : no;
    features(f).forEach(k => bucket[k] = (bucket[k] || 0) + 1);
  }
  const w = {};
  new Set([...Object.keys(yes), ...Object.keys(no)]).forEach(k => {
    const y = yes[k] || 0, n = no[k] || 0;
    w[k] = (y - n) / (y + n + 1);
  });
  return w;
}

function scoreFilm(f, prior, mood) {
  const feats = features(f);
  if (!feats.length) return { score: 0, reasons: [] };
  const contrib = feats.map(k => ({ k, v: 2 * (mood[k] || 0) + (prior[k] || 0) }));
  const crowd = tmdbOf(f)?.tmdbRating ? (tmdbOf(f).tmdbRating - 6.5) * 0.15 : 0;
  const score = contrib.reduce((s, c) => s + c.v, 0) / Math.sqrt(feats.length) + crowd;
  const reasons = contrib.filter(c => c.v > 0.15).sort((a, b) => b.v - a.v).slice(0, 3).map(c => featureLabel(c.k));
  return { score, reasons };
}

/* =============================================
   CHOOSING CARDS
   First round spreads across genres and eras; later rounds probe the films the
   model is least sure about.
   ============================================= */
function pickCards(count) {
  const seen = new Set([...swipe.deck, ...Object.keys(swipe.votes)]);
  const pool = swipePool().filter(f => !seen.has(filmKey(f)));
  const hasData = f => tmdbOf(f)?.genres?.length;
  const candidates = pool.some(hasData) ? pool.filter(hasData) : pool;
  const picked = [];

  if (!Object.keys(swipe.votes).length) {
    // Greedy coverage: each pick adds the most features not yet shown
    const covered = {};
    const remaining = [...candidates];
    while (picked.length < count && remaining.length) {
      let best = 0, bestVal = -Infinity;
      remaining.forEach((f, i) => {
        const novelty = features(f).reduce((s, k) => s + 1 / (1 + (covered[k] || 0)), 0);
        const val = novelty + (tmdbOf(f)?.tmdbRating || 6) * 0.05 + (tmdbOf(f)?.poster ? 0.3 : 0) + Math.random() * 0.4;
        if (val > bestVal) { bestVal = val; best = i; }
      });
      const f = remaining.splice(best, 1)[0];
      features(f).forEach(k => covered[k] = (covered[k] || 0) + 1);
      picked.push(filmKey(f));
    }
    return picked;
  }

  // Uncertainty: scores near zero, plus features with few votes so far
  const prior = ratingPrior(), mood = swipeWeights();
  const votesPer = {};
  Object.keys(swipe.votes).forEach(key => {
    const f = filmByKey(key);
    if (f) features(f).forEach(k => votesPer[k] = (votesPer[k] || 0) + 1);
  });
  return candidates
    .map(f => {
      const { score } = scoreFilm(f, prior, mood);
      const unexplored = features(f).reduce((s, k) => s + 1 / (1 + (votesPer[k] || 0)), 0);
      return { key: filmKey(f), val: -Math.abs(score) + unexplored * 0.5 + Math.random() * 0.3 };
    })
    .sort((a, b) => b.val - a.val)
    .slice(0, count)
    .map(c => c.key);
}

/* =============================================
   VOTING
   ============================================= */
function vote(dir, flyOut = true) {
  const key = swipe.deck[swipe.index];
  if (!key) return;
  const card = document.querySelector('.swipe-card.top');
  const finish = () => {
    swipe.votes[key] = dir;
    swipe.history.push(key);
    swipe.index++;
    saveSwipeSession();
    renderSwipe();
  };
  if (card && flyOut) {
    card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    card.style.transform = `translateX(${dir * 140}%) rotate(${dir * 18}deg)`;
    card.style.opacity = '0';
    setTimeout(finish, 250);
  } else {
    finish();
  }
}

function undoVote() {
  const key = swipe.history.pop();
  if (!key) return;
  delete swipe.votes[key];
  swipe.index = Math.max(0, swipe.deck.indexOf(key));
  saveSwipeSession();
  renderSwipe();
}

function restartSwipe() {
  if (Object.keys(swipe.votes).length && !confirm('Clear your swipes and deal a new deck?')) return;
  swipe = newSwipeSession(swipe.mode);
  swipe.deck = pickCards(SWIPE_DECK_SIZE);
  saveSwipeSession();
  renderSwipe();
}

// Swipes so far still count; a fresh deck is dealt from the new pool
async function setSwipeMode(mode) {
  if (mode === swipe.mode) return;
  swipe.mode = mode;
  swipe.deck = swipe.deck.slice(0, swipe.index);
  renderSwipeMode();
  await prefetchPool();
  swipe.deck.push(...pickCards(SWIPE_DECK_SIZE));
  saveSwipeSession();
  renderSwipe();
}

function renderSwipeMode() {
  document.querySelectorAll('.swipe-mode-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === swipe.mode));
  setText('swipeDesc', swipe.mode === 'all'
    ? 'Swipe right if you’d watch it tonight, left if not. Cards come from your whole collection, rewatches included.'
    : 'Swipe right if you’d watch it tonight, left if not. All cards come from your unwatched films.');
}

function dealMore() {
  swipe.deck.push(...pickCards(SWIPE_MORE_SIZE));
  saveSwipeSession();
  renderSwipe();
}

/* =============================================
   RENDER
   ============================================= */
function renderSwipe() {
  const total = swipe.deck.length;
  const done  = Math.min(swipe.index, total);
  const yes   = Object.values(swipe.votes).filter(v => v > 0).length;
  setText('swipeProgress', total ? `${done} / ${total} · ${yes} yes` : '');
  document.getElementById('swipeUndo').disabled = !swipe.history.length;
  document.getElementById('swipeNoToken').hidden = !!BEARER;

  const finished = done >= total;
  document.getElementById('swipeDeckWrap').hidden = finished;
  document.getElementById('swipeResults').hidden = !finished;
  if (finished) return renderSwipeResults();

  // Top card plus the next one peeking underneath
  const stack = document.getElementById('swipeStack');
  stack.innerHTML = '';
  swipe.deck.slice(swipe.index, swipe.index + 2).reverse().forEach((key, i, arr) => {
    const f = filmByKey(key);
    if (f) stack.appendChild(buildCard(f, i === arr.length - 1));
  });
}

function buildCard(f, isTop) {
  const t = tmdbOf(f);
  const card = document.createElement('div');
  card.className = 'swipe-card' + (isTop ? ' top' : '');
  const meta = [f.year, t?.runtime ? `${t.runtime} min` : null, t?.tmdbRating ? `TMDB ${t.tmdbRating}` : null]
    .filter(Boolean).join(' · ');
  const seenBadge = !isWatched(f) ? '' : f.rating >= 1
    ? `<div class="swipe-seen">Seen · your rating ${starsStr(f.rating)}</div>`
    : '<div class="swipe-seen">Seen</div>';
  card.innerHTML = `
    ${t?.poster
      ? `<img class="swipe-poster" src="${IMG}w500${t.poster}" alt="" draggable="false" />`
      : `<div class="swipe-poster blank">${escapeHtml(f.name)}</div>`}
    <div class="swipe-stamp yes">YES</div>
    <div class="swipe-stamp no">NOPE</div>
    <div class="swipe-info">
      ${seenBadge}
      <div class="swipe-title">${escapeHtml(f.name)}</div>
      <div class="swipe-meta">${escapeHtml(meta)}</div>
      ${t?.genres?.length ? `<div class="swipe-genres">${t.genres.slice(0, 3).map(g => `<span class="genre-pill">${escapeHtml(g)}</span>`).join('')}</div>` : ''}
      ${t?.overview ? `<p class="swipe-overview">${escapeHtml(t.overview)}</p>` : ''}
    </div>
    <button class="swipe-details" aria-label="Details">i</button>`;
  card.querySelector('.swipe-details').addEventListener('click', e => { e.stopPropagation(); openModal(f); });
  if (isTop) attachDrag(card);
  return card;
}

function attachDrag(card) {
  let startX = 0, startY = 0, dx = 0, dragging = false;
  const yesStamp = card.querySelector('.swipe-stamp.yes');
  const noStamp  = card.querySelector('.swipe-stamp.no');

  card.addEventListener('pointerdown', e => {
    if (e.target.closest('.swipe-details')) return;
    dragging = true; startX = e.clientX; startY = e.clientY; dx = 0;
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  card.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = e.clientX - startX;
    const dy = (e.clientY - startY) * 0.2;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    yesStamp.style.opacity = Math.max(0, Math.min(1, dx / SWIPE_THRESHOLD));
    noStamp.style.opacity  = Math.max(0, Math.min(1, -dx / SWIPE_THRESHOLD));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dx) > SWIPE_THRESHOLD) return vote(dx > 0 ? 1 : -1);
    card.style.transition = 'transform 0.2s ease';
    card.style.transform = '';
    yesStamp.style.opacity = noStamp.style.opacity = 0;
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function swipeRanking() {
  const prior = ratingPrior(), mood = swipeWeights();
  const rank = films => films
    .map(f => ({ f, ...scoreFilm(f, prior, mood) }))
    .sort((a, b) => b.score - a.score);
  const inPool   = new Set(swipePool().map(filmKey));
  const yesFilms = Object.keys(swipe.votes).filter(k => swipe.votes[k] > 0 && inPool.has(k)).map(filmByKey).filter(Boolean);
  const others   = swipePool().filter(f => !(filmKey(f) in swipe.votes));
  return { yes: rank(yesFilms), picks: rank(others).slice(0, 12), mood };
}

function renderSwipeResults() {
  const { yes, picks, mood } = swipeRanking();

  const liked = Object.entries(mood).filter(([, v]) => v > 0.2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => featureLabel(k));
  const nope  = Object.entries(mood).filter(([, v]) => v < -0.2).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([k]) => featureLabel(k));
  setText('swipeMood',
    (liked.length ? `In the mood for: ${liked.join(', ')}.` : 'No clear pattern yet. Swipe a few more.') +
    (nope.length ? ` Not tonight: ${nope.join(', ')}.` : ''));

  const tile = ({ f, reasons }) => {
    const poster = tmdbOf(f)?.poster;
    return `
      <div class="film-card" data-film="${f.id}">
        <div class="film-card-poster ${poster ? '' : 'blank'}">
          ${poster ? `<img src="${IMG}w200${poster}" alt="${escapeHtml(f.name)}" loading="lazy" />` : escapeHtml(f.name)}
        </div>
        <div class="film-card-info">
          <div class="film-card-title">${escapeHtml(f.name)}</div>
          <div class="film-card-meta">${f.year || '—'}</div>
          ${reasons.length ? `<div class="swipe-reasons">${reasons.map(escapeHtml).join(' · ')}</div>` : ''}
        </div>
      </div>`;
  };
  document.getElementById('swipeYesGrid').innerHTML = yes.length
    ? yes.map(tile).join('') : '<p class="stat-note">You didn’t say yes to any. Deal more cards?</p>';
  document.getElementById('swipePicksGrid').innerHTML = picks.map(tile).join('');
}

/* =============================================
   COPY FOR CLAUDE
   ============================================= */
async function copySwipeSummary() {
  const { yes, picks, mood } = swipeRanking();
  const name = f => `${f.name} (${f.year || '?'})${f.rating >= 1 ? `, rated ${f.rating}` : isWatched(f) ? ', seen' : ''}`;
  const noFilms = Object.keys(swipe.votes).filter(k => swipe.votes[k] < 0).map(filmByKey).filter(Boolean);
  const liked = Object.entries(mood).filter(([, v]) => v > 0.2).map(([k]) => featureLabel(k));
  const text = [
    `Movie swipe session (${new Date().toLocaleDateString()}). Pick something from my ${swipe.mode === 'all' ? 'collection (rewatches OK)' : 'unwatched films'}.`,
    `YES (${yes.length}): ${yes.map(r => name(r.f)).join('; ') || 'none'}`,
    `NO (${noFilms.length}): ${noFilms.map(name).join('; ') || 'none'}`,
    liked.length ? `Leaning toward: ${liked.join(', ')}` : '',
    `App's top picks: ${picks.slice(0, 8).map(r => name(r.f)).join('; ')}`,
  ].filter(Boolean).join('\n');

  const btn = document.getElementById('swipeCopy');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied ✓';
  } catch (e) {
    // Clipboard blocked: show the text so it can be copied by hand
    prompt('Copy this and paste it to Claude:', text);
  }
  setTimeout(() => { btn.textContent = 'Copy for Claude'; }, 2000);
}
