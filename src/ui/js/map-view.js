'use strict';

/**
 * PersonsMap – affiche une carte Leaflet des lieux associés à un couple.
 *
 * Dépend de :
 *   - Leaflet (L) disponible globalement
 *   - formatPlace(), formatDate() de components.js
 *
 * Fonctionnalités :
 *   - Géocodage à deux niveaux : rue+ville d'abord, puis ville seule en fallback
 *   - Clustering dynamique par distance en pixels (recalculé à chaque zoomend)
 *     → un cluster par groupe de marqueurs proches ; clic pour zoomer
 */
const PersonsMap = (function () {

  // ── Cache & constantes ────────────────────────────────────────────────────

  // Cache en mémoire, pré-chargé depuis le serveur (geocache.json).
  // Les nouvelles entrées sont envoyées au serveur en une seule requête POST
  // après chaque session de géocodage.
  const _cache      = {};
  const _CACHE_URL  = 'src/server/Api/geocache.php';
  let   _cacheReady = false;   // chargement effectué (évite les doublons)
  let   _newEntries = {};      // entrées à persister en fin de session

  const MAX_CONCURRENT = 4;    // requêtes Photon simultanées
  const CLUSTER_RADIUS = 44;   // pixels : rayon de regroupement

  /** Charge le cache depuis le serveur (une seule fois par session). */
  async function _ensureCacheLoaded() {
    if (_cacheReady) return;
    _cacheReady = true; // positionné avant await pour éviter un double appel concurrent
    try {
      const resp = await fetch(_CACHE_URL);
      if (resp.ok) Object.assign(_cache, await resp.json());
    } catch { /* réseau indisponible : on continue sans cache pré-chargé */ }
  }

  /** Envoie les nouvelles entrées au serveur pour persistance. */
  async function _flushCache() {
    if (!Object.keys(_newEntries).length) return;
    const toSave  = _newEntries;
    _newEntries   = {};
    try {
      await fetch(_CACHE_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(toSave),
      });
    } catch { /* échec silencieux : les données seront re-géocodées au prochain chargement */ }
  }

  // ── Géocodage Nominatim ───────────────────────────────────────────────────

  /** Requête précise : rue + ville */
  function _buildQueryFull(lieu) {
    if (!lieu) return '';
    const p = [];
    if (lieu.adresse)       p.push(lieu.adresse);
    if (lieu.ville)         p.push(lieu.ville);
    if (lieu.dept_num) p.push(lieu.dept_num);
    if (!lieu.pays || lieu.pays.toLowerCase() === 'france') p.push('France');
    else p.push(lieu.pays);
    return p.join(', ');
  }

  /** Requête repli : ville seule */
  function _buildQueryCity(lieu) {
    if (!lieu) return '';
    const p = [];
    if (lieu.ville)         p.push(lieu.ville);
    if (lieu.dept_num) p.push(lieu.dept_num);
    p.push('France');
    return p.length ? p.join(', ') : (lieu.brut || '');
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** Géocode une requête texte via Photon (cache serveur + gestion 429). */
  async function _fetchCoords(q) {
    if (!q) return null;
    if (Object.prototype.hasOwnProperty.call(_cache, q)) return _cache[q];

    // Photon (komoot) – retourne du GeoJSON, coordonnées [lon, lat]
    const url = 'https://photon.komoot.io/api/?' +
      new URLSearchParams({ q, limit: '1', lang: 'fr' });

    async function _parse(resp) {
      if (!resp.ok) return null;
      const data = await resp.json();
      const feat = data.features && data.features[0];
      if (!feat) return null;
      const [lon, lat] = feat.geometry.coordinates; // GeoJSON : lon en premier
      return [lat, lon]; // Leaflet attend [lat, lon]
    }

    function _store(res) {
      if (res) { _cache[q] = res; _newEntries[q] = res; }
    }

    try {
      const resp = await fetch(url);

      if (resp.status === 429) {
        await _sleep(5000);
        const res2 = await _parse(await fetch(url));
        _store(res2); return res2;
      }

      const res = await _parse(resp);
      _store(res); return res;
    } catch (e) {
      return null;
    }
  }

  /**
   * Géocode tous les groupes en parallèle (pool de MAX_CONCURRENT workers).
   * Les entrées déjà en cache sont servies immédiatement sans requête réseau.
   */
  async function _geocodeAll(groups) {
    const resolved = [];   // résultats dans l'ordre d'arrivée
    let next = 0;          // index partagé entre les workers

    async function worker() {
      while (next < groups.length) {
        const i = next++;           // chaque worker prend le prochain groupe
        const g = groups[i];
        const c = await _geocode(g.lieu);
        if (c) resolved.push({ g, c });
      }
    }

    // Lance MIN(MAX_CONCURRENT, nb groupes) workers en parallèle
    const n = Math.min(MAX_CONCURRENT, groups.length);
    await Promise.all(Array.from({ length: n }, worker));
    return resolved;
  }

  /** Essaie rue+ville, replie sur ville seule. */
  async function _geocode(lieu) {
    const qFull = _buildQueryFull(lieu);
    const qCity = _buildQueryCity(lieu);
    if (qFull && qFull !== qCity) {
      const r = await _fetchCoords(qFull);
      if (r) return r;
    }
    return _fetchCoords(qCity);
  }

  // ── Extraction des événements ─────────────────────────────────────────────

  function _eventsForPerson(person) {
    const evs = [];
    function add(ev, label) {
      if (ev && ev.lieu) evs.push({ lieu: ev.lieu, label, date: ev.date || null });
    }
    if (!person) return evs;
    add(person.naissance, 'Naissance');
    add(person.bapteme,   'Baptême');
    add(person.deces,     'Décès');
    add(person.sepulture, 'Sépulture');
    (person.residences || []).forEach(r => add(r, 'Résidence'));
    return evs;
  }

  function _personName(p) {
    return p ? [p.prenom, p.nom].filter(Boolean).join(' ') : '';
  }

  // ── Marqueurs individuels ─────────────────────────────────────────────────

  function _fillColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      M: s.getPropertyValue('--sex-M').trim() || '#ADE6F4',
      F: s.getPropertyValue('--sex-F').trim() || '#FFC1F6',
      U: s.getPropertyValue('--sex-U').trim() || '#c4b5fd',
    };
  }

  function _splitDotHtml(cL, cR) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="map-tt__split-dot">' +
      '<circle cx="8" cy="8" r="7" fill="white" stroke="rgba(0,0,0,0.20)" stroke-width="0.5"/>' +
      '<path d="M8,3 A5,5 0 0,0 8,13 L8,8 Z" fill="' + cL + '"/>' +
      '<path d="M8,3 A5,5 0 0,1 8,13 L8,8 Z" fill="' + cR + '"/>' +
      '<circle cx="8" cy="8" r="5" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>' +
      '</svg>';
  }

  function _addMarker(layer, group, coords, fillColor) {
    const place = formatPlace(group.lieu) || group.lieu.brut || '';
    const cL    = fillColor.M || fillColor.U;
    const cR    = fillColor.F || fillColor.U;

    let html = '<div class="map-tt">';
    if (place) html += '<div class="map-tt__place">' + place + '</div>';

    group.persons.forEach(pe => {
      html += '<div class="map-tt__person">' +
        '<div class="map-tt__person-hd">' +
        '<span class="map-tt__dot map-tt__dot--' + pe.sexe + '"></span>' +
        '<span class="map-tt__name">' + (pe.name || '(inconnu)') + '</span>' +
        '</div><div class="map-tt__events">';
      pe.events.forEach(ev => {
        const d = formatDate(ev.date);
        html += '<div><span class="map-tt-ev-label">' + ev.label + '</span>' +
          (d ? '<span class="map-tt-ev-date"> – ' + d + '</span>' : '') + '</div>';
      });
      html += '</div></div>';
    });

    if (group.coupleEvents && group.coupleEvents.length) {
      group.coupleEvents.forEach(ev => {
        const d = formatDate(ev.date);
        html += '<div class="map-tt__couple-ev">' +
          _splitDotHtml(cL, cR) +
          '<span class="map-tt-ev-label">' + ev.label + '</span>' +
          (d ? '<span class="map-tt-ev-date"> – ' + d + '</span>' : '') +
          '</div>';
      });
    }
    html += '</div>';

    const tooltipOpts = { direction: 'top', sticky: false, className: 'map-leaflet-tooltip' };
    const isCouple    = group.persons.length >= 2
      || (group.coupleEvents && group.coupleEvents.length > 0);

    if (isCouple) {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">' +
        '<circle cx="15" cy="15" r="14" fill="white" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>' +
        '<path d="M15,6 A9,9 0 0,0 15,24 L15,15 Z" fill="' + cL + '"/>' +
        '<path d="M15,6 A9,9 0 0,1 15,24 L15,15 Z" fill="' + cR + '"/>' +
        '<circle cx="15" cy="15" r="9" fill="none" stroke="rgba(0,0,0,0.50)" stroke-width="1.5"/>' +
        '</svg>';
      const icon = L.divIcon({ html: svg, className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker(coords, { icon }).bindTooltip(html, tooltipOpts).addTo(layer);
    } else {
      const color = fillColor[(group.persons[0] || {}).sexe] || fillColor.U;
      L.circleMarker(coords, {
        radius: 13, fillColor: '#fff', fillOpacity: 1,
        color: 'rgba(0,0,0,0.25)', weight: 1, interactive: false,
      }).addTo(layer);
      L.circleMarker(coords, {
        radius: 9, fillColor: color, fillOpacity: 1,
        color: 'rgba(0,0,0,0.50)', weight: 1.5,
      }).bindTooltip(html, tooltipOpts).addTo(layer);
    }
  }

  // ── Clustering par distance en pixels ─────────────────────────────────────

  /**
   * Regroupe les marqueurs dont les positions écran sont ≤ CLUSTER_RADIUS px.
   * Algorithme glouton : le premier point non affecté devient le centre d'un cluster.
   */
  function _buildClusters(map, resolved) {
    const n    = resolved.length;
    const used = new Array(n).fill(false);
    const clusters = [];

    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const cluster = [resolved[i]];
      used[i] = true;
      const p1 = map.latLngToContainerPoint(resolved[i].c);
      for (let j = i + 1; j < n; j++) {
        if (used[j]) continue;
        if (p1.distanceTo(map.latLngToContainerPoint(resolved[j].c)) <= CLUSTER_RADIUS) {
          cluster.push(resolved[j]);
          used[j] = true;
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  /** Marqueur de cluster (cercle coloré avec compteur). */
  function _addClusterMarker(map, layer, items, fillColor) {
    const lat = items.reduce((s, r) => s + r.c[0], 0) / items.length;
    const lng = items.reduce((s, r) => s + r.c[1], 0) / items.length;

    // Tooltip : liste des lieux regroupés
    let html = '<div class="map-tt"><div class="map-tt__cluster-title">' +
      items.length + ' lieux groupés</div>';
    items.forEach(({ g }) => {
      const p = formatPlace(g.lieu) || g.lieu.brut || '';
      if (p) html += '<div class="map-tt__cluster-item">• ' + p + '</div>';
    });
    html += '<div class="map-tt__cluster-hint">Cliquez pour zoomer</div></div>';

    const icon = L.divIcon({
      html: '<div class="map-cluster"><span>' + items.length + '</span></div>',
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });

    L.marker([lat, lng], { icon })
      .bindTooltip(html, { direction: 'top', sticky: false, className: 'map-leaflet-tooltip' })
      .on('click', function () {
        const bounds = L.latLngBounds(items.map(r => r.c));
        const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
        if (Math.abs(ne.lat - sw.lat) < 0.0001 && Math.abs(ne.lng - sw.lng) < 0.0001) {
          // Tous les points sont au même endroit → zoom progressif
          map.setView(items[0].c, Math.min(map.getZoom() + 3, 15));
        } else {
          map.fitBounds(bounds.pad(0.5), { maxZoom: 15 });
        }
      })
      .addTo(layer);
  }

  // ── Rendu des marqueurs (recalculé à chaque zoomend) ─────────────────────

  function _renderMarkers(map, layer, resolved, fillColor) {
    layer.clearLayers();
    const clusters = _buildClusters(map, resolved);
    clusters.forEach(items => {
      if (items.length === 1) {
        _addMarker(layer, items[0].g, items[0].c, fillColor);
      } else {
        _addClusterMarker(map, layer, items, fillColor);
      }
    });
  }

  // ── Point d'entrée principal ──────────────────────────────────────────────

  async function render(container, person, conjoint, mariage) {

    // Déterminer homme (gauche/bleu) et femme (droite/rose)
    let maleP = null, femaleP = null;
    if (!conjoint) {
      if (person && person.sexe === 'F') femaleP = person;
      else                               maleP   = person;
    } else {
      const pMale = person   && person.sexe   === 'M';
      const cMale = conjoint && conjoint.sexe  === 'M';
      if (pMale || (!pMale && !cMale)) { maleP = person;   femaleP = conjoint; }
      else                              { maleP = conjoint; femaleP = person;   }
    }

    const maleEvs   = _eventsForPerson(maleP);
    const femaleEvs = _eventsForPerson(femaleP);

    // Grouper par lieu (clé = texte formaté)
    const markerMap = {};
    function _addToGroup(evs, sexe, p) {
      evs.forEach(ev => {
        const k = (formatPlace(ev.lieu) || ev.lieu.brut || '').trim();
        if (!k) return;
        if (!markerMap[k]) markerMap[k] = { lieu: ev.lieu, key: k, persons: [], coupleEvents: [] };
        let pe = markerMap[k].persons.find(x => x.sexe === sexe);
        if (!pe) { pe = { sexe, name: _personName(p), events: [] }; markerMap[k].persons.push(pe); }
        pe.events.push(ev);
      });
    }
    _addToGroup(maleEvs,   'M', maleP);
    _addToGroup(femaleEvs, 'F', femaleP);
    if (mariage && mariage.lieu) {
      const k = (formatPlace(mariage.lieu) || mariage.lieu.brut || '').trim();
      if (k) {
        if (!markerMap[k]) markerMap[k] = { lieu: mariage.lieu, key: k, persons: [], coupleEvents: [] };
        markerMap[k].coupleEvents.push({ label: 'Mariage', date: mariage.date || null });
      }
    }

    const groups = Object.values(markerMap);

    // Spinner
    container.innerHTML =
      '<div class="map-spinner">' +
      '<span class="map-spinner__icon">⏳</span>' +
      '<span>Géolocalisation…</span>' +
      '</div>';

    // Chargement du cache serveur (une seule fois par session)
    await _ensureCacheLoaded();

    // Géocodage parallèle (MAX_CONCURRENT workers)
    const resolved = await _geocodeAll(groups);

    // Persistance des nouvelles entrées sur le serveur
    _flushCache(); // sans await : ne bloque pas l'affichage

    container.innerHTML = '';

    if (!resolved.length) {
      container.classList.add('persons-map--no-data');
      container.textContent = 'Aucun lieu géolocalisable pour cette fiche.';
      return null;
    }

    await new Promise(r => requestAnimationFrame(r));
    const map = L.map(container, { zoomControl: true }).setView([46.5, 2.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    await new Promise(r => requestAnimationFrame(r));
    map.invalidateSize();

    const fillColor = _fillColors();
    const layer     = L.layerGroup().addTo(map);

    // Rendu initial + recalcul à chaque zoom
    _renderMarkers(map, layer, resolved, fillColor);
    map.on('zoomend', () => _renderMarkers(map, layer, resolved, fillColor));

    // Cadrage automatique (jamais plus près que zoom 10)
    const MAX_ZOOM = 10;
    const coords = resolved.map(r => r.c);
    if (coords.length === 1) {
      map.setView(coords[0], 9);
    } else {
      map.fitBounds(L.latLngBounds(coords), { padding: [50, 50], maxZoom: MAX_ZOOM });
    }

    return map;
  }

  // ── Vérification rapide (sans géocodage) ─────────────────────────────────

  function hasLocations(person, conjoint, mariage) {
    function _hasLieu(ev) { return !!(ev && ev.lieu); }
    function _personHasLoc(p) {
      if (!p) return false;
      return _hasLieu(p.naissance) || _hasLieu(p.bapteme) ||
             _hasLieu(p.deces)     || _hasLieu(p.sepulture) ||
             (p.residences || []).some(_hasLieu);
    }
    return _personHasLoc(person) || _personHasLoc(conjoint) || _hasLieu(mariage);
  }

  return { render, hasLocations };
})();
