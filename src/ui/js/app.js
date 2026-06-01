'use strict';

// ── Initialisation ─────────────────────────────────────────────────────────
const api          = new ApiClient('src/server/Api');
const searchInput  = document.getElementById('search-input');
const searchDrop   = document.getElementById('search-dropdown');
const personView   = document.getElementById('person-view');
const welcomeEl    = document.getElementById('welcome');

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

async function renderPersonPage(data, seq) {
  personView.innerHTML = '';
  const onSelect = id => selectPerson(id);
  const unions   = data.unions || [];

  // Chargement de l'arbre avant le rendu pour l'insérer avant "Naissance"
  let treeData = null;
  if (data.person.sosa != null && data.person.sosa >= 2) {
    try { treeData = await api.getSosaTree(data.person.sosa); } catch (e) {}
  }

  if (!unions.length) {
    personView.appendChild(renderCoupleCard(data.person, data.parents, null, [], onSelect, treeData));
  } else {
    // Priorité à l'union dont le conjoint a un numéro Sosa
    const sosaIdx    = unions.findIndex(u => u.conjoint && u.conjoint.sosa != null);
    const primaryIdx = sosaIdx >= 0 ? sosaIdx : 0;
    const primary    = unions[primaryIdx];
    const others     = unions.filter((_, i) => i !== primaryIdx);
    personView.appendChild(renderCoupleCard(data.person, data.parents, primary, others, onSelect, treeData));
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
