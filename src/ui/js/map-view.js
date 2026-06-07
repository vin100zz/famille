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
   * Retourne les événements individuels d'une personne qui ont un lieu.
   * Le mariage est exclu ici ; il est géré séparément comme événement commun.
   */
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
    if (!p) return '';
    return [p.prenom, p.nom].filter(Boolean).join(' ');
  }

  // ── Marqueurs ─────────────────────────────────────────────────────────────

  // Couleurs lues depuis les variables CSS (même palette que les bordures de l'arbre)
  function _fillColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      M: s.getPropertyValue('--sex-M').trim() || '#ADE6F4',
      F: s.getPropertyValue('--sex-F').trim() || '#FFC1F6',
      U: s.getPropertyValue('--sex-U').trim() || '#c4b5fd',
    };
  }

  /** Petit cercle splitté inline pour les événements de couple dans le tooltip. */
  function _splitDotHtml(cL, cR) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="map-tt__split-dot">'
      + '<circle cx="8" cy="8" r="7" fill="white" stroke="rgba(0,0,0,0.20)" stroke-width="0.5"/>'
      + '<path d="M8,3 A5,5 0 0,0 8,13 L8,8 Z" fill="' + cL + '"/>'
      + '<path d="M8,3 A5,5 0 0,1 8,13 L8,8 Z" fill="' + cR + '"/>'
      + '<circle cx="8" cy="8" r="5" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>'
      + '</svg>';
  }

  function _addMarker(map, group, coords, fillColor) {
    const place = formatPlace(group.lieu) || group.lieu.brut || '';
    const cL    = fillColor.M || fillColor.U;
    const cR    = fillColor.F || fillColor.U;

    // ── Tooltip ───────────────────────────────────────────────────────────────
    let html = '<div class="map-tt">';
    if (place) html += '<div class="map-tt__place">' + place + '</div>';

    // Événements individuels (un bloc par personne)
    group.persons.forEach(pe => {
      html += '<div class="map-tt__person">'
        + '<div class="map-tt__person-hd">'
        + '<span class="map-tt__dot map-tt__dot--' + pe.sexe + '"></span>'
        + '<span class="map-tt__name">' + (pe.name || '(inconnu)') + '</span>'
        + '</div><div class="map-tt__events">';
      pe.events.forEach(ev => {
        const d = formatDate(ev.date);
        html += '<div><span class="map-tt-ev-label">' + ev.label + '</span>'
          + (d ? '<span class="map-tt-ev-date"> – ' + d + '</span>' : '') + '</div>';
      });
      html += '</div></div>';
    });

    // Événements communs (mariage) : en dernier, avec l'icône splittée
    if (group.coupleEvents && group.coupleEvents.length) {
      group.coupleEvents.forEach(ev => {
        const d = formatDate(ev.date);
        html += '<div class="map-tt__couple-ev">'
          + _splitDotHtml(cL, cR)
          + '<span class="map-tt-ev-label">' + ev.label + '</span>'
          + (d ? '<span class="map-tt-ev-date"> – ' + d + '</span>' : '')
          + '</div>';
      });
    }
    html += '</div>';

    const tooltipOpts = { direction: 'top', sticky: false, className: 'map-leaflet-tooltip' };

    // ── Type de marqueur ──────────────────────────────────────────────────────
    // Splitté si : 2 personnes, ou mariage commun (même seul à cet endroit)
    const isCouple = group.persons.length >= 2
      || (group.coupleEvents && group.coupleEvents.length > 0);

    if (isCouple) {
      // Marqueur splitté : moitié gauche = homme, moitié droite = femme
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">'
        + '<circle cx="15" cy="15" r="14" fill="white" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>'
        + '<path d="M15,6 A9,9 0 0,0 15,24 L15,15 Z" fill="' + cL + '"/>'
        + '<path d="M15,6 A9,9 0 0,1 15,24 L15,15 Z" fill="' + cR + '"/>'
        + '<circle cx="15" cy="15" r="9" fill="none" stroke="rgba(0,0,0,0.50)" stroke-width="1.5"/>'
        + '</svg>';
      const icon = L.divIcon({ html: svg, className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker(coords, { icon }).bindTooltip(html, tooltipOpts).addTo(map);

    } else {
      // Marqueur simple (une seule personne, aucun mariage commun ici)
      const color = fillColor[group.persons[0].sexe] || fillColor.U;
      L.circleMarker(coords, {
        radius: 13, fillColor: '#fff', fillOpacity: 1,
        color: 'rgba(0,0,0,0.25)', weight: 1, interactive: false,
      }).addTo(map);
      L.circleMarker(coords, {
        radius: 9, fillColor: color, fillOpacity: 1,
        color: 'rgba(0,0,0,0.50)', weight: 1.5,
      }).bindTooltip(html, tooltipOpts).addTo(map);
    }
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

    // Événements individuels (mariage exclu)
    const maleEvs   = _eventsForPerson(maleP);
    const femaleEvs = _eventsForPerson(femaleP);

    // ── Grouper par lieu ──────────────────────────────────────────────────────
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

    // Mariage : événement commun, affiché une seule fois dans le groupe de son lieu
    if (mariage && mariage.lieu) {
      const k = (formatPlace(mariage.lieu) || mariage.lieu.brut || '').trim();
      if (k) {
        if (!markerMap[k]) markerMap[k] = { lieu: mariage.lieu, key: k, persons: [], coupleEvents: [] };
        markerMap[k].coupleEvents.push({ label: 'Mariage', date: mariage.date || null });
      }
    }

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
    const fillColor = _fillColors();
    resolved.forEach(({ g, c }) => _addMarker(map, g, c, fillColor));

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

