'use strict';

// ── Éditeur inline ────────────────────────────────────────────────────────────
// Editor.open(ctx, onSaved)
// ctx = { personId, person, conjointId, conjoint, familleId, union, parents, conjointParents }

const Editor = (function () {

  // ── État ──────────────────────────────────────────────────────────────────
  let _personId = null, _conjointId = null, _familleId = null;
  let _person = null, _conjoint = null, _family = null;
  let _personParents = [];    // [{id, nom, prenom, sexe, sosa}]
  let _conjointParents = [];
  let _onSaved = null, _container = null;
  let _newPersons = {}, _newFamilies = {}, _deleteFamilies = [];
  let _conjointFamilyTempId = null;
  let _tempCtr = 0;
  const _nameCache = {};

  function _newTempId() { return '__new__' + (++_tempCtr); }
  function _cacheName(id, obj) {
    if (!id || !obj) return;
    _nameCache[id] = ([obj.nom, obj.prenom].filter(Boolean).join(' ') || id)
      + (obj.sosa ? ' [' + obj.sosa + ']' : '');
  }
  function _name(id) { return _nameCache[id] || id; }
  function _sosaFather(n) { return (n != null) ? n * 2     : null; }
  function _sosaMother(n) { return (n != null) ? n * 2 + 1 : null; }
  function _sosaSpouse(n) { return (n != null) ? (n % 2 === 0 ? n + 1 : n - 1) : null; }

  // ── open ───────────────────────────────────────────────────────────────────

  function open(ctx, onSaved) {
    _personId   = ctx.personId;
    _conjointId = ctx.conjointId || null;
    _familleId  = ctx.familleId  || null;
    _onSaved    = onSaved;

    _person   = _clone(ctx.person);
    _conjoint = ctx.conjoint ? _clone(ctx.conjoint) : null;
    _family = {
      mariage:   _clone((ctx.union && ctx.union.mariage)   || null),
      enfants:   ((ctx.union && ctx.union.enfants) || []).map(e => e.id || e).filter(Boolean),
      documents: _clone((ctx.union && ctx.union.documents) || []),
    };
    _personParents   = (ctx.parents        || []).map(p => ({id:p.id, nom:p.nom, prenom:p.prenom, sexe:p.sexe, sosa:p.sosa}));
    _conjointParents = (ctx.conjointParents || []).map(p => ({id:p.id, nom:p.nom, prenom:p.prenom, sexe:p.sexe, sosa:p.sosa}));

    _newPersons = {}; _newFamilies = {}; _deleteFamilies = [];
    _conjointFamilyTempId = null; _tempCtr = 0;

    _cacheName(_personId, ctx.person);
    _cacheName(_conjointId, ctx.conjoint);
    (ctx.parents        || []).forEach(p => _cacheName(p.id, p));
    (ctx.conjointParents || []).forEach(p => _cacheName(p.id, p));
    ((ctx.union && ctx.union.enfants) || []).forEach(e => _cacheName(e.id, e));

    _container = document.getElementById('person-view');
    _render();
  }

  // ── Rendu principal ────────────────────────────────────────────────────────

  function _render() {
    _container.innerHTML = '';

    // Bandeau fixe Enregistrer / Annuler (ajouté au body, hors flux)
    // Supprimer l'éventuelle barre précédente avant d'en créer une nouvelle
    // (évite les doublons lors des re-rendus après popup)
    _removeBar();
    const bar = _buildBar();
    document.body.appendChild(bar);

    // Carte éditeur (bordure ambrée = indicateur de mode édition)
    const wrap = el('div', 'ed-wrapper');
    wrap.appendChild(_buildCard());
    _container.appendChild(wrap);

    // Documents hors du wrapper (même position qu'en vue)
    const docsSec = _buildDocSection();
    if (docsSec) {
      docsSec.classList.add('doc-section--fullwidth');
      _container.appendChild(docsSec);
    }
  }

  function _buildBar() {
    const bar = el('div', 'ed-bar');
    bar.id = 'ed-fixed-bar';
    const s = el('button', 'ed-btn ed-btn--save');
    s.type = 'button'; s.textContent = 'Enregistrer'; s.addEventListener('click', _save);
    const c = el('button', 'ed-btn ed-btn--cancel');
    c.type = 'button'; c.textContent = 'Annuler';
    c.addEventListener('click', () => { _removeBar(); _onSaved(); });
    bar.appendChild(s); bar.appendChild(c);
    return bar;
  }

  function _removeBar() {
    const b = document.getElementById('ed-fixed-bar');
    if (b) b.parentNode.removeChild(b);
  }

  // ── Carte principale ──────────────────────────────────────────────────────

  function _buildCard() {
    let left, leftId, leftPar, right, rightId, rightPar;
    if (!_conjoint) {
      if (_person.sexe === 'F') {
        left = null; leftId = null; leftPar = [];
        right = _person; rightId = _personId; rightPar = _personParents;
      } else {
        left = _person; leftId = _personId; leftPar = _personParents;
        right = null; rightId = null; rightPar = [];
      }
    } else {
      const pm = (_person.sexe === 'M'), cm = (_conjoint.sexe === 'M');
      if (pm || (!pm && !cm)) {
        left = _person; leftId = _personId; leftPar = _personParents;
        right = _conjoint; rightId = _conjointId; rightPar = _conjointParents;
      } else {
        left = _conjoint; leftId = _conjointId; leftPar = _conjointParents;
        right = _person; rightId = _personId; rightPar = _personParents;
      }
    }

    const card = el('div', 'couple-card');

    // 1. En-têtes
    const headerRow = el('div', 'couple-row couple-row--headers');
    headerRow.appendChild(left  ? _buildEditableHeader(left,  leftId)  : _buildEmptyHeader());
    headerRow.appendChild(right ? _buildEditableHeader(right, rightId) : _buildEmptyHeader());
    card.appendChild(headerRow);

    const appendSection = (label, lContent, rContent) => {
      card.appendChild(txt('div', 'section-bar', label));
      const row = el('div', 'couple-row');
      const lc = el('div', 'person-col' + (lContent ? '' : ' person-col--empty'));
      if (lContent) lc.appendChild(lContent);
      const rc = el('div', 'person-col' + (rContent ? '' : ' person-col--empty'));
      if (rContent) rc.appendChild(rContent);
      row.appendChild(lc); row.appendChild(rc);
      card.appendChild(row);
    };

    // 2. Naissance
    appendSection('Naissance',
      left  ? _buildEvtGroup(left,  ['naissance', 'bapteme']) : null,
      right ? _buildEvtGroup(right, ['naissance', 'bapteme']) : null
    );

    // 3. Mariage (pleine largeur)
    const mariRow = el('div', 'couple-row--full');
    mariRow.appendChild(txt('div', 'section-bar section-bar--full', 'Mariage'));
    mariRow.appendChild(_buildEventEditor(_family, 'mariage'));
    card.appendChild(mariRow);

    // 4. Professions
    appendSection('Professions',
      left  ? _buildStringListEditor(left.professions  || (left.professions  = []))       : null,
      right ? _buildStringListEditor(right.professions || (right.professions = []))       : null
    );

    // 5. Résidences
    appendSection('Résidences',
      left  ? _buildResidencesEditor(left)  : null,
      right ? _buildResidencesEditor(right) : null
    );

    // 6. Décès
    appendSection('Décès',
      left  ? _buildEvtGroup(left,  ['deces', 'sepulture']) : null,
      right ? _buildEvtGroup(right, ['deces', 'sepulture']) : null
    );

    // 7. Commentaires
    appendSection('Commentaires',
      left  ? _buildStringListEditor(left.commentaires  || (left.commentaires  = []), true) : null,
      right ? _buildStringListEditor(right.commentaires || (right.commentaires = []), true) : null
    );

    // 8. Parents
    appendSection('Parents',
      left  ? _buildParentsEditor(leftId,  leftPar)  : null,
      right ? _buildParentsEditor(rightId, rightPar) : null
    );

    // 9. Enfants (pleine largeur, si famille)
    if (_conjoint || _familleId) {
      const enfsRow = el('div', 'couple-row--full');
      enfsRow.appendChild(txt('div', 'section-bar section-bar--full', 'Enfants'));
      enfsRow.appendChild(_buildChildrenEditor());
      card.appendChild(enfsRow);
    }

    return card;
  }

  // ── En-tête vide : offre d'ajouter un conjoint ────────────────────────────

  function _buildEmptyHeader() {
    const h = el('div', 'person-header person-header--empty');
    if (_conjointId === null) {
      const btn = el('button', 'ed-add-spouse-btn');
      btn.type = 'button'; btn.textContent = '+ Ajouter un(e) conjoint(e)';
      btn.addEventListener('click', () => _openAddPersonPopup('spouse'));
      h.appendChild(btn);
    }
    return h;
  }

  // ── En-tête éditable ──────────────────────────────────────────────────────

  function _buildEditableHeader(person, personId) {
    const sc = person.sexe === 'M' ? 'M' : person.sexe === 'F' ? 'F' : 'U';
    const h = el('div', 'person-header person-header--' + sc + ' ed-header');

    if (person.sosa != null) h.appendChild(txt('div', 'sosa-badge', person.sosa));

    const nomInp = document.createElement('input');
    nomInp.type = 'text'; nomInp.className = 'ed-header-inp ed-header-inp--nom';
    nomInp.placeholder = 'NOM'; nomInp.value = person.nom || '';
    nomInp.addEventListener('input', () => { person.nom = nomInp.value.trim() || null; });
    h.appendChild(nomInp);

    const prenomInp = document.createElement('input');
    prenomInp.type = 'text'; prenomInp.className = 'ed-header-inp ed-header-inp--prenom';
    prenomInp.placeholder = 'Prénom'; prenomInp.value = person.prenom || '';
    prenomInp.addEventListener('input', () => { person.prenom = prenomInp.value.trim() || null; });
    h.appendChild(prenomInp);

    // Toggle Sexe M / F
    const sw = el('div', 'ed-sexe-toggle');
    ['M', 'F'].forEach(v => {
      const lbl = document.createElement('label');
      lbl.className = 'ed-sexe-btn' + (person.sexe === v ? ' ed-sexe-btn--active' : '');
      const inp = document.createElement('input');
      inp.type = 'radio'; inp.name = 'sexe_' + personId; inp.value = v;
      inp.checked = (person.sexe === v); inp.style.display = 'none';
      inp.addEventListener('change', () => {
        if (!inp.checked) return;
        person.sexe = v;
        sw.querySelectorAll('.ed-sexe-btn').forEach(b => b.classList.remove('ed-sexe-btn--active'));
        lbl.classList.add('ed-sexe-btn--active');
      });
      lbl.appendChild(inp);
      lbl.appendChild(document.createTextNode(v === 'M' ? 'H' : 'F'));
      sw.appendChild(lbl);
    });
    h.appendChild(sw);
    return h;
  }

  // ── Groupe d'événements (naissance+baptême, décès+sépulture) ─────────────

  function _buildEvtGroup(person, keys) {
    const wrap = el('div', 'ed-evt-group');
    keys.forEach((k, i) => {
      if (i > 0) {
        const label = { bapteme: 'Baptême', sepulture: 'Sépulture' }[k] || k;
        wrap.appendChild(txt('div', 'ed-block-title', label));
      }
      wrap.appendChild(_buildEventEditor(person, k));
    });
    return wrap;
  }

  // ── Éditeur d'événement (date + lieu + adresse) ────────────────────────────

  function _buildEventEditor(obj, key) {
    if (!obj[key]) obj[key] = {};
    const ev = obj[key];
    const wrap = el('div', 'ed-event');

    // Date avec infobulle
    const dateRow = el('div', 'ed-field');
    const lblRow  = el('div', 'ed-label-row');
    lblRow.appendChild(txt('span', 'ed-label', 'Date'));
    const tip = el('button', 'ed-date-tip');
    tip.type = 'button'; tip.textContent = 'ℹ';
    tip.title = 'Formats acceptés :\n• Date exacte : 12 JAN 1740\n• Approximative : ABT 1750\n• Intervalle : BET 1756 AND 1759\n• Avant : BEF 1751\n• Après : AFT 1751\n• Calculée : CAL 1800';
    lblRow.appendChild(tip);
    dateRow.appendChild(lblRow);
    const dateInp = document.createElement('input');
    dateInp.type = 'text'; dateInp.className = 'ed-input';
    dateInp.value = ev.date || '';
    dateInp.addEventListener('input', () => { ev.date = dateInp.value.trim() || null; });
    dateRow.appendChild(dateInp);
    wrap.appendChild(dateRow);

    if (!ev.lieu) ev.lieu = {};
    const lieu = ev.lieu;
    const lieuBlock = el('div', 'ed-lieu');
    [
      ['Ville',          'ville'],
      ['Adresse',        'adresse'],
      ['N° département', 'dept_num'],
      ['Département',    'dept_nom'],
      ['Région',         'region'],
      ['Pays',           'pays'],
    ].forEach(([lbl, fkey]) => {
      const row = el('div', 'ed-field ed-field--sm');
      row.appendChild(txt('label', 'ed-label', lbl));
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'ed-input ed-input--sm';
      inp.value = lieu[fkey] || '';
      inp.addEventListener('input', () => { lieu[fkey] = inp.value.trim() || undefined; });
      row.appendChild(inp);
      lieuBlock.appendChild(row);
    });
    wrap.appendChild(lieuBlock);
    return wrap;
  }

  // ── Liste de chaînes (professions, commentaires) ──────────────────────────

  function _buildStringListEditor(arr, multiline) {
    const wrap = el('div', 'ed-list');
    const refresh = () => {
      wrap.innerHTML = '';
      arr.forEach((val, i) => {
        const row = el('div', 'ed-list-item');
        let inp;
        if (multiline) {
          inp = document.createElement('textarea'); inp.className = 'ed-textarea'; inp.rows = 3;
        } else {
          inp = document.createElement('input'); inp.type = 'text'; inp.className = 'ed-input';
        }
        inp.value = val;
        inp.addEventListener('input', () => { arr[i] = inp.value; });
        row.appendChild(inp);
        const del = el('button', 'ed-icon-btn ed-icon-btn--del');
        del.type = 'button'; del.title = 'Supprimer'; del.textContent = '×';
        del.addEventListener('click', () => { arr.splice(i, 1); refresh(); });
        row.appendChild(del);
        wrap.appendChild(row);
      });
      const addBtn = el('button', 'ed-add-btn');
      addBtn.type = 'button'; addBtn.textContent = '+ Ajouter';
      addBtn.addEventListener('click', () => { arr.push(''); refresh(); });
      wrap.appendChild(addBtn);
    };
    refresh();
    return wrap;
  }

  // ── Résidences ─────────────────────────────────────────────────────────────

  function _buildResidencesEditor(person) {
    if (!person.residences) person.residences = [];
    const arr = person.residences;
    const wrap = el('div', 'ed-list');
    const refresh = () => {
      wrap.innerHTML = '';
      arr.forEach((_, i) => {
        const card = el('div', 'ed-residence-item');
        card.appendChild(_buildEventEditor(arr, i));
        const del = el('button', 'ed-icon-btn ed-icon-btn--del');
        del.type = 'button'; del.title = 'Supprimer'; del.textContent = '×';
        del.addEventListener('click', () => { arr.splice(i, 1); refresh(); });
        card.appendChild(del);
        wrap.appendChild(card);
      });
      const addBtn = el('button', 'ed-add-btn');
      addBtn.type = 'button'; addBtn.textContent = '+ Ajouter une résidence';
      addBtn.addEventListener('click', () => { arr.push({ date: null, lieu: {} }); refresh(); });
      wrap.appendChild(addBtn);
    };
    refresh();
    return wrap;
  }

  // ── Éditeur de parents ─────────────────────────────────────────────────────

  function _buildParentsEditor(personId, parentsArr) {
    const wrap = el('div', 'ed-person-list');
    const refresh = () => {
      wrap.innerHTML = '';
      parentsArr.forEach(p => {
        wrap.appendChild(_buildPersonItem(p, () => _removeParent(personId, parentsArr, p)));
      });
      const hasM = parentsArr.some(p => p.sexe === 'M');
      const hasF = parentsArr.some(p => p.sexe === 'F');
      if (!hasM) {
        const btn = el('button', 'ed-add-btn'); btn.type = 'button'; btn.textContent = '+ Ajouter le père';
        btn.addEventListener('click', () => _openAddPersonPopup('parent', personId, 'M', parentsArr, refresh));
        wrap.appendChild(btn);
      }
      if (!hasF) {
        const btn = el('button', 'ed-add-btn'); btn.type = 'button'; btn.textContent = '+ Ajouter la mère';
        btn.addEventListener('click', () => _openAddPersonPopup('parent', personId, 'F', parentsArr, refresh));
        wrap.appendChild(btn);
      }
    };
    refresh();
    return wrap;
  }

  function _removeParent(personId, parentsArr, parent) {
    const idx = parentsArr.findIndex(p => p.id === parent.id);
    if (idx === -1) return;
    parentsArr.splice(idx, 1);
    // Supprimer la famille créée dans cette session si présente
    for (const ftid in _newFamilies) {
      const f = _newFamilies[ftid];
      if ((f.mari === parent.id || f.epouse === parent.id) &&
          Array.isArray(f.enfants) && f.enfants.indexOf(personId) !== -1) {
        delete _newFamilies[ftid]; break;
      }
    }
    _render();
  }

  // ── Éditeur d'enfants ──────────────────────────────────────────────────────

  function _buildChildrenEditor() {
    const arr = _family.enfants;
    const wrap = el('div', 'ed-person-list');
    const refresh = () => {
      wrap.innerHTML = '';
      arr.forEach(id => {
        const item = el('div', 'ed-person-list__item');
        item.appendChild(txt('span', 'ed-person-list__name', _name(id)));
        const del = el('button', 'ed-icon-btn ed-icon-btn--del');
        del.type = 'button'; del.title = 'Retirer'; del.textContent = '×';
        del.addEventListener('click', () => { arr.splice(arr.indexOf(id), 1); refresh(); });
        item.appendChild(del);
        wrap.appendChild(item);
      });
      const btn = el('button', 'ed-add-btn');
      btn.type = 'button'; btn.textContent = '+ Ajouter un enfant';
      btn.addEventListener('click', () => _openAddPersonPopup('child', null, null, arr, refresh));
      wrap.appendChild(btn);
    };
    refresh();
    return wrap;
  }

  function _buildPersonItem(p, onRemove) {
    const item = el('div', 'ed-person-list__item');
    const sc = p.sexe === 'M' ? 'var(--sex-M)' : p.sexe === 'F' ? 'var(--sex-F)' : 'var(--gray)';
    item.style.borderLeft = '3px solid ' + sc;
    const name = [p.nom, p.prenom].filter(Boolean).join(' ') || p.id || '(inconnu)';
    item.appendChild(txt('span', 'ed-person-list__name', name + (p.sosa ? ' [' + p.sosa + ']' : '')));
    const del = el('button', 'ed-icon-btn ed-icon-btn--del');
    del.type = 'button'; del.title = 'Retirer'; del.textContent = '×';
    del.addEventListener('click', onRemove);
    item.appendChild(del);
    return item;
  }

  // ── Popup "Créer une personne" ─────────────────────────────────────────────

  function _openAddPersonPopup(role, targetPersonId, forcedSex, targetArr, onDone) {
    const overlay = el('div', 'ed-popup-overlay');
    const titles  = { parent: forcedSex === 'M' ? 'Ajouter le père' : 'Ajouter la mère',
                      child: 'Ajouter un enfant', spouse: 'Ajouter un(e) conjoint(e)' };
    const popup = el('div', 'ed-popup');
    popup.appendChild(txt('div', 'ed-popup__title', titles[role]));

    const nomInp    = document.createElement('input');
    nomInp.type     = 'text'; nomInp.className = 'ed-input'; nomInp.placeholder = 'Nom';
    const prenomInp = document.createElement('input');
    prenomInp.type  = 'text'; prenomInp.className = 'ed-input'; prenomInp.placeholder = 'Prénom';
    popup.appendChild(nomInp);
    popup.appendChild(prenomInp);

    let selectedSex = forcedSex;
    if (!selectedSex && role === 'spouse') selectedSex = _person.sexe === 'M' ? 'F' : 'M';

    if (!forcedSex) {
      const sw = el('div', 'ed-radio-group');
      ['M', 'F'].forEach(v => {
        const lbl = document.createElement('label'); lbl.className = 'ed-radio-label';
        const inp = document.createElement('input');
        inp.type = 'radio'; inp.name = 'popup_sexe'; inp.value = v;
        if (v === selectedSex) inp.checked = true;
        inp.addEventListener('change', () => { if (inp.checked) selectedSex = v; });
        lbl.appendChild(inp); lbl.appendChild(document.createTextNode(' ' + (v === 'M' ? 'Homme' : 'Femme')));
        sw.appendChild(lbl);
      });
      popup.appendChild(sw);
    }

    const errEl = txt('div', 'ed-popup__error', ''); errEl.hidden = true;
    popup.appendChild(errEl);

    const btnRow = el('div', 'ed-popup__btns');
    const btnCreate = el('button', 'ed-btn ed-btn--save');
    btnCreate.type = 'button'; btnCreate.textContent = 'Créer';
    const btnCancel = el('button', 'ed-btn ed-btn--cancel');
    btnCancel.type = 'button'; btnCancel.textContent = 'Annuler';
    btnCancel.addEventListener('click', () => document.body.removeChild(overlay));

    btnCreate.addEventListener('click', () => {
      const nom    = nomInp.value.trim()    || null;
      const prenom = prenomInp.value.trim() || null;
      if (!nom && !prenom) { errEl.textContent = 'Saisir au moins un nom ou un prénom.'; errEl.hidden = false; nomInp.focus(); return; }
      if (!selectedSex)    { errEl.textContent = 'Sélectionner un sexe.'; errEl.hidden = false; return; }

      const tempId = _newTempId();

      // Calcul Sosa
      let sosa = null;
      if (role === 'parent') {
        const parentOf = targetPersonId === _personId ? _person : _conjoint;
        const base = parentOf ? parentOf.sosa : null;
        sosa = selectedSex === 'M' ? _sosaFather(base) : _sosaMother(base);
      } else if (role === 'spouse') {
        sosa = _sosaSpouse(_person.sosa);
      }

      // Fix C : stocker une copie propre dans _newPersons (évite la mutation
      //         par le rendu qui ajouterait des champs vides lieu:[] etc.)
      const savedP = { nom, prenom, sexe: selectedSex };
      if (sosa != null) savedP.sosa = sosa;
      _newPersons[tempId] = savedP;
      _cacheName(tempId, savedP);

      // newP est la copie utilisée localement (peut être mutée par le rendu)
      const newP = Object.assign({}, savedP);

      if (role === 'parent') {
        targetArr.push({ id: tempId, nom, prenom, sexe: selectedSex, sosa });
        // Fix A : supprimer l'éventuelle famille de session pour cet enfant,
        //         puis toujours recréer une famille même avec un seul parent.
        for (const ftid in _newFamilies) {
          const f = _newFamilies[ftid];
          if (Array.isArray(f.enfants) && f.enfants.indexOf(targetPersonId) !== -1) {
            delete _newFamilies[ftid];
            break;
          }
        }
        const father = targetArr.find(p => p.sexe === 'M');
        const mother = targetArr.find(p => p.sexe === 'F');
        const ftid = _newTempId();
        const fam = { enfants: [targetPersonId] };
        if (father) fam.mari   = father.id;
        if (mother) fam.epouse = mother.id;
        _newFamilies[ftid] = fam;
      } else if (role === 'child') {
        targetArr.push(tempId);
      } else if (role === 'spouse') {
        _conjoint   = newP;
        _conjointId = tempId;
        const ftid  = _newTempId();
        const isM   = (_person.sexe === 'M');
        // Fix B : si une famille sans conjoint existe déjà (famille "parent seul"),
        //         la supprimer pour éviter les doublons et récupérer ses enfants.
        if (_familleId && !_newFamilies[_familleId]) {
          _deleteFamilies.push(_familleId);
        }
        _newFamilies[ftid] = {
          mari:    isM ? _personId : tempId,
          epouse:  isM ? tempId    : _personId,
          enfants: _family.enfants.slice(),
        };
        _familleId             = ftid;
        _conjointFamilyTempId  = ftid;
      }

      document.body.removeChild(overlay);
      if (onDone) onDone();
      _render();
    });

    btnRow.appendChild(btnCreate); btnRow.appendChild(btnCancel);
    popup.appendChild(btnRow);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    nomInp.focus();
  }

  // ── Section Documents ──────────────────────────────────────────────────────

  function _buildDocSection() {
    const docs = _family.documents;
    const section = el('div', 'doc-section');
    const renderDocs = () => {
      section.innerHTML = '';
      docs.forEach((doc, i) => section.appendChild(_buildDocCard(doc, i, docs, renderDocs)));
      const addBtn = el('button', 'ed-add-btn');
      addBtn.type = 'button'; addBtn.textContent = '+ Ajouter une section';
      addBtn.style.cssText = 'margin:12px 32px;';
      addBtn.addEventListener('click', () => { docs.push({ titre: { annee: null, label: '' }, contenu: [[]] }); renderDocs(); });
      section.appendChild(addBtn);
    };
    renderDocs();
    return section;
  }

  function _buildDocCard(doc, docIdx, docs, renderDocs) {
    if (!doc.titre) doc.titre = { annee: null, label: '' };
    if (!doc.contenu || !Array.isArray(doc.contenu)) doc.contenu = [[]];

    const card = el('div', 'doc-card');

    // Barre titre (mêmes classes que la vue : doc-titre)
    const titre = el('div', 'doc-titre');
    const anneeInp = document.createElement('input');
    anneeInp.type = 'number'; anneeInp.className = 'ed-titre-annee';
    anneeInp.placeholder = 'Année'; anneeInp.value = doc.titre.annee != null ? doc.titre.annee : '';
    anneeInp.addEventListener('input', () => { doc.titre.annee = anneeInp.value ? parseInt(anneeInp.value, 10) : null; });
    const labelInp = document.createElement('input');
    labelInp.type = 'text'; labelInp.className = 'ed-titre-label';
    labelInp.placeholder = 'Titre / description…'; labelInp.value = doc.titre.label || '';
    labelInp.addEventListener('input', () => { doc.titre.label = labelInp.value; });
    titre.appendChild(anneeInp);
    titre.appendChild(labelInp);

    const colsWrap = el('div', 'doc-content');
    let addColBtn, delColBtn;

    const renderCols = () => {
      colsWrap.innerHTML = '';
      doc.contenu.forEach((_, ci) => colsWrap.appendChild(_buildColEditor(doc, ci, renderCols)));
      if (addColBtn) { addColBtn.disabled = doc.contenu.length >= 4; delColBtn.disabled = doc.contenu.length <= 1; }
    };

    // Boutons dans la barre titre : ▲ ▼  +☰ -☰  ×
    const acts = el('div', 'ed-doc-card__actions');
    if (docIdx > 0)              acts.appendChild(_ib('▲', 'Monter',    'ed-icon-btn--light', () => { docs.splice(docIdx-1,0,docs.splice(docIdx,1)[0]); renderDocs(); }));
    if (docIdx < docs.length-1)  acts.appendChild(_ib('▼', 'Descendre', 'ed-icon-btn--light', () => { docs.splice(docIdx+1,0,docs.splice(docIdx,1)[0]); renderDocs(); }));
    addColBtn = _ib('+☰', '+ Colonne', 'ed-icon-btn--light', () => { if (doc.contenu.length < 4) { doc.contenu.push([]); renderCols(); } });
    delColBtn = _ib('-☰', '- Colonne', 'ed-icon-btn--light', () => {
      if (doc.contenu.length > 1) {
        // Fusionner le contenu de la dernière colonne dans l'avant-dernière
        const removed = doc.contenu.pop();
        removed.forEach(block => doc.contenu[doc.contenu.length - 1].push(block));
        renderCols();
      }
    });
    acts.appendChild(addColBtn);
    acts.appendChild(delColBtn);
    acts.appendChild(_ib('×', 'Supprimer la section', 'ed-icon-btn--light ed-icon-btn--del', () => {
      if (confirm('Supprimer cette section ?')) { docs.splice(docIdx, 1); renderDocs(); }
    }));

    titre.appendChild(acts);
    card.appendChild(titre);
    card.appendChild(colsWrap);
    renderCols();
    return card;
  }

  // ── Colonne avec drag-and-drop ─────────────────────────────────────────────

  let _dragPayload = null;

  function _buildColEditor(doc, colIdx, renderCols) {
    const colBlocks = doc.contenu[colIdx];
    const col = el('div', 'doc-col');
    const blockList = el('div', 'ed-block-list');
    col.appendChild(blockList);

    const refreshBlocks = () => {
      blockList.innerHTML = '';
      colBlocks.forEach((block, bi) => {
        const bwrap = _buildBlockEditor(block, bi, colBlocks, renderCols);
        bwrap.setAttribute('draggable', 'true');
        bwrap.addEventListener('dragstart', e => {
          _dragPayload = { doc, fromCol: colIdx, fromIdx: bi };
          bwrap.classList.add('ed-dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        bwrap.addEventListener('dragend', () => bwrap.classList.remove('ed-dragging'));
        blockList.appendChild(bwrap);
      });
      const addRow = el('div', 'ed-add-block-row');
      [['+ Image', 'IMAGE'], ['+ Texte', 'TEXTE']].forEach(([lbl, type]) => {
        const btn = el('button', 'ed-add-btn'); btn.type = 'button'; btn.textContent = lbl;
        btn.addEventListener('click', () => { colBlocks.push({ type, fichier: '' }); refreshBlocks(); });
        addRow.appendChild(btn);
      });
      blockList.appendChild(addRow);
    };

    col.addEventListener('dragover',  e => { e.preventDefault(); col.classList.add('ed-drop-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('ed-drop-over'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('ed-drop-over');
      if (!_dragPayload || _dragPayload.doc !== doc) return;
      const src = _dragPayload.doc.contenu[_dragPayload.fromCol];
      const [moved] = src.splice(_dragPayload.fromIdx, 1);
      colBlocks.push(moved);
      _dragPayload = null;
      renderCols();
    });

    refreshBlocks();
    return col;
  }

  function _buildBlockEditor(block, blockIdx, colBlocks, renderCols) {
    const wrap = el('div', 'ed-block-editor');
    if (block.type === 'IMAGE') _buildImageBlockEditor(wrap, block, blockIdx, colBlocks, renderCols);
    else                        _buildTextBlockEditor(wrap,  block, blockIdx, colBlocks, renderCols);
    return wrap;
  }

  // ── Bloc IMAGE : image + overlay ──────────────────────────────────────────

  function _buildImageBlockEditor(wrap, block, blockIdx, colBlocks, renderCols) {
    wrap.classList.add('ed-img-block');

    const imgWrap = el('div', 'ed-img-block__img');
    if (block.fichier) {
      const img = document.createElement('img');
      img.src = 'website/pages/' + block.fichier; img.alt = '';
      imgWrap.appendChild(img);
    } else {
      imgWrap.appendChild(txt('span', 'ed-img-placeholder', 'Aucune image'));
    }
    wrap.appendChild(imgWrap);

    // Overlay
    const overlay = el('div', 'ed-img-block__overlay');
    if (blockIdx > 0)
      overlay.appendChild(_ib('▲','Monter','',() => { colBlocks.splice(blockIdx-1,0,colBlocks.splice(blockIdx,1)[0]); renderCols(); }));
    if (blockIdx < colBlocks.length-1)
      overlay.appendChild(_ib('▼','Descendre','',() => { colBlocks.splice(blockIdx+1,0,colBlocks.splice(blockIdx,1)[0]); renderCols(); }));

    const fileInp = document.createElement('input');
    fileInp.type = 'file'; fileInp.accept = 'image/*'; fileInp.style.display = 'none';
    fileInp.addEventListener('change', async () => {
      if (!fileInp.files[0]) return;
      try { const r = await api.uploadImage(fileInp.files[0]); block.fichier = r.fichier; renderCols(); }
      catch (e) { alert('Upload : ' + e.message); }
    });
    overlay.appendChild(_ib('📂', 'Changer l\'image', '', () => fileInp.click()));
    overlay.appendChild(fileInp);
    overlay.appendChild(_ib('×','Supprimer','ed-icon-btn--del',() => { colBlocks.splice(blockIdx,1); renderCols(); }));
    wrap.appendChild(overlay);

    // Drag image directement sur le bloc
    wrap.addEventListener('dragover', e => { if (e.dataTransfer.types.indexOf && e.dataTransfer.types.indexOf('Files') >= 0) { e.preventDefault(); wrap.classList.add('ed-upload-zone--over'); } });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('ed-upload-zone--over'));
    wrap.addEventListener('drop', async e => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !f.type.startsWith('image/')) return;
      e.preventDefault(); e.stopPropagation(); wrap.classList.remove('ed-upload-zone--over');
      try { const r = await api.uploadImage(f); block.fichier = r.fichier; renderCols(); }
      catch (err) { alert('Upload : ' + err.message); }
    });
  }

  // ── Bloc TEXTE : barre unique (formatage + déplacer + supprimer) ───────────

  function _buildTextBlockEditor(wrap, block, blockIdx, colBlocks, renderCols) {
    const bar = el('div', 'ed-txt-toolbar');
    const edDiv = el('div', 'ed-txt-content');
    edDiv.contentEditable = 'true'; edDiv.spellcheck = true;
    edDiv.innerHTML = (block.fichier || '').replace(/<br\/>/gi, '<br>');
    edDiv.addEventListener('input', () => { block.fichier = _serializeRichText(edDiv); });
    edDiv.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _insertBr(edDiv); } });

    [['<b>G</b>','bold','Gras'],['<i>I</i>','italic','Italique'],['<u>S</u>','underline','Souligné']].forEach(([lbl,cmd,title]) => {
      const btn = el('button','ed-txt-btn'); btn.type='button'; btn.title=title; btn.innerHTML=lbl;
      btn.addEventListener('mousedown', e => { e.preventDefault(); document.execCommand(cmd,false,null); });
      bar.appendChild(btn);
    });
    const brBtn = el('button','ed-txt-btn'); brBtn.type='button'; brBtn.title='Saut de ligne'; brBtn.textContent='↵';
    brBtn.addEventListener('mousedown', e => { e.preventDefault(); _insertBr(edDiv); });
    bar.appendChild(brBtn);

    // Séparateur
    bar.appendChild(txt('span','ed-txt-sep',''));

    // Déplacer + Supprimer dans la même barre
    if (blockIdx > 0) {
      const up=el('button','ed-txt-btn'); up.type='button'; up.title='Monter'; up.textContent='▲';
      up.addEventListener('click',()=>{ colBlocks.splice(blockIdx-1,0,colBlocks.splice(blockIdx,1)[0]); renderCols(); });
      bar.appendChild(up);
    }
    if (blockIdx < colBlocks.length-1) {
      const dn=el('button','ed-txt-btn'); dn.type='button'; dn.title='Descendre'; dn.textContent='▼';
      dn.addEventListener('click',()=>{ colBlocks.splice(blockIdx+1,0,colBlocks.splice(blockIdx,1)[0]); renderCols(); });
      bar.appendChild(dn);
    }
    const del=el('button','ed-txt-btn ed-icon-btn--del'); del.type='button'; del.title='Supprimer'; del.textContent='×';
    del.addEventListener('click',()=>{ colBlocks.splice(blockIdx,1); renderCols(); });
    bar.appendChild(del);

    wrap.appendChild(bar);
    wrap.appendChild(edDiv);
  }

  // ── Sauvegarde ─────────────────────────────────────────────────────────────

  async function _save() {
    const btnSave = document.getElementById('ed-fixed-bar') &&
                    document.getElementById('ed-fixed-bar').querySelector('.ed-btn--save');
    if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Enregistrement…'; }
    try {
      const updatePersons = {};
      updatePersons[_personId] = _buildPersonPayload(_person, _personParents.map(p => p.id));
      if (_conjointId && _conjoint && !_newPersons[_conjointId]) {
        updatePersons[_conjointId] = _buildPersonPayload(_conjoint, _conjointParents.map(p => p.id));
      }
      const updateFamilies = {};
      if (_familleId && !_newFamilies[_familleId]) {
        updateFamilies[_familleId] = {
          mariage:   _cleanEvent(_family.mariage),
          enfants:   _family.enfants.filter(Boolean),
          documents: _family.documents,
        };
      }
      const result = await api.saveAll({
        newPersons: _newPersons, newFamilies: _newFamilies,
        updatePersons, updateFamilies, deleteFamilies: _deleteFamilies,
      });
      if (_conjointFamilyTempId && result.idMap && result.idMap[_conjointFamilyTempId]) {
        await api.saveFamily(result.idMap[_conjointFamilyTempId], {
          mariage: _cleanEvent(_family.mariage), documents: _family.documents,
        });
      }
      _removeBar();
      _onSaved();
    } catch (err) {
      alert('Erreur lors de la sauvegarde :\n' + err.message);
      if (btnSave) { btnSave.disabled = false; btnSave.textContent = 'Enregistrer'; }
    }
  }

  // ── Utilitaires ────────────────────────────────────────────────────────────

  function _buildPersonPayload(person, parentIds) {
    return {
      nom:          person.nom    || null,
      prenom:       person.prenom || null,
      sexe:         person.sexe   || null,
      sosa:         person.sosa   != null ? person.sosa : undefined,
      naissance:    _cleanEvent(person.naissance),
      bapteme:      _cleanEvent(person.bapteme),
      deces:        _cleanEvent(person.deces),
      sepulture:    _cleanEvent(person.sepulture),
      professions:  (person.professions  || []).filter(Boolean),
      residences:   (person.residences   || []).map(r => _cleanEvent(r)).filter(Boolean),
      commentaires: (person.commentaires || []).filter(Boolean),
      parents:      parentIds.filter(Boolean),
    };
  }

  function _cleanEvent(ev) {
    if (!ev) return null;
    const hasDate = ev.date && String(ev.date).trim();
    const lieu    = ev.lieu || {};
    const keys    = ['ville','adresse','dept_num','dept_nom','region','pays','complement'];
    const hasLieu = keys.some(k => lieu[k] && String(lieu[k]).trim());
    if (!hasDate && !hasLieu) return null;
    const result = {};
    if (hasDate) result.date = String(ev.date).trim();
    if (hasLieu) {
      result.lieu = {};
      keys.forEach(k => { if (lieu[k]) result.lieu[k] = lieu[k]; });
      result.lieu.brut = keys.map(k => lieu[k]).filter(Boolean).join(', ');
    }
    return result;
  }

  // Raccourci bouton icône
  function _ib(label, title, extraClass, onClick) {
    const btn = el('button', 'ed-icon-btn' + (extraClass ? ' ' + extraClass : ''));
    btn.type = 'button'; btn.title = title; btn.textContent = label;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function _insertBr(edDiv) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    if (!br.nextSibling) br.parentNode.insertBefore(document.createTextNode('\u00A0'), br.nextSibling);
    range.setStartAfter(br); range.setEndAfter(br);
    sel.removeAllRanges(); sel.addRange(range);
  }

  function _serializeRichText(node) {
    let out = '';
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent.replace(/\u200B/g, '');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const t = child.tagName.toLowerCase();
        if      (t === 'br')                  out += '<br/>';
        else if (t === 'b' || t === 'strong') out += '<b>' + _serializeRichText(child) + '</b>';
        else if (t === 'i' || t === 'em')     out += '<i>' + _serializeRichText(child) + '</i>';
        else if (t === 'u')                   out += '<u>' + _serializeRichText(child) + '</u>';
        else if (t === 'div' || t === 'p') {
          const inner = _serializeRichText(child);
          out += (out && !out.endsWith('<br/>') ? '<br/>' : '') + inner;
        } else out += _serializeRichText(child);
      }
    });
    return out.replace(/(<br\/>)+$/, '');
  }

  function _clone(obj) { return obj == null ? obj : JSON.parse(JSON.stringify(obj)); }

  return { open };
})();


