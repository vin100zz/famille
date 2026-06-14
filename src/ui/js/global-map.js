'use strict';

/**
 * GlobalMap – carte de tous les ancêtres avec slider temporel.
 *
 * Précision adaptative au zoom :
 *   zoom < ZOOM_ADDR  → regroupement par ville (un marqueur par ville)
 *   zoom ≥ ZOOM_ADDR  → regroupement par adresse (géocodage fin à la demande)
 */
const GlobalMap = (function () {

  const YEAR_MIN  = 1360;
  const YEAR_MAX  = 2022;
  const ZOOM_ADDR = 11;   // seuil de bascule ville → adresse

  let _map            = null;
  let _layer          = null;
  let _allEvents      = null;
  let _geocodedCity   = null;   // Map<cityKey,  [lat,lng]>  — toujours chargé
  let _geocodedFull   = null;   // Map<fullKey,  [lat,lng]>  — chargé au premier zoom >ZOOM_ADDR
  let _geocodingFull  = false;  // verrou
  let _container      = null;
  let _updateFn       = null;   // référence à update() pour re-render après geocoding

  // ── Clés de regroupement ───────────────────────────────────────────────────

  function _keyCity(lieu) {
    if (!lieu) return '';
    return (lieu.ville || '') + '|' + (lieu.dept_num || '');
  }

  function _keyFull(lieu) {
    if (!lieu) return '';
    return (lieu.adresse || '') + '|' + (lieu.ville || '') + '|' + (lieu.dept_num || '');
  }

  // ── Chargement des événements ──────────────────────────────────────────────

  async function _loadEvents() {
    if (_allEvents) return _allEvents;
    const r = await fetch('src/server/Api/all-events.php');
    _allEvents = r.ok ? await r.json() : [];
    return _allEvents;
  }

  // ── Cache géocodage (partagé avec PersonsMap via geocache.php) ────────────

  const _CACHE_URL  = 'src/server/Api/geocache.php';
  const _gCache     = {};
  let   _cacheReady = false;
  const _newEntries = {};

  async function _ensureCacheLoaded() {
    if (_cacheReady) return;
    _cacheReady = true;
    try {
      const r = await fetch(_CACHE_URL);
      if (r.ok) Object.assign(_gCache, await r.json());
    } catch { /* continue sans cache */ }
  }

  async function _flushCache() {
    const keys = Object.keys(_newEntries);
    if (!keys.length) return;
    const toSave = {};
    keys.forEach(k => { toSave[k] = _newEntries[k]; delete _newEntries[k]; });
    try {
      await fetch(_CACHE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSave),
      });
    } catch { /* silencieux */ }
  }

  async function _fetchCoords(q) {
    if (!q) return null;
    if (Object.prototype.hasOwnProperty.call(_gCache, q)) return _gCache[q];
    try {
      const url  = 'https://photon.komoot.io/api/?' + new URLSearchParams({ q, limit: '1', lang: 'fr' });
      const resp = await fetch(url);
      if (!resp.ok) { _gCache[q] = null; return null; }
      const data = await resp.json();
      const feat = data.features && data.features[0];
      if (!feat) { _gCache[q] = null; return null; }
      const [lon, lat] = feat.geometry.coordinates;
      _gCache[q] = [lat, lon];
      _newEntries[q] = [lat, lon];
      return [lat, lon];
    } catch { _gCache[q] = null; return null; }
  }

  // ── Géocodage niveau ville ─────────────────────────────────────────────────

  async function _geocodeLieuCity(lieu) {
    if (!lieu) return null;
    const parts = [];
    if (lieu.ville)    parts.push(lieu.ville);
    if (lieu.dept_num) parts.push(lieu.dept_num);
    parts.push('France');
    return _fetchCoords(parts.join(', '));
  }

  async function _geocodeAllCity(events) {
    if (_geocodedCity) return _geocodedCity;
    _geocodedCity = new Map();
    const lieux = new Map();
    events.forEach(ev => {
      const k = _keyCity(ev.lieu);
      if (k && !lieux.has(k)) lieux.set(k, ev.lieu);
    });
    const keys = [...lieux.keys()];
    let i = 0;
    async function worker() {
      while (i < keys.length) {
        const k = keys[i++];
        const c = await _geocodeLieuCity(lieux.get(k));
        if (c) _geocodedCity.set(k, c);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, keys.length) }, worker));
    return _geocodedCity;
  }

  // ── Géocodage niveau adresse (lazy) ───────────────────────────────────────

  async function _geocodeLieuFull(lieu) {
    if (!lieu) return null;
    const cityParts = [];
    if (lieu.ville)    cityParts.push(lieu.ville);
    if (lieu.dept_num) cityParts.push(lieu.dept_num);
    cityParts.push('France');
    const qCity = cityParts.join(', ');

    if (!lieu.adresse) return _fetchCoords(qCity);

    const fullParts = [lieu.adresse, ...cityParts.slice(0, -1), 'France'];
    const qFull = fullParts.join(', ');
    const r = await _fetchCoords(qFull);
    return r || _fetchCoords(qCity);
  }

  async function _geocodeAllFull(events, onProgress) {
    if (_geocodedFull) return _geocodedFull;
    _geocodedFull = new Map();
    const lieux = new Map();
    events.forEach(ev => {
      const k = _keyFull(ev.lieu);
      if (k && !lieux.has(k)) lieux.set(k, ev.lieu);
    });
    const keys = [...lieux.keys()];
    let i = 0, done = 0;
    async function worker() {
      while (i < keys.length) {
        const k = keys[i++];
        const c = await _geocodeLieuFull(lieux.get(k));
        if (c) _geocodedFull.set(k, c);
        if (onProgress) onProgress(++done, keys.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, keys.length) }, worker));
    return _geocodedFull;
  }

  // ── Rendu des marqueurs ────────────────────────────────────────────────────

  const TYPE_COLOR = {
    'Naissance': '#3b82f6',
    'Décès':     '#6b7280',
    'Sépulture': '#9ca3af',
    'Résidence': '#10b981',
    'Mariage':   '#f59e0b',
  };

  function _renderMarkers(yearMax, cumulative) {
    if (!_layer || !_map) return;
    _layer.clearLayers();

    const zoom    = _map.getZoom();
    const useAddr = zoom >= ZOOM_ADDR && !!_geocodedFull;
    const keyFn   = useAddr ? _keyFull   : _keyCity;
    const geoMap  = useAddr ? _geocodedFull : _geocodedCity;

    const events = _allEvents.filter(ev =>
      cumulative ? ev.year <= yearMax : Math.abs(ev.year - yearMax) <= 25
    );

    // Groupe par lieu
    const groups = new Map();
    events.forEach(ev => {
      const k = keyFn(ev.lieu);
      const c = geoMap && geoMap.get(k);
      if (!c) return;
      if (!groups.has(k)) groups.set(k, { c, lieu: ev.lieu, events: [] });
      groups.get(k).events.push(ev);
    });

    groups.forEach(({ c, lieu, events }) => {
      const count = events.length;
      const r     = Math.max(6, Math.min(20, 4 + Math.sqrt(count) * 2));

      const typeCounts = {};
      events.forEach(ev => { typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1; });
      const domType = Object.keys(typeCounts).reduce((a, b) => typeCounts[a] > typeCounts[b] ? a : b);
      const color   = TYPE_COLOR[domType] || '#6366f1';

      const place = formatPlace(lieu) || lieu.brut || '';
      let html = `<div class="gm-tt-place">${place}</div>`;
      html += `<div class="gm-tt-count">${count} événement${count > 1 ? 's' : ''}</div>`;
      Object.keys(typeCounts).sort().forEach(t => {
        html += `<div class="gm-tt-type"><span class="gm-tt-dot" style="background:${TYPE_COLOR[t]}"></span>${t} (${typeCounts[t]})</div>`;
      });
      const persons = [...new Set(events.map(ev => [ev.prenom, ev.nom].filter(Boolean).join(' ')).filter(Boolean))];
      if (persons.length) {
        html += '<div class="gm-tt-persons">';
        persons.slice(0, 5).forEach(p => { html += `<div class="gm-tt-person">• ${p}</div>`; });
        if (persons.length > 5) html += `<div class="gm-tt-more">…et ${persons.length - 5} autres</div>`;
        html += '</div>';
      }

      L.circleMarker(c, {
        radius: r, fillColor: color, fillOpacity: 0.75,
        color: '#fff', weight: 1.5,
      })
        .bindTooltip(html, { className: 'gm-tooltip', direction: 'top', sticky: false })
        .addTo(_layer);
    });

    // Stats + indicateur de précision
    const statsEl = _container && _container.querySelector('.gm-stats');
    if (statsEl) {
      const precLabel = useAddr ? '📍 adresse' : '🏙 ville';
      statsEl.textContent = `${events.length} év. · ${groups.size} lieux · ${precLabel}`;
    }
  }

  // ── Construction de l'UI ───────────────────────────────────────────────────

  function _buildUI() {
    const wrap = document.createElement('div');
    wrap.id        = 'global-map-view';
    wrap.className = 'global-map-view';
    wrap.innerHTML = `
      <div class="gm-map" id="gm-map"></div>
      <div class="gm-panel">
        <div class="gm-controls">
          <div class="gm-year-display">
            <span class="gm-year-label">Jusqu'en</span>
            <span class="gm-year-val" id="gm-year-val">1800</span>
          </div>
          <input type="range" class="gm-slider" id="gm-slider"
            min="${YEAR_MIN}" max="${YEAR_MAX}" value="1800" step="5">
          <div class="gm-year-bounds">
            <span>${YEAR_MIN}</span><span>${YEAR_MAX}</span>
          </div>
        </div>
        <div class="gm-right">
          <div class="gm-toggle">
            <label class="gm-toggle-label">
              <input type="checkbox" id="gm-cumul" checked>
              Cumulatif
            </label>
          </div>
          <button class="gm-play-btn" id="gm-play">▶</button>
          <div class="gm-stats" id="gm-stats">—</div>
        </div>
        <div class="gm-legend">
          <span class="gm-leg-item"><span class="gm-leg-dot" style="background:#3b82f6"></span>Naissance</span>
          <span class="gm-leg-item"><span class="gm-leg-dot" style="background:#f59e0b"></span>Mariage</span>
          <span class="gm-leg-item"><span class="gm-leg-dot" style="background:#10b981"></span>Résidence</span>
          <span class="gm-leg-item"><span class="gm-leg-dot" style="background:#6b7280"></span>Décès</span>
        </div>
      </div>`;
    return wrap;
  }

  // ── API publique ───────────────────────────────────────────────────────────

  async function open(containerEl) {
    _container = containerEl;
    containerEl.innerHTML = '';
    containerEl.appendChild(_buildUI());

    await new Promise(r => requestAnimationFrame(r));
    _map = L.map('gm-map', { zoomControl: true }).setView([46.5, 2.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19,
    }).addTo(_map);
    _layer = L.layerGroup().addTo(_map);

    const statsEl = containerEl.querySelector('.gm-stats');

    // Chargement initial : ville seulement
    if (statsEl) statsEl.textContent = 'Chargement…';
    const events = await _loadEvents();
    if (statsEl) statsEl.textContent = 'Géocodage…';
    await _ensureCacheLoaded();
    await _geocodeAllCity(events);
    await _flushCache();

    // Slider + cumul
    const slider  = containerEl.querySelector('#gm-slider');
    const yearVal = containerEl.querySelector('#gm-year-val');
    const cumulCb = containerEl.querySelector('#gm-cumul');
    const labelEl = containerEl.querySelector('.gm-year-label');

    function update() {
      const y     = parseInt(slider.value);
      const cumul = cumulCb.checked;
      yearVal.textContent = y;
      labelEl.textContent = cumul ? "Jusqu'en" : '±25 ans autour de';
      _renderMarkers(y, cumul);
    }
    _updateFn = update;

    slider.addEventListener('input', update);
    cumulCb.addEventListener('change', update);

    // Bascule vers précision adresse au zoom in
    _map.on('zoomend', async () => {
      const zoom = _map.getZoom();
      if (zoom >= ZOOM_ADDR && !_geocodedFull && !_geocodingFull) {
        _geocodingFull = true;
        if (statsEl) statsEl.textContent = 'Géocodage adresses…';
        await _geocodeAllFull(events, (done, total) => {
          if (statsEl) statsEl.textContent = `Géocodage adresses ${done}/${total}…`;
        });
        await _flushCache();
        _geocodingFull = false;
      }
      update();
    });

    // Lecture automatique
    let _playTimer = null;
    const playBtn = containerEl.querySelector('#gm-play');
    playBtn.addEventListener('click', () => {
      if (_playTimer) {
        clearInterval(_playTimer); _playTimer = null;
        playBtn.textContent = '▶';
        return;
      }
      playBtn.textContent = '⏹';
      _playTimer = setInterval(() => {
        const v = parseInt(slider.value) + 10;
        if (v > YEAR_MAX) {
          clearInterval(_playTimer); _playTimer = null;
          playBtn.textContent = '▶';
          return;
        }
        slider.value = v; update();
      }, 120);
    });

    update();
    _map.invalidateSize();
  }

  function close() {
    if (_map) { _map.remove(); _map = null; }
    _layer = null; _container = null; _updateFn = null;
  }

  return { open, close };

})();
