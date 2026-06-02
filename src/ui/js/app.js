'use strict';

// ── Initialisation ─────────────────────────────────────────────────────────
const api          = new ApiClient('src/server/Api');
const searchInput  = document.getElementById('search-input');
const searchDrop   = document.getElementById('search-dropdown');
const personView   = document.getElementById('person-view');
const welcomeEl    = document.getElementById('welcome');

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

      const years = yearsLabel(r.naissance_date, r.deces_date);
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

let _loadSeq = 0;  // séquence de chargement pour annuler les requêtes périmées

async function loadPerson(id) {
  const seq = ++_loadSeq;
  welcomeEl.hidden = true;
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

  // Sosa ≥ 2 : arbre depuis l'API (avec chaîne d'ancêtres jusqu'au Sosa 1)
  // Sinon    : arbre local (couple + grands-parents + enfants, sans chaîne)
  let treeData = null;
  if (data.person.sosa != null && data.person.sosa >= 2) {
    try { treeData = await api.getSosaTree(data.person.sosa); } catch (e) {}
  } else {
    treeData = buildLocalTree(data, primary);
  }

  personView.appendChild(renderCoupleCard(data.person, data.parents, primary, others, onSelect, treeData));

  // Documents riches : rendu pleine largeur, en dehors de la carte
  const docs = primary ? (primary.documents || []) : [];
  const docsSection = renderDocuments(docs);
  if (docsSection) {
    docsSection.classList.add('doc-section--fullwidth');
    personView.appendChild(docsSection);
  }
}

// ── Navigation navigateur (back / forward) ─────────────────────────────────

window.addEventListener('popstate', e => {
  if (e.state && e.state.id) {
    loadPerson(e.state.id);
  } else {
    personView.innerHTML = '';
    welcomeEl.hidden = false;
  }
});

function goHome() {
  history.pushState(null, '', location.pathname);
  personView.innerHTML = '';
  welcomeEl.hidden = false;
}

// ── Chargement initial depuis le hash ──────────────────────────────────────

(function init() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) loadPerson(hash);
})();
