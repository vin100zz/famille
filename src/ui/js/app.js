'use strict';

// ── Initialisation ─────────────────────────────────────────────────────────
const api             = new ApiClient('src/server/Api');
const searchInput     = document.getElementById('search-input');
const searchDrop      = document.getElementById('search-dropdown');
const personView      = document.getElementById('person-view');
const welcomeEl       = document.getElementById('welcome');
const mainEl          = document.getElementById('main-content');
const homeBtnEl       = document.getElementById('home-btn');
const globalMapScreen = document.getElementById('global-map-screen');
const globalMapBtn    = document.getElementById('global-map-btn');

// ── Carte globale ──────────────────────────────────────────────────────────

let _globalMapOpen = false;

function toggleGlobalMap() {
  _globalMapOpen = !_globalMapOpen;
  if (_globalMapOpen) {
    globalMapScreen.hidden = false;
    globalMapBtn.classList.add('header-map-btn--active');
    GlobalMap.open(globalMapScreen);
  } else {
    GlobalMap.close();
    globalMapScreen.hidden = true;
    globalMapBtn.classList.remove('header-map-btn--active');
  }
}

// Calcule et met à jour --hdr-h (hauteur réelle du header sticky)
function _updateHdrH() {
  const hdr  = document.querySelector('.site-header');
  const hdrH = hdr ? hdr.offsetHeight : 60;
  document.documentElement.style.setProperty('--hdr-h', hdrH + 'px');
}
_updateHdrH();
window.addEventListener('resize', _updateHdrH);

function _showHomeBtn(visible) {
  if (homeBtnEl) homeBtnEl.hidden = !visible;
}

// ── Lightbox ────────────────────────────────────────────────────────────────

(function initLightbox() {
  const lb    = document.getElementById('lightbox');
  const close = document.getElementById('lightbox-close');
  if (!lb || !close) return;

  function closeLb() {
    lb.classList.remove('lightbox--open');
    document.getElementById('lightbox-img').src = '';
  }

  close.addEventListener('click', closeLb);
  lb.addEventListener('click', function(e) {
    if (e.target === lb) closeLb();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeLb();
  });
})();

// ── Recherche / autocomplete ───────────────────────────────────────────────

let searchTimer    = null;
let activeIdx      = -1;
let currentResults = [];

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) { hideDropdown(); return; }
  searchTimer = setTimeout(() => doSearch(q), 260);
});

searchInput.addEventListener('keydown', e => {
  if (searchDrop.hidden) return;
  const items = searchDrop.querySelectorAll('.search-result:not(.search-result--empty)');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(items, Math.min(activeIdx + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(items, Math.max(activeIdx - 1, 0));
  } else if (e.key === 'Enter' && activeIdx >= 0) {
    e.preventDefault();
    selectPerson(currentResults[activeIdx].id);
  } else if (e.key === 'Escape') {
    hideDropdown();
  }
});

// Ferme le dropdown si clic en dehors
document.addEventListener('click', e => {
  if (!searchInput.contains(e.target) && !searchDrop.contains(e.target)) {
    hideDropdown();
  }
});

async function doSearch(q) {
  try {
    const results = await api.search(q);
    currentResults = results;
    renderDropdown(results, q);
  } catch (err) {
    console.error('Recherche :', err);
  }
}

function renderDropdown(results, query) {
  searchDrop.innerHTML = '';
  activeIdx = -1;

  if (!results.length) {
    const empty = el('div', 'search-result search-result--empty');
    empty.textContent = 'Aucun résultat';
    searchDrop.appendChild(empty);
  } else {
    results.forEach((r, i) => {
      const item = el('div', 'search-result');
      item.setAttribute('role', 'option');

      const dot = el('span', 'result-dot result-dot--' + sexClass(r.sexe));
      item.appendChild(dot);

      const info = el('div', 'result-info');

      // Nom + prénom avec highlight
      const nameEl = el('div', 'result-name');
      const parts = [r.nom, r.prenom].filter(Boolean);
      if (parts.length) {
        parts.forEach((part, pi) => {
          if (pi > 0) nameEl.appendChild(document.createTextNode(' '));
          highlightNodes(part, query).forEach(n => nameEl.appendChild(n));
        });
      } else {
        nameEl.textContent = '(inconnu)';
      }
      info.appendChild(nameEl);

      const years = yearsLabel(r.naissance_year, r.deces_year);
      if (years) info.appendChild(txt('div', 'result-years', years));
      item.appendChild(info);

      // Badge Sosa (avec highlight si la query est numérique)
      if (r.sosa != null) {
        const sosaEl = el('span', 'result-sosa');
        highlightNodes('Sosa\u00a0' + r.sosa, query).forEach(n => sosaEl.appendChild(n));
        item.appendChild(sosaEl);
      }

      item.addEventListener('click', () => selectPerson(r.id));
      searchDrop.appendChild(item);
    });
  }

  searchDrop.hidden = false;
}

function setActive(items, idx) {
  if (activeIdx >= 0 && items[activeIdx]) {
    items[activeIdx].classList.remove('search-result--active');
  }
  activeIdx = idx;
  if (items[activeIdx]) {
    items[activeIdx].classList.add('search-result--active');
    items[activeIdx].scrollIntoView({ block: 'nearest' });
  }
}

function hideDropdown() {
  searchDrop.hidden = true;
  activeIdx = -1;
}

// ── Navigation ──────────────────────────────────────────────────────────────

async function selectPerson(id) {
  hideDropdown();
  searchInput.value = '';
  history.pushState({ id }, '', '#' + encodeURIComponent(id));
  await loadPerson(id);
}

let _loadSeq  = 0;  // séquence de chargement pour annuler les requêtes périmées
let _activeMap = null; // instance Leaflet en cours (détruite à chaque nouvelle fiche)

async function loadPerson(id) {
  const seq = ++_loadSeq;

  // Détruire la carte précédente et fermer l'éditeur avant de vider le DOM
  if (_activeMap) { _activeMap.remove(); _activeMap = null; }
  Editor.close();

  welcomeEl.hidden = true;
  mainEl.hidden    = false;
  _showHomeBtn(true);
  CircularTree.showControls(false);
  personView.innerHTML = '';
  personView.appendChild(txt('div', 'loading', 'Chargement…'));

  try {
    const data = await api.getPerson(id);
    if (seq !== _loadSeq) return;   // une navigation plus récente a pris le relais
    renderPersonPage(data, seq);
  } catch (err) {
    if (seq !== _loadSeq) return;
    personView.innerHTML = '';
    personView.appendChild(txt('div', 'error', 'Erreur : ' + err.message));
  }
}

// ── Arbre local (personnes sans numéro Sosa) ───────────────────────────────

/**
 * Répartit un tableau de résumés de parents en [père|null, mère|null].
 */
function summariesToParents(summaries) {
  let father = null, mother = null;
  for (const s of summaries) {
    if (s.sexe === 'M' && !father)      father = s;
    else if (s.sexe === 'F' && !mother) mother = s;
  }
  return [father, mother];
}

/**
 * Construit les données d'arbre à partir des données déjà disponibles
 * (pas d'appel API supplémentaire). Pas de chaîne d'ancêtres.
 */
function buildLocalTree(data, union) {
  const person          = data.person;
  const conjoint        = union ? union.conjoint        : null;
  const personSummary   = personToSummary(person);
  const conjointSummary = conjoint ? personToSummary(conjoint) : null;

  const personParents   = summariesToParents(data.parents || []);
  const conjointParents = summariesToParents(union ? (union.conjoint_parents || []) : []);

  const personMale   = person.sexe === 'M';
  const conjointMale = conjoint && conjoint.sexe === 'M';

  let male, female, maleParents, femaleParents;
  if (!conjoint || personMale || (!personMale && !conjointMale)) {
    male = personSummary;   maleParents   = personParents;
    female = conjointSummary; femaleParents = conjointParents;
  } else {
    male = conjointSummary; maleParents   = conjointParents;
    female = personSummary; femaleParents = personParents;
  }

  return {
    sosa:           null,
    couple:         { male, female },
    male_parents:   maleParents,
    female_parents: femaleParents,
    children:       union ? (union.enfants || []) : [],
    ancestors:      [],
  };
}

// ── Rendu de la page personne ───────────────────────────────────────────────

async function renderPersonPage(data, seq) {
  personView.innerHTML = '';
  const onSelect = id => selectPerson(id);
  const unions   = data.unions || [];

  const sosaIdx    = unions.findIndex(u => u.conjoint && u.conjoint.sosa != null);
  const primaryIdx = sosaIdx >= 0 ? sosaIdx : 0;
  const primary    = unions.length ? unions[primaryIdx] : null;
  const others     = unions.filter((_, i) => i !== primaryIdx);

  const conjoint = primary ? primary.conjoint : null;
  const mariage  = primary ? primary.mariage  : null;

  // Bouton Mode Édition (position fixe, indépendant du layout)
  const editBar = el('div', 'view-edit-bar');
  const editBtn = el('button', 'view-edit-btn');
  editBtn.type = 'button';
  editBtn.textContent = '\u270F\uFE0F Modifier';
  editBtn.addEventListener('click', () => {
    Editor.open({
      personId:        data.person.id,
      person:          data.person,
      familleId:       primary ? primary.famille_id : null,
      conjointId:      primary && primary.conjoint ? primary.conjoint.id : null,
      conjoint:        primary ? primary.conjoint   : null,
      union:           primary,
      parents:         data.parents || [],
      conjointParents: primary ? (primary.conjoint_parents || []) : [],
    }, () => loadPerson(data.person.id));
  });
  editBar.appendChild(editBtn);
  personView.appendChild(editBar);

  let treeData = buildLocalTree(data, primary);
  const personSosa = data.person.sosa;
  if (personSosa != null && personSosa >= 2) {
    try { treeData = await api.getSosaTree(personSosa); } catch (e) {}
  } else if (conjoint && conjoint.sosa != null && conjoint.sosa >= 2) {
    try { treeData = await api.getSosaTree(conjoint.sosa); } catch (e) {}
  }
  const coupleCard  = renderCoupleCard(data.person, data.parents, primary, others, onSelect, treeData);
  const docs        = primary ? (primary.documents || []) : [];
  const docsSection = renderDocuments(docs);

  const hasMap = PersonsMap.hasLocations(data.person, conjoint, mariage);

  if (!hasMap) {
    // ── Layout centré standard (aucun lieu référencé) ─────────────────────
    personView.appendChild(coupleCard);
    if (docsSection) {
      docsSection.classList.add('doc-section--fullwidth');
      personView.appendChild(docsSection);
    }
    return;
  }

  // ── Layout pleine largeur : fiche (2/3) + carte dans le flow (1/3) ───────
  // La carte est au même niveau que la fiche ; les documents passent dessous.

  const layout = el('div', 'person-page-layout');

  // Colonne gauche : fiche uniquement
  const leftCol = el('div', 'person-page-main');
  leftCol.appendChild(coupleCard);
  layout.appendChild(leftCol);

  // Colonne droite : carte
  const rightCol = el('div', 'person-page-map-col');
  const mapEl    = el('div', 'persons-map persons-map--side');
  rightCol.appendChild(mapEl);
  layout.appendChild(rightCol);

  personView.appendChild(layout);

  // Documents sous les deux colonnes, pleine largeur
  if (docsSection) {
    docsSection.classList.add('doc-section--fullwidth');
    personView.appendChild(docsSection);
  }

  const mapInst = await PersonsMap.render(mapEl, data.person, conjoint, mariage);

  if (seq !== _loadSeq) {
    if (mapInst) mapInst.remove();
  } else {
    _activeMap = mapInst;
  }
}

// ── Navigation navigateur (back / forward) ─────────────────────────────────

window.addEventListener('popstate', e => {
  if (e.state && e.state.id) {
    loadPerson(e.state.id);
  } else {
    if (_activeMap) { _activeMap.remove(); _activeMap = null; }
    Editor.close();
    personView.innerHTML = '';
    welcomeEl.hidden = false;
    mainEl.hidden    = true;
    _showHomeBtn(false);
    CircularTree.showControls(true);
    CircularTree.redraw();
  }
});

function goHome() {
  if (_activeMap) { _activeMap.remove(); _activeMap = null; }
  Editor.close();
  history.pushState(null, '', location.pathname);
  personView.innerHTML = '';
  welcomeEl.hidden = false;
  mainEl.hidden    = true;
  _showHomeBtn(false);
  CircularTree.showControls(true);
  CircularTree.redraw();   // no-op si pas encore initialisé (init() est async)
}

// ── Création d'une nouvelle personne ───────────────────────────────────────

function openCreatePerson() {
  const modal = document.getElementById('create-modal');
  document.getElementById('cp-nom').value    = '';
  document.getElementById('cp-prenom').value = '';
  document.querySelector('input[name="cp-sexe"][value="M"]').checked = true;
  const errEl = document.getElementById('create-modal-error');
  errEl.hidden = true;
  errEl.textContent = '';
  modal.hidden = false;
  document.getElementById('cp-nom').focus();
}

function closeCreatePerson() {
  document.getElementById('create-modal').hidden = true;
}

async function submitCreatePerson() {
  const nom    = document.getElementById('cp-nom').value.trim();
  const prenom = document.getElementById('cp-prenom').value.trim();
  const sexe   = document.querySelector('input[name="cp-sexe"]:checked').value || null;

  if (!nom && !prenom) {
    const errEl = document.getElementById('create-modal-error');
    errEl.textContent = 'Veuillez saisir au moins un nom ou un prénom.';
    errEl.hidden = false;
    return;
  }

  const btn = document.getElementById('create-modal-submit');
  btn.disabled = true;
  btn.textContent = 'Création…';

  try {
    const personData = {};
    if (nom)    personData.nom    = nom;
    if (prenom) personData.prenom = prenom;
    if (sexe)   personData.sexe   = sexe;

    const TEMP = '__new__';
    const result = await api.saveAll({
      newPersons:    { [TEMP]: personData },
      newFamilies:   {},
      updatePersons: {},
      updateFamilies:{},
      deleteFamilies:[],
    });

    closeCreatePerson();
    const newId = result.idMap && result.idMap[TEMP];
    if (newId) {
      await selectPerson(newId);
    }
  } catch (err) {
    const errEl = document.getElementById('create-modal-error');
    errEl.textContent = 'Erreur : ' + err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Créer';
  }
}

// Fermer le modal avec Échap
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('create-modal');
    if (modal && !modal.hidden) closeCreatePerson();
  }
});

// ── Chargement initial depuis le hash ──────────────────────────────────────

(function init() {
  // L'arbre circulaire est toujours initialisé (en arrière-plan si besoin),
  // pour qu'il soit prêt quand l'utilisateur revient à l'accueil.
  const container = document.getElementById('tree-container');
  const treeReady = CircularTree.init(container, id => selectPerson(id));

  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) {
    // Démarrage direct sur une fiche
    mainEl.hidden    = false;
    welcomeEl.hidden = true;
    loadPerson(hash);
    // Afficher les contrôles de zoom uniquement quand l'arbre sera prêt ET qu'on
    // sera revenu à l'accueil (géré dans goHome/popstate)
  } else {
    // Démarrage sur l'accueil
    mainEl.hidden    = true;
    welcomeEl.hidden = false;
    treeReady.then(() => CircularTree.showControls(true));
  }
})();
