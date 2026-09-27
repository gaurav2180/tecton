// A small, deterministic layered layout (Sugiyama-style), computed on base ∪ current so that
// switching between the Base / Current / Diff views never moves anything.

const NODE_H = 46;
const ROW_GAP = 86;
const COL_GAP = 36;
const DUMMY_W = 14;

export function nodeWidth(label) {
  // icon (34px) + text (~7.3px per char at 13px Geist semibold) + right padding
  return Math.max(120, Math.round(label.length * 7.3) + 56);
}

export function layout(nodes, edges) {
  const ids = nodes.map((n) => n.id).sort();
  const metaLen = (n) => (n.external ? 11 : (n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur} files` : `${n.filesCur || n.filesBase || 0} files`).length);
  // box must fit the name (13px sans) and the file-count line (10.5px mono, ~6.4px per char)
  const width = new Map(nodes.map((n) => [n.id, Math.max(nodeWidth(n.id.replace(/^npm:/, '')), n.filesCur === undefined ? 0 : Math.round(36 + metaLen(n) * 6.4 + 16))]));

  // 1. Break loops: walk the graph depth-first; any arrow pointing back up the walk is flipped for layout.
  const succ = new Map(ids.map((i) => [i, []]));
  for (const e of edges) succ.get(e.from).push(e);
  for (const list of succ.values()) list.sort((a, b) => (a.to < b.to ? -1 : 1));
  const state = new Map();
  const flipped = new Set();
  const dfs = (v) => {
    state.set(v, 1);
    for (const e of succ.get(v)) {
      const s = state.get(e.to);
      if (s === 1) flipped.add(e.id);
      else if (!s) dfs(e.to);
    }
    state.set(v, 2);
  };
  for (const v of ids) if (!state.get(v)) dfs(v);
  const dag = edges.map((e) => (flipped.has(e.id) ? { id: e.id, u: e.to, v: e.from } : { id: e.id, u: e.from, v: e.to }));

  // 2. Rows: users on top, things being used underneath (longest path).
  const preds = new Map(ids.map((i) => [i, []]));
  const outs = new Map(ids.map((i) => [i, []]));
  for (const d of dag) { preds.get(d.v).push(d.u); outs.get(d.u).push(d.v); }
  const indeg = new Map(ids.map((i) => [i, preds.get(i).length]));
  const topo = [];
  const queue = ids.filter((i) => indeg.get(i) === 0);
  while (queue.length) {
    queue.sort();
    const v = queue.shift();
    topo.push(v);
    for (const w of outs.get(v)) { indeg.set(w, indeg.get(w) - 1); if (indeg.get(w) === 0) queue.push(w); }
  }
  const layer = new Map();
  for (const v of topo) layer.set(v, Math.max(0, ...preds.get(v).map((u) => layer.get(u) + 1)));
  // pull pure "users" down next to what they use, so arrows stay short
  for (const v of [...topo].reverse()) {
    if (preds.get(v).length === 0 && outs.get(v).length) layer.set(v, Math.min(...outs.get(v).map((w) => layer.get(w))) - 1);
  }
  const minL = Math.min(0, ...layer.values());
  for (const v of ids) layer.set(v, layer.get(v) - minL);

  // 3. Long arrows get invisible waypoints on each row they cross.
  const allLayer = new Map(layer);
  const chains = new Map(); // edge id -> [u, dummies..., v]
  const segs = [];
  for (const d of dag) {
    const chain = [d.u];
    for (let l = layer.get(d.u) + 1; l < layer.get(d.v); l++) {
      const dummy = `\u0000${d.id}#${l}`;
      allLayer.set(dummy, l);
      width.set(dummy, DUMMY_W);
      chain.push(dummy);
    }
    chain.push(d.v);
    chains.set(d.id, chain);
    for (let i = 0; i + 1 < chain.length; i++) segs.push([chain[i], chain[i + 1]]);
  }
  const up = new Map([...allLayer.keys()].map((k) => [k, []]));
  const down = new Map([...allLayer.keys()].map((k) => [k, []]));
  for (const [a, b] of segs) { down.get(a).push(b); up.get(b).push(a); }

  // 4. Order within each row to reduce crossings (barycenter sweeps, keep the best).
  const nLayers = Math.max(0, ...allLayer.values()) + 1;
  let rows = Array.from({ length: nLayers }, () => []);
  // initial order: breadth-first from the top, alphabetical tie-break
  const placed = new Set();
  const bfs = [...allLayer.keys()].filter((k) => up.get(k).length === 0).sort();
  while (bfs.length) {
    const v = bfs.shift();
    if (placed.has(v)) continue;
    placed.add(v);
    rows[allLayer.get(v)].push(v);
    for (const w of [...down.get(v)].sort()) if (!placed.has(w)) bfs.push(w);
  }
  for (const k of [...allLayer.keys()].sort()) if (!placed.has(k)) rows[allLayer.get(k)].push(k);

  const crossings = (rs) => {
    let total = 0;
    for (let l = 0; l + 1 < rs.length; l++) {
      const pos = new Map(rs[l + 1].map((v, i) => [v, i]));
      const list = [];
      rs[l].forEach((v, i) => down.get(v).forEach((w) => list.push([i, pos.get(w)])));
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          if ((list[a][0] - list[b][0]) * (list[a][1] - list[b][1]) < 0) total++;
        }
      }
    }
    return total;
  };
  const reorder = (rs, l, neighbours, ref) => {
    const pos = new Map(rs[ref].map((v, i) => [v, i]));
    const bc = new Map(rs[l].map((v, i) => {
      const ns = neighbours.get(v).filter((w) => pos.has(w));
      return [v, ns.length ? ns.reduce((s, w) => s + pos.get(w), 0) / ns.length : i];
    }));
    rs[l] = [...rs[l]].sort((a, b) => bc.get(a) - bc.get(b) || rs[l].indexOf(a) - rs[l].indexOf(b));
  };
  let best = rows.map((r) => [...r]);
  let bestC = crossings(best);
  for (let iter = 0; iter < 16 && bestC > 0; iter++) {
    if (iter % 2 === 0) for (let l = 1; l < nLayers; l++) reorder(rows, l, up, l - 1);
    else for (let l = nLayers - 2; l >= 0; l--) reorder(rows, l, down, l + 1);
    const c = crossings(rows);
    if (c < bestC) { bestC = c; best = rows.map((r) => [...r]); }
  }
  rows = best;

  // 5. Horizontal positions: start packed, then nudge each box toward its neighbours.
  const x = new Map();
  for (const row of rows) {
    let cur = 0;
    for (const v of row) { x.set(v, cur + width.get(v) / 2); cur += width.get(v) + COL_GAP; }
    const shift = (cur - COL_GAP) / 2;
    for (const v of row) x.set(v, x.get(v) - shift);
  }
  const settle = (row, want) => {
    const gap = (a, b) => (width.get(a) + width.get(b)) / 2 + (a.startsWith('\u0000') || b.startsWith('\u0000') ? 10 : COL_GAP);
    const L = row.map((v) => want.get(v));
    for (let i = 1; i < row.length; i++) L[i] = Math.max(L[i], L[i - 1] + gap(row[i - 1], row[i]));
    const R = row.map((v) => want.get(v));
    for (let i = row.length - 2; i >= 0; i--) R[i] = Math.min(R[i], R[i + 1] - gap(row[i], row[i + 1]));
    row.forEach((v, i) => x.set(v, (L[i] + R[i]) / 2));
    // averaging can re-introduce overlaps; one last left-to-right pass fixes them
    for (let i = 1; i < row.length; i++) {
      const min = x.get(row[i - 1]) + gap(row[i - 1], row[i]);
      if (x.get(row[i]) < min) x.set(row[i], min);
    }
  };
  for (let iter = 0; iter < 10; iter++) {
    const order = iter % 2 === 0 ? rows.map((_, i) => i) : rows.map((_, i) => rows.length - 1 - i);
    for (const l of order) {
      const nb = iter % 2 === 0 ? up : down;
      const want = new Map(rows[l].map((v) => {
        const ns = [...nb.get(v), ...(iter > 5 ? (nb === up ? down : up).get(v) : [])];
        return [v, ns.length ? ns.reduce((s, w) => s + x.get(w), 0) / ns.length : x.get(v)];
      }));
      settle(rows[l], want);
    }
  }

  // 6. Coordinates and arrow waypoints.
  const y = (l) => l * (NODE_H + ROW_GAP);
  const minX = Math.min(...[...x.entries()].map(([v, cx]) => cx - width.get(v) / 2), 0);
  const pos = {};
  for (const id of ids) {
    const w = width.get(id);
    pos[id] = { x: x.get(id) - w / 2 - minX, y: y(layer.get(id)), w, h: NODE_H };
  }
  const pairs = new Set(edges.map((e) => `${e.from}→${e.to}`));
  const routes = {};
  for (const e of edges) {
    let chain = chains.get(e.id);
    const pts = chain.map((v, i) => {
      const cx = x.get(v) - minX;
      const cy = y(allLayer.get(v));
      if (i === 0) return [cx, cy + NODE_H];
      if (i === chain.length - 1) return [cx, cy];
      return [cx, cy + NODE_H / 2];
    });
    if (flipped.has(e.id)) pts.reverse();
    // two-way dependency between the same pair: offset so both arrows are visible
    if (pairs.has(`${e.to}→${e.from}`)) {
      const off = e.from < e.to ? -7 : 7;
      pts.forEach((p) => { p[0] += off; });
    }
    routes[e.id] = pts.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]);
    chain = null;
  }
  const W = Math.max(0, ...Object.values(pos).map((p) => p.x + p.w));
  const H = Math.max(0, ...Object.values(pos).map((p) => p.y + p.h));
  return { pos, routes, width: W, height: H, crossings: bestC };
}
