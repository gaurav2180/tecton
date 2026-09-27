// Comparing two snapshots: what appeared, what disappeared, which rule breaks are new.
import { nameMatches } from './graph.js';
import { packagesNamedInRules } from './rules.js';

const status = (inBase, inCur) => (inBase && inCur ? 'same' : inCur ? 'added' : 'removed');

export function diffGraphs(base, cur, baseViol, curViol, cfg) {
  const showPkg = (name) => cfg.externals === true
    || packagesNamedInRules(cfg).some((p) => nameMatches(p, name));

  // ---- dependencies (arrows) ----
  const edges = [];
  const keys = new Set([...base.edges.keys(), ...cur.edges.keys()]);
  for (const key of keys) {
    const b = base.edges.get(key);
    const c = cur.edges.get(key);
    const e = c || b;
    if (e.external && !showPkg(e.to)) continue;
    const st = status(!!b, !!c);
    edges.push({
      id: key, from: e.from, to: e.to, external: e.external, status: st,
      countBase: b ? b.count : 0, countCur: c ? c.count : 0,
      imports: (c || b).imports,
      addedImports: st === 'same' ? newEvidence(b.imports, c.imports) : [],
    });
  }

  // ---- modules (boxes) ----
  const nodes = [];
  const names = new Set([...base.modules.keys(), ...cur.modules.keys()]);
  for (const e of edges) { if (e.external) { names.add(e.from); names.add(e.to); } }
  for (const name of names) {
    const external = name.startsWith('npm:');
    const b = base.modules.get(name);
    const c = cur.modules.get(name);
    let inBase = !!b; let inCur = !!c;
    if (external) {
      inBase = edges.some((e) => e.to === name && e.status !== 'added');
      inCur = edges.some((e) => e.to === name && e.status !== 'removed');
    }
    const bf = new Set(b ? b.files : []);
    const cf = new Set(c ? c.files : []);
    nodes.push({
      id: name, external, status: status(inBase, inCur),
      filesBase: bf.size, filesCur: cf.size,
      files: [...new Set([...bf, ...cf])].sort().map((f) => ({ path: f, status: status(bf.has(f), cf.has(f)) })),
    });
  }

  // ---- rule breaks ----
  const baseIds = new Set(baseViol.map((v) => v.id));
  const curIds = new Set(curViol.map((v) => v.id));
  const violations = [
    ...curViol.map((v) => ({ ...v, status: baseIds.has(v.id) ? 'existing' : 'new' })),
    ...baseViol.filter((v) => !curIds.has(v.id)).map((v) => ({ ...v, status: 'fixed' })),
  ];
  const order = { new: 0, existing: 1, fixed: 2 };
  violations.sort((a, b) => order[a.status] - order[b.status] || (a.severity === 'error' ? -1 : 1) - (b.severity === 'error' ? -1 : 1));

  const count = (arr, st) => arr.filter((x) => x.status === st).length;
  const summary = {
    modules: { added: count(nodes.filter((n) => !n.external), 'added'), removed: count(nodes.filter((n) => !n.external), 'removed'), total: cur.modules.size },
    deps: {
      added: count(edges, 'added'), removed: count(edges, 'removed'),
      changed: edges.filter((e) => e.status === 'same' && e.countBase !== e.countCur).length,
      total: edges.filter((e) => e.status !== 'removed').length,
    },
    violations: {
      newErrors: violations.filter((v) => v.status === 'new' && v.severity === 'error').length,
      newWarnings: violations.filter((v) => v.status === 'new' && v.severity !== 'error').length,
      existing: count(violations, 'existing'),
      fixed: count(violations, 'fixed'),
    },
    files: { base: base.stats.files, cur: cur.stats.files },
  };
  return { nodes, edges, violations, summary };
}

function newEvidence(before, after) {
  const k = (x) => `${x.file}>${x.target}`;
  const seen = new Set(before.map(k));
  return after.filter((x) => !seen.has(k(x)));
}
