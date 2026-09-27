// The report model embedded in the page, everything derived from it, and the shared UI state.
import { plural, short } from './dom.js';

/** @typedef {import('../../../types').ReportModel} ReportModel */

/** The report model, embedded by report.js as JSON. @type {ReportModel} */
const D = JSON.parse(document.getElementById('data').textContent);

// ------------------------------------------------------------------ derived data
const S = D.summary;
const V = S.violations;
const hasBase = D.hasBase;
const nodesById = new Map(D.nodes.map((n) => [n.id, n]));
const edgesById = new Map(D.edges.map((e) => [e.id, e]));
const violById = new Map(D.violations.map((v) => [v.id, v]));
const violEdges = { cur: new Map(), base: new Map() };
const pushTo = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
D.violations.forEach((v) => v.edges.forEach((eid) => {
  if (v.status !== 'fixed') pushTo(violEdges.cur, eid, v);
  if (v.status !== 'new') pushTo(violEdges.base, eid, v);
}));
const failing = hasBase ? V.newErrors > 0 : D.violations.some((v) => v.severity === 'error');
const curViols = D.violations.filter((v) => v.status !== 'fixed');
const isChange = (e) => e.status !== 'same' || e.countBase !== e.countCur;
const changeKind = (e) => (e.status === 'added' ? 'added' : e.status === 'removed' ? 'removed' : 'changed');
const internalNodes = D.nodes.filter((n) => !n.external);

const nodeStats = new Map(D.nodes.map((n) => [n.id, { uses: 0, usedBy: 0, viol: 0 }]));
D.edges.forEach((e) => {
  if (e.status === 'removed') return;
  nodeStats.get(e.from).uses++;
  nodeStats.get(e.to).usedBy++;
});
curViols.forEach((v) => {
  const mods = v.kind === 'cycle' ? v.members : [v.from];
  mods.forEach((m) => { if (nodeStats.has(m)) nodeStats.get(m).viol++; });
});

const rules = (D.rules || []).map((r) => {
  const vs = D.violations.filter((v) => v.rule === r.key);
  const n = { new: 0, existing: 0, fixed: 0 };
  vs.forEach((v) => { n[v.status]++; });
  let state;
  if (n.new) state = 'new';
  else if (n.existing) state = 'existing';
  else if (n.fixed) state = 'fixed';
  else state = 'pass';
  return { ...r, viols: vs, n, state };
});

/** @type {import('../types').ChangeItem[]} */
const changes = [
  ...internalNodes.filter((n) => n.status !== 'same').map((n) => ({
    type: 'node', id: n.id, kind: n.status, label: n.id,
    sub: plural(n.status === 'added' ? n.filesCur : n.filesBase, 'file'),
  })),
  ...D.edges.filter(isChange).map((e) => ({
    type: 'edge', id: e.id, kind: changeKind(e), label: `${short(e.from)} → ${short(e.to)}`, edge: e,
    viol: (violEdges.cur.get(e.id) || []).some((v) => v.status === 'new'),
  })),
];
// files inside modules, and which file imports which (for the per-module drill-down)
const FG = D.files || { files: [], deps: [] };
/** @type {Record<string, import('../../../types').Status>} */
const FST = { s: 'same', a: 'added', r: 'removed' };
/** @type {import('../types').FileInfo[]} */
const FILES = FG.files.map(([path, module, st, edited], i) => ({ i, path, module, status: FST[st], edited: !!edited, out: [], in: [] }));
const fileByPath = new Map(FILES.map((f) => [f.path, f]));
FG.deps.forEach(([a, b, st, line]) => { const d = { from: FILES[a], to: FILES[b], status: FST[st], line }; FILES[a].out.push(d); FILES[b].in.push(d); });
const filesOf = (mod) => FILES.filter((f) => f.module === mod);
const touchedMods = new Set(D.nodes.filter((n) => n.touched).map((n) => n.id));
const canScope = hasBase && touchedMods.size > 0;
const fileKind = (f) => (f.status === 'added' ? 'added' : f.status === 'removed' ? 'removed' : f.edited ? 'edited' : 'same');

const kindOrder = { added: 0, removed: 1, changed: 2 };
changes.sort((a, b) => (b.viol ? 1 : 0) - (a.viol ? 1 : 0) || kindOrder[a.kind] - kindOrder[b.kind] || a.label.localeCompare(b.label));

// ------------------------------------------------------------------ state
const PAGES = [
  { id: 'overview', title: 'Overview', icon: 'overview' },
  { id: 'system', title: 'Architecture', icon: 'layers' },
  { id: 'map', title: 'Dependency map', icon: 'map' },
  { id: 'rules', title: 'Rule checks', icon: 'shield' },
  { id: 'changes', title: 'Changes', icon: 'compare' },
  { id: 'modules', title: 'Modules', icon: 'box' },
];
const state = { page: 'overview', view: hasBase ? 'diff' : 'cur', selected: null, focusOnly: false, touchedOnly: false };

export { D, S, V, hasBase, nodesById, edgesById, violById, violEdges, pushTo, failing, curViols, isChange, changeKind, internalNodes, nodeStats, rules, changes, FG, FST, FILES, fileByPath, filesOf, touchedMods, canScope, fileKind, kindOrder, PAGES, state };
