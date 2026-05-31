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
  if (lieu.ville)      parts.push(lieu.ville);
  if (lieu.dept_nom)   parts.push(lieu.dept_nom);
  else if (lieu.dept_num) parts.push(lieu.dept_num);
  if (lieu.pays)       parts.push(lieu.pays);
  if (lieu.complement) parts.push(lieu.complement);
  return parts.length ? parts.join(', ') : (lieu.brut || null);
}

function yearsLabel(birthY, deathY) {
  if (!birthY && !deathY) return null;
  return (birthY || '?') + ' – ' + (deathY || '?');
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

  const years = yearsLabel(summary.naissance_year, summary.deces_year);
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
    extractYear(person.naissance && person.naissance.date),
    extractYear(person.deces     && person.deces.date)
  );
  if (years) header.appendChild(txt('div', 'person-header__years', years));

  return header;
}

// ── Colonne naissance ──────────────────────────────────────────────────────

function renderNaissanceCol(person, parents, onSelect) {
  const col = el('div', 'person-col' + (person ? '' : ' person-col--empty'));
  if (!person) return col;

  const hasNaiss   = person.naissance || person.bapteme;
  const hasParents = parents && parents.length > 0;
  if (!hasNaiss && !hasParents) return col;

  if (person.naissance) {
    const ev = renderEventBlock(person.naissance);
    if (ev) col.appendChild(ev);
  }

  if (person.bapteme) {
    col.appendChild(txt('div', 'section-sublabel', 'Baptême'));
    const ev = renderEventBlock(person.bapteme);
    if (ev) col.appendChild(ev);
  }

  if (hasParents) {
    col.appendChild(txt('div', 'section-sublabel', 'Parents'));
    const row = el('div', 'box-row');
    parents.forEach(p => {
      const box = renderPersonBox(p, onSelect);
      if (box) row.appendChild(box);
    });
    col.appendChild(row);
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
    deces_year:     extractYear(p.deces     && p.deces.date),
  };
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
function renderCoupleCard(person, parents, union, otherUnions, onSelect) {
  const conjoint        = union ? union.conjoint        : null;
  const conjointParents = union ? (union.conjoint_parents || []) : [];
  const mariage         = union ? union.mariage         : null;
  const mariageNotes    = union ? (union.commentaires   || []) : [];
  const enfants         = union ? (union.enfants        || []) : [];

  // ── Disposition homme à gauche, femme à droite ──
  let left, leftParents, right, rightParents;

  if (!conjoint) {
    // Personne seule
    if (person.sexe === 'F') {
      left = null; leftParents = [];
      right = person; rightParents = parents;
    } else {
      left = person; leftParents = parents;
      right = null; rightParents = [];
    }
  } else {
    const personMale   = person.sexe === 'M';
    const conjointMale = conjoint.sexe === 'M';
    if (personMale || (!personMale && !conjointMale)) {
      left = person;   leftParents = parents;
      right = conjoint; rightParents = conjointParents;
    } else {
      left = conjoint; leftParents = conjointParents;
      right = person;  rightParents = parents;
    }
  }

  const card = el('div', 'couple-card');

  // ── 1. En-têtes ──────────────────────────────────────────────────────────
  const headerRow = el('div', 'couple-row couple-row--headers');
  headerRow.appendChild(renderPersonHeader(left));
  headerRow.appendChild(renderPersonHeader(right));
  card.appendChild(headerRow);

  // ── 2. Naissance ─────────────────────────────────────────────────────────
  const naissSection = makeSection('Naissance',
    renderNaissanceCol(left,  leftParents,  onSelect),
    renderNaissanceCol(right, rightParents, onSelect)
  );
  if (naissSection) card.appendChild(naissSection);

  // ── 3. Mariage (pleine largeur) ───────────────────────────────────────────
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

  // ── 4. Enfants (pleine largeur) ───────────────────────────────────────────
  if (enfants.length) {
    const row = el('div', 'couple-row--full');
    row.appendChild(txt('div', 'section-bar section-bar--full', 'Enfants (' + enfants.length + ')'));
    const boxRow = el('div', 'box-row');
    enfants.forEach(child => {
      const box = renderPersonBox(child, onSelect);
      if (box) boxRow.appendChild(box);
    });
    row.appendChild(boxRow);
    card.appendChild(row);
  }

  // ── 5. Autres mariages (dans la colonne de la personne) ───────────────────
  if (otherUnions && otherUnions.length) {
    const personIsLeft = (left === person);
    const autreCol = el('div', 'person-col');
    const emptyCol = el('div', 'person-col person-col--empty');

    otherUnions.forEach((u, i) => {
      if (i > 0) autreCol.appendChild(el('div', 'other-union-sep'));

      // Date/lieu du mariage
      const ev = renderEventBlock(u.mariage);
      if (ev) autreCol.appendChild(ev);

      // Conjoint cliquable
      if (u.conjoint) {
        autreCol.appendChild(txt('div', 'section-sublabel', 'Conjoint'));
        const box = renderPersonBox(personToSummary(u.conjoint), onSelect);
        if (box) autreCol.appendChild(box);
      }

      // Enfants de cette union
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

      // Notes
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
