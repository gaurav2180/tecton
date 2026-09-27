// Module drill-down page (#module:<name>): the file diagram, files table and per-file sheet.
import { layout } from '../../../layout.js';
import { $, ICONS, esc, h, icon, plural, reduceMotion, s } from '../lib/dom.js';
import { fileByPath, fileKind, filesOf, hasBase, nodeStats, nodesById, state } from '../lib/data.js';
import { hideTip, kindBadge, showTip, tabs } from '../ui/common.js';
import { syncViews } from './architecture.js';
import { activeViol, goSelect, pathD, present } from './map.js';
import { go, show } from '../ui/router.js';

// ------------------------------------------------------------------ module drill-down (#module:<name>)
const modState = { id: null, file: null, pending: null, onlyTouched: false, els: null, rows: new Map(), refresh: null };
const MAX_DIAGRAM_FILES = 250;
function goModule(id, file) {
  modState.pending = file || null;
  const page = `module:${encodeURIComponent(id)}`;
  if (location.hash !== `#${page}`) location.hash = page; else show(page);
}
function commonDir(paths) {
  if (!paths.length) return '';
  let parts = paths[0].split('/').slice(0, -1);
  for (const p of paths) { const q = p.split('/'); let i = 0; while (i < parts.length && i < q.length - 1 && parts[i] === q[i]) i++; parts = parts.slice(0, i); }
  return parts.join('/');
}
const modEdgeOf = (d) => (d.from.module !== d.to.module ? `${d.from.module}→${d.to.module}` : null);
const depViols = (d) => { const k = modEdgeOf(d); return (k && present(d.status) && activeViol().get(k)) || null; };
const showFileRow = (f) => present(f.status) && (!modState.onlyTouched || fileKind(f) !== 'same');

/** Boxes = this module's files + one box per module they talk to; arrows = imports. */
function fileGraph(id, files, relOf) {
  const edges = new Map();
  const others = new Set();
  const add = (from, to, d) => { const k = `${from}→${to}`; if (!edges.has(k)) edges.set(k, { id: k, from, to, deps: [] }); edges.get(k).deps.push(d); };
  for (const f of files) {
    for (const d of f.out) { if (d.to.module === id) add(f.path, d.to.path, d); else { others.add(d.to.module); add(f.path, `mod:${d.to.module}`, d); } }
    for (const d of f.in) if (d.from.module !== id) { others.add(d.from.module); add(`mod:${d.from.module}`, f.path, d); }
  }
  // box width must fit the file name (13px sans) and its folder line (10.5px mono)
  const fit = (name, meta) => (name.length * 7.3 >= meta.length * 6.4 ? name : name.padEnd(Math.ceil((meta.length * 6.4) / 7.3), ' '));
  const nodes = files.map((f) => {
    const r = relOf(f);
    const dir = r.includes('/') ? r.slice(0, r.lastIndexOf('/') + 1) : '';
    return { id: f.path, name: r.split('/').pop(), meta: dir, file: f };
  });
  [...others].sort().forEach((m) => nodes.push({ id: `mod:${m}`, name: m, meta: 'module', mod: m }));
  nodes.forEach((x) => { x.label = fit(x.name, x.meta); });
  const list = [...edges.values()].map((e) => {
    const sts = e.deps.map((d) => d.status);
    const status = sts.every((x) => x === 'added') ? 'added' : sts.every((x) => x === 'removed') ? 'removed' : 'same';
    return { ...e, status, countBase: e.deps.filter((d) => d.status !== 'added').length, countCur: e.deps.filter((d) => d.status !== 'removed').length };
  });
  const lay = layout(nodes.map((x) => ({ id: x.id, label: x.label, external: !!x.mod })), list);
  return { nodes, edges: list, lay };
}

function fileNodeTip(x) {
  if (x.mod) return `<div class="tt">${esc(x.name)}</div><div class="kv"><span>Another module</span><b></b></div><div class="kv faint"><span>Click to open its files</span></div>`;
  const f = x.file;
  const k = fileKind(f);
  return `<div class="tt">${esc(x.name)}${hasBase && k !== 'same' ? ` <span class="badge ${k === 'added' ? 'add' : k === 'removed' ? 'rem' : 'acc'}">${k[0].toUpperCase()}${k.slice(1)}</span>` : ''}</div>`
    + `<div class="kv"><span class="mono-s">${esc(f.path)}</span></div>`
    + `<div class="kv"><span>Imports</span><b>${f.out.filter((d) => present(d.status)).length}</b></div><div class="kv"><span>Imported by</span><b>${f.in.filter((d) => present(d.status)).length}</b></div>`;
}
function fileEdgeTip(e) {
  const n = e.status === 'removed' ? e.countBase : e.countCur;
  const name = (id) => (id.startsWith('mod:') ? id.slice(4) : id.split('/').pop());
  const vs = [...new Set(e.deps.flatMap((d) => (depViols(d) || []).map((v) => v.rule)))];
  return `<div class="tt">${esc(name(e.from))} <span class="faint">→</span> ${esc(name(e.to))}</div>`
    + `<div class="kv"><span>Imports</span><b>${e.status === 'same' && e.countBase !== e.countCur ? `${e.countBase} → ${e.countCur}` : n}</b></div>`
    + (hasBase && e.status !== 'same' ? `<div class="kv"><span>Status</span><b>${e.status === 'added' ? 'New' : 'Removed'}</b></div>` : '')
    + vs.map((r) => `<div class="kv" style="color:var(--viol-text)"><span>⚠ ${esc(r)}</span></div>`).join('');
}

function drawFileMap(box, g) {
  box.innerHTML = '';
  const pad = 28;
  const W = g.lay.width + pad * 2;
  const H = g.lay.height + pad * 2;
  const svg = s('svg', { class: 'fmap-svg', width: W, height: H, viewBox: `${-pad} ${-pad} ${W} ${H}`, role: 'group', 'aria-label': 'Files in this module and what they import' });
  // own markers and shadow: the map's are inside a hidden page, and browsers don't paint those
  const defs = s('defs');
  defs.innerHTML = '<filter id="fm-shadow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#101018" flood-opacity=".08"/></filter>'
    + ['line', 'add', 'rem', 'viol', 'accent'].map((k) => `<marker id="fm-arr-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,1.5 L9,5 L1,8.5 Q2.5,5 1,1.5 z" style="fill: var(--${k})"/></marker>`).join('');
  svg.appendChild(defs);
  const edgeLayer = s('g');
  const nodeLayer = s('g');
  svg.append(edgeLayer, nodeLayer);
  const els = { nodes: new Map(), edges: new Map() };
  g.edges.forEach((e) => {
    const d = pathD(g.lay.routes[e.id]);
    const line = s('path', { class: 'line', d });
    const el = s('g', { class: 'edge' }, s('path', { class: 'glow', d }), line, s('path', { class: 'hit', d }));
    el.addEventListener('pointermove', (ev) => showTip(ev, fileEdgeTip(e)));
    el.addEventListener('pointerleave', hideTip);
    edgeLayer.appendChild(el);
    els.edges.set(e.id, { e, el, line });
  });
  g.nodes.forEach((x) => {
    const p = g.lay.pos[x.id];
    const el = s('g', { class: `node${x.mod ? ' external' : ''}`, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': x.mod ? `Open module ${x.name}` : `File ${x.file.path}` });
    const badge = (cls, text, w) => s('g', { class: `nbadge ${cls}`, transform: `translate(${p.w - w - 8},-8)` }, s('rect', { width: w, height: 15, rx: 4 }), s('text', { x: w / 2, y: 10.5, 'text-anchor': 'middle' }, text));
    el.append(
      s('rect', { class: 'card-r', width: p.w, height: p.h, rx: x.mod ? p.h / 2 : 10 }),
      s('g', { class: 'n-ico', transform: `translate(12,${(p.h - 16) / 2}) scale(0.667)`, html: x.mod ? ICONS.box : ICONS.file }),
      s('text', { class: 'n-name', x: 36, y: x.meta ? 20 : p.h / 2 + 4.5 }, x.name),
      x.meta ? s('text', { class: 'n-meta', x: 36, y: 35 }, x.meta) : null,
      badge('b-add', 'NEW', 34), badge('b-rem', 'GONE', 38));
    if (x.file && x.file.edited && x.file.status === 'same') el.appendChild(s('circle', { class: 'tdot', cx: p.w - 11, cy: p.h / 2, r: 3.5 }));
    const act = () => (x.mod ? goModule(x.mod) : selectFile(modState.file === x.id ? null : x.id));
    el.addEventListener('click', (ev) => { ev.stopPropagation(); act(); });
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(); } });
    el.addEventListener('pointermove', (ev) => showTip(ev, fileNodeTip(x)));
    el.addEventListener('pointerleave', hideTip);
    nodeLayer.appendChild(el);
    els.nodes.set(x.id, { x, el });
  });
  svg.addEventListener('click', () => selectFile(null));
  box.appendChild(svg);
  return els;
}

function applyFileMap() {
  const els = modState.els;
  if (!els) return;
  const sel = modState.file;
  const shownNode = (id) => { const x = els.nodes.get(id).x; return x.mod ? true : showFileRow(x.file); };
  const visE = new Set();
  const liveMods = new Set();
  for (const { e } of els.edges.values()) {
    if (present(e.status) && shownNode(e.from) && shownNode(e.to)) {
      visE.add(e.id);
      [e.from, e.to].forEach((id) => { if (id.startsWith('mod:')) liveMods.add(id); });
    }
  }
  const keepE = sel ? new Set([...visE].filter((id) => { const e = els.edges.get(id).e; return e.from === sel || e.to === sel; })) : null;
  const keepN = sel ? new Set([sel, ...[...keepE].flatMap((id) => { const e = els.edges.get(id).e; return [e.from, e.to]; })]) : null;
  for (const { e, el, line } of els.edges.values()) {
    const show = visE.has(e.id);
    const st = state.view === 'diff' ? e.status : 'same';
    const viol = show && !(state.view === 'diff' && e.status === 'removed') && e.deps.some((d) => depViols(d));
    const on = keepE && keepE.has(e.id);
    el.setAttribute('class', `edge ${st}${viol ? ' viol' : ''}${on ? ' sel' : ''}${!show ? ' gone' : ''}${keepE && !on ? ' dim' : ''}`);
    line.setAttribute('marker-end', `url(#fm-arr-${on ? 'accent' : viol ? 'viol' : st === 'added' ? 'add' : st === 'removed' ? 'rem' : 'line'})`);
  }
  for (const { x, el } of els.nodes.values()) {
    const show = x.mod ? liveMods.has(x.id) : showFileRow(x.file);
    const k = x.file && state.view === 'diff' && hasBase ? fileKind(x.file) : 'same';
    const cls = k === 'edited' ? 'same touched' : k;
    el.setAttribute('class', `node${x.mod ? ' external' : ''} ${cls}${sel === x.id ? ' sel' : ''}${!show ? ' gone' : ''}${keepN && !keepN.has(x.id) ? ' dim' : ''}`);
  }
}

function selectFile(path) {
  modState.file = path && fileByPath.has(path) ? path : null;
  applyFileMap();
  modState.rows.forEach((tr, p) => tr.classList.toggle('sel', p === modState.file));
  hideTip();
  if (modState.file) {
    openFileSheet(fileByPath.get(modState.file));
    const tr = modState.rows.get(modState.file);
    const node = modState.els && modState.els.nodes.get(modState.file);
    if (node) node.el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    else if (tr) tr.scrollIntoView({ block: 'nearest' });
  } else {
    const sh = $('#sheet'); if (sh) sh.classList.remove('open');
  }
}

function openFileSheet(f) {
  const sh = $('#sheet');
  sh.innerHTML = '';
  const k = fileKind(f);
  const outs = f.out.filter((d) => present(d.status)).sort((a, b) => Number(a.to.module === f.module) - Number(b.to.module === f.module) || a.to.path.localeCompare(b.to.path));
  const ins = f.in.filter((d) => present(d.status)).sort((a, b) => Number(a.from.module === f.module) - Number(b.from.module === f.module) || a.from.path.localeCompare(b.from.path));
  const row = (d, dir) => {
    const o = dir === 'out' ? d.to : d.from;
    const same = o.module === f.module;
    const vs = depViols(d);
    return h('button', { class: 'pill-item', title: o.path, on: { click: () => (same ? selectFile(o.path) : goModule(o.module, o.path)) } },
      icon('file', 'faint'),
      h('span', { class: 'grow mono-s ell', text: same ? o.path.split('/').pop() : o.path }),
      !same ? h('span', { class: `chip${vs ? ' viol' : ''}`, text: o.module }) : null,
      state.view === 'diff' && hasBase && d.status !== 'same' ? kindBadge(d.status) : null,
      h('span', { class: 'faint mono-s', title: dir === 'out' ? `line ${d.line} of this file` : `line ${d.line} of ${o.path}`, text: `:${d.line}` }));
  };
  const rulesHit = [...new Set(outs.flatMap((d) => (depViols(d) || []).map((v) => v.rule)))];
  const others = [...new Set(outs.filter((d) => d.to.module !== f.module).map((d) => d.to.module))];
  const body = h('div', { class: 'drawer-b' });
  if (hasBase && k !== 'same') body.append(h('div', null, kindBadge(k), ' ', h('span', { class: 'chip', text: `module ${f.module}` })));
  rulesHit.forEach((r) => body.append(h('div', { class: 'callout' }, icon('alert'), h('div', null, h('b', { text: `An import here breaks “${r}”` }), h('div', { text: 'The rule-breaking imports are marked in orange below.' })))));
  body.append(h('div', { class: 'kv-grid' },
    h('div', null, h('div', { class: 'k', text: 'Imports' }), h('div', { class: 'v', text: outs.length })),
    h('div', null, h('div', { class: 'k', text: 'Imported by' }), h('div', { class: 'v', text: ins.length })),
    h('div', null, h('div', { class: 'k', text: 'Other modules' }), h('div', { class: 'v', text: others.length }))));
  if (outs.length) body.append(h('div', null, h('div', { class: 'sec-t', text: `Imports · ${outs.length}` }), h('div', { class: 'pill-list' }, outs.map((d) => row(d, 'out')))));
  if (ins.length) body.append(h('div', null, h('div', { class: 'sec-t', text: `Imported by · ${ins.length}` }), h('div', { class: 'pill-list' }, ins.map((d) => row(d, 'in')))));
  if (!outs.length && !ins.length) body.append(h('div', { class: 'muted', text: 'This file does not import other files in the analysed code, and nothing imports it.' }));
  sh.append(h('div', { class: 'drawer-h' },
    h('span', { class: `ico-box ${k === 'added' ? 'add' : k === 'removed' ? 'rem' : ''}` }, icon('file')),
    h('div', { style: { minWidth: 0 } }, h('h3', { text: f.path.split('/').pop() }), h('div', { class: 'sub mono-s ell', title: f.path, text: f.path })),
    h('button', { class: 'btn icon ghost', 'aria-label': 'Close', style: { marginLeft: 'auto' }, on: { click: () => selectFile(null) } }, icon('x'))), body);
  sh.classList.add('open');
}

function renderModule(id) {
  const pg = $('#page-module');
  pg.innerHTML = '';
  const n = nodesById.get(id);
  const keep = modState.id === id ? modState.file : null;
  modState.id = id;
  modState.els = null;
  modState.rows = new Map();
  const files = filesOf(id);
  const root = commonDir(files.map((f) => f.path));
  const relOf = (f) => (root ? f.path.slice(root.length + 1) : f.path);
  const st = nodeStats.get(id);
  const editedN = files.filter((f) => fileKind(f) !== 'same').length;
  const vt = tabs([
    { value: 'diff', label: 'Changes', disabled: !hasBase },
    { value: 'base', label: 'Before', disabled: !hasBase },
    { value: 'cur', label: 'After' },
  ], state.view, (v) => { state.view = v; syncViews(); });
  const nowFiles = files.filter((f) => present(f.status)).length;
  pg.append(h('div', { class: 'page-head' },
    h('div', { style: { minWidth: 0 } },
      h('button', { class: 'link-btn back', on: { click: () => go('modules') } }, icon('arrowLeft'), 'All modules'),
      h('h1', { class: 'ell', text: id, title: id }),
      h('p', { text: `${plural(nowFiles, 'file')}${root ? ` in ${root}/` : ''} · uses ${plural(st.uses, 'module')} · used by ${plural(st.usedBy, 'module')}` })),
    h('div', { class: 'right' }, vt, h('button', { class: 'btn', on: { click: () => goSelect({ type: 'node', id }) } }, icon('map'), h('span', { class: 'lbl-t', text: 'Show on map' })))));
  const chips = [
    hasBase && n.status !== 'same' ? kindBadge(n.status) : null,
    hasBase && editedN ? h('span', { class: 'chip acc' }, icon('pencil'), `${editedN} ${editedN === 1 ? 'file' : 'files'} edited in this change`) : null,
    st.viol ? h('span', { class: 'chip viol' }, icon('alert'), plural(st.viol, 'rule break')) : null,
  ].filter(Boolean);
  if (chips.length) pg.append(h('div', { class: 'chip-row' }, chips));

  const touchSw = hasBase && editedN ? h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: modState.onlyTouched, on: { change: (e) => { modState.onlyTouched = e.target.checked; modState.refresh(); } } }), 'Only changed files') : null;
  const legendItem = (cls, label) => h('span', null, s('svg', { viewBox: '0 0 22 8' }, s('g', { class: `edge ${cls}` }, s('path', { class: 'line', d: 'M1,4 L21,4' }))), label);
  const box = h('div', { class: 'fmap', id: 'fmap' });
  pg.append(h('div', { class: 'card fmap-card' },
    h('div', { class: 'card-h' }, h('h3', { text: 'How the files connect' }),
      h('div', { class: 'right fmap-legend' },
        legendItem('same', 'import'), hasBase ? legendItem('added', 'new') : null, hasBase ? legendItem('removed', 'removed') : null, legendItem('viol', 'breaks a rule'),
        hasBase && editedN ? h('span', null, h('i', { class: 'tdot-key' }), 'edited') : null)),
    box));
  if (files.length > MAX_DIAGRAM_FILES) {
    box.append(h('div', { class: 'empty-state' }, h('div', { class: 'ico-box' }, icon('layers')), h('h4', { text: `${plural(files.length, 'file')} is too many to draw clearly` }), h('p', { text: `The diagram is drawn for modules with up to ${MAX_DIAGRAM_FILES} files. The table below lists every file, or split the module with "depth" or "modules" in tecton.config.json.` })));
  } else if (!files.length) {
    box.append(h('div', { class: 'empty-state' }, h('div', { class: 'ico-box' }, icon('file')), h('h4', { text: 'No files' }), h('p', { text: 'This module has no files in the analysed code.' })));
  } else {
    modState.els = drawFileMap(box, fileGraph(id, files, relOf));
  }

  // files table
  const tbody = h('tbody');
  const draw = () => {
    tbody.innerHTML = '';
    modState.rows = new Map();
    const list = files.filter(showFileRow).sort((a, b) => relOf(a).localeCompare(relOf(b)));
    if (!list.length) tbody.appendChild(h('tr', null, h('td', { colspan: 5, class: 'faint', text: 'No files to show in this view.' })));
    list.forEach((f) => {
      const outs = f.out.filter((d) => present(d.status));
      const inside = outs.filter((d) => d.to.module === id).length;
      const mods = [...new Set(outs.filter((d) => d.to.module !== id).map((d) => d.to.module))].sort();
      const usedFrom = f.in.filter((d) => present(d.status) && d.from.module !== id).length;
      const r = relOf(f);
      const dir = r.includes('/') ? r.slice(0, r.lastIndexOf('/') + 1) : '';
      const k = fileKind(f);
      const tr = h('tr', { class: `click${f.path === modState.file ? ' sel' : ''}`, tabindex: 0, on: { click: () => selectFile(modState.file === f.path ? null : f.path), keydown: (e) => { if (e.key === 'Enter') selectFile(f.path); } } },
        h('td', null, h('div', { class: 'cell-mod mono-s' }, icon('file', 'faint'), h('span', { class: 'ell' }, dir ? h('span', { class: 'faint', text: dir }) : null, r.split('/').pop()))),
        h('td', null, hasBase && state.view === 'diff' && k !== 'same' ? kindBadge(k) : h('span', { class: 'faint', text: '—' })),
        h('td', { class: 'r num', text: inside }),
        h('td', null, mods.length ? h('div', { class: 'chip-row tight' }, mods.slice(0, 4).map((m) => {
          const vs = outs.some((d) => d.to.module === m && depViols(d));
          return h('button', { class: `chip mod${vs ? ' viol' : ''}`, title: vs ? `Breaks a rule. Open ${m}` : `Open ${m}`, on: { click: (e) => { e.stopPropagation(); goModule(m); } } }, m);
        }), mods.length > 4 ? h('span', { class: 'faint', text: `+${mods.length - 4}` }) : null) : h('span', { class: 'faint', text: '—' })),
        h('td', { class: 'r num', text: usedFrom }));
      modState.rows.set(f.path, tr);
      tbody.appendChild(tr);
    });
  };
  const thead = h('tr', null, h('th', { text: 'File' }), h('th', { text: 'Change' }), h('th', { class: 'r', text: 'Imports here' }), h('th', { text: 'Uses other modules' }), h('th', { class: 'r', text: 'Used from outside' }));
  pg.append(h('div', { class: 'toolbar', style: { marginTop: '14px' } }, h('h3', { class: 'toolbar-t', text: 'Files' }), touchSw),
    h('div', { class: 'card' }, h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, thead), tbody))));
  modState.refresh = () => { draw(); applyFileMap(); if (modState.file && !showFileRow(fileByPath.get(modState.file))) selectFile(null); };
  draw();
  modState.file = null;
  const want = modState.pending || keep;
  modState.pending = null;
  selectFile(want && fileByPath.has(want) && fileByPath.get(want).module === id ? want : null);
}

export { modState, MAX_DIAGRAM_FILES, goModule, commonDir, modEdgeOf, depViols, showFileRow, fileGraph, fileNodeTip, fileEdgeTip, drawFileMap, applyFileMap, selectFile, openFileSheet, renderModule };
