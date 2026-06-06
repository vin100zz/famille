'use strict';

// ── Arbre généalogique circulaire ────────────────────────────────────────────
// Usage : CircularTree.init(containerEl, onSelectFn)

const CircularTree = (function () {

  // ── Paramètres ────────────────────────────────────────────────────────────

  const LAYERS    = 13;
  const ZOOM_STEP = 0.15;
  const ZOOM_MIN  = 0.4;
  const ZOOM_MAX  = 8.0;

  // ── État ─────────────────────────────────────────────────────────────────

  let _size = 1000;
  let _mid, _rad, _outer;
  let _map  = {};
  let _cnv  = null;
  let _hi   = null;
  let _ctx  = null;
  let _hctx = null;
  let _onSelect   = null;
  let _initialized = false;

  let _zoomLevel   = 1.0;   // multiplicateur par rapport à la taille viewport
  let _baseSize    = 800;   // taille "100 %" = ajustée sur le viewport
  let _container   = null;  // #tree-container
  let _scrollEl    = null;  // #welcome  (le conteneur scrollable)
  let _zoomCtrl    = null;  // div des boutons ± (position:fixed)

  // ── Drag-to-pan ────────────────────────────────────────────────────────────
  let _dragActive  = false;
  let _dragMoved   = false;
  let _dragStartX  = 0;
  let _dragStartY  = 0;
  let _scrollStartX = 0;
  let _scrollStartY = 0;

  // ── Initialisation publique ───────────────────────────────────────────────

  async function init(container, onSelectFn) {
    _onSelect  = onSelectFn;
    _container = container;
    _scrollEl  = document.getElementById('welcome');

    // Créer les deux canvas superposés
    _cnv  = _makeCanvas(container, 'ct-nodes');
    _hi   = _makeCanvas(container, 'ct-hi');
    _ctx  = _cnv.getContext('2d');
    _hctx = _hi.getContext('2d');

    // Labels texte
    const lblDiv = document.createElement('div');
    lblDiv.id = 'ct-labels';
    lblDiv.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    container.appendChild(lblDiv);

    // Tooltip
    // (déjà dans index.html comme #ct-tooltip)

    // ── Événements souris ────────────────────────────────────────────────────
    // Hover
    _hi.addEventListener('mousemove', _onMove);
    _hi.addEventListener('mouseleave', () => {
      if (!_dragActive) {
        _hctx.clearRect(0, 0, _size, _size);
        _hideTooltip();
      }
    });

    // Drag / click (mousedown sur le canvas highlight)
    _hi.addEventListener('mousedown', _onDragStart);
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup',   _onDragEnd);

    // Zoom molette (sur le conteneur scrollable)
    if (_scrollEl) {
      _scrollEl.addEventListener('wheel', _onWheel, { passive: false });
    }

    // ── Données ──────────────────────────────────────────────────────────────
    try {
      _map = await api.getSosaMap();
    } catch (e) {
      console.error('CircularTree: impossible de charger la carte sosa', e);
    }

    // ── Boutons ± ────────────────────────────────────────────────────────────
    _createZoomControls();

    // ── Dimensionnement + dessin ─────────────────────────────────────────────
    _resize();
    _centerView();
    window.addEventListener('resize', () => { _resize(); _draw(); _centerView(); });
    _draw();
    _initialized = true;
  }

  /** Redessine l'arbre (utile après retour à l'accueil). */
  function redraw() {
    if (_initialized) { _resize(); _draw(); _centerView(); }
  }

  /** Affiche ou masque les boutons de zoom. */
  function showControls(visible) {
    if (_zoomCtrl) _zoomCtrl.hidden = !visible;
  }

  // ── Zoom ─────────────────────────────────────────────────────────────────

  function _applyZoom(newZoom, pivotClientX, pivotClientY) {
    const prev = _zoomLevel;
    _zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
    if (Math.abs(_zoomLevel - prev) < 0.001) return;

    // Position absolue du pivot dans le contenu scrollé
    let absX = 0, absY = 0;
    if (_scrollEl && pivotClientX != null) {
      const r = _scrollEl.getBoundingClientRect();
      absX = (_scrollEl.scrollLeft + pivotClientX - r.left);
      absY = (_scrollEl.scrollTop  + pivotClientY - r.top);
    }

    const ratio = _zoomLevel / prev;
    _resize();
    _draw();
    _updateScrollArea();

    // Repositionner pour garder le pivot sous le curseur
    if (_scrollEl && pivotClientX != null) {
      const r = _scrollEl.getBoundingClientRect();
      _scrollEl.scrollLeft = absX * ratio - (pivotClientX - r.left);
      _scrollEl.scrollTop  = absY * ratio - (pivotClientY - r.top);
    }
  }

  function _zoomIn()  { _applyZoom(_zoomLevel + ZOOM_STEP); }
  function _zoomOut() { _applyZoom(_zoomLevel - ZOOM_STEP); }

  function _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    _applyZoom(_zoomLevel + delta, e.clientX, e.clientY);
  }

  // ── Drag to pan ───────────────────────────────────────────────────────────

  function _onDragStart(e) {
    if (e.button !== 0) return;
    _dragActive   = true;
    _dragMoved    = false;
    _dragStartX   = e.clientX;
    _dragStartY   = e.clientY;
    _scrollStartX = _scrollEl ? _scrollEl.scrollLeft : 0;
    _scrollStartY = _scrollEl ? _scrollEl.scrollTop  : 0;
    e.preventDefault();   // évite la sélection de texte
  }

  function _onDragMove(e) {
    if (!_dragActive) return;
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartY;
    if (!_dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      _dragMoved = true;
    }
    if (_dragMoved && _scrollEl) {
      _scrollEl.scrollLeft = _scrollStartX - dx;
      _scrollEl.scrollTop  = _scrollStartY - dy;
      _hi.style.cursor = 'grabbing';
      _hctx.clearRect(0, 0, _size, _size);
      _hideTooltip();
    }
  }

  function _onDragEnd(e) {
    if (!_dragActive) return;
    const wasMoved = _dragMoved;
    _dragActive = false;
    _dragMoved  = false;
    _hi.style.cursor = 'default';
    // Si pas de déplacement → clic
    if (!wasMoved) _onClick(e);
  }

  // ── Centrage de la vue ────────────────────────────────────────────────────

  function _centerView() {
    if (!_scrollEl) return;
    const sw = _scrollEl.clientWidth;
    const sh = _scrollEl.clientHeight;
    if (_size > sw) _scrollEl.scrollLeft = (_size - sw) / 2;
    else            _scrollEl.scrollLeft = 0;
    if (_size > sh) _scrollEl.scrollTop  = (_size - sh) / 2;
    else            _scrollEl.scrollTop  = 0;
  }

  // ── Scroll area ──────────────────────────────────────────────────────────

  function _updateScrollArea() {
    const sa = document.getElementById('tree-scroll-area');
    if (!sa || !_scrollEl) return;
    const vw = _scrollEl.clientWidth;
    const vh = _scrollEl.clientHeight;
    sa.style.width  = Math.max(vw, _size) + 'px';
    sa.style.height = Math.max(vh, _size) + 'px';
  }

  // ── Utilitaires DOM ───────────────────────────────────────────────────────

  function _makeCanvas(parent, id) {
    const c = document.createElement('canvas');
    c.id = id;
    c.style.cssText = 'position:absolute;left:0;top:0;';
    parent.appendChild(c);
    return c;
  }

  function _createZoomControls() {
    const div = document.createElement('div');
    div.className = 'ct-zoom-controls';
    div.id = 'ct-zoom-controls';

    const mkBtn = (label, fn, title) => {
      const b = document.createElement('button');
      b.className   = 'ct-zoom-btn';
      b.textContent = label;
      b.title       = title;
      b.type        = 'button';
      b.addEventListener('click', fn);
      return b;
    };

    div.appendChild(mkBtn('+', _zoomIn,  'Zoom avant'));
    div.appendChild(mkBtn('−', _zoomOut, 'Zoom arrière'));
    document.body.appendChild(div);
    _zoomCtrl = div;
  }

  function _resize() {
    const hdr = document.querySelector('.site-header');
    const hdrH = hdr ? hdr.offsetHeight : 60;
    document.documentElement.style.setProperty('--hdr-h', hdrH + 'px');
    const avail = Math.min(window.innerWidth, window.innerHeight - hdrH) - 16;
    _baseSize = Math.max(300, avail);
    _size     = Math.max(300, Math.round(_baseSize * _zoomLevel));
    _mid      = _size / 2;
    _rad      = Math.floor(_size / (2 * (LAYERS + 1)));
    _outer    = LAYERS * _rad;

    if (_container) {
      _container.style.width  = _size + 'px';
      _container.style.height = _size + 'px';
    }
    [_cnv, _hi].forEach(c => { if (c) { c.width = _size; c.height = _size; } });

    const lbl = document.getElementById('ct-labels');
    if (lbl) lbl.innerHTML = '';

    _updateScrollArea();
  }

  // ── Dessin des noeuds ─────────────────────────────────────────────────────

  function _draw() {
    _drawNodes();
    _drawLabels();
  }

  function _drawNodes() {
    _ctx.clearRect(0, 0, _size, _size);
    // Cercle central (cujus)
    if (_map[1]) {
      _ctx.globalAlpha = 1;
      _ctx.fillStyle   = '#f4a261';
      _ctx.strokeStyle = '#aaa';
      _ctx.lineWidth   = 0.5;
      _ctx.beginPath();
      _ctx.arc(_mid, _mid, _rad, 0, 2 * Math.PI);
      _ctx.fill();
      _ctx.stroke();
    }
    // Anneaux
    for (let layer = 1; layer <= LAYERS; layer++) {
      const n = Math.pow(2, layer);
      for (let i = 0; i < n; i++) {
        const id = n + i;
        if (_map[id]) {
          _drawSegment(_ctx, layer, i, 'wheat', id % 2 === 1 ? 0.55 : 1.0);
        }
      }
    }
  }

  function _drawSegment(ctx, layer, idx, color, alpha) {
    const n  = Math.pow(2, layer);
    const a0 = -2 * Math.PI * (idx + 1) / n;
    const a1 = -2 * Math.PI * idx / n;
    const r0 = layer * _rad;
    const r1 = (layer + 1) * _rad;

    ctx.globalAlpha  = alpha;
    ctx.fillStyle    = color;
    ctx.strokeStyle  = '#aaa';
    ctx.lineWidth    = 0.5;
    ctx.beginPath();
    ctx.arc(_mid, _mid, r0, a0, a1);
    ctx.lineTo(_mid + r1 * Math.cos(a1), _mid + r1 * Math.sin(a1));
    ctx.arc(_mid, _mid, r1, a1, a0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Dessin des labels ─────────────────────────────────────────────────────

  function _drawLabels() {
    const lbl = document.getElementById('ct-labels');
    if (!lbl) return;
    lbl.innerHTML = '';

    if (_map[1]) _addLabel(_shortName(1, true), _mid, _mid - _rad / 4, 10);
    if (_map[2]) _addLabel(_shortName(2), _mid, _mid - _rad * 1.5 + 7,  10);
    if (_map[3]) _addLabel(_shortName(3), _mid, _mid + _rad * 1.5 - 5,  10);

    const dx = _rad / 3, dy = _rad;
    if (_map[4]) _addLabel(_shortName(4), _mid + _rad * 1.5 + dx, _mid - _rad * 2.5 + dy, 10, '45deg');
    if (_map[5]) _addLabel(_shortName(5), _mid - _rad * 1.5 - dx, _mid - _rad * 2.5 + dy, 10, '-45deg');
    if (_map[6]) _addLabel(_shortName(6), _mid - _rad * 1.5 - dx, _mid + _rad * 2.5 - dy, 10, '45deg');
    if (_map[7]) _addLabel(_shortName(7), _mid + _rad * 1.5 + dx, _mid + _rad * 2.5 - dy, 10, '-45deg');

    for (let layer = 3; layer < LAYERS; layer++) {
      const n = Math.pow(2, layer);
      for (let i = 0; i < n; i++) {
        const id = n + i;
        if (_map[id]) {
          const angle = (2 * i + 1) * Math.PI / n;
          const r     = (layer + 0.5) * _rad;
          const x     = _mid + r * Math.cos(angle);
          const y     = _mid - r * Math.sin(angle);
          _addLabel(id, x, y);
        }
      }
    }
  }

  function _shortName(id, br = false) {
    const p = _map[id];
    if (!p) return '';
    const prenom = (_stripQuotes(p.prenom).split(' ')[0] || '');
    const nom    = p.nom || '';
    return `${prenom}${br ? '<br/>' : ' '}${nom}`.trim();
  }

  /** Supprime les guillemets droits ou typographiques autour des prénoms. */
  function _stripQuotes(str) {
    if (!str) return '';
    return str.replace(/['"''""«»]/g, '');
  }

  function _addLabel(content, x, y, size = 8, rotate) {
    const lbl = document.getElementById('ct-labels');
    if (!lbl) return;
    const div = document.createElement('div');
    Object.assign(div.style, {
      position:   'absolute',
      left:       (x - 50) + 'px',
      top:        (y - 10) + 'px',
      width:      '100px',
      height:     '20px',
      textAlign:  'center',
      color:      '#333',
      font:       size + 'px Arial',
      lineHeight: '20px',
    });
    if (rotate) div.style.transform = 'rotate(' + rotate + ')';
    div.innerHTML = typeof content === 'number' ? String(content) : content;
    lbl.appendChild(div);
  }

  // ── Détection du noeud sous le curseur ────────────────────────────────────

  function _hitTest(evt) {
    const rect  = _hi.getBoundingClientRect();
    const x     = evt.clientX - rect.left;
    const y     = evt.clientY - rect.top;
    const r     = Math.sqrt((x - _mid) ** 2 + (y - _mid) ** 2);

    if (r <= _rad) return _map[1] ? { id: 1, layer: 0, idx: 0 } : null;
    if (r > _outer) return null;

    const layer = Math.floor(r / _rad);
    if (layer < 1 || layer > LAYERS) return null;

    let idx;
    if (layer === 1) {
      idx = (y - _mid < 0) ? 0 : 1;
    } else {
      const angle = (y - _mid < 0)
        ? -Math.atan2(y - _mid, x - _mid)
        : 2 * Math.PI - Math.atan2(y - _mid, x - _mid);
      idx = Math.floor(angle * Math.pow(2, layer) / (2 * Math.PI));
    }

    const id = Math.pow(2, layer) + idx;
    return _map[id] ? { id, layer, idx } : null;
  }

  // ── Événements ────────────────────────────────────────────────────────────

  function _onMove(evt) {
    if (_dragActive) return;   // pas de hover pendant un drag
    _hctx.clearRect(0, 0, _size, _size);

    const hit = _hitTest(evt);
    if (!hit) {
      _hideTooltip();
      _hi.style.cursor = 'default';
      return;
    }

    const { id, layer, idx } = hit;
    _getAncestors(id).forEach(aid => _drawSegmentById(aid, 'lightgreen', 0.85));
    _getDescendants(id).forEach(did => _drawSegmentById(did, 'lightblue', 0.85));

    if (layer === 0) {
      _hctx.globalAlpha = 1;
      _hctx.fillStyle   = 'orange';
      _hctx.beginPath();
      _hctx.arc(_mid, _mid, _rad, 0, 2 * Math.PI);
      _hctx.fill();
      _hctx.globalAlpha = 1;
    } else {
      _drawSegment(_hctx, layer, idx, 'orange', 1.0);
    }

    _hi.style.cursor = 'pointer';
    _showTooltip(_tooltipHtml(id), evt.pageX, evt.pageY);
  }

  function _onClick(evt) {
    const hit = _hitTest(evt);
    if (!hit) return;
    const person = _map[hit.id];
    if (person && person.id && _onSelect) _onSelect(person.id);
  }

  // ── Utilitaires graphiques ────────────────────────────────────────────────

  function _drawSegmentById(id, color, alpha) {
    if (id === 1) {
      _hctx.globalAlpha = alpha;
      _hctx.fillStyle   = color;
      _hctx.beginPath();
      _hctx.arc(_mid, _mid, _rad, 0, 2 * Math.PI);
      _hctx.fill();
      _hctx.globalAlpha = 1;
      return;
    }
    const layer = Math.floor(Math.log2(id));
    const idx   = id - Math.pow(2, layer);
    _drawSegment(_hctx, layer, idx, color, alpha);
  }

  function _getDescendants(id) {
    const res = [];
    let cur = id;
    while (cur > 1) { cur = Math.floor(cur / 2); if (cur >= 1) res.push(cur); }
    return res;
  }

  function _getAncestors(id) {
    const MAX  = Math.pow(2, LAYERS + 1) - 1;
    const res  = [], q = [id], seen = new Set();
    while (q.length) {
      const c = q.shift();
      if (seen.has(c) || c > MAX) continue;
      seen.add(c);
      [2 * c, 2 * c + 1].forEach(p => {
        if (p <= MAX && !seen.has(p) && _map[p]) { res.push(p); q.push(p); }
      });
    }
    return res;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function _showTooltip(html, px, py) {
    const tip = document.getElementById('ct-tooltip');
    if (!tip) return;
    tip.innerHTML     = html;
    tip.style.display = 'block';
    tip.style.left    = (px + 18) + 'px';
    tip.style.top     = (py + 14) + 'px';
  }

  function _hideTooltip() {
    const tip = document.getElementById('ct-tooltip');
    if (tip) tip.style.display = 'none';
  }

  function _tooltipHtml(id) {
    const p = _map[id];
    if (!p) return '';
    function fmt(s) {
      if (!s) return '';
      return String(s)
        .replace(/\bJAN\b/gi,'jan.').replace(/\bFEB\b/gi,'fév.')
        .replace(/\bMAR\b/gi,'mars').replace(/\bAPR\b/gi,'avr.')
        .replace(/\bMAY\b/gi,'mai' ).replace(/\bJUN\b/gi,'juin')
        .replace(/\bJUL\b/gi,'juil.').replace(/\bAUG\b/gi,'août')
        .replace(/\bSEP\b/gi,'sep.').replace(/\bOCT\b/gi,'oct.')
        .replace(/\bNOV\b/gi,'nov.').replace(/\bDEC\b/gi,'déc.')
        .replace(/\bABT\b/gi,'v.').replace(/\bBEF\b/gi,'av.')
        .replace(/\bAFT\b/gi,'ap.');
    }
    function line(lbl, date, ville) {
      const d = fmt(date), l = [d, ville].filter(Boolean).join(' – ');
      return l ? `<div><span class="ct-tip-lbl">${lbl}</span> ${l}</div>` : '';
    }
    return `
      <div class="ct-tip-name">${_stripQuotes(p.prenom)} ${p.nom || ''}
        <span class="ct-tip-sosa">${id}</span>
      </div>
      ${line('Naissance', p.naissance_date, p.naissance_ville)}
      ${line('Mariage',   p.mariage_date,   p.mariage_ville)}
      ${line('Décès',     p.deces_date,     p.deces_ville)}
    `;
  }

  // ── API publique ──────────────────────────────────────────────────────────

  return { init, redraw, showControls };

})();

