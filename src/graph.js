// Turning files + imports into a module-level map ("which part of the app uses which").
import path from 'node:path';
import { extractImports, loadAliases, makeResolver } from './scan.js';

const MAX_EVIDENCE = 60;

export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Match a module name against a rule pattern. `*` matches anything (including "/"). */
export function nameMatches(pattern, name) {
  if (pattern === name) return true;
  if (!pattern.includes('*')) return false;
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(name);
}

const DEFAULT_EXCLUDE = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/__mocks__/**',
  '**/*.stories.*', '**/*.config.*'];

/** Decide which module each file belongs to. */
export function makeGrouper(cfg, files) {
  const hasSrc = files.some((f) => f.startsWith('src/'));
  const root = (cfg.root ?? (hasSrc ? 'src' : '')).replace(/^\.\/?/, '').replace(/\/$/, '');
  const depth = cfg.depth ?? 1;
  const exclude = [...DEFAULT_EXCLUDE, ...(cfg.exclude || [])].map(globToRegex);

  const explicit = [];
  const mods = cfg.modules || {};
  for (const [name, pats] of Object.entries(mods)) {
    for (const p of [].concat(pats)) {
      if (/[*?]/.test(p)) { explicit.push({ name, re: globToRegex(p) }); continue; }
      // a plain path means that exact file, or everything inside that folder
      const clean = p.replace(/^\.\//, '').replace(/\/$/, '');
      explicit.push({ name, re: globToRegex(clean) }, { name, re: globToRegex(`${clean}/**`) });
    }
  }

  return {
    root,
    moduleOf(file) {
      if (exclude.some((re) => re.test(file))) return null;
      for (const m of explicit) if (m.re.test(file)) return m.name;
      if (cfg.modules && cfg.onlyListedModules) return null;
      let rel = file;
      if (root) {
        if (!file.startsWith(`${root}/`)) return null; // e.g. top-level config files
        rel = file.slice(root.length + 1);
      }
      const dirs = path.posix.dirname(rel).split('/').filter((s) => s && s !== '.');
      return dirs.length ? dirs.slice(0, depth).join('/') : '(root)';
    },
  };
}

/**
 * Build the module graph for one snapshot of the code.
 * Returns { modules: Map<name,{files}>, edges: Map<key,{from,to,external,imports}>, stats }.
 */
export function buildGraph(source, cfg) {
  const fileSet = new Set(source.files);
  const resolve = makeResolver(fileSet, loadAliases(source, cfg.aliases));
  const grouper = makeGrouper(cfg, source.files);

  const modules = new Map();
  const edges = new Map();
  const stats = { files: 0, imports: 0, unresolved: 0 };
  const moduleOf = new Map();

  for (const f of source.files) {
    const m = grouper.moduleOf(f);
    if (!m) continue;
    moduleOf.set(f, m);
    if (!modules.has(m)) modules.set(m, { files: [] });
    modules.get(m).files.push(f);
  }

  for (const [file, from] of moduleOf) {
    const text = source.read(file);
    if (text == null) continue;
    stats.files++;
    for (const { spec, line } of extractImports(text)) {
      const r = resolve(file, spec);
      let to;
      let target;
      if (r.kind === 'file') {
        to = moduleOf.get(r.file);
        target = r.file;
        if (!to) continue; // imports something outside the analysed area (tests, configs)
      } else if (r.kind === 'package') {
        to = `npm:${r.pkg}`;
        target = r.pkg;
      } else {
        if (r.kind === 'unresolved') stats.unresolved++;
        continue;
      }
      stats.imports++;
      if (to === from) continue;
      const key = `${from}→${to}`;
      if (!edges.has(key)) edges.set(key, { from, to, external: to.startsWith('npm:'), imports: [], count: 0 });
      const e = edges.get(key);
      e.count++;
      if (e.imports.length < MAX_EVIDENCE) e.imports.push({ file, line, spec, target });
    }
  }
  return { modules, edges, stats, root: grouper.root, moduleOf };
}
