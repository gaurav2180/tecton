// Dependency map page: layout rendering, drawer, pan/zoom, minimap and intro animation.
import { $, $$, ICONS, esc, h, icon, plural, reduceMotion, s, short, store } from '../lib/dom.js';
import { D, canScope, edgesById, fileByPath, hasBase, isChange, nodeStats, nodesById, state, touchedMods, violById, violEdges } from '../lib/data.js';
import { evidence, hideTip, kindBadge, showTip, statusBadge, tabs, violBadge } from '../ui/common.js';
import { exportSvg } from '../ui/export.js';
import { goModule } from './module.js';
import { go } from '../ui/router.js';
import { MAP_VIEWS, renderMapAlt } from './map-views.js';

// ------------------------------------------------------------------ map
const map = { built: false, animated: false, vb: { x: 0, y: 0, w: 100, h: 100 }, edgeEls: new Map(), nodeEls: new Map() };

function pathD(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]; const my = (b[1] - a[1]) / 2;
    d += ` C${a[0]},${a[1] + my} ${b[0]},${b[1] - my} ${b[0]},${b[1]}`;
  }
  return d;
}
// sample the same curve in JS (no DOM measuring needed, works while the page is hidden)
function samplePath(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]; const my = (b[1] - a[1]) / 2;
    const c1 = [a[0], a[1] + my]; const c2 = [b[0], b[1] - my];
    for (let k = 1; k <= 16; k++) {
      const t = k / 16; const u = 1 - t;
      out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
        u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
  }
  let len = 0;
  const cum = [0];
  for (let i = 1; i < out.length; i++) { len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]); cum.push(len); }
  const half = len / 2;
  let j = cum.findIndex((c) => c >= half);
  if (j < 1) j = 1;
  const f = (half - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
  return { len, mid: [out[j - 1][0] + (out[j][0] - out[j - 1][0]) * f, out[j - 1][1] + (out[j][1] - out[j - 1][1]) * f] };
}

function renderMap() {
  const pg = $('#page-map');
  const viewTabs = tabs([
    { value: 'diff', label: 'Changes', disabled: !hasBase },
    { value: 'base', label: 'Before', disabled: !hasBase },
    { value: 'cur', label: 'After' },
  ], state.view, (v) => { state.view = v; applyMap(); });
  viewTabs.id = 'view-tabs';
  const kindTabs = tabs(MAP_VIEWS, state.mapView, (v) => setMapView(v));
  kindTabs.id = 'map-kind-tabs';
  kindTabs.setAttribute('aria-label', 'Kind of diagram');
  const focusSw = h('label', { class: 'switch glass graph-only', style: { display: hasBase ? '' : 'none' }, title: 'Show only dependencies that were added, removed or break a rule' },
    h('input', { type: 'checkbox', id: 'focus-sw', on: { change: (e) => { state.focusOnly = e.target.checked; if (state.focusOnly) { state.touchedOnly = false; const t = $('#touched-sw'); if (t) t.checked = false; if (state.view !== 'diff') { state.view = 'diff'; viewTabs._set('diff'); } } applyMap(); } } }), 'Only changes');
  const touchedSw = canScope ? h('label', { class: 'switch glass graph-only', title: 'Show only the modules whose files this change edits, and what they connect to' },
    h('input', { type: 'checkbox', id: 'touched-sw', on: { change: (e) => { state.touchedOnly = e.target.checked; if (state.touchedOnly) { state.focusOnly = false; $('#focus-sw').checked = false; } applyMap(); } } }),
    h('i', { class: 'tdot-key', 'aria-hidden': 'true' }), 'Only touched') : null;
  const legendItem = (cls, label) => h('span', null, s('svg', { viewBox: '0 0 22 8' }, s('g', { class: `edge ${cls}` }, s('path', { class: 'line', d: 'M1,4 L21,4' }))), label);
  const legend = h('div', { class: 'legend-float glass' },
    legendItem('same', 'Unchanged'), hasBase ? legendItem('added', 'New') : null, hasBase ? legendItem('removed', 'Removed') : null, legendItem('viol', 'Breaks a rule'));
  const pct = h('div', { class: 'pct', id: 'zoom-pct', text: '100%' });
  const zoomCtl = h('div', { class: 'zoom glass' },
    h('button', { 'aria-label': 'Zoom in', 'data-tip': 'Zoom in', on: { click: () => zoom(1 / 1.3) } }, icon('plus')),
    h('button', { 'aria-label': 'Zoom out', 'data-tip': 'Zoom out', on: { click: () => zoom(1.3) } }, icon('minus')),
    h('button', { 'aria-label': 'Fit to screen', 'data-tip': 'Fit to screen (F)', on: { click: () => fit(true) } }, icon('fit')),
    h('button', { 'aria-label': 'Export SVG', 'data-tip': 'Export as SVG', on: { click: exportSvg } }, icon('image')),
    pct);
  const minimap = h('div', { class: 'minimap glass', id: 'minimap' });
  const svg = s('svg', { id: 'map-svg', role: 'img', 'aria-label': 'Module dependency map' });
  const stage = h('div', { id: 'stage' }, svg);
  const drawer = h('aside', { class: 'drawer', id: 'drawer', 'aria-label': 'Details' });
  const alt = h('div', { class: 'map-alt', id: 'map-alt' });
  pg.append(h('div', { class: 'card map-card', id: 'map-card' }, stage, alt,
    h('div', { class: 'float tl', id: 'map-float' }, h('div', { class: 'glass', style: { padding: '0', borderRadius: '11px' } }, kindTabs), h('div', { class: 'glass', style: { padding: '0', borderRadius: '11px' } }, viewTabs), focusSw, touchedSw, legend),
    h('div', { class: 'float br' }, zoomCtl),
    h('div', { class: 'float bl' }, minimap),
    drawer));
  buildGraph(svg);
  buildMinimap(minimap);
  wirePanZoom(stage);
  setMapView(state.mapView, true);
}

/** Graph, Matrix or Radial. The graph stays built underneath, so switching back keeps its zoom. */
function setMapView(v, quiet) {
  if (!MAP_VIEWS.some((x) => x.value === v)) v = 'graph';
  state.mapView = v;
  if (!quiet) store.set('mapView', v);
  const card = $('#map-card');
  card.dataset.kind = v;
  card.classList.toggle('alt-on', v !== 'graph');
  hideTip();
  placeAlt();
  renderMapAlt($('#map-alt'));
  if (v === 'graph' && !quiet) requestAnimationFrame(() => { if (!map.fitted) { fit(false); map.fitted = true; } });
}
/** Keep the other views clear of the floating toolbar, whose height changes as it wraps. */
function placeAlt() {
  const fl = $('#map-float'); const alt = $('#map-alt');
  if (fl && alt) alt.style.top = `${fl.offsetTop + fl.offsetHeight + 12}px`;
}

function buildGraph(svg) {
  const defs = s('defs');
  defs.innerHTML = '<filter id="nshadow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#101018" flood-opacity=".08"/></filter>'
    + '<pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" style="fill: var(--dot)"/></pattern>';
  ['line', 'add', 'rem', 'viol', 'accent'].forEach((k) => {
    const m = s('marker', { id: `arr-${k}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 10, markerHeight: 10, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
    m.appendChild(s('path', { d: 'M1,1.5 L9,5 L1,8.5 Q2.5,5 1,1.5 z', style: `fill: var(--${k})` }));
    defs.appendChild(m);
  });
  svg.appendChild(defs);
  svg.appendChild(s('rect', { x: -20000, y: -20000, width: 40000, height: 40000, fill: 'url(#dots)' }));
  const world = s('g', { id: 'world' });
  const edgeLayer = s('g');
  const nodeLayer = s('g');
  const labelLayer = s('g');
  world.append(edgeLayer, nodeLayer, labelLayer);
  svg.appendChild(world);

  const maxY = Math.max(1, D.height);
  D.edges.forEach((e, i) => {
    const d = pathD(e.points);
    const { len, mid } = samplePath(e.points);
    const g = s('g', { class: 'edge', style: `--len:${Math.ceil(len)};--d:${(e.points[0][1] / maxY) * 0.6 + 0.15}s` });
    g.appendChild(s('path', { class: 'glow', d }));
    const line = s('path', { class: 'line', d, id: `ep${i}` });
    g.appendChild(line);
    g.appendChild(s('path', { class: 'hit', d }));
    const needsFlow = e.status === 'added' || violEdges.cur.has(e.id);
    if (needsFlow && !reduceMotion) {
      const dot = s('circle', { class: 'flow', r: 2.6 });
      const am = s('animateMotion', { dur: `${Math.max(1.6, len / 70).toFixed(2)}s`, repeatCount: 'indefinite', rotate: 'auto' });
      am.appendChild(s('mpath', { href: `#ep${i}` }));
      dot.appendChild(am);
      g.appendChild(dot);
    }
    edgeLayer.appendChild(g);
    const wrap = s('g', { class: 'edge' });
    const lg = s('g', { class: 'lbl', transform: `translate(${mid[0].toFixed(1)},${mid[1].toFixed(1)})` });
    const lr = s('rect', { rx: 8, height: 16, y: -8 });
    const lt = s('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5 });
    lg.append(lr, lt);
    wrap.appendChild(lg);
    labelLayer.appendChild(wrap);
    const onClick = (ev) => { if (!map.dragMoved) { ev.stopPropagation(); select({ type: 'edge', id: e.id }); } };
    [g, wrap].forEach((el) => {
      el.addEventListener('click', onClick);
      el.addEventListener('pointermove', (ev) => { if (!map.drag) showTip(ev, edgeTip(e)); });
      el.addEventListener('pointerleave', hideTip);
    });
    wrap.style.cursor = 'pointer';
    map.edgeEls.set(e.id, { g, line, lbl: wrap, lr, lt });
  });

  D.nodes.forEach((n, i) => {
    const p = n.pos;
    const g = s('g', { class: `node${n.external ? ' external' : ''}`, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': n.id });
    const inner = s('g', { style: `--d:${(p.y / maxY) * 0.5 + (i % 5) * 0.03}s` });
    inner.appendChild(s('rect', { class: 'card-r', width: p.w, height: p.h, rx: n.external ? p.h / 2 : 10 }));
    const ic = s('g', { class: 'n-ico', transform: `translate(12,${(p.h - 16) / 2}) scale(0.667)`, html: n.external ? ICONS.pkg : ICONS.box });
    inner.appendChild(ic);
    inner.appendChild(s('text', { class: 'n-name', x: 36, y: 20 }, short(n.id)));
    const meta = s('text', { class: 'n-meta', x: 36, y: 35 });
    inner.appendChild(meta);
    const badge = (cls, text, w) => s('g', { class: `nbadge ${cls}`, transform: `translate(${p.w - w - 8},-8)` }, s('rect', { width: w, height: 15, rx: 4 }), s('text', { x: w / 2, y: 10.5, 'text-anchor': 'middle' }, text));
    inner.appendChild(badge('b-add', 'NEW', 34));
    inner.appendChild(badge('b-rem', 'GONE', 38));
    if (n.touched) inner.appendChild(s('circle', { class: 'tdot', cx: p.w - 11, cy: p.h / 2, r: 3.5 }));
    g.appendChild(inner);
    g.addEventListener('click', (ev) => { if (!map.dragMoved) { ev.stopPropagation(); select({ type: 'node', id: n.id }); } });
    if (!n.external) g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); goModule(n.id); });
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select({ type: 'node', id: n.id }); } });
    g.addEventListener('pointermove', (ev) => { if (!map.drag) showTip(ev, nodeTip(n)); });
    g.addEventListener('pointerleave', hideTip);
    nodeLayer.appendChild(g);
    map.nodeEls.set(n.id, { g, inner, meta });
  });
  svg.addEventListener('click', () => { if (!map.dragMoved && state.selected) select(null); });
  map.world = world;
  map.svg = svg;
  map.built = true;
  applyMap();
}

function present(status) {
  if (state.view === 'diff') return true;
  return state.view === 'base' ? status !== 'added' : status !== 'removed';
}
const activeViol = () => (state.view === 'base' ? violEdges.base : violEdges.cur);

function applyMap() {
  if (!map.built) return;
  const av = activeViol();
  const sel = state.selected;
  let keepN = null;
  let keepE = null;
  if (sel) {
    keepN = new Set(); keepE = new Set();
    if (sel.type === 'node') {
      keepN.add(sel.id);
      D.edges.forEach((e) => { if ((e.from === sel.id || e.to === sel.id) && present(e.status)) { keepE.add(e.id); keepN.add(e.from); keepN.add(e.to); } });
    } else if (sel.type === 'edge') {
      const se = edgesById.get(sel.id); keepE.add(se.id); keepN.add(se.from); keepN.add(se.to);
    } else {
      violById.get(sel.id).edges.forEach((id) => { const x = edgesById.get(id); if (x) { keepE.add(id); keepN.add(x.from); keepN.add(x.to); } });
    }
  } else if (state.focusOnly && state.view === 'diff') {
    keepN = new Set(); keepE = new Set();
    D.edges.forEach((e) => { if (isChange(e) || av.has(e.id)) { keepE.add(e.id); keepN.add(e.from); keepN.add(e.to); } });
    D.nodes.forEach((n) => { if (n.status !== 'same') keepN.add(n.id); });
  } else if (state.touchedOnly) {
    keepN = new Set(touchedMods); keepE = new Set();
    D.edges.forEach((e) => { if (present(e.status) && (touchedMods.has(e.from) || touchedMods.has(e.to))) { keepE.add(e.id); keepN.add(e.from); keepN.add(e.to); } });
  }
  const violNodes = new Set();
  D.edges.forEach((e) => {
    const E = map.edgeEls.get(e.id);
    const show = present(e.status);
    const st = state.view === 'diff' ? e.status : 'same';
    const viol = av.has(e.id) && show && !(state.view === 'diff' && e.status === 'removed');
    if (viol) { violNodes.add(e.from); violNodes.add(e.to); }
    const isSel = sel && sel.type === 'edge' && sel.id === e.id;
    const extra = E.g.classList.contains('draw-in') ? ' draw-in' : '';
    const cls = `edge ${st}${viol ? ' viol' : ''}${isSel ? ' sel' : ''}${!show ? ' gone' : ''}${keepE && !keepE.has(e.id) ? ' dim' : ''}`;
    E.g.setAttribute('class', cls + extra);
    E.lbl.setAttribute('class', cls);
    const mk = isSel ? 'accent' : viol ? 'viol' : st === 'added' ? 'add' : st === 'removed' ? 'rem' : 'line';
    E.line.setAttribute('marker-end', `url(#arr-${mk})`);
    let txt;
    if (state.view === 'diff') {
      if (e.status === 'added') txt = `+${e.countCur}`;
      else if (e.status === 'removed') txt = `−${e.countBase}`;
      else txt = e.countBase === e.countCur ? String(e.countCur) : `${e.countBase}→${e.countCur}`;
    } else txt = String(state.view === 'base' ? e.countBase : e.countCur);
    if (viol) txt = `⚠ ${txt}`;
    E.lt.textContent = txt;
    const w = Math.max(20, txt.length * 6.3 + 12);
    E.lr.setAttribute('width', w); E.lr.setAttribute('x', -w / 2);
  });
  D.nodes.forEach((n) => {
    const N = map.nodeEls.get(n.id);
    const show = present(n.status);
    const st = state.view === 'diff' ? n.status : 'same';
    const isSel = sel && sel.type === 'node' && sel.id === n.id;
    N.g.setAttribute('class', `node${n.external ? ' external' : ''} ${st}${violNodes.has(n.id) ? ' inviol' : ''}${isSel ? ' sel' : ''}${!show ? ' gone' : ''}${keepN && !keepN.has(n.id) ? ' dim' : ''}${n.touched && state.view === 'diff' ? ' touched' : ''}`);
    const files = state.view === 'base' ? n.filesBase : state.view === 'cur' ? n.filesCur : (n.status === 'removed' ? n.filesBase : n.filesCur);
    N.meta.textContent = n.external ? 'npm package' : (state.view === 'diff' && n.status === 'same' && n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur} files` : plural(files, 'file'));
  });
  updateMinimapClasses(violNodes);
  renderDrawer();
  if (state.mapView !== 'graph') renderMapAlt($('#map-alt'));
}

function nodeTip(n) {
  const st = nodeStats.get(n.id);
  return `<div class="tt">${esc(short(n.id))}${n.status !== 'same' && hasBase ? ` <span class="badge ${n.status === 'added' ? 'add' : 'rem'}">${n.status === 'added' ? 'New' : 'Removed'}</span>` : ''}</div>`
    + `${n.external ? '<div class="kv"><span>npm package</span><b></b></div>' : `<div class="kv"><span>Files</span><b>${hasBase && n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur}` : n.status === 'removed' ? n.filesBase : n.filesCur}</b></div>`}`
    + `<div class="kv"><span>Uses</span><b>${st.uses}</b></div><div class="kv"><span>Used by</span><b>${st.usedBy}</b></div>`
    + (n.touched && hasBase ? `<div class="kv"><span>Files edited</span><b style="color:var(--accent-text)">${n.touched}</b></div>` : '')
    + (!n.external ? '<div class="kv faint"><span>Double-click to open its files</span></div>' : '')
    + (st.viol ? `<div class="kv"><span>Rule breaks</span><b style="color:var(--viol-text)">${st.viol}</b></div>` : '');
}
function edgeTip(e) {
  const vs = activeViol().get(e.id) || [];
  const n = e.status === 'removed' ? e.countBase : e.countCur;
  return `<div class="tt">${esc(short(e.from))} <span class="faint">→</span> ${esc(short(e.to))}</div>`
    + `<div class="kv"><span>Imports</span><b>${e.status === 'same' && e.countBase !== e.countCur ? `${e.countBase} → ${e.countCur}` : n}</b></div>`
    + (hasBase ? `<div class="kv"><span>Status</span><b>${e.status === 'added' ? 'New' : e.status === 'removed' ? 'Removed' : 'Unchanged'}</b></div>` : '')
    + vs.map((v) => `<div class="kv" style="color:var(--viol-text)"><span>⚠ ${esc(v.rule)}</span></div>`).join('');
}

// ---- drawer
function renderDrawer() {
  const dr = $('#drawer');
  if (!dr) return;
  const sel = state.selected;
  if (!sel) { dr.classList.remove('open'); return; }
  dr.innerHTML = '';
  const closeBtn = h('button', { class: 'btn icon ghost', 'aria-label': 'Close details', style: { marginLeft: 'auto' }, on: { click: () => select(null) } }, icon('x'));
  const body = h('div', { class: 'drawer-b' });
  let head;
  if (sel.type === 'node') {
    const n = nodesById.get(sel.id);
    const st = nodeStats.get(n.id);
    head = h('div', { class: 'drawer-h' },
      h('span', { class: `ico-box ${n.status === 'added' && hasBase ? 'add' : n.status === 'removed' ? 'rem' : ''}` }, icon(n.external ? 'pkg' : 'box')),
      h('div', { style: { minWidth: 0 } }, h('h3', { text: short(n.id) }), h('div', { class: 'sub' }, n.external ? 'npm package' : `${hasBase ? ({ added: 'New module', removed: 'Removed module', same: 'Module' })[n.status] : 'Module'} · ${plural(n.status === 'removed' ? n.filesBase : n.filesCur, 'file')}`)),
      closeBtn);
    body.append(h('div', { class: 'kv-grid' },
      h('div', null, h('div', { class: 'k', text: 'Uses' }), h('div', { class: 'v', text: st.uses })),
      h('div', null, h('div', { class: 'k', text: 'Used by' }), h('div', { class: 'v', text: st.usedBy })),
      h('div', null, h('div', { class: 'k', text: 'Rule breaks' }), h('div', { class: 'v', style: st.viol ? { color: 'var(--viol-text)' } : null, text: st.viol }))));
    if (!n.external) body.append(h('button', { class: 'btn', on: { click: () => goModule(n.id) } }, icon('file'), 'Open files and how they connect', n.touched && hasBase ? h('span', { class: 'chip acc', text: `${n.touched} edited` }) : null));
    const outs = D.edges.filter((e) => e.from === n.id && present(e.status));
    const ins = D.edges.filter((e) => e.to === n.id && present(e.status));
    /** @type {[string, import('../../../types').MapEdge[], 'to' | 'from'][]} */ ([['Uses', outs, 'to'], ['Used by', ins, 'from']]).forEach(([title, list, end]) => {
      if (!list.length) return;
      body.append(h('div', null, h('div', { class: 'sec-t', text: `${title} · ${list.length}` }), h('div', { class: 'pill-list' }, list.map((e) => {
        const vs = activeViol().get(e.id);
        return h('button', { class: 'pill-item', on: { click: () => select({ type: 'edge', id: e.id }) } },
          icon(e[end].startsWith('npm:') ? 'pkg' : 'box', 'faint'), h('span', { class: 'grow', text: short(e[end]) }),
          vs ? statusBadge('serious', 'Rule') : null,
          state.view === 'diff' && e.status !== 'same' ? kindBadge(e.status) : null,
          h('span', { class: 'faint num mono', style: { fontSize: '11.5px' }, text: String(e.status === 'removed' ? e.countBase : e.countCur) }));
      }))));
    });
    if (n.files.length) {
      const files = n.files.filter((f) => !(state.view === 'base' && f.status === 'added') && !(state.view === 'cur' && f.status === 'removed'));
      body.append(h('div', null, h('div', { class: 'sec-t', text: `Files · ${files.length}` }), h('div', { class: 'file-list' },
        files.slice(0, 300).map((f) => {
          const edited = state.view === 'diff' && f.status === 'same' && (fileByPath.get(f.path) || {}).edited;
          const cls = state.view === 'diff' ? (f.status === 'added' ? 'plus' : f.status === 'removed' ? 'minus' : edited ? 'edit' : '') : '';
          return h('div', { class: `${cls} click`, role: 'button', tabindex: 0, title: 'Open this file', on: { click: () => goModule(n.id, f.path), keydown: (e) => { if (e.key === 'Enter') goModule(n.id, f.path); } }, text: `${state.view === 'diff' && f.status === 'added' ? '+ ' : state.view === 'diff' && f.status === 'removed' ? '− ' : edited ? '~ ' : ''}${f.path}` });
        }))));
    }
  } else if (sel.type === 'edge') {
    const e = edgesById.get(sel.id);
    const vs = activeViol().get(e.id) || [];
    head = h('div', { class: 'drawer-h' },
      h('span', { class: `ico-box ${vs.length ? 'viol' : e.status === 'added' ? 'add' : e.status === 'removed' ? 'rem' : ''}` }, icon(vs.length ? 'alert' : 'link')),
      h('div', { style: { minWidth: 0 } }, h('h3', null, short(e.from), h('span', { class: 'arrow', text: ' → ' }), short(e.to)),
        h('div', { class: 'sub', text: `${hasBase ? ({ added: 'New dependency', removed: 'Removed dependency', same: 'Dependency' })[e.status] : 'Dependency'} · ${e.status === 'same' && e.countBase !== e.countCur ? `imports ${e.countBase} → ${e.countCur}` : plural(e.status === 'removed' ? e.countBase : e.countCur, 'import')}` })),
      closeBtn);
    vs.forEach((v) => body.append(h('div', { class: 'callout' }, icon('alert'), h('div', null, h('b', { text: `Breaks “${v.rule}”` }), v.message ? h('div', { text: v.message }) : null))));
    body.append(h('div', { class: 'pill-list' },
      [e.from, e.to].map((id) => h('button', { class: 'pill-item', on: { click: () => select({ type: 'node', id }) } }, icon(id.startsWith('npm:') ? 'pkg' : 'box', 'faint'), h('span', { class: 'grow', text: short(id) }), h('span', { class: 'faint', style: { fontSize: '12px' }, text: id === e.from ? 'imports' : 'is imported' })))));
    if (e.addedImports && e.addedImports.length) body.append(h('div', null, h('div', { class: 'sec-t', text: 'Added in this change' }), evidence(e.addedImports, 'plus')));
    body.append(h('div', null, h('div', { class: 'sec-t', text: e.status === 'removed' ? 'Where it used to happen' : 'Where it happens' }), evidence(e.imports)));
  } else {
    const v = violById.get(sel.id);
    head = h('div', { class: 'drawer-h' },
      h('span', { class: 'ico-box viol' }, icon(v.kind === 'cycle' ? 'cycle' : 'alert')),
      h('div', { style: { minWidth: 0 } }, h('h3', { text: v.rule }), h('div', { class: 'sub', text: v.status === 'new' ? 'New in this change' : v.status === 'fixed' ? 'Fixed by this change' : hasBase ? 'Already existed before this change' : 'Found in the current code' })),
      closeBtn);
    body.append(h('div', null, violBadge(v), ' ', statusBadge(v.severity === 'error' ? 'critical' : 'warn', v.severity === 'error' ? 'Error' : 'Warning')));
    if (v.message) body.append(h('div', { class: 'callout' }, icon('alert'), v.message));
    body.append(h('div', { class: 'muted', text: v.kind === 'cycle' ? `These modules depend on each other in a loop: ${v.members.map(short).join(' ⇄ ')}` : `${short(v.from)} is not allowed to use ${short(v.to)}.` }));
    body.append(h('div', null, h('div', { class: 'sec-t', text: 'Where it happens' }), evidence(v.imports)));
  }
  dr.append(head, body);
  dr.classList.add('open');
}

function select(sel, reveal) {
  state.selected = sel && state.selected && state.selected.type === sel.type && state.selected.id === sel.id && !reveal ? null : sel;
  const s2 = state.selected;
  if (s2 && hasBase) {
    const obj = s2.type === 'node' ? nodesById.get(s2.id) : s2.type === 'edge' ? edgesById.get(s2.id) : null;
    const v = s2.type === 'viol' ? violById.get(s2.id) : null;
    if (state.view === 'cur' && ((obj && obj.status === 'removed') || (v && v.status === 'fixed'))) state.view = 'diff';
    if (state.view === 'base' && ((obj && obj.status === 'added') || (v && v.status === 'new'))) state.view = 'diff';
    const vt = $('#view-tabs'); if (vt) vt._set(state.view);
  }
  hideTip();
  applyMap();
  if (s2 && reveal) revealSelection();
}
function goSelect(sel) { go('map'); setTimeout(() => select(sel, true), 30); }

// ---- pan / zoom
function setVB() {
  const vb = map.vb;
  map.svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const r = $('#stage').getBoundingClientRect();
  const pctEl = $('#zoom-pct');
  if (pctEl && r.width) pctEl.textContent = `${Math.round((r.width / vb.w) * 100)}%`;
  updateMinimapViewport();
}
function stageRect() { return $('#stage').getBoundingClientRect(); }
function fitTo(x0, y0, x1, y1, pad, animate) {
  const r = stageRect();
  const W = Math.max(1, r.width); const H = Math.max(1, r.height);
  const drawerW = state.selected && $('#drawer').classList.contains('open') && W > 700 ? Math.min(400, W) : 0;
  const topPad = 64;
  const cw = (x1 - x0) + pad * 2; const ch = (y1 - y0) + pad * 2 + topPad;
  const sc = Math.max(cw / (W - drawerW), ch / H, 0.55);
  const target = { w: W * sc, h: H * sc };
  target.x = (x0 + x1) / 2 - ((W - drawerW) * sc) / 2;
  target.y = (y0 + y1) / 2 - target.h / 2 - (topPad / 2) * sc; // leave room for the floating toolbar
  animateVB(target, animate);
}
let vbAnim = null;
function animateVB(target, animate) {
  cancelAnimationFrame(vbAnim);
  if (!animate || reduceMotion) { Object.assign(map.vb, target); setVB(); return; }
  const from = { ...map.vb };
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 420);
    const k = 1 - (1 - p) ** 3;
    ['x', 'y', 'w', 'h'].forEach((key) => { map.vb[key] = from[key] + (target[key] - from[key]) * k; });
    setVB();
    if (p < 1) vbAnim = requestAnimationFrame(step);
  };
  vbAnim = requestAnimationFrame(step);
}
function fit(animate) { fitTo(0, -10, D.width, D.height, 48, animate); }
function revealSelection() {
  const sel = state.selected;
  if (!sel) return;
  let ids = [];
  if (sel.type === 'node') {
    ids = [sel.id];
    D.edges.forEach((e) => { if ((e.from === sel.id || e.to === sel.id) && present(e.status)) ids.push(e.from, e.to); });
  } else if (sel.type === 'edge') { const e = edgesById.get(sel.id); ids = [e.from, e.to]; } else violById.get(sel.id).edges.forEach((k) => { const e = edgesById.get(k); if (e) ids.push(e.from, e.to); });
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  ids.forEach((id) => { const p = nodesById.get(id).pos; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); });
  fitTo(x0, y0, x1, y1, 90, true);
}
function zoom(f, cx, cy) {
  const r = stageRect();
  if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
  const vb = map.vb;
  const px = vb.x + (cx / r.width) * vb.w; const py = vb.y + (cy / r.height) * vb.h;
  const nw = Math.min(Math.max(vb.w * f, 180), Math.max(D.width, D.height) * 6 + 2400);
  const k = nw / vb.w;
  vb.x = px - (px - vb.x) * k; vb.y = py - (py - vb.y) * k; vb.w *= k; vb.h *= k;
  setVB();
}
function wirePanZoom(stage) {
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = stageRect();
    if (ev.ctrlKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX) * 1.2 || ev.deltaMode) zoom(Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016)), ev.clientX - r.left, ev.clientY - r.top);
    else { map.vb.x += ev.deltaX * map.vb.w / r.width; map.vb.y += ev.deltaY * map.vb.h / r.height; setVB(); }
  }, { passive: false });
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    map.drag = { x: ev.clientX, y: ev.clientY, vx: map.vb.x, vy: map.vb.y }; map.dragMoved = false;
  });
  window.addEventListener('pointermove', (ev) => {
    if (!map.drag) return;
    const dx = ev.clientX - map.drag.x; const dy = ev.clientY - map.drag.y;
    if (!map.dragMoved && Math.abs(dx) + Math.abs(dy) > 4) { map.dragMoved = true; stage.classList.add('dragging'); hideTip(); }
    if (!map.dragMoved) return;
    const r = stageRect();
    map.vb.x = map.drag.vx - dx * map.vb.w / r.width; map.vb.y = map.drag.vy - dy * map.vb.h / r.height; setVB();
  });
  window.addEventListener('pointerup', () => { map.drag = null; stage.classList.remove('dragging'); setTimeout(() => { map.dragMoved = false; }, 0); });
}

// ---- minimap
function buildMinimap(box) {
  const pad = 20;
  const svg = s('svg', { viewBox: `${-pad} ${-pad} ${D.width + pad * 2} ${D.height + pad * 2}`, preserveAspectRatio: 'xMidYMid meet' });
  const g = s('g');
  D.edges.forEach((e) => g.appendChild(s('path', { d: pathD(e.points), style: 'fill:none;stroke:var(--border-strong);stroke-width:2', 'vector-effect': 'non-scaling-stroke' })));
  D.nodes.forEach((n) => { const r = s('rect', { class: 'mn', x: n.pos.x, y: n.pos.y, width: n.pos.w, height: n.pos.h, rx: 8, dataset: null }); r.dataset.id = n.id; g.appendChild(r); });
  const vp = s('rect', { class: 'vp', rx: 6 });
  svg.append(g, vp);
  box.appendChild(svg);
  map.mini = { svg, vp, pad };
  const jump = (ev) => {
    const r = svg.getBoundingClientRect();
    const vbW = D.width + pad * 2; const vbH = D.height + pad * 2;
    const scale = Math.max(vbW / r.width, vbH / r.height);
    const offX = (r.width * scale - vbW) / 2; const offY = (r.height * scale - vbH) / 2;
    const x = (ev.clientX - r.left) * scale - offX - pad; const y = (ev.clientY - r.top) * scale - offY - pad;
    animateVB({ ...map.vb, x: x - map.vb.w / 2, y: y - map.vb.h / 2 }, ev.type === 'click');
  };
  let dragging = false;
  box.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); dragging = true; jump(ev); });
  window.addEventListener('pointermove', (ev) => { if (dragging) jump(ev); });
  window.addEventListener('pointerup', () => { dragging = false; });
}
function updateMinimapViewport() {
  if (!map.mini) return;
  const vb = map.vb;
  const vp = map.mini.vp;
  vp.setAttribute('x', vb.x); vp.setAttribute('y', vb.y); vp.setAttribute('width', vb.w); vp.setAttribute('height', vb.h);
}
function updateMinimapClasses(violNodes) {
  if (!map.mini) return;
  $$('rect.mn', map.mini.svg).forEach((r) => {
    const n = nodesById.get(r.dataset.id);
    const st = state.view === 'diff' ? n.status : 'same';
    r.setAttribute('class', `mn ${st}${violNodes.has(n.id) ? ' inviol' : ''}`);
    r.style.opacity = present(n.status) ? '' : '0';
  });
}

// ---- intro animation (first visit to the map)
function introAnimation() {
  if (map.animated || reduceMotion) { map.animated = true; return; }
  map.animated = true;
  map.edgeEls.forEach((E) => E.g.classList.add('draw-in'));
  map.nodeEls.forEach((N) => N.inner.classList.add('pop-in'));
  $$('.lbl', map.world).forEach((l) => { l.style.opacity = '0'; l.style.transition = 'opacity .4s'; });
  setTimeout(() => $$('.lbl', map.world).forEach((l) => { l.style.opacity = ''; }), 900);
  setTimeout(() => {
    map.edgeEls.forEach((E) => E.g.classList.remove('draw-in'));
    map.nodeEls.forEach((N) => N.inner.classList.remove('pop-in'));
  }, 1900);
}

export { setMapView, placeAlt, map, pathD, samplePath, renderMap, buildGraph, present, activeViol, applyMap, nodeTip, edgeTip, renderDrawer, select, goSelect, setVB, stageRect, fitTo, vbAnim, animateVB, fit, revealSelection, zoom, wirePanZoom, buildMinimap, updateMinimapViewport, updateMinimapClasses, introAnimation };
