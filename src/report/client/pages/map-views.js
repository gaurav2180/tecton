// Other ways to look at the dependency map (the layered graph lives in map.js):
//   matrix  a dependency structure matrix: each row imports the columns it has a number in
//   radial  modules around a circle, imports as curves through the middle (shows tightly knit groups)
// Both follow Changes / Before / After and the current selection, and open the same side panel.
import { $$, h, s, short } from '../lib/dom.js';
import { D, edgesById, hasBase, state } from '../lib/data.js';
import { hideTip, showTip } from '../ui/common.js';
import { activeViol, edgeTip, nodeTip, present, select } from './map.js';

/** @typedef {import('../../../types').MapNode} MapNode @typedef {import('../../../types').MapEdge} MapEdge */

const MAP_VIEWS = [
  { value: 'graph', label: 'Graph' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'radial', label: 'Radial' },
];

/** Modules in reading order: the graph's layers top to bottom, left to right (so all views agree). */
function orderedNodes() {
  return D.nodes.slice().sort((a, b) => (a.pos ? a.pos.y : 0) - (b.pos ? b.pos.y : 0) || (a.pos ? a.pos.x : 0) - (b.pos ? b.pos.x : 0) || a.id.localeCompare(b.id));
}
const inDiff = () => state.view === 'diff' && hasBase;
/** @param {MapEdge} e */
const countOf = (e) => (state.view === 'base' ? e.countBase : state.view === 'cur' ? e.countCur : e.status === 'removed' ? e.countBase : e.countCur);
/** @param {MapEdge} e */
const isViol = (e) => activeViol().has(e.id) && !(inDiff() && e.status === 'removed');
const selEdge = () => (state.selected && state.selected.type === 'edge' ? state.selected.id : null);
const selNode = () => (state.selected && state.selected.type === 'node' ? state.selected.id : null);

// ------------------------------------------------------------------ matrix (DSM)
function renderMatrix(box) {
  const nodes = orderedNodes().filter((n) => present(n.status));
  const sn = selNode(); const se = selEdge();
  const colHead = nodes.map((n, j) => h('th', { class: `mx-col${n.external ? ' ext' : ''}${inDiff() && n.status !== 'same' ? ` s-${n.status}` : ''}${sn === n.id ? ' sel' : ''}`, dataset: { c: j }, title: n.id },
    h('div', { class: 'mx-rot' }, h('span', { text: short(n.id) }))));
  const rows = nodes.map((r, i) => {
    const cells = nodes.map((c, j) => {
      if (i === j) return h('td', { class: 'mx-diag', dataset: { c: j } });
      const e = edgesById.get(`${r.id}→${c.id}`);
      if (!e || !present(e.status)) return h('td', { class: 'mx-empty', dataset: { c: j } });
      const st = inDiff() ? e.status : 'same';
      const back = edgesById.get(`${c.id}→${r.id}`);
      const loop = back && present(back.status) && !c.external && !r.external;
      const changed = inDiff() && e.status === 'same' && e.countBase !== e.countCur;
      const cls = `mx-cell ${st}${isViol(e) ? ' viol' : ''}${loop ? ' loop' : ''}${changed ? ' chg' : ''}${se === e.id ? ' sel' : ''}${sn && sn !== r.id && sn !== c.id ? ' dim' : ''}`;
      return h('td', {
        class: cls, tabindex: 0, role: 'button', 'aria-label': `${r.id} imports ${c.id}`, dataset: { c: j },
        on: {
          click: () => select({ type: 'edge', id: e.id }),
          keydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select({ type: 'edge', id: e.id }); } },
          pointermove: (ev) => showTip(ev, edgeTip(e)), pointerleave: hideTip,
        },
      }, String(countOf(e)));
    });
    return h('tr', { class: `${sn === r.id ? 'sel' : ''}` },
      h('th', { class: `mx-row${r.external ? ' ext' : ''}${inDiff() && r.status !== 'same' ? ` s-${r.status}` : ''}`, scope: 'row' },
        h('button', { title: r.id, on: { click: () => select({ type: 'node', id: r.id }), pointermove: (ev) => showTip(ev, nodeTip(r)), pointerleave: hideTip } }, short(r.id))),
      cells);
  });
  const table = h('table', { class: 'dsm', 'aria-label': 'Dependency matrix: each row imports the columns with a number' },
    h('thead', null, h('tr', null, h('th', { class: 'mx-corner' }, h('span', { text: 'imports →' }), h('span', { text: '↓ module' })), colHead)),
    h('tbody', null, rows));
  // crosshair: highlight the row and column under the pointer
  table.addEventListener('pointerover', (ev) => {
    const td = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('td, th'));
    $$('.hc', table).forEach((el) => el.classList.remove('hc'));
    if (!td || td.dataset.c == null) return;
    td.parentElement.classList.add('hc');
    $$(`[data-c="${td.dataset.c}"]`, table).forEach((el) => el.classList.add('hc'));
  });
  table.addEventListener('pointerleave', () => $$('.hc', table).forEach((el) => el.classList.remove('hc')));
  box.append(
    h('div', { class: 'alt-note' },
      h('b', { text: 'How to read it: ' }), 'each row imports the modules in the columns where it has a number (the number of imports). ',
      h('span', { class: 'mx-key loop' }), ' mirrored cells are a loop. ',
      h('span', { class: 'mx-key viol' }), ' breaks a rule', inDiff() ? [' · ', h('span', { class: 'mx-key added' }), ' new · ', h('span', { class: 'mx-key removed' }), ' removed'] : null, '.'),
    h('div', { class: 'dsm-wrap' }, table));
}

// ------------------------------------------------------------------ radial
function renderRadial(box) {
  const nodes = orderedNodes();
  const n = Math.max(1, nodes.length);
  const labelW = Math.min(200, Math.max(...nodes.map((x) => short(x.id).length)) * 7 + 18);
  const R = Math.max(150, (n * 30) / (2 * Math.PI));
  const S = 2 * (R + labelW + 16);
  /** @type {Map<string, {x: number, y: number, a: number}>} */
  const at = new Map(nodes.map((x, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [x.id, { x: R * Math.cos(a), y: R * Math.sin(a), a }]; }));
  const svg = s('svg', { class: 'radial', viewBox: `${-S / 2} ${-S / 2} ${S} ${S}`, preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': 'Radial dependency view' });
  const defs = s('defs');
  // own arrowheads: the graph's live in an SVG that is hidden while this view is shown
  defs.innerHTML = ['line', 'add', 'rem', 'viol', 'accent'].map((k) => `<marker id="rd-arr-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,1.5 L9,5 L1,8.5 Q2.5,5 1,1.5 z" style="fill: var(--${k})"/></marker>`).join('');
  svg.appendChild(defs);
  svg.appendChild(s('circle', { class: 'rd-ring', r: R }));
  const sn = selNode(); const se = selEdge();
  const edgeLayer = s('g'); const nodeLayer = s('g');
  svg.append(edgeLayer, nodeLayer);
  /** @type {{ e: MapEdge, g: SVGGElement }[]} */
  const wires = [];
  for (const e of D.edges) {
    const a = at.get(e.from); const b = at.get(e.to);
    if (!a || !b) continue;
    // stop short of the dot so the arrowhead is visible, and bend through the middle
    const k = (R - 9) / R;
    const d = `M${(a.x * k).toFixed(1)},${(a.y * k).toFixed(1)} Q${((a.x + b.x) * 0.12).toFixed(1)},${((a.y + b.y) * 0.12).toFixed(1)} ${(b.x * k).toFixed(1)},${(b.y * k).toFixed(1)}`;
    const st = inDiff() ? e.status : 'same';
    const viol = present(e.status) && isViol(e);
    const on = se === e.id || (sn && (e.from === sn || e.to === sn));
    const g = s('g', { class: `edge ${st}${viol ? ' viol' : ''}${present(e.status) ? '' : ' gone'}${se === e.id ? ' sel' : ''}${(sn || se) && !on ? ' dim' : ''}`, dataset: { from: e.from, to: e.to } },
      s('path', { class: 'line', d, 'marker-end': `url(#rd-arr-${se === e.id ? 'accent' : viol ? 'viol' : st === 'added' ? 'add' : st === 'removed' ? 'rem' : 'line'})` }),
      s('path', { class: 'hit', d }));
    g.addEventListener('click', (ev) => { ev.stopPropagation(); select({ type: 'edge', id: e.id }); });
    g.addEventListener('pointermove', (ev) => showTip(ev, edgeTip(e)));
    g.addEventListener('pointerleave', hideTip);
    edgeLayer.appendChild(g);
    wires.push({ e, g });
  }
  const violNodes = new Set(D.edges.filter((e) => present(e.status) && isViol(e)).flatMap((e) => [e.from, e.to]));
  for (const x of nodes) {
    const p = at.get(x.id);
    const deg = (p.a * 180) / Math.PI;
    const left = Math.cos(p.a) < -1e-6;
    const st = inDiff() ? x.status : 'same';
    const linked = sn && (sn === x.id || D.edges.some((e) => present(e.status) && ((e.from === sn && e.to === x.id) || (e.to === sn && e.from === x.id))));
    const g = s('g', { class: `rn ${st}${x.external ? ' external' : ''}${violNodes.has(x.id) ? ' inviol' : ''}${sn === x.id ? ' sel' : ''}${present(x.status) ? '' : ' gone'}${sn && !linked ? ' dim' : ''}`, tabindex: 0, role: 'button', 'aria-label': x.id, transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})` },
      s('circle', { r: x.external ? 5 : 7 }),
      s('text', { transform: `rotate(${left ? deg + 180 : deg}) translate(${left ? -14 : 14},0)`, 'text-anchor': left ? 'end' : 'start', 'dominant-baseline': 'central' }, short(x.id)));
    const hl = (on) => {
      svg.classList.toggle('hl-on', on);
      if (!on) { wires.forEach((w) => w.g.classList.remove('hl')); return; }
      wires.forEach((w) => w.g.classList.toggle('hl', w.e.from === x.id || w.e.to === x.id));
    };
    g.addEventListener('pointerenter', () => hl(true));
    g.addEventListener('pointerleave', () => { hl(false); hideTip(); });
    g.addEventListener('pointermove', (ev) => showTip(ev, nodeTip(x)));
    g.addEventListener('click', (ev) => { ev.stopPropagation(); select({ type: 'node', id: x.id }); });
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select({ type: 'node', id: x.id }); } });
    nodeLayer.appendChild(g);
  }
  svg.addEventListener('click', () => { if (state.selected) select(null); });
  box.append(
    h('div', { class: 'alt-note' }, h('b', { text: 'How to read it: ' }), 'modules sit around the circle in the same order as the graph; each curve is an import, arrowhead at the module being used. Hover a module to follow its links.'),
    h('div', { class: 'radial-wrap' }, svg));
}

/** Draw the chosen non-graph view into `box` (called on every view or selection change). */
function renderMapAlt(box) {
  if (!box) return;
  box.innerHTML = '';
  if (state.mapView === 'matrix') renderMatrix(box);
  else if (state.mapView === 'radial') renderRadial(box);
}

export { MAP_VIEWS, renderMapAlt, orderedNodes };
