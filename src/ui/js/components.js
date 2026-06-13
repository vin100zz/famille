'use strict';

// ── Utilitaires DOM ────────────────────────────────────────────────────────

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function txt(tag, className, content) {
  const e = el(tag, className);
  if (content != null) e.textContent = content;
  return e;
}

// ── Utilitaires données ────────────────────────────────────────────────────

function sexClass(sexe) {
  return sexe === 'M' ? 'M' : sexe === 'F' ? 'F' : 'U';
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

/**
 * Normalise une chaîne pour la recherche : minuscules + suppression des accents.
 * Chaque caractère NFC source produit exactement 1 caractère normalisé,
 * ce qui garantit la correspondance des index avec le texte original.
 */
function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Retourne un tableau de nœuds DOM (texte + <mark class="hl">) représentant
 * `text` avec la partie correspondant à `query` mise en évidence.
 */
function highlightNodes(text, query) {
  if (!text) return [document.createTextNode('')];
  if (!query) return [document.createTextNode(text)];
  const normText  = normalizeStr(text);
  const normQuery = normalizeStr(query);
  const idx = normText.indexOf(normQuery);
  if (idx === -1) return [document.createTextNode(text)];
  const len   = normQuery.length;
  const nodes = [];
  if (idx > 0) nodes.push(document.createTextNode(text.slice(0, idx)));
  const mark = document.createElement('mark');
  mark.className = 'hl';
  mark.textContent = text.slice(idx, idx + len);
  nodes.push(mark);
  if (idx + len < text.length) nodes.push(document.createTextNode(text.slice(idx + len)));
  return nodes;
}

const MONTHS_FR = {
  JAN:'jan.', FEB:'fév.', MAR:'mars', APR:'avr.', MAY:'mai', JUN:'juin',
  JUL:'juil.', AUG:'août', SEP:'sep.', OCT:'oct.', NOV:'nov.', DEC:'déc.'
};

function formatDate(dateStr) {
  if (!dateStr) return null;
  return String(dateStr)
    .replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi,
      m => MONTHS_FR[m.toUpperCase()] || m)
    .replace(/\bBET\b/gi, 'entre').replace(/\bAND\b/gi, 'et')
    .replace(/\bABT\b/gi, 'vers') .replace(/\bBEF\b/gi, 'avant')
    .replace(/\bAFT\b/gi, 'après').replace(/\bCAL\b/gi, 'calculé')
    .replace(/\bESTD?\b/gi, 'estimé');
}

function formatPlace(lieu) {
  if (!lieu) return null;
  const parts = [];
  if (lieu.adresse)    parts.push(lieu.adresse);
  if (lieu.dept_num)   parts.push(lieu.dept_num);
  if (lieu.ville)      parts.push(lieu.ville);
  return parts.length ? parts.join(', ') : (lieu.brut || null);
}

/**
 * Extrait l'année d'une chaîne de date GEDCOM en préservant le qualificatif :
 *   "AFT 1751"  → "ap. 1751"
 *   "BEF 1751"  → "av. 1751"
 *   "ABT 1751"  → "v. 1751"
 *   "1751"      → "1751"
 */
function extractYearLabel(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).toUpperCase();
  const m = s.match(/\b(\d{4})\b/);
  if (!m) return null;
  const year = m[1];
  if (/\bAFT\b/.test(s))             return 'ap.\u00a0' + year;
  if (/\bBEF\b/.test(s))             return 'av.\u00a0' + year;
  if (/\b(ABT|CAL|ESTD?)\b/.test(s)) return 'v.\u00a0'  + year;
  return year;
}

/**
 * Construit le label "naissance – décès" à partir des chaînes de date GEDCOM brutes.
 * Après 1900, l'absence de décès n'affiche pas de "?".
 */
function yearsLabel(birthDate, deathDate) {
  const birthY     = extractYear(birthDate);
  const birthLabel = extractYearLabel(birthDate);
  const deathLabel = extractYearLabel(deathDate);
  if (!birthLabel && !deathLabel) return null;
  const deathPart = deathLabel || (birthY && birthY >= 1900 ? '' : '?');
  if (!deathPart) return birthLabel;
  return (birthLabel || '?') + '\u00a0–\u00a0' + deathPart;
}

// ── Boîte personne (parents / enfants) ────────────────────────────────────

/**
 * Retourne un bouton cliquable au style boîte généalogique.
 * @param {Object}   summary  { id, nom, prenom, sexe, naissance_year, deces_year }
 * @param {Function} onSelect callback(id)
 */
function renderPersonBox(summary, onSelect) {
  if (!summary) return null;

  const sc  = sexClass(summary.sexe);
  const box = el('button', 'person-box person-box--' + sc);
  box.type  = 'button';
  box.title = 'Voir la fiche';

  if (summary.sosa != null) {
    box.classList.add('person-box--has-sosa');
    box.appendChild(txt('span', 'person-box__sosa', summary.sosa));
  }

  const nameEl = el('span', 'person-box__name');
  if (summary.nom)    nameEl.appendChild(txt('span', null, summary.nom));
  if (summary.prenom) {
    nameEl.appendChild(document.createElement('br'));
    nameEl.appendChild(txt('span', null, summary.prenom));
  }
  if (!summary.nom && !summary.prenom) nameEl.textContent = '(inconnu)';
  box.appendChild(nameEl);

  const years = yearsLabel(summary.naissance_date, summary.deces_date);
  if (years) box.appendChild(txt('span', 'person-box__years', years));

  box.addEventListener('click', () => onSelect(summary.id));
  return box;
}

// ── Bloc événement (date + lieu) ───────────────────────────────────────────

function renderEventBlock(event) {
  if (!event) return null;
  const wrap  = el('div', 'event-block');
  const date  = formatDate(event.date);
  const place = formatPlace(event.lieu);
  if (date)  wrap.appendChild(txt('span', 'event-date', date));
  if (place) wrap.appendChild(txt('span', 'event-place', place));
  if (!date && !place) return null;
  return wrap;
}

// ── En-tête de colonne personne ────────────────────────────────────────────

function renderPersonHeader(person) {
  const sc     = person ? sexClass(person.sexe) : 'empty';
  const header = el('div', 'person-header person-header--' + sc);
  if (!person) return header;

  if (person.sosa != null) {
    header.appendChild(txt('div', 'sosa-badge', person.sosa));
  }

  if (person.nom)    header.appendChild(txt('div', 'person-header__nom',    person.nom));
  if (person.prenom) header.appendChild(txt('div', 'person-header__prenom', person.prenom));

  const years = yearsLabel(
    person.naissance && person.naissance.date,
    person.deces     && person.deces.date
  );
  if (years) header.appendChild(txt('div', 'person-header__years', years));

  return header;
}

// ── Colonne naissance ──────────────────────────────────────────────────────

function renderNaissanceCol(person, onSelect) {
  const col = el('div', 'person-col' + (person ? '' : ' person-col--empty'));
  if (!person) return col;

  if (!person.naissance) return col;

  if (person.naissance) {
    const ev = renderEventBlock(person.naissance);
    if (ev) col.appendChild(ev);
  }


  return col;
}

// ── Colonne professions ────────────────────────────────────────────────────

function renderProfessionsCol(person) {
  const col = el('div', 'person-col' + (person ? '' : ' person-col--empty'));
  if (!person || !person.professions || !person.professions.length) return col;

  const profs = person.professions.map(p => p ? p.charAt(0).toUpperCase() + p.slice(1) : p);

  if (profs.length === 1) {
    col.appendChild(txt('span', null, profs[0]));
  } else {
    const ul = el('ul', 'simple-list');
    profs.forEach(p => ul.appendChild(txt('li', null, p)));
    col.appendChild(ul);
  }
  return col;
}

// ── Colonne résidences ─────────────────────────────────────────────────────

function renderResidencesCol(person) {
  const col = el('div', 'person-col' + (person ? '' : ' person-col--empty'));
  if (!person || !person.residences || !person.residences.length) return col;

  person.residences.forEach(r => {
    const ev = renderEventBlock(r);
    if (ev) col.appendChild(ev);
  });
  return col;
}

// ── Colonne décès ──────────────────────────────────────────────────────────

function renderDecesCol(person) {
  const col = el('div', 'person-col' + (person ? '' : ' person-col--empty'));
  if (!person) return col;
  const hasDeces    = person.deces;
  const hasSepulture = person.sepulture;
  if (!hasDeces && !hasSepulture) return col;

  if (hasDeces) {
    const ev = renderEventBlock(person.deces);
    if (ev) col.appendChild(ev);
  }

  if (hasSepulture) {
    col.appendChild(txt('div', 'section-sublabel', 'Sépulture'));
    const ev = renderEventBlock(person.sepulture);
    if (ev) col.appendChild(ev);
  }

  return col;
}

// ── Colonne commentaires ───────────────────────────────────────────────────

/**
 * Retourne un bloc repliable : icône "i" jaune + contenu masqué par défaut.
 */
function renderCollapsibleComments(comments) {
  if (!comments || !comments.length) return null;

  const wrap = el('div', 'comment-collapsible');

  const btn = el('button', 'comment-toggle');
  btn.type  = 'button';
  btn.title = 'Afficher / masquer les commentaires';
  btn.textContent = 'i';

  const body = el('div', 'comment-body');
  body.hidden = true;
  comments.forEach(c => body.appendChild(txt('p', 'comment-text', c)));

  btn.addEventListener('click', () => {
    body.hidden = !body.hidden;
    btn.classList.toggle('comment-toggle--open', !body.hidden);
  });

  wrap.appendChild(btn);
  wrap.appendChild(body);
  return wrap;
}

function renderCommentairesCol(person) {
  const col = el('div', 'person-col' + (person ? '' : ' person-col--empty'));
  if (!person || !person.commentaires || !person.commentaires.length) return col;

  const block = renderCollapsibleComments(person.commentaires);
  if (block) col.appendChild(block);
  return col;
}

// ── Section : barre de titre + paire de colonnes ──────────────────────────

/**
 * Construit une section avec :
 *   - une barre de titre pleine largeur (section-bar)
 *   - une couple-row avec les deux colonnes de contenu
 *
 * Retourne un DocumentFragment, ou null si les deux colonnes sont vides.
 */
function makeSection(label, leftCol, rightCol) {
  const leftHasContent  = leftCol.children.length  > 0;
  const rightHasContent = rightCol.children.length > 0;
  if (!leftHasContent && !rightHasContent) return null;

  const frag = document.createDocumentFragment();
  frag.appendChild(txt('div', 'section-bar', label));
  const row = el('div', 'couple-row');
  row.appendChild(leftCol);
  row.appendChild(rightCol);
  frag.appendChild(row);
  return frag;
}

/**
 * Convertit les données complètes d'une personne en résumé utilisable
 * par renderPersonBox.
 */
function personToSummary(p) {
  if (!p) return null;
  return {
    id:             p.id,
    nom:            p.nom,
    prenom:         p.prenom,
    sexe:           p.sexe,
    sosa:           p.sosa,
    naissance_year: extractYear(p.naissance && p.naissance.date),
    naissance_date: p.naissance && p.naissance.date || null,
    deces_year:     extractYear(p.deces     && p.deces.date),
    deces_date:     p.deces     && p.deces.date     || null,
  };
}

// ── Arbre généalogique Sosa ────────────────────────────────────────────────

function renderTreePersonBox(summary, onSelect) {
  if (summary) return renderPersonBox(summary, onSelect);
  const box = el('div', 'person-box person-box--U tree-box--ghost');
  return box;
}

// ── Dessin des connecteurs (appelé après rendu DOM) ────────────────────────

function drawTreeConnectors(treeEl) {
  const overlay = treeEl.querySelector('.tree-conn-overlay');
  if (!overlay) return;
  overlay.innerHTML = '';

  const cr = treeEl.getBoundingClientRect();

  // Position du centre d'un élément repéré par [data-tree~=key]
  function C(key) {
    const el = treeEl.querySelector('[data-tree~="' + key + '"]');
    if (!el) return null;
    // On prend le premier .person-box ou .tree-box--ghost à l'intérieur
    const box = el.querySelector('.person-box, .tree-box--ghost') || el;
    const r   = box.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left,
             y: r.top  + r.height / 2 - cr.top  };
  }

  // Tous les éléments commençant par un préfixe (éléments visibles uniquement)
  function Clist(prefix) {
    return Array.from(treeEl.querySelectorAll('[data-tree^="' + prefix + '"]'))
      .filter(function(e) {
        const b = e.querySelector('.person-box, .tree-box--ghost') || e;
        return b.offsetWidth > 0;
      })
      .map(function(e) {
        const b = e.querySelector('.person-box, .tree-box--ghost') || e;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2 - cr.left,
                 y: r.top  + r.height / 2 - cr.top  };
      });
  }

  function hLine(x1, x2, y) {
    const d = document.createElement('div');
    d.className = 'tree-conn-h';
    d.style.left   = Math.round(Math.min(x1, x2)) + 'px';
    d.style.top    = Math.round(y - 1) + 'px';
    d.style.width  = Math.round(Math.abs(x2 - x1)) + 'px';
    overlay.appendChild(d);
  }

  function vLine(x, y1, y2) {
    const d = document.createElement('div');
    d.className = 'tree-conn-v';
    d.style.left   = Math.round(x - 1) + 'px';
    d.style.top    = Math.round(Math.min(y1, y2)) + 'px';
    d.style.height = Math.round(Math.abs(y2 - y1)) + 'px';
    overlay.appendChild(d);
  }

  const gp0 = C('gp0'), gp1 = C('gp1'), gp2 = C('gp2'), gp3 = C('gp3');
  const male = C('male'), female = C('female');
  const kids = Clist('child-');
  const ancs = Clist('anc-');
  const dc   = C('direct-child');

  // 1. Horizontal GP1-GP2 + vertical vers le mari
  if (gp0 && gp1) {
    const y = (gp0.y + gp1.y) / 2;
    hLine(gp0.x, gp1.x, y);
    if (male) vLine((gp0.x + gp1.x) / 2, y, male.y);
  }

  // 2. Horizontal GP3-GP4 + vertical vers l'épouse
  if (gp2 && gp3) {
    const y = (gp2.y + gp3.y) / 2;
    hLine(gp2.x, gp3.x, y);
    if (female) vLine((gp2.x + gp3.x) / 2, y, female.y);
  }

  // 3. Horizontal mari-épouse
  if (male && female) {
    const y = (male.y + female.y) / 2;
    hLine(male.x, female.x, y);

    // 4. Vertical couple → enfants
    if (kids.length) {
      const childY = kids.reduce(function(s,c) { return s+c.y; }, 0) / kids.length;
      vLine((male.x + female.x) / 2, y, childY);
    }
  }

  // 5. Horizontal entre les enfants (premier → dernier)
  if (kids.length > 1) {
    const y = kids.reduce(function(s,c) { return s+c.y; }, 0) / kids.length;
    hLine(kids[0].x, kids[kids.length - 1].x, y);
  }

  // 6. Traits verticaux vers les ancêtres (dans la colonne de l'enfant direct)
  let prev = dc || (kids.length ? kids[Math.floor((kids.length - 1) / 2)] : null);
  ancs.forEach(function(anc) {
    if (prev && anc) { vLine(prev.x, prev.y, anc.y); prev = anc; }
  });
}

// ── Numéros de génération en chiffres romains ──────────────────────────────

function toRoman(n) {
  if (n <= 0) return '?';
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r = '';
  vals.forEach((v, i) => { while (n >= v) { r += syms[i]; n -= v; } });
  return r;
}

function drawGenLabels(wrap, sosa, children, ancestorsToShow) {
  if (!sosa) return;
  const col = wrap.querySelector('.tree-gen-col');
  if (!col) return;
  col.querySelectorAll('.tree-gen-label').forEach(function(l) { l.remove(); });

  const colTop = col.getBoundingClientRect().top;
  const G = Math.floor(Math.log2(sosa)) + 1;

  function addLabel(gen, selector) {
    const ref = wrap.querySelector(selector);
    if (!ref) return;
    const r = ref.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // élément caché
    const label = document.createElement('div');
    label.className = 'tree-gen-label';
    label.textContent = toRoman(gen);
    label.style.top = (r.top - colTop + r.height / 2) + 'px';
    col.appendChild(label);
  }

  addLabel(G + 1, '[data-tree="gp0"]');
  addLabel(G,     '[data-tree="male"]');
  if (children.length) addLabel(G - 1, '[data-tree~="child-0"]');
  ancestorsToShow.forEach(function(_, i) {
    addLabel(G - 2 - i, '[data-tree="anc-' + i + '"]');
  });
}

// ── Arbre Sosa ─────────────────────────────────────────────────────────────

function renderSosaTree(treeData, onSelect, currentPersonId) {
  const sosa          = treeData.sosa;
  const couple        = treeData.couple;
  const maleParents   = treeData.male_parents;
  const femaleParents = treeData.female_parents;
  const children      = treeData.children  || [];
  const ancestors     = treeData.ancestors || [];

  const wrap    = el('div', 'sosa-tree');
  const genCol  = el('div', 'tree-gen-col');
  const content = el('div', 'tree-content');
  wrap.appendChild(genCol);
  wrap.appendChild(content);

  // ── Grille supérieure : 4 colonnes, alternance contenu / espace ───────────
  const upper = el('div', 'tree-upper-grid');

  // Rang 1 : grands-parents
  [maleParents[0], maleParents[1], femaleParents[0], femaleParents[1]].forEach(function(gp, i) {
    const cell = el('div', 'tree-ugrid-cell');
    cell.style.gridColumn = (i + 1) + '';
    cell.style.gridRow    = '1';
    cell.dataset.tree     = 'gp' + i;
    cell.appendChild(renderTreePersonBox(gp, onSelect));
    upper.appendChild(cell);
  });

  // Rang 2 : espace (pour les traits verticaux GP→couple)
  const sp1 = el('div', 'tree-spacer');
  sp1.style.gridColumn = '1 / 5';
  sp1.style.gridRow    = '2';
  upper.appendChild(sp1);

  // Rang 3 : couple
  const maleBox = renderTreePersonBox(couple.male, onSelect);
  if (couple.male) {
    maleBox.classList.add('tree-box--selected');
    if (couple.male.id === currentPersonId) maleBox.disabled = true;
  }
  const maleCell = el('div', 'tree-ugrid-cell');
  maleCell.style.gridColumn = '1 / 3';
  maleCell.style.gridRow    = '3';
  maleCell.dataset.tree     = 'male';
  maleCell.appendChild(maleBox);
  upper.appendChild(maleCell);

  const femaleBox = renderTreePersonBox(couple.female, onSelect);
  if (couple.female) {
    femaleBox.classList.add('tree-box--selected');
    if (couple.female.id === currentPersonId) femaleBox.disabled = true;
  }
  const femaleCell = el('div', 'tree-ugrid-cell');
  femaleCell.style.gridColumn = '3 / 5';
  femaleCell.style.gridRow    = '3';
  femaleCell.dataset.tree     = 'female';
  femaleCell.appendChild(femaleBox);
  upper.appendChild(femaleCell);

  // Rang 4 : espace (pour le trait vertical couple→enfants)
  const sp2 = el('div', 'tree-spacer');
  sp2.style.gridColumn = '1 / 5';
  sp2.style.gridRow    = '4';
  upper.appendChild(sp2);

  content.appendChild(upper);

  // ── Grille inférieure : N colonnes (enfants + ancêtres) ───────────────────
  const n = children.length || 1;
  const directSosa = Math.floor(sosa / 2);
  let directCol = 1;

  const lower = el('div', 'tree-lower-grid');
  lower.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';

  if (children.length) {
    children.forEach(function(child, i) {
      const cell = el('div', 'tree-lgrid-cell');
      cell.style.gridColumn = (i + 1) + '';
      cell.style.gridRow    = '1';
      if (child.sosa === directSosa) { directCol = i + 1; cell.dataset.tree = 'child-' + i + ' direct-child'; }
      else                           { cell.dataset.tree = 'child-' + i; }
      const box = renderPersonBox(child, onSelect);
      if (box) cell.appendChild(box);
      lower.appendChild(cell);
    });
  }

  const ancestorsToShow = children.length ? ancestors.slice(1) : ancestors;
  ancestorsToShow.forEach(function(anc, i) {
    const spRow  = (children.length ? 1 : 0) + i * 2 + 2;
    const boxRow = spRow + 1;

    const sp = el('div', 'tree-spacer tree-anc-item');
    sp.style.gridColumn = directCol + '';
    sp.style.gridRow    = spRow + '';
    lower.appendChild(sp);

    const cell = el('div', 'tree-lgrid-cell tree-anc-item');
    cell.style.gridColumn = directCol + '';
    cell.style.gridRow    = boxRow + '';
    cell.dataset.tree     = 'anc-' + i;
    cell.appendChild(renderTreePersonBox(anc, onSelect));
    lower.appendChild(cell);
  });

  content.appendChild(lower);

  // ── Bouton déplier / replier la chaîne d'ancêtres ────────────────────────
  if (ancestorsToShow.length > 0) {
    const toggleRow = el('div', 'tree-anc-toggle');
    const btn = el('button', 'tree-anc-btn');
    btn.type = 'button';
    const arrow = txt('span', 'tree-anc-btn__arrow', '▼');
    btn.appendChild(arrow);
    toggleRow.appendChild(btn);
    content.appendChild(toggleRow);

    btn.addEventListener('click', function() {
      const wasExpanded = wrap.classList.contains('sosa-tree--anc-expanded');
      wrap.classList.toggle('sosa-tree--anc-expanded');
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          drawTreeConnectors(content);
          drawGenLabels(wrap, sosa, children, ancestorsToShow);
          if (wasExpanded) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
      });
    });
  }

  // ── Overlay connecteurs (position:absolute, tracé après rendu) ────────────
  content.appendChild(el('div', 'tree-conn-overlay'));

  // Double rAF : garantit que le DOM est rendu avant la mesure
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      drawTreeConnectors(content);
      drawGenLabels(wrap, sosa, children, ancestorsToShow);
    });
  });

  return wrap;
}
// ── Documents riches ──────────────────────────────────────────────────────

const IMAGES_BASE = '../famille/contenu/pages/';

/**
 * Ouvre l'image dans la lightbox globale.
 */
function openLightbox(src) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!lb || !img) return;
  img.src = src;
  lb.classList.add('lightbox--open');
}

/**
 * Construit et retourne le nœud DOM pour la section documents d'une union.
 * @param {Array} documents  Liste de documents riches
 */
function renderDocuments(documents) {
  if (!documents || !documents.length) return null;

  const section = el('div', 'doc-section');

  documents.forEach(function(doc) {
    const card = el('div', 'doc-card');

    // ── Titre ────────────────────────────────────────────────────────────
    const hasAnnee = doc.titre && doc.titre.annee != null;
    const hasLabel = doc.titre && doc.titre.label && doc.titre.label.trim();
    if (hasAnnee || hasLabel) {
      const titre = el('div', 'doc-titre');
      if (hasAnnee) titre.appendChild(txt('span', 'doc-titre__annee', String(doc.titre.annee)));
      if (hasLabel) titre.appendChild(txt('span', 'doc-titre__label', doc.titre.label));
      card.appendChild(titre);
    }

    // ── Contenu (colonnes) ────────────────────────────────────────────────
    const content = el('div', 'doc-content');

    (doc.contenu || []).forEach(function(colBlocks) {
      const col = el('div', 'doc-col');

      colBlocks.forEach(function(block) {
        if (block.type === 'IMAGE') {
          const wrap = el('div', 'doc-block--image');
          const img  = document.createElement('img');
          img.src   = IMAGES_BASE + block.fichier;
          img.alt   = '';
          img.loading = 'lazy';
          img.addEventListener('click', function() { openLightbox(img.src); });
          wrap.appendChild(img);
          col.appendChild(wrap);
        } else if (block.type === 'TEXTE') {
          const wrap = el('div', 'doc-block--texte');
          wrap.innerHTML = block.fichier;   // HTML déjà sanitisé côté saisie
          col.appendChild(wrap);
        }
      });

      content.appendChild(col);
    });

    card.appendChild(content);
    section.appendChild(card);
  });

  return section;
}

// ── Carte couple principale ────────────────────────────────────────────────

/**
 * Construit la fiche d'un couple (ou d'une personne seule si union = null).
 *
 * @param {Object}   person      Données complètes de la personne sélectionnée
 * @param {Array}    parents     Résumés de ses parents
 * @param {Object}   union       Union principale (ou null si solo)
 * @param {Array}    otherUnions Unions secondaires à afficher dans la colonne de la personne
 * @param {Function} onSelect    callback(id) pour la navigation
 */
function renderCoupleCard(person, parents, union, otherUnions, onSelect, treeData) {
  const conjoint        = union ? union.conjoint        : null;
  const conjointParents = union ? (union.conjoint_parents || []) : [];
  const mariage         = union ? union.mariage         : null;
  const mariageNotes    = union ? (union.commentaires   || []) : [];

  // ── Disposition homme à gauche, femme à droite ──
  let left, right;

  if (!conjoint) {
    if (person.sexe === 'F') {
      left = null;
      right = person;
    } else {
      left = person;
      right = null;
    }
  } else {
    const personMale   = person.sexe === 'M';
    const conjointMale = conjoint.sexe === 'M';
    if (personMale || (!personMale && !conjointMale)) {
      left = person;    right = conjoint;
    } else {
      left = conjoint;  right = person;
    }
  }

  const card = el('div', 'couple-card');

  // ── 1. En-têtes ──────────────────────────────────────────────────────────
  const headerRow = el('div', 'couple-row couple-row--headers');
  headerRow.appendChild(renderPersonHeader(left));
  headerRow.appendChild(renderPersonHeader(right));
  card.appendChild(headerRow);

  // ── 2. Arbre généalogique ─────────────────────────────────────────────────
  if (treeData) {
    const row = el('div', 'couple-row--full');
    row.appendChild(txt('div', 'section-bar section-bar--full', 'Arbre généalogique'));
    const tree = renderSosaTree(treeData, onSelect, person.id);
    tree.classList.add('sosa-tree--card');
    row.appendChild(tree);
    card.appendChild(row);
  }

  // ── 3. Naissance ─────────────────────────────────────────────────────────
  const naissSection = makeSection('Naissance',
    renderNaissanceCol(left,  onSelect),
    renderNaissanceCol(right, onSelect)
  );
  if (naissSection) card.appendChild(naissSection);

  // ── 4. Mariage (pleine largeur) ───────────────────────────────────────────
  if (mariage || mariageNotes.length) {
    const row = el('div', 'couple-row--full');
    row.appendChild(txt('div', 'section-bar section-bar--full', 'Mariage'));
    const ev = renderEventBlock(mariage);
    if (ev) row.appendChild(ev);
    if (mariageNotes.length) {
      const block = renderCollapsibleComments(mariageNotes);
      if (block) row.appendChild(block);
    }
    card.appendChild(row);
  }

  // ── 5. Autres mariages (dans la colonne de la personne) ───────────────────
  if (otherUnions && otherUnions.length) {
    const personIsLeft = (left === person);
    const autreCol = el('div', 'person-col');
    const emptyCol = el('div', 'person-col person-col--empty');

    otherUnions.forEach((u, i) => {
      if (i > 0) autreCol.appendChild(el('div', 'other-union-sep'));
      const ev = renderEventBlock(u.mariage);
      if (ev) autreCol.appendChild(ev);
      if (u.conjoint) {
        autreCol.appendChild(txt('div', 'section-sublabel', 'Conjoint'));
        const box = renderPersonBox(personToSummary(u.conjoint), onSelect);
        if (box) autreCol.appendChild(box);
      }
      const uEnfants = u.enfants || [];
      if (uEnfants.length) {
        autreCol.appendChild(txt('div', 'section-sublabel', 'Enfants (' + uEnfants.length + ')'));
        const boxRow = el('div', 'box-row');
        uEnfants.forEach(child => {
          const box = renderPersonBox(child, onSelect);
          if (box) boxRow.appendChild(box);
        });
        autreCol.appendChild(boxRow);
      }
      if (u.commentaires && u.commentaires.length) {
        const block = renderCollapsibleComments(u.commentaires);
        if (block) autreCol.appendChild(block);
      }
    });

    const autresSection = makeSection(
      'Autres mariages',
      personIsLeft ? autreCol : emptyCol,
      personIsLeft ? emptyCol : autreCol
    );
    if (autresSection) card.appendChild(autresSection);
  }

  // ── 6. Professions ────────────────────────────────────────────────────────
  const profSection = makeSection('Professions',
    renderProfessionsCol(left), renderProfessionsCol(right));
  if (profSection) card.appendChild(profSection);

  // ── 7. Résidences ─────────────────────────────────────────────────────────
  const resiSection = makeSection('Résidences',
    renderResidencesCol(left), renderResidencesCol(right));
  if (resiSection) card.appendChild(resiSection);

  // ── 8. Décès ──────────────────────────────────────────────────────────────
  const decesSection = makeSection('Décès',
    renderDecesCol(left), renderDecesCol(right));
  if (decesSection) card.appendChild(decesSection);

  // ── 9. Commentaires ───────────────────────────────────────────────────────
  const commSection = makeSection('Commentaires',
    renderCommentairesCol(left), renderCommentairesCol(right));
  if (commSection) card.appendChild(commSection);


  return card;
}