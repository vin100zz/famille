'use strict';

/**
 * PersonsMap – affiche une carte Leaflet des lieux associés à un couple.
 *
 * Dépend de :
 *   - Leaflet (L) disponible globalement
 *   - formatPlace(), formatDate() de components.js
 */
const PersonsMap = (function () {

  // ── Géocodage Nominatim (avec cache mémoire) ─────────────────────────────

  const _cache = {};

  function _buildQuery(lieu) {
    if (!lieu) return '';
    const p = [];
    if (lieu.ville)         p.push(lieu.ville);
    if (lieu.dept_nom)      p.push(lieu.dept_nom);
    else if (lieu.dept_num) p.push(lieu.dept_num);
    if (lieu.pays)          p.push(lieu.pays);
    else if (p.length)      p.push('France');
    return p.length ? p.join(', ') : (lieu.brut || '');
  }

  async function _geocode(lieu) {
    const q = _buildQuery(lieu);
    if (!q) return null;
    if (Object.prototype.hasOwnProperty.call(_cache, q)) return _cache[q];
    try {
      const url = 'https://nominatim.openstreetmap.org/search?' +
        new URLSearchParams({ q, format: 'json', limit: '1', 'accept-language': 'fr' });
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'FamilleGeneralogie/1.0' }
      });
      const arr = await resp.json();
      const result = arr.length ? [parseFloat(arr[0].lat), parseFloat(arr[0].lon)] : null;
      _cache[q] = result;
      return result;
    } catch (e) {
      _cache[q] = null;
      return null;
    }
  }

  function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Extraction des événements géolocalisés d'une personne ─────────────────

  /**
   * Retourne un tableau d'objets { lieu, label, date } pour tous les événements
   * d'une personne qui ont un lieu renseigné.
   * @param {Object|null} person  Données complètes de la personne
   * @param {Object|null} mariage Événement mariage de l'union (optionnel)
   */
  function _eventsForPerson(person, mariage) {
    const evs = [];
    function add(ev, label) {
      if (ev && ev.lieu) evs.push({ lieu: ev.lieu, label, date: ev.date || null });
    }
    if (!person) return evs;
    add(person.naissance, 'Naissance');
    add(person.bapteme,   'Baptême');
    add(mariage,          'Mariage');
    add(person.deces,     'Décès');
    add(person.sepulture, 'Sépulture');
    (person.residences || []).forEach(r => add(r, 'Résidence'));
    return evs;
  }

  function _personName(p) {
    if (!p) return '';
    return [p.prenom, p.nom].filter(Boolean).join(' ');
  }

  // ── Ajout d'un marqueur circulaire avec tooltip ───────────────────────────

  // Couleurs vives (plus lisibles sur fond de carte que les pastels CSS)
  const FILL_COLOR = { M: '#1a7abf', F: '#bf2d87', U: '#7c3aed' };

  function _addMarker(map, group, coords) {
    const color = FILL_COLOR[group.sexe] || FILL_COLOR.U;

    // ── Halo blanc (couche de fond, non interactive) ───────────────────────
    // Crée un anneau blanc visible entre la couleur et le fond de carte.
    L.circleMarker(coords, {
      radius:      13,
      fillColor:   '#fff',
      fillOpacity: 1,
      color:       'rgba(0,0,0,0.30)',
      weight:      1,
      interactive: false,
    }).addTo(map);

    // ── Marqueur coloré principal ──────────────────────────────────────────
    const circle = L.circleMarker(coords, {
      radius:      9,
      fillColor:   color,
      fillOpacity: 1,
      color:       'rgba(0,0,0,0.55)',   // contour sombre
      weight:      1.5,
      opacity:     1,
    }).addTo(map);

    const place    = formatPlace(group.lieu) || group.lieu.brut || '';
    const evLines  = group.events.map(ev => {
      const d = formatDate(ev.date);
      return '<span class="map-tt-ev-label">' + ev.label + '</span>'
        + (d ? '<span class="map-tt-ev-date"> – ' + d + '</span>' : '');
    });

    const html =
      '<div class="map-tt">'
      + '<div class="map-tt__name">' + (group.name || '(inconnu)') + '</div>'
      + (place ? '<div class="map-tt__place">' + place + '</div>' : '')
      + '<div class="map-tt__events">' + evLines.join('') + '</div>'
      + '</div>';

    circle.bindTooltip(html, { direction: 'top', sticky: false, className: 'map-leaflet-tooltip' });
  }

  // ── Point d'entrée principal ──────────────────────────────────────────────

  /**
   * Géocode tous les lieux de la fiche, initialise la carte Leaflet et place
   * les marqueurs colorés.
   *
   * @param {HTMLElement}  container  Div recevant la carte (hauteur fixée par CSS)
   * @param {Object}       person     Données complètes de la personne sélectionnée
   * @param {Object|null}  conjoint   Données complètes du conjoint principal
   * @param {Object|null}  mariage    Événement mariage de l'union principale
   * @returns {L.Map|null}            Instance Leaflet (ou null si rien à afficher)
   */
  async function render(container, person, conjoint, mariage) {

    // ── Déterminer homme (gauche/bleu) et femme (droite/rose) ────────────────
    let maleP = null, femaleP = null;
    if (!conjoint) {
      if (person && person.sexe === 'F') femaleP = person;
      else                               maleP   = person;
    } else {
      const pMale = person  && person.sexe  === 'M';
      const cMale = conjoint && conjoint.sexe === 'M';
      if (pMale || (!pMale && !cMale)) { maleP = person;   femaleP = conjoint; }
      else                              { maleP = conjoint; femaleP = person;   }
    }

    const maleEvs   = _eventsForPerson(maleP,   mariage);
    const femaleEvs = _eventsForPerson(femaleP, mariage);

    // ── Grouper les événements par lieu (clé = lieu formaté + sexe) ──────────
    const markerMap = {};

    function _addToGroup(evs, sexe, p) {
      evs.forEach(ev => {
        const k = (formatPlace(ev.lieu) || ev.lieu.brut || '').trim();
        if (!k) return;
        const mk = k + '|' + sexe;
        if (!markerMap[mk]) {
          markerMap[mk] = { lieu: ev.lieu, sexe, key: k, name: _personName(p), events: [] };
        }
        markerMap[mk].events.push(ev);
      });
    }

    _addToGroup(maleEvs,   'M', maleP);
    _addToGroup(femaleEvs, 'F', femaleP);

    const groups = Object.values(markerMap);

    // ── Affichage du spinner pendant le géocodage ─────────────────────────────
    container.innerHTML =
      '<div class="map-spinner">'
      + '<span class="map-spinner__icon">⏳</span>'
      + '<span>Géolocalisation…</span>'
      + '</div>';

    // ── Géocodage séquentiel (200 ms entre chaque requête) ────────────────────
    const resolved = [];
    for (let i = 0; i < groups.length; i++) {
      if (i > 0) await _sleep(200);
      const g = groups[i];
      const c = await _geocode(g.lieu);
      if (c) resolved.push({ g, c });
    }

    // ── Nettoyage du spinner ──────────────────────────────────────────────────
    container.innerHTML = '';

    if (!resolved.length) {
      container.classList.add('persons-map--no-data');
      container.textContent = 'Aucun lieu géolocalisable pour cette fiche.';
      return null;
    }

    // ── Initialisation Leaflet ────────────────────────────────────────────────
    // requestAnimationFrame garantit que le conteneur est bien dimensionné
    await new Promise(r => requestAnimationFrame(r));

    const map = L.map(container, { zoomControl: true }).setView([46.5, 2.5], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // invalidateSize pour les layouts sticky/flex où la taille peut changer
    await new Promise(r => requestAnimationFrame(r));
    map.invalidateSize();

    // ── Ajout des marqueurs ───────────────────────────────────────────────────
    resolved.forEach(({ g, c }) => _addMarker(map, g, c));

    // ── Cadrage automatique ───────────────────────────────────────────────────
    // On ne zoome jamais plus près que le niveau 10 (contexte ville/région).
    // Sans maxZoom, fitBounds zoomait au maximum quand plusieurs lieux
    // se trouvent dans la même ville (coords quasi identiques).
    const MAX_ZOOM = 10;
    const coords = resolved.map(r => r.c);
    if (coords.length === 1) {
      map.setView(coords[0], 9);   // ville + contexte régional
    } else {
      map.fitBounds(L.latLngBounds(coords), { padding: [50, 50], maxZoom: MAX_ZOOM });
    }

    return map;
  }

  // ── Vérification rapide (sans géocodage) ─────────────────────────────────

  /**
   * Retourne true si au moins un événement parmi la personne, le conjoint
   * ou le mariage possède un champ lieu renseigné.
   * Permet de décider du layout AVANT de lancer le géocodage.
   */
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

