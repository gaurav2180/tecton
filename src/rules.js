// House rules: "this part of the app must not depend on that part".
import { nameMatches } from './graph.js';

/**
 * Rule shapes (in tecton.config.json → "rules"):
 *   { "name": "...", "from": "components", "to": ["db", "npm:pg"] }      // forbidden targets
 *   { "name": "...", "from": "lib", "allow": ["utils", "types"] }        // the ONLY internal modules allowed
 * "from"/"to"/"allow" accept module names with * wildcards. npm packages are written "npm:<name>".
 * Optional "severity": "error" (default, fails CI) or "warn".
 * Top-level "cycles": "warn" (default) | "error" | "off" flags modules that depend on each other in a loop.
 */
/**
 * @param {Pick<import('./types.js').Graph, 'modules' | 'edges'>} graph
 * @param {import('./types.js').Config} cfg
 * @returns {import('./types.js').Violation[]}
 */
export function evaluate(graph, cfg) {
  const rules = (cfg.rules || []).map((r, i) => ({ ...r, key: r.name || `rule ${i + 1}`, severity: r.severity || 'error' }));
  const out = [];

  for (const e of graph.edges.values()) {
    for (const r of rules) {
      if (!r.from || ![].concat(r.from).some((p) => nameMatches(p, e.from))) continue;
      let broken = false;
      if (r.to && [].concat(r.to).some((p) => nameMatches(p, e.to))) broken = true;
      if (r.allow && !e.external && ![].concat(r.allow).some((p) => nameMatches(p, e.to))) broken = true;
      if (!broken) continue;
      out.push({
        id: `${r.key}|${e.from}|${e.to}`,
        kind: 'rule', rule: r.key, message: r.message || null, severity: r.severity,
        from: e.from, to: e.to, edges: [`${e.from}→${e.to}`], count: e.count, imports: e.imports,
      });
    }
  }

  const cycleMode = cfg.cycles ?? 'warn';
  if (cycleMode !== 'off') {
    for (const scc of stronglyConnected(graph)) {
      const sorted = [...scc].sort();
      // Only the dependencies that close the loop are reported (removing them breaks it); flagging every
      // arrow inside a big loop would paint the whole map and hide which imports to fix.
      const edgeKeys = loopClosers(graph, scc);
      out.push({
        id: `cycle|${sorted.join('|')}`,
        kind: 'cycle', rule: 'No circular dependencies', message: null, severity: cycleMode,
        from: sorted[0], to: sorted[sorted.length - 1], members: sorted, edges: edgeKeys,
        count: edgeKeys.length, imports: edgeKeys.flatMap((k) => graph.edges.get(k).imports.slice(0, 5)),
      });
    }
  }
  return out;
}

/**
 * The dependencies that close a loop: walk the group from its most "top-level" module (uses the most,
 * is used the least) down; an arrow back to a module still on the walk points up and closes a loop.
 * Removing these breaks every loop in the group. Deterministic: ties go by name.
 * @param {Pick<import('./types.js').Graph, 'edges'>} graph
 * @param {string[]} scc
 * @returns {string[]} edge keys "from→to", sorted
 */
export function loopClosers(graph, scc) {
  const members = new Set(scc);
  const inner = [...graph.edges.values()].filter((e) => members.has(e.from) && members.has(e.to));
  const rank = new Map(scc.map((m) => [m, 0]));
  for (const e of inner) { rank.set(e.from, rank.get(e.from) + 1); rank.set(e.to, rank.get(e.to) - 1); }
  const byRank = (a, b) => rank.get(b) - rank.get(a) || (a < b ? -1 : 1);
  const next = new Map(scc.map((m) => [m, inner.filter((e) => e.from === m).map((e) => e.to).sort(byRank)]));
  const state = new Map(); // 1 = on the walk, 2 = done
  const closers = [];
  const walk = (v) => {
    state.set(v, 1);
    for (const w of next.get(v)) {
      if (state.get(w) === 1) closers.push(`${v}→${w}`);
      else if (!state.get(w)) walk(w);
    }
    state.set(v, 2);
  };
  for (const v of [...scc].sort(byRank)) if (!state.get(v)) walk(v);
  return closers.sort();
}

/** Tarjan's algorithm over internal modules; returns groups of 2+ modules that form a loop. */
function stronglyConnected(graph) {
  const adj = new Map();
  for (const m of graph.modules.keys()) adj.set(m, []);
  for (const e of graph.edges.values()) if (!e.external) adj.get(e.from)?.push(e.to);
  let index = 0;
  const idx = new Map(); const low = new Map(); const onStack = new Set(); const stack = []; const res = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) res.push(comp);
    }
  };
  for (const v of [...adj.keys()].sort()) if (!idx.has(v)) visit(v);
  return res;
}

/** Packages that rules mention by name, so they get drawn on the map even if externals are hidden. */
export function packagesNamedInRules(cfg) {
  return (cfg.rules || []).flatMap((r) => [].concat(r.to || [])).filter((p) => p.startsWith('npm:'));
}
