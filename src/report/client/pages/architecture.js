// Architecture page: the C4 container diagram, its side sheet and the overview glance.
import { $, $$, ICONS, esc, h, icon, plural, reduceMotion, s, store } from '../lib/dom.js';
import { D, hasBase, state } from '../lib/data.js';
import { toast } from '../ui/shell.js';
import { hideTip, kindBadge, placeTabs, showTip, tabs } from '../ui/common.js';
import { applyMap, goSelect, present } from './map.js';
import { exportSvgFrom } from '../ui/export.js';
import { modState, renderModule, selectFile } from './module.js';
import { go } from '../ui/router.js';
import { ARCH_VIEWS, renderArchAlt } from './arch-views.js';

// ------------------------------------------------------------------ system architecture
/** @typedef {import('../../../types').App} App @typedef {import('../../../types').Store} Store @typedef {import('../../../types').OutsideDiff} Outside */
/** @typedef {import('../types').ArchNode} ArchNode @typedef {import('../types').ArchEdge} ArchEdge @typedef {import('../types').ArchModel} ArchModel */
/** @type {import('../../../types').System} */
const SYS = D.system || { apps: [], stores: [], outside: [], links: [], hasUsers: false, summary: null };
const sysState = { expanded: new Set(), sel: null };
const GROUPS = [
  { key: 'pages', title: 'Pages', icon: 'file', mono: true },
  { key: 'api', title: 'Routes & API', icon: 'code' },
  { key: 'endpoints', title: 'HTTP endpoints', icon: 'code' },
  { key: 'jobs', title: 'Jobs & scripts', icon: 'terminal', mono: true },
  { key: 'schedules', title: 'Schedules', icon: 'clock', mono: true },
];
const storeIcon = (x) => (x.kind === 'Queue' ? 'queue' : 'database');
const appIcon = (a) => ({ web: 'globe', mobile: 'phone', desktop: 'monitor', server: 'server' }[a.role] || 'box');
const visible = (x) => present(x.status || 'same');
const stClass = (x) => (state.view === 'diff' && x.status && x.status !== 'same' ? ` s-${x.status}` : '');
const appById = new Map(SYS.apps.map((a) => /** @type {[string, App]} */ ([a.id, a])));
const appLabel = (id) => (id === 'users' ? 'Users' : (appById.get(id) || {}).name || id);
const svcById = new Map([...SYS.stores, ...SYS.outside].map((x) => /** @type {[string, Store | Outside]} */ ([x.id, x])));

function orderApps() {
  // callers to the left of the apps they call; front doors first
  const calls = SYS.links.filter((l) => l.kind === 'app');
  const rank = new Map(SYS.apps.map((a) => [a.id, ['web', 'mobile', 'desktop'].includes(a.role) ? 0 : 1]));
  for (let i = 0; i < 4; i++) calls.forEach((l) => { if (rank.has(l.to) && rank.has(l.from)) rank.set(l.to, Math.max(rank.get(l.to), rank.get(l.from) + 1)); });
  return [...SYS.apps].sort((a, b) => rank.get(a.id) - rank.get(b.id) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ architecture: a C4 container diagram
// People on top, this repo as a dashed system boundary holding its apps (containers) with their
// databases and queues underneath, and outside systems to the right. Laid out once on base ∪ current,
// so nothing moves between Changes / Before / After. Connectors are routed around the boxes on a grid.
const cssId = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_');
const APP_COLORS = ['var(--accent)', 'var(--chg)', 'var(--add)', 'var(--viol)', 'var(--warn)'];
function appColor(id) { const i = SYS.apps.findIndex((a) => a.id === id); return APP_COLORS[(i < 0 ? 0 : i) % APP_COLORS.length]; }
const arch = { vb: { x: 0, y: 0, w: 100, h: 100 }, drag: null, dragMoved: false, nodes: new Map(), wires: [], model: null, fitted: false };
const G = 8; // routing grid
const snap = (v) => Math.round(v / G) * G;
const textW = (t, px) => t.length * px;
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const statusOf = (list) => (list.every((x) => x.status === 'added') ? 'added' : list.every((x) => x.status === 'removed') ? 'removed' : 'same');

function entrySummary(a) {
  const words = { pages: ['page', 'pages'], api: ['route', 'routes'], endpoints: ['endpoint', 'endpoints'], jobs: ['job', 'jobs'], schedules: ['schedule', 'schedules'] };
  return GROUPS.map((g) => [g.key, (a.groups[g.key] || []).filter((x) => x.status !== 'removed').length]).filter(([, n]) => n)
    .map(([k, n]) => `${n} ${words[k][n === 1 ? 0 : 1]}`).join(' · ');
}
function wireLabel(l) {
  if (l.kind === 'users') return 'uses · HTTPS';
  if (l.kind === 'app') return l.labels[0] || 'HTTP';
  const x = svcById.get(l.to);
  if (l.kind === 'data') {
    if (l.labels.length) return l.labels.join(' · ');
    if (x && x.kind === 'Queue') return 'messages';
    return x && /SQL|Postgre|MySQL|SQLite|ORM|Prisma|Drizzle/i.test(`${x.name} ${x.via.join(' ')}`) ? 'reads & writes · SQL' : 'reads & writes';
  }
  if (x && x.id.startsWith('svc:')) return 'API · SDK';
  if (x && x.id.startsWith('env:')) return 'HTTPS · env';
  return 'HTTPS';
}

/** Nodes and connectors of the diagram, with sizes. */
/** @returns {ArchModel} */
function archModel() {
  /** @type {ArchNode[]} */
  const nodes = [];
  const usersLinks = SYS.links.filter((l) => l.kind === 'users');
  if (usersLinks.length) nodes.push({ id: 'users', type: 'person', name: 'Users', kind: 'Person', sub: 'Browser & API clients', status: statusOf(usersLinks), w: 168, h: 128 });
  for (const a of SYS.apps) {
    const desc = entrySummary(a) || 'No entry points found';
    const tech = a.tech.filter((t) => t.toLowerCase() !== a.framework.toLowerCase()).slice(0, 4).join(' · ');
    const w = snap(Math.max(248, 64 + textW(clip(a.name, 26), 8), 32 + textW(desc, 6.6), 32 + textW(tech, 6.3)));
    nodes.push({ id: a.id, type: 'app', name: clip(a.name, 26), kind: `Container: ${a.framework}`, sub: desc, tech, status: a.status || 'same', w, h: tech ? 128 : 112, ref: a, color: appColor(a.id) });
  }
  for (const x of SYS.stores) {
    const q = x.kind === 'Queue';
    const w = snap(Math.max(q ? 192 : 176, 44 + textW(clip(x.name, 24), 7.6)));
    nodes.push({ id: x.id, type: q ? 'queue' : 'db', name: clip(x.name, 24), kind: q ? 'Queue' : x.kind, sub: clip(x.via.join(', '), 30), status: x.status || 'same', w, h: q ? 72 : 104, ref: x });
  }
  for (const x of SYS.outside) {
    const hosts = (x.hosts || []).map((hh) => (typeof hh === 'string' ? hh : hh.host));
    const sub = x.id.startsWith('env:') ? `set by ${x.via[0] || 'an env var'}` : hosts.length ? clip(hosts.join(', '), 30) : x.via.length ? clip(x.via.join(', '), 30) : '';
    const w = snap(Math.max(208, 56 + textW(clip(x.name, 26), 7.8), 32 + textW(sub, 6.3)));
    nodes.push({ id: x.id, type: 'ext', name: clip(x.name, 26), kind: `External · ${x.kind}`, sub, status: x.status || 'same', w, h: 80, ref: x, envOnly: x.id.startsWith('env:') });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = SYS.links.filter((l) => byId.has(l.from) && byId.has(l.to)).map((l) => /** @type {ArchEdge} */ ({
    id: l.id, from: l.from, to: l.to, kind: l.kind, status: l.status || 'same', label: wireLabel(l), link: l,
    async: l.kind === 'data' && byId.get(l.to).type === 'queue',
  }));
  return { nodes, edges, byId };
}

/** Place everything: users row, app rows by call order, data row, then outside systems in columns to the right. */
/** @param {ArchModel} M */
function archLayout(M) {
  const APP_GAP = 144; const DATA_GAP = 64; const ROW_GAP = 104; const PAD = 48; const TITLE = 40;
  const apps = M.nodes.filter((n) => n.type === 'app');
  const calls = M.edges.filter((e) => e.kind === 'app');
  const rank = new Map(apps.map((n) => [n.id, ['web', 'mobile', 'desktop'].includes(/** @type {App} */ (n.ref).role) ? 0 : 1]));
  for (let i = 0; i < 4; i++) calls.forEach((e) => { if (rank.has(e.to) && rank.has(e.from)) rank.set(e.to, Math.max(rank.get(e.to), rank.get(e.from) + 1)); });
  const minRank = Math.min(...rank.values());
  apps.forEach((n) => rank.set(n.id, rank.get(n.id) - minRank));
  // apps sit in one row, callers to the left of the apps they call (front doors first); wrap after 4
  const PER_ROW = 4;
  const ordered = apps.slice().sort((a, b) => rank.get(a.id) - rank.get(b.id) || a.name.localeCompare(b.name));
  const appRows = [];
  for (let i = 0; i < ordered.length; i += PER_ROW) appRows.push(ordered.slice(i, i + PER_ROW));
  const data = M.nodes.filter((n) => n.type === 'db' || n.type === 'queue');
  const gapOf = (list) => (list[0] && list[0].type === 'app' ? APP_GAP : DATA_GAP);
  const rowW = (list) => list.reduce((s0, n) => s0 + n.w, 0) + gapOf(list) * Math.max(0, list.length - 1);
  const innerW = Math.max(...appRows.map(rowW), rowW(data), 320);
  const hasUsers = M.byId.has('users');
  const top = hasUsers ? M.byId.get('users').h + 96 : 0;
  let y = top + PAD;
  const place = (list, rowY, cx) => {
    let x = cx - rowW(list) / 2;
    const rh = Math.max(...list.map((n) => n.h));
    list.forEach((n) => { n.x = snap(x); n.y = snap(rowY + (rh - n.h) / 2); x += n.w + gapOf(list); });
    return rh;
  };
  const cx = PAD + innerW / 2;
  appRows.forEach((list) => { y += place(list, y, cx) + ROW_GAP; });
  if (data.length) {
    const bary = (n) => { const us = M.edges.filter((e) => e.to === n.id).map((e) => M.byId.get(e.from)).filter((m) => m && m.x != null); return us.length ? us.reduce((s0, m) => s0 + m.x + m.w / 2, 0) / us.length : cx; };
    data.sort((a, b) => bary(a) - bary(b) || Number(a.type === 'queue') - Number(b.type === 'queue') || a.name.localeCompare(b.name));
    y += place(data, y, cx) + 0;
  } else y -= ROW_GAP;
  const inner = [...apps, ...data];
  const bx0 = snap(Math.min(...inner.map((n) => n.x)) - PAD);
  const bx1 = snap(Math.max(...inner.map((n) => n.x + n.w)) + PAD);
  const by0 = snap(top);
  const by1 = snap(y + PAD + TITLE); // the title sits in the bottom margin (C4 convention), where no wire crosses
  const boundary = inner.length ? { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } : null;
  if (hasUsers) {
    const u = M.byId.get('users');
    const fronts = M.edges.filter((e) => e.from === 'users').map((e) => M.byId.get(e.to)).filter((m) => m.x != null);
    const ux = fronts.length ? fronts.reduce((s0, m) => s0 + m.x + m.w / 2, 0) / fronts.length : cx;
    u.x = snap(ux - u.w / 2); u.y = 0;
  }
  // outside systems: columns right of the boundary, ordered by who calls them
  const ext = M.nodes.filter((n) => n.type === 'ext');
  if (ext.length) {
    const callerY = (n) => { const us = M.edges.filter((e) => e.to === n.id).map((e) => M.byId.get(e.from)).filter((m) => m && m.y != null); return us.length ? us.reduce((s0, m) => s0 + m.y + m.h / 2, 0) / us.length : 0; };
    ext.sort((a, b) => callerY(a) - callerY(b) || /** @type {Outside} */ (a.ref).kind.localeCompare(/** @type {Outside} */ (b.ref).kind) || a.name.localeCompare(b.name));
    const EG = 40; // leaves a routing corridor between boxes (clearance is 12 on each side)
    const areaTop = boundary ? boundary.y : 0;
    const areaH = boundary ? boundary.h : 600;
    // tall columns beat many short ones: the diagram stays closer to a screen's shape
    const perCol = Math.max(4, Math.floor((areaH + EG) / (80 + EG)), Math.min(8, Math.ceil(ext.length / 2)));
    const cols = Math.ceil(ext.length / perCol);
    const colW = Math.max(...ext.map((n) => n.w));
    let x0 = (boundary ? boundary.x + boundary.w : 0) + 176;
    for (let c = 0; c < cols; c++) {
      const list = ext.slice(c * perCol, (c + 1) * perCol);
      const hh = list.reduce((s0, n) => s0 + n.h, 0) + EG * (list.length - 1);
      let yy = areaTop + Math.max(0, (areaH - hh) / 2);
      list.forEach((n) => { n.x = snap(x0 + (colW - n.w) / 2); n.y = snap(yy); yy += n.h + EG; });
      x0 += colW + 96;
    }
  }
  const all = M.nodes;
  const minX = Math.min(...all.map((n) => n.x), boundary ? boundary.x : Infinity);
  const minY = Math.min(...all.map((n) => n.y), boundary ? boundary.y : Infinity);
  const maxX = Math.max(...all.map((n) => n.x + n.w), boundary ? boundary.x + boundary.w : -Infinity);
  const maxY = Math.max(...all.map((n) => n.y + n.h), boundary ? boundary.y + boundary.h : -Infinity);
  return { boundary, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

/** Orthogonal connectors: A* on a grid around the boxes, spreading ports along each side and avoiding shared runs. */
function routeWires(M, L) {
  const INF = 12; // clearance around boxes
  const b = L.bounds;
  const ox = snap(b.x - 120); const oy = snap(b.y - 120);
  const W = Math.ceil((b.w + 240) / G) + 1; const H = Math.ceil((b.h + 240) / G) + 1;
  const blocked = new Uint8Array(W * H);
  const idx = (gx, gy) => gy * W + gx;
  for (const n of M.nodes) {
    // grid points strictly within the clearance (rounding outwards here would close the gaps between boxes)
    const x0 = Math.floor((n.x - INF - ox) / G) + 1; const x1 = Math.ceil((n.x + n.w + INF - ox) / G) - 1;
    const y0 = Math.floor((n.y - INF - oy) / G) + 1; const y1 = Math.ceil((n.y + n.h + INF - oy) / G) - 1;
    for (let gy = Math.max(0, y0); gy <= Math.min(H - 1, y1); gy++) for (let gx = Math.max(0, x0); gx <= Math.min(W - 1, x1); gx++) blocked[idx(gx, gy)] = 1;
  }
  const used = new Uint8Array(W * H); // bit 1 = horizontal run, bit 2 = vertical run
  const owner = new Int16Array(W * H); // which source first ran through here (1-based), so a bundle can share it
  const srcIdx = new Map(M.nodes.map((n, i) => [n.id, i + 1]));
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up
  const sideDir = { right: 0, bottom: 1, left: 2, top: 3 };
  // which side each end leaves from
  const ends = [];
  for (const e of M.edges) {
    const s0 = M.byId.get(e.from); const t = M.byId.get(e.to);
    let ss; let ts;
    if (t.y >= s0.y + s0.h + 24 && !(t.type === 'ext' && s0.type !== 'person')) { ss = 'bottom'; ts = 'top'; }
    else if (t.y + t.h + 24 <= s0.y && t.type !== 'ext') { ss = 'top'; ts = 'bottom'; }
    else if (t.x + t.w / 2 >= s0.x + s0.w / 2) { ss = 'right'; ts = 'left'; }
    else { ss = 'left'; ts = 'right'; }
    e.ss = ss; e.ts = ts;
    ends.push({ e, node: s0, side: ss, other: t, end: 's' }, { e, node: t, side: ts, other: s0, end: 't' });
  }
  // ports: wires leaving a side share one port (they travel as a bundle and fan out near their targets);
  // wires arriving on a side are spread along it, ordered by where they come from
  const groups = new Map();
  ends.forEach((p) => { const k = `${p.node.id}|${p.side}|${p.end}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  for (const list of groups.values()) {
    const horiz = list[0].side === 'top' || list[0].side === 'bottom';
    list.sort((a, c) => (horiz ? (a.other.x + a.other.w / 2) - (c.other.x + c.other.w / 2) : (a.other.y + a.other.h / 2) - (c.other.y + c.other.h / 2)) || (a.e.id < c.e.id ? -1 : 1));
    const n = list[0].node;
    const len = horiz ? n.w : n.h;
    const outgoing = list[0].end === 's';
    const span = outgoing ? 0 : Math.min(len * 0.7, Math.max(0, (list.length - 1) * 24));
    // leave from the half of the side that faces the targets, so bundles don't all start dead centre
    const bias = outgoing && list.length ? Math.max(-len * 0.25, Math.min(len * 0.25, (list.reduce((s0, p) => s0 + (horiz ? p.other.x + p.other.w / 2 : p.other.y + p.other.h / 2), 0) / list.length - ((horiz ? n.x : n.y) + len / 2)) * 0.3)) : 0;
    list.forEach((p, i) => {
      const off = snap((horiz ? n.x : n.y) + len / 2 + bias - span / 2 + (list.length > 1 && span ? (span * i) / (list.length - 1) : 0));
      const P = p.side === 'right' ? [n.x + n.w, off] : p.side === 'left' ? [n.x, off] : p.side === 'bottom' ? [off, n.y + n.h] : [off, n.y];
      const d = DIRS[sideDir[p.side]];
      const Q = [P[0] + d[0] * 3 * G, P[1] + d[1] * 3 * G]; // first free grid point outside the clearance
      p.e[p.end === 's' ? 'P0' : 'P1'] = P; p.e[p.end === 's' ? 'Q0' : 'Q1'] = Q;
    });
  }
  // A* per wire, shortest first
  const order = M.edges.slice().sort((a, c) => (Math.abs(a.Q0[0] - a.Q1[0]) + Math.abs(a.Q0[1] - a.Q1[1])) - (Math.abs(c.Q0[0] - c.Q1[0]) + Math.abs(c.Q0[1] - c.Q1[1])) || (a.id < c.id ? -1 : 1));
  const TURN = 6;
  for (const e of order) {
    const sx = Math.round((e.Q0[0] - ox) / G); const sy = Math.round((e.Q0[1] - oy) / G);
    const tx = Math.round((e.Q1[0] - ox) / G); const ty = Math.round((e.Q1[1] - oy) / G);
    const me = srcIdx.get(e.from);
    const startDir = sideDir[e.ss];
    const endDir = (sideDir[e.ts] + 2) % 4; // arrive moving into the target
    const N = W * H * 4;
    const g = new Float64Array(N).fill(Infinity); // float64: float32 rounding made the stale-entry check drop live states
    const from = new Int32Array(N).fill(-1);
    const heap = [];
    const push = (f, st) => { heap.push([f, st]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const hEst = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const s0 = (idx(sx, sy) << 2) | startDir;
    g[s0] = 0; push(hEst(sx, sy), s0);
    let goal = -1; let guard = 0;
    while (heap.length && guard++ < 400000) {
      const [f, st] = pop();
      const cell = st >> 2; const dir = st & 3;
      const cx0 = cell % W; const cy0 = (cell - cx0) / W;
      if (cx0 === tx && cy0 === ty) { goal = st; break; } // arriving the wrong way was already charged a turn
      if (f > g[st] + hEst(cx0, cy0) + 1e-6) continue;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (dir + 2) % 4) continue;
        const nx = cx0 + DIRS[nd][0]; const ny = cy0 + DIRS[nd][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny);
        if (blocked[ni] && !(nx === tx && ny === ty)) continue;
        const axis = nd % 2 === 0 ? 1 : 2;
        const mine = owner[ni] === me;
        let cost = (mine ? 0.7 : 1) + (nd !== dir ? TURN : 0) + (mine ? 0 : used[ni] & axis ? 4 : used[ni] ? 1.5 : 0);
        if (nx === tx && ny === ty && nd !== endDir) cost += TURN;
        const ns = (ni << 2) | nd;
        const ng = g[st] + cost;
        if (ng < g[ns]) { g[ns] = ng; from[ns] = st; push(ng + hEst(nx, ny), ns); }
      }
    }
    let pts;
    if (goal < 0) pts = [e.P0, e.Q0, [e.Q0[0], e.Q1[1]], e.Q1, e.P1];
    else {
      const cells = [];
      for (let st = goal; st >= 0; st = from[st]) cells.push(st);
      cells.reverse();
      let prev = null;
      for (const st of cells) {
        const cell = st >> 2; const gx = cell % W; const gy = (cell - gx) / W;
        if (prev) {
          const axis = gx !== prev[0] ? 1 : 2;
          for (const k of [idx(gx, gy), idx(prev[0], prev[1])]) { used[k] |= axis; if (!owner[k]) owner[k] = me; }
        }
        prev = [gx, gy];
      }
      pts = [e.P0, ...cells.map((st) => { const cell = st >> 2; const gx = cell % W; return [ox + gx * G, oy + ((cell - gx) / W) * G]; }), e.P1];
    }
    // drop points in the middle of straight runs
    e.pts = pts.filter((p, i) => i === 0 || i === pts.length - 1 || !((pts[i - 1][0] === p[0] && p[0] === pts[i + 1][0]) || (pts[i - 1][1] === p[1] && p[1] === pts[i + 1][1])));
  }
  // labels: on the longest free stretch of each wire, never on a box or another label
  const boxes = M.nodes.map((n) => ({ x: n.x - 4, y: n.y - 4, w: n.w + 8, h: n.h + 8 }));
  const placed = [];
  const hit = (r) => [...boxes, ...placed].some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
  for (const e of order) {
    const w = e.label.length * 6.3 + 18; const hgt = 20;
    const all = [];
    for (let i = 0; i < e.pts.length - 1; i++) { const a = e.pts[i]; const c = e.pts[i + 1]; all.push({ a, c, len: Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) }); }
    // bundles share their first stretch, so label each wire on its own last stretch; else on its longest
    const tail = all.slice().reverse().filter((sg) => sg.len >= (sg.a[1] === sg.c[1] ? w + 16 : hgt + 24));
    const segs = [...tail, ...all.slice().sort((p, q) => q.len - p.len)];
    let spot = null;
    for (const sg of segs) {
      for (const t of [0.5, 0.3, 0.7, 0.18, 0.82]) {
        const px = sg.a[0] + (sg.c[0] - sg.a[0]) * t; const py = sg.a[1] + (sg.c[1] - sg.a[1]) * t;
        const r = { x: px - w / 2, y: py - hgt / 2, w, h: hgt };
        if (!hit(r)) { spot = r; break; }
      }
      if (spot) break;
    }
    if (!spot && segs.length) { const sg = segs[0]; spot = { x: (sg.a[0] + sg.c[0]) / 2 - w / 2, y: (sg.a[1] + sg.c[1]) / 2 - hgt / 2, w, h: hgt }; }
    if (spot) { placed.push(spot); e.lbl = spot; }
  }
}

function roundedPath(pts, r = 10) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]; const [x, y] = pts[i]; const [nx, ny] = pts[i + 1];
    const r1 = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ax = x - Math.sign(x - px) * r1; const ay = y - Math.sign(y - py) * r1;
    const bx = x + Math.sign(nx - x) * r1; const by = y + Math.sign(ny - y) * r1;
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

// ---- drawing
/** @param {ArchNode} n */
function archNode(n) {
  const g = s('g', { class: `an t-${n.type}`, transform: `translate(${n.x},${n.y})`, dataset: { node: n.id } });
  const ic = (name, x, y, sc = 0.75) => s('g', { class: 'an-ico', transform: `translate(${x},${y}) scale(${sc})`, html: ICONS[name] });
  const txt = (cls, x, y, t, anchor) => s('text', { class: cls, x, y, 'text-anchor': anchor || 'start' }, t);
  const { w, h } = n;
  if (n.type === 'person') {
    // C4 person: a head above a body with rounded shoulders (a clear gap between them, like the notation)
    const top = 44; const sh = 30; const r = 12;
    g.append(
      s('path', { class: 'an-shape', d: `M0,${h - r} V${top + sh} Q0,${top} ${sh + 8},${top} H${w - sh - 8} Q${w},${top} ${w},${top + sh} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} Z` }),
      s('circle', { class: 'an-shape an-head', cx: w / 2, cy: 19, r: 18 }),
      txt('an-name', w / 2, top + 36, n.name, 'middle'), txt('an-kind', w / 2, top + 53, `[${n.kind}]`, 'middle'), txt('an-sub', w / 2, top + 70, n.sub, 'middle'));
  } else if (n.type === 'app') {
    g.style.setProperty('--app', n.color);
    g.append(
      s('rect', { class: 'an-shape', width: w, height: h, rx: 12 }),
      s('rect', { class: 'an-ibox', x: 16, y: 18, width: 30, height: 30, rx: 8 }),
      ic(appIcon(n.ref), 22, 24),
      txt('an-name', 56, 32, n.name), txt('an-kind', 56, 47, `[${n.kind}]`),
      s('line', { class: 'an-rule', x1: 16, x2: w - 16, y1: 64, y2: 64 }),
      txt('an-sub', 16, 86, n.sub));
    if (n.tech) g.append(txt('an-tech', 16, 110, n.tech));
  } else if (n.type === 'db') {
    const ry = 11;
    g.append(
      s('path', { class: 'an-shape', d: `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} L${w},${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z` }),
      s('ellipse', { class: 'an-lid', cx: w / 2, cy: ry, rx: w / 2, ry }),
      ic('database', w / 2 - 9, 30), txt('an-name', w / 2, 66, n.name, 'middle'), txt('an-kind', w / 2, 82, `[${n.kind}]`, 'middle'));
  } else if (n.type === 'queue') {
    const rx = 14;
    g.append(
      s('path', { class: 'an-shape', d: `M${rx},0 L${w - rx},0 A${rx},${h / 2} 0 0 1 ${w - rx},${h} L${rx},${h} A${rx},${h / 2} 0 0 1 ${rx},0 Z` }),
      s('ellipse', { class: 'an-lid', cx: w - rx, cy: h / 2, rx, ry: h / 2 }),
      ic('queue', 26, h / 2 - 9), txt('an-name', 54, h / 2 - 2, n.name), txt('an-kind', 54, h / 2 + 14, `[${n.kind}${n.sub ? ` · ${n.sub}` : ''}]`));
  } else {
    g.append(
      s('rect', { class: `an-shape${n.envOnly ? ' env' : ''}`, width: w, height: h, rx: 10 }),
      ic({ Email: 'mail', 'Web / HTTP': 'globe' }[/** @type {Outside} */ (n.ref).kind] || 'cloud', 16, 16),
      txt('an-name', 44, 29, n.name), txt('an-kind', 16, 52, `[${n.kind}]`));
    if (n.sub) g.append(txt('an-sub mono', 16, 69, n.sub));
  }
  const badge = (cls, label, bw) => s('g', { class: `an-badge ${cls}`, transform: `translate(${w - bw - 10},-9)` }, s('rect', { width: bw, height: 17, rx: 5 }), s('text', { x: bw / 2, y: 12, 'text-anchor': 'middle' }, label));
  g.append(badge('b-add', 'NEW', 36), badge('b-rem', 'GONE', 40));
  if (n.type !== 'person') {
    g.setAttribute('tabindex', 0); g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${n.name}, ${n.kind}`);
    const open = () => openSys(n.type === 'app' ? { type: 'app', id: n.id } : { type: 'svc', id: n.id });
    g.addEventListener('click', (ev) => { if (arch.dragMoved) return; ev.stopPropagation(); open(); });
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
  }
  g.addEventListener('pointerenter', () => { if (!arch.drag) archHl(n.id); });
  g.addEventListener('pointerleave', () => archHl(null));
  g.addEventListener('focus', () => archHl(n.id));
  g.addEventListener('blur', () => archHl(null));
  return g;
}

function buildArch(svg) {
  const M = archModel();
  const L = archLayout(M);
  routeWires(M, L);
  arch.model = M; arch.layout = L;
  const defs = s('defs');
  defs.innerHTML = [['line', '--text-3'], ['app', '--accent'], ['data', '--text-2'], ['add', '--add'], ['rem', '--rem'], ['hl', '--accent']]
    .map(([k, c]) => `<marker id="aw-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,1.5 L9,5 L1,8.5 Q2.5,5 1,1.5 z" style="fill: var(${c})"/></marker>`).join('')
    + '<filter id="an-shadow" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#101018" flood-opacity=".07"/></filter>'
    + '<pattern id="aw-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" style="fill: var(--dot)"/></pattern>';
  svg.appendChild(defs);
  svg.appendChild(s('rect', { class: 'arch-bg', x: -20000, y: -20000, width: 40000, height: 40000, fill: 'url(#aw-dots)' }));
  const world = s('g', { id: 'arch-world' });
  if (L.boundary) {
    const B = L.boundary;
    world.append(s('g', { class: 'arch-boundary' },
      s('rect', { x: B.x, y: B.y, width: B.w, height: B.h, rx: 18 }),
      s('g', { class: 'an-ico', transform: `translate(${B.x + 20},${B.y + B.h - 33}) scale(0.7)`, html: ICONS.layers }),
      s('text', { class: 'ab-name', x: B.x + 44, y: B.y + B.h - 20 }, D.project),
      s('text', { class: 'ab-kind', x: B.x + 56 + textW(D.project, 8.6), y: B.y + B.h - 20 }, '[Software system · this repo]')));
  }
  const wireLayer = s('g'); const nodeLayer = s('g'); const lblLayer = s('g');
  world.append(wireLayer, nodeLayer, lblLayer);
  arch.wires = [];
  for (const e of M.edges) {
    const d = roundedPath(e.pts);
    const path = s('path', { class: 'wl', d });
    const g = s('g', { class: `aw k-${e.kind}${e.async ? ' async' : ''}`, dataset: { wire: e.id } }, path, s('path', { class: 'whit', d }));
    if (!reduceMotion && (e.kind === 'app' || e.status === 'added')) {
      const dot = s('circle', { class: 'wdot', r: 2.6 });
      const am = s('animateMotion', { dur: `${Math.max(2, e.pts.reduce((n0, p, i) => (i ? n0 + Math.abs(p[0] - e.pts[i - 1][0]) + Math.abs(p[1] - e.pts[i - 1][1]) : 0), 0) / 90).toFixed(2)}s`, repeatCount: 'indefinite', path: d });
      dot.appendChild(am); g.appendChild(dot);
    }
    let lbl = null;
    if (e.lbl) {
      lbl = s('g', { class: `aw-lbl k-${e.kind}` }, s('rect', { x: e.lbl.x, y: e.lbl.y, width: e.lbl.w, height: e.lbl.h, rx: 10 }), s('text', { x: e.lbl.x + e.lbl.w / 2, y: e.lbl.y + e.lbl.h / 2 + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, e.label));
      lblLayer.appendChild(lbl);
    }
    const tipHtml = () => `<div class="tt">${esc(e.from === 'users' ? 'Users' : (M.byId.get(e.from) || {}).name || e.from)} <span class="faint">→</span> ${esc((M.byId.get(e.to) || {}).name || e.to)}</div><div class="kv"><span>${esc(e.label)}</span><b>${e.link.count || ''}</b></div>${hasBase && e.status !== 'same' ? `<div class="kv"><span>Status</span><b>${e.status === 'added' ? 'New' : 'Removed'}</b></div>` : ''}${e.link.evidence && e.link.evidence[0] ? `<div class="kv faint"><span class="mono-s">${esc(e.link.evidence[0].file)}:${e.link.evidence[0].line}</span></div>` : ''}`;
    [g, lbl].filter(Boolean).forEach((el) => {
      el.addEventListener('pointermove', (ev) => { if (!arch.drag) showTip(ev, tipHtml()); });
      el.addEventListener('pointerleave', hideTip);
    });
    wireLayer.appendChild(g);
    arch.wires.push({ e, g, path, lbl });
  }
  arch.nodes = new Map();
  for (const n of M.nodes) { const el = archNode(n); nodeLayer.appendChild(el); arch.nodes.set(n.id, { n, el }); }
  svg.appendChild(world);
  svg.addEventListener('click', () => { if (!arch.dragMoved) closeSheet(); });
  arch.svg = svg; arch.world = world;
}

function applyArch() {
  if (!arch.svg) return;
  for (const { n, el } of arch.nodes.values()) {
    const st = state.view === 'diff' && hasBase ? n.status : 'same';
    el.setAttribute('class', `an t-${n.type} ${st}${present(n.status) ? '' : ' gone'}`);
  }
  for (const { e, g, path, lbl } of arch.wires) {
    const st = state.view === 'diff' && hasBase ? e.status : 'same';
    const cls = `${st}${present(e.status) ? '' : ' gone'}`;
    g.setAttribute('class', `aw k-${e.kind}${e.async ? ' async' : ''} ${cls}`);
    if (lbl) lbl.setAttribute('class', `aw-lbl k-${e.kind} ${cls}`);
    path.setAttribute('marker-end', `url(#aw-${st === 'added' ? 'add' : st === 'removed' ? 'rem' : e.kind === 'app' ? 'app' : e.kind === 'data' ? 'data' : 'line'})`);
  }
}

function archHl(id) {
  const cv = $('#arch-card');
  if (!cv) return;
  applyArch(); // resets classes and arrowheads
  cv.classList.toggle('hl-on', !!id);
  if (!id) return;
  const near = new Set([id]);
  for (const { e, g, path, lbl } of arch.wires) {
    const on = e.from === id || e.to === id;
    g.classList.toggle('hl', on); if (lbl) lbl.classList.toggle('hl', on);
    if (on) { near.add(e.from); near.add(e.to); path.setAttribute('marker-end', 'url(#aw-hl)'); }
  }
  for (const { n, el } of arch.nodes.values()) el.classList.toggle('hl', near.has(n.id));
}

// ---- pan & zoom (same feel as the dependency map)
function archSetVB() {
  if (!arch.svg) return;
  arch.svg.setAttribute('viewBox', `${arch.vb.x} ${arch.vb.y} ${arch.vb.w} ${arch.vb.h}`);
  const r = $('#arch-stage').getBoundingClientRect();
  const pct = $('#arch-pct'); if (pct && r.width) pct.textContent = `${Math.round((r.width / arch.vb.w) * 100)}%`;
}
function archFit(animate) {
  const st = $('#arch-stage');
  if (!st || !arch.layout) return false;
  const r = st.getBoundingClientRect();
  if (!r.width || !r.height) return false; // page hidden: fit when it is shown
  const b = arch.layout.bounds; const pad = 40;
  const fitScale = Math.min(1.1, (r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h);
  // on a phone the whole picture would be unreadably small: keep a legible zoom and start at the top-left
  const scale = Math.max(fitScale, r.width < 640 ? 0.5 : 0.2);
  const clamped = scale > fitScale + 1e-6;
  const w = r.width / scale; const hh = r.height / scale;
  const target = clamped
    ? { x: b.x - pad / scale, y: b.y - pad / scale, w, h: hh }
    : { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - hh / 2, w, h: hh };
  if (!animate || reduceMotion) { arch.vb = target; archSetVB(); return true; }
  const from = { ...arch.vb }; const t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / 320); const k = 1 - (1 - p) ** 3; for (const key of ['x', 'y', 'w', 'h']) arch.vb[key] = from[key] + (target[key] - from[key]) * k; archSetVB(); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  return true;
}
function archZoom(f, cx, cy) {
  const r = $('#arch-stage').getBoundingClientRect();
  const px = cx == null ? r.width / 2 : cx; const py = cy == null ? r.height / 2 : cy;
  const nw = Math.min(8000, Math.max(160, arch.vb.w * f));
  const k = nw / arch.vb.w;
  arch.vb.x += (px / r.width) * arch.vb.w * (1 - k); arch.vb.y += (py / r.height) * arch.vb.h * (1 - k);
  arch.vb.w = nw; arch.vb.h *= k; archSetVB();
}
function archPanZoom(stage) {
  const pts = new Map();
  let pinch = null;
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    if (ev.ctrlKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX) * 1.2 || ev.deltaMode) archZoom(Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016)), ev.clientX - r.left, ev.clientY - r.top);
    else { arch.vb.x += ev.deltaX * arch.vb.w / r.width; arch.vb.y += ev.deltaY * arch.vb.h / r.height; archSetVB(); }
  }, { passive: false });
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), w: arch.vb.w }; arch.drag = null; return; }
    arch.drag = { x: ev.clientX, y: ev.clientY, vx: arch.vb.x, vy: arch.vb.y }; arch.dragMoved = false;
  });
  stage.addEventListener('pointermove', (ev) => {
    if (pts.has(ev.pointerId)) pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()]; const r = stage.getBoundingClientRect();
      const f = (pinch.w * pinch.d / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1]))) / arch.vb.w;
      archZoom(f, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); arch.dragMoved = true; return;
    }
    if (!arch.drag) return;
    const dx = ev.clientX - arch.drag.x; const dy = ev.clientY - arch.drag.y;
    if (!arch.dragMoved && Math.abs(dx) + Math.abs(dy) > 4) { arch.dragMoved = true; stage.classList.add('dragging'); hideTip(); archHl(null); }
    if (!arch.dragMoved) return;
    const r = stage.getBoundingClientRect();
    arch.vb.x = arch.drag.vx - dx * arch.vb.w / r.width; arch.vb.y = arch.drag.vy - dy * arch.vb.h / r.height; archSetVB();
  });
  const end = (ev) => { pts.delete(ev.pointerId); if (pts.size < 2) pinch = null; arch.drag = null; stage.classList.remove('dragging'); setTimeout(() => { arch.dragMoved = false; }, 0); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end); stage.addEventListener('pointerleave', (ev) => { if (arch.drag) end(ev); });
}

function exportArchSvg() {
  const b = arch.layout.bounds; const pad = 40;
  exportSvgFrom(arch.svg, { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, `${D.project}-system-architecture.svg`, ['whit', 'wdot', 'arch-bg']);
  toast('Architecture diagram exported as SVG', 'download');
}

function renderSystem() {
  const pg = $('#page-system');
  const keepVB = arch.svg && arch.fitted ? { ...arch.vb } : null;
  pg.innerHTML = '';
  arch.svg = null;
  const sum = SYS.summary;
  const vt = tabs([
    { value: 'diff', label: 'Changes', disabled: !hasBase },
    { value: 'base', label: 'Before', disabled: !hasBase },
    { value: 'cur', label: 'After' },
  ], state.view, (v) => { state.view = v; syncViews(); });
  vt.classList.add('sys-tabs');
  const kindTabs = tabs(ARCH_VIEWS, state.archView, (v) => setArchView(v));
  kindTabs.id = 'arch-kind-tabs';
  kindTabs.setAttribute('aria-label', 'Kind of diagram');
  const delta = (o) => (hasBase && (o.added || o.removed) ? [o.added ? h('span', { class: 'chip add', text: `+${o.added}` }) : null, o.removed ? h('span', { class: 'chip rem', text: `−${o.removed}` }) : null] : null);
  const stat = (n, label, o, ic) => h('div', { class: 'sys-stat' }, icon(ic), h('b', { class: 'num', text: n }), h('span', { text: label }), delta(o));
  pg.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', { text: 'Architecture' }), h('p', { text: 'A container diagram drawn from your code: who uses the system, the apps in this repo, the data they keep and the outside systems they call.' })),
    h('div', { class: 'right' }, kindTabs, vt)));
  if (sum) {
    pg.append(h('div', { class: 'sys-stats stagger' },
      stat(sum.apps.total, sum.apps.total === 1 ? 'app' : 'apps', sum.apps, 'layers'),
      stat(sum.entry.total, 'entry points', sum.entry, 'code'),
      stat(sum.stores.total, sum.stores.total === 1 ? 'data store' : 'data stores', sum.stores, 'database'),
      stat(sum.outside.total, sum.outside.total === 1 ? 'outside system' : 'outside systems', sum.outside, 'cloud')));
  }
  if (!SYS.apps.length) {
    pg.append(h('div', { class: 'card' }, h('div', { class: 'empty-state' }, h('div', { class: 'ico-box' }, icon('layers')), h('h4', { text: 'No apps found' }), h('p', { text: 'Tecton looks for package.json files to find the apps in a repo.' }))));
    return;
  }
  const svg = s('svg', { id: 'arch-svg', role: 'img', 'aria-label': `Container diagram of ${D.project}` });
  const stage = h('div', { id: 'arch-stage' }, svg);
  const key = (cls, label, shape) => h('span', { class: 'ak' }, s('svg', { viewBox: '0 0 26 16', 'aria-hidden': 'true' }, shape || s('g', { class: `aw ${cls}` }, s('path', { class: 'wl', d: 'M2,8 L24,8' }))), label);
  const shapeKey = (cls, d) => s('path', { class: `ak-shape ${cls}`, d });
  const legend = h('div', { class: 'arch-legend', id: 'arch-legend' },
    key('', 'Person', shapeKey('', 'M13,1.5 a3,3 0 1 1 0,6 a3,3 0 1 1 0,-6 M5,15 q0,-6 8,-6 q8,0 8,6 z')),
    key('', 'App (container)', shapeKey('', 'M3,3 h20 a2,2 0 0 1 2,2 v8 a2,2 0 0 1 -2,2 h-20 a2,2 0 0 1 -2,-2 v-8 a2,2 0 0 1 2,-2 z')),
    key('', 'Database', shapeKey('', 'M6,3 a7,2.5 0 0 1 14,0 v10 a7,2.5 0 0 1 -14,0 z M6,3 a7,2.5 0 0 0 14,0')),
    key('', 'Queue', shapeKey('', 'M5,3 h16 a3,5 0 0 1 0,10 h-16 a3,5 0 0 1 0,-10 z M21,3 a3,5 0 0 0 0,10')),
    key('', 'Outside system', shapeKey('ext', 'M2,3 h22 v10 h-22 z')),
    key('', 'This repo', shapeKey('bnd', 'M2,3 h22 v10 h-22 z')),
    h('span', { class: 'ak-sep' }),
    key('k-app', 'calls'), key('k-data', 'reads / writes'), key('k-data async', 'async (queue)'), key('k-outside', 'outside call'),
    hasBase ? [key('added', 'new'), key('removed', 'removed')] : null);
  const zoomCtl = h('div', { class: 'zoom glass' },
    h('button', { 'aria-label': 'Zoom in', 'data-tip': 'Zoom in', on: { click: () => archZoom(1 / 1.3) } }, icon('plus')),
    h('button', { 'aria-label': 'Zoom out', 'data-tip': 'Zoom out', on: { click: () => archZoom(1.3) } }, icon('minus')),
    h('button', { 'aria-label': 'Fit to screen', 'data-tip': 'Fit to screen (F)', on: { click: () => archFit(true) } }, icon('fit')),
    h('button', { 'aria-label': 'Export SVG', 'data-tip': 'Export as SVG', on: { click: exportArchSvg } }, icon('image')),
    h('div', { class: 'pct', id: 'arch-pct', text: '100%' }));
  pg.append(h('div', { class: 'card arch-card', id: 'arch-card' },
    stage,
    h('div', { class: 'arch-alt', id: 'arch-alt' }),
    h('div', { class: 'float br' }, zoomCtl),
    h('div', { class: 'float bl' }, h('div', { class: 'arch-hint glass' }, icon('sparkle'), 'Hover to trace · click for the exact lines · drag to pan'))),
  legend);
  pg.appendChild(h('p', { class: 'faint sys-note', text: 'Detected from package.json files, imports, route files and route definitions, queue names, cron schedules, URLs in the code and .env.example files.' }));
  buildArch(svg);
  applyArch();
  archPanZoom(stage);
  setArchView(state.archView, true);
  requestAnimationFrame(() => {
    placeTabs();
    if (keepVB) { arch.vb = keepVB; archSetVB(); } else if (state.archView === 'diagram') arch.fitted = archFit(false);
  });
}

/** Diagram, Tiers or Matrix. The diagram stays built underneath, so switching back keeps its zoom. */
function setArchView(v, quiet) {
  if (!ARCH_VIEWS.some((x) => x.value === v)) v = 'diagram';
  state.archView = v;
  if (!quiet) store.set('archView', v);
  const card = $('#arch-card');
  if (!card) return;
  card.dataset.kind = v;
  card.classList.toggle('alt-on', v !== 'diagram');
  archHl(null);
  hideTip();
  renderArchAlt($('#arch-alt'));
  if (v === 'diagram' && !arch.fitted) requestAnimationFrame(() => { arch.fitted = archFit(false); });
}
function statusTag(x) {
  if (state.view !== 'diff' || !x.status || x.status === 'same') return null;
  return h('span', { class: `badge ${x.status === 'added' ? 'add' : 'rem'}`, text: x.status === 'added' ? 'New' : 'Removed' });
}

// ---- side sheet with the evidence
function openSys(sel) {
  sysState.sel = sel;
  const sh = $('#sheet');
  sh.innerHTML = '';
  const body = h('div', { class: 'drawer-b' });
  let title; let sub; let ic; let tone = '';
  const evList = (list) => h('div', { class: 'ev' }, list.map((x) => h('div', { class: 'ev-row' }, h('code', { text: `${x.file}:${x.line}` }), x.text ? h('span', { class: 'to', text: x.text }) : null)));
  if (sel.type === 'app') {
    const a = appById.get(sel.id);
    title = a.name; sub = `${a.framework} app · ${a.root ? `${a.root}/` : 'repo root'}${a.pkgName && a.pkgName !== a.name ? ` · package "${a.pkgName}"` : ''}`; ic = appIcon(a);
    body.append(h('div', { class: 'kv-grid' },
      h('div', null, h('div', { class: 'k', text: 'Files' }), h('div', { class: 'v', text: a.fileCount })),
      h('div', null, h('div', { class: 'k', text: 'Entry points' }), h('div', { class: 'v', text: GROUPS.reduce((n, g) => n + (a.groups[g.key] || []).filter((x) => x.status !== 'removed').length, 0) })),
      h('div', null, h('div', { class: 'k', text: 'Modules' }), h('div', { class: 'v', text: (a.modules || []).length }))));
    const conns = SYS.links.filter((l) => (l.from === a.id || l.to === a.id) && visible(l));
    if (conns.length) {
      body.append(h('div', null, h('div', { class: 'sec-t', text: 'Connections' }), h('div', { class: 'pill-list' }, conns.map((l) => {
        const other = l.from === a.id ? l.to : l.from;
        const svc = svcById.get(other);
        return h('button', { class: 'pill-item', on: { click: () => (svc ? openSys({ type: 'svc', id: other }) : appById.has(other) ? openSys({ type: 'app', id: other }) : null) } },
          icon(svc ? (SYS.stores.includes(svc) ? storeIcon(svc) : 'cloud') : other === 'users' ? 'users' : 'server', 'faint'),
          h('span', { class: 'grow', text: `${l.from === a.id ? '→ ' : '← '}${svc ? svc.name : appLabel(other)}` }),
          state.view === 'diff' && l.status !== 'same' ? kindBadge(l.status) : null,
          h('span', { class: 'faint', style: { fontSize: '12px' }, text: l.labels[0] || '' }));
      }))));
    }
    if (a.tech.length) body.append(h('div', null, h('div', { class: 'sec-t', text: 'Notable tech' }), h('div', { class: 'sys-tech', style: { padding: 0 } }, a.tech.map((t) => h('span', { class: 'chip', text: t })))));
    // every entry point, grouped: pages, routes, endpoints, jobs, schedules
    for (const g of GROUPS) {
      const items = (a.groups[g.key] || []).filter(visible);
      if (!items.length) continue;
      body.append(h('div', null, h('div', { class: 'sec-t', text: `${g.title} · ${items.length}` }), h('div', { class: 'pill-list' }, items.map((x) => h('button', {
        class: 'pill-item', title: `${x.file}:${x.line}`, on: { click: () => openSys({ type: 'item', app: a.id, group: g.key, key: x.key }) },
      },
      x.methods && x.methods.length ? x.methods.map((m) => h('span', { class: `meth m-${m.toLowerCase()}`, text: m })) : icon(g.icon, 'faint'),
      h('span', { class: 'grow mono-s', text: x.label }),
      x.human ? h('span', { class: 'faint', style: { fontSize: '12px' }, text: x.human }) : null,
      state.view === 'diff' && hasBase && x.status !== 'same' ? kindBadge(x.status) : null)))));
    }
  } else if (sel.type === 'svc') {
    const x = svcById.get(sel.id);
    const isStore = SYS.stores.includes(x);
    title = x.name; sub = `${x.kind}${x.via && x.via.length ? ` · via ${x.via.join(', ')}` : ''}`; ic = isStore ? storeIcon(x) : x.kind === 'Email' ? 'mail' : 'cloud';
    if (x.kind === 'Set by env var') body.append(h('div', { class: 'muted', text: `The address comes from ${x.via.join(', ')} at run time, so only its name is known. Check .env.example or your deploy settings for where it points.` }));
    if (x.status && x.status !== 'same' && hasBase) body.append(h('div', null, kindBadge(x.status)));
    body.append(h('div', null, h('div', { class: 'sec-t', text: 'Used by' }), h('div', { class: 'pill-list' }, x.apps.map((id) => h('button', { class: 'pill-item', on: { click: () => openSys({ type: 'app', id }) } }, h('i', { class: 'dot', style: { background: appColor(id) } }), h('span', { class: 'grow', text: appLabel(id) }), h('span', { class: 'faint', style: { fontSize: '12px' }, text: (appById.get(id) || {}).framework || '' }))))));
    if ('hosts' in x && x.hosts.length) body.append(h('div', null, h('div', { class: 'sec-t', text: 'Hosts' }), h('div', { class: 'file-list' }, x.hosts.map((hh) => h('div', { class: state.view === 'diff' ? (hh.status === 'added' ? 'plus' : hh.status === 'removed' ? 'minus' : '') : '', text: hh.host })))));
    body.append(h('div', null, h('div', { class: 'sec-t', text: `Where the code uses it · ${x.evidence.length}${x.evidence.length >= 25 ? '+' : ''}` }), evList(x.evidence)));
  } else {
    const a = appById.get(sel.app);
    const g = GROUPS.find((gg) => gg.key === sel.group);
    const it = a.groups[sel.group].find((x) => x.key === sel.key);
    title = `${it.methods && it.methods.length ? `${it.methods.join(' / ')} ` : ''}${it.label}`; sub = `${g.title.replace(/s$/, '')} in ${a.name}`; ic = g.icon;
    if (it.status && it.status !== 'same' && hasBase) body.append(h('div', null, kindBadge(it.status)));
    if (it.human) body.append(h('div', { class: 'callout info' }, icon('clock'), h('div', null, h('b', { text: `Runs ${it.human}` }), h('div', { class: 'mono-s', text: it.label }))));
    body.append(h('div', null, h('div', { class: 'sec-t', text: 'Defined in' }), evList([{ file: it.file, line: it.line, text: it.cmd || null }])));
    const f = it.file;
    const mod = D.nodes.find((n) => n.files.some((ff) => ff.path === f));
    if (mod) body.append(h('button', { class: 'btn', on: { click: () => { closeSheet(); goSelect({ type: 'node', id: mod.id }); } } }, icon('map'), `Show module “${mod.id}” on the dependency map`));
  }
  sh.append(h('div', { class: 'drawer-h' },
    h('span', { class: `ico-box ${tone}` }, icon(ic)),
    h('div', { style: { minWidth: 0 } }, h('h3', { text: title }), h('div', { class: 'sub', text: sub })),
    h('button', { class: 'btn icon ghost', 'aria-label': 'Close', style: { marginLeft: 'auto' }, on: { click: closeSheet } }, icon('x'))), body);
  sh.classList.add('open');
}
function closeSheet() {
  const sh = $('#sheet'); if (sh) sh.classList.remove('open');
  sysState.sel = null;
  if (modState.file) selectFile(null);
}

function syncViews() {
  const vt = $('#view-tabs'); if (vt) vt._set(state.view);
  applyMap();
  $$('.sys-tabs').forEach((t) => t._set && t._set(state.view));
  if (arch.svg) { applyArch(); if (state.archView !== 'diagram') renderArchAlt($('#arch-alt')); } else renderSystem();
  if (state.page === 'module') renderModule(modState.id);
}

// overview card: the system at a glance
function systemGlance() {
  if (!SYS.apps.length) return null;
  const sum = SYS.summary;
  const flow = h('div', { class: 'glance' });
  if (SYS.hasUsers) flow.append(h('div', { class: 'g-node users' }, icon('users'), 'Users'), h('span', { class: 'g-arrow' }, icon('arrowRight')));
  orderApps().forEach((a, i, arr) => {
    const entry = GROUPS.map((g) => [g, (a.groups[g.key] || []).filter((x) => x.status !== 'removed').length]).filter(([, n]) => n);
    flow.append(h('button', { class: 'g-node g-app', style: { '--app': appColor(a.id) }, on: { click: () => { go('system'); setTimeout(() => openSys({ type: 'app', id: a.id }), 60); } } },
      h('span', { class: 'ico-box app-ico' }, icon(appIcon(a))),
      h('span', null, h('b', { text: a.name }), h('span', { class: 'faint', text: `${a.framework}${entry.length ? ` · ${entry.map(([g, n]) => `${n} ${g.title.toLowerCase().replace('routes & api', 'routes').replace('http endpoints', 'endpoints').replace('jobs & scripts', 'jobs').replace('schedules', n === 1 ? 'schedule' : 'schedules')}`).join(' · ')}` : ''}` }))));
    if (i < arr.length - 1) flow.append(h('span', { class: 'g-arrow' }, icon('arrowRight')));
  });
  const tail = h('div', { class: 'g-tail' },
    SYS.stores.filter((x) => x.status !== 'removed').map((x) => h('span', { class: 'chip' }, icon(storeIcon(x)), x.name)),
    h('span', { class: 'chip' }, icon('cloud'), plural(sum.outside.total, 'outside service')),
    hasBase && sum.outside.added ? h('span', { class: 'chip add', text: `+${sum.outside.added} new ${sum.outside.added === 1 ? 'service' : 'services'}` }) : null,
    hasBase && sum.entry.added ? h('span', { class: 'chip add', text: `+${sum.entry.added} entry points` }) : null);
  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-h' }, h('h3', { text: 'Architecture' }), h('div', { class: 'right' }, h('button', { class: 'link-btn', on: { click: () => go('system') } }, 'Open diagram', icon('right')))),
    h('div', { class: 'card-b' }, flow, tail));
}

export { setArchView, SYS, sysState, GROUPS, storeIcon, appIcon, visible, stClass, appById, appLabel, svcById, orderApps, cssId, APP_COLORS, appColor, arch, G, snap, textW, clip, statusOf, entrySummary, wireLabel, archModel, archLayout, routeWires, roundedPath, archNode, buildArch, applyArch, archHl, archSetVB, archFit, archZoom, archPanZoom, exportArchSvg, renderSystem, statusTag, openSys, closeSheet, syncViews, systemGlance };
