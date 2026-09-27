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
      const members = new Set(scc);
      const edgeKeys = [...graph.edges.values()]
        .filter((e) => members.has(e.from) && members.has(e.to))
        .map((e) => `${e.from}→${e.to}`).sort();
      const sorted = [...scc].sort();
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
