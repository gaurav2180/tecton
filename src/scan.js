// Reading source files (from disk or from a git commit) and pulling out their imports.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '.turbo', '.vercel', '.cache', '.output', '.svelte-kit']);
const CONFIG_FILES = ['tsconfig.json', 'jsconfig.json'];

export const isCode = (p) => CODE_EXT.includes(path.posix.extname(p)) && !p.endsWith('.d.ts');

export function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd, input: input === undefined ? undefined : Buffer.from(input, 'utf8'),
    encoding: input === undefined ? 'utf8' : null, // stdin callers get raw bytes back
    maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function gitInfo(dir) {
  try {
    const top = git(dir, ['rev-parse', '--show-toplevel']).trim();
    const prefix = path.relative(top, dir).split(path.sep).join('/');
    return { top, prefix };
  } catch {
    return null;
  }
}

export function refExists(dir, ref) {
  try { git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return true; } catch { return false; }
}

/** The files as they are on disk right now (respecting .gitignore when inside a repo). */
export function workingTreeSource(dir) {
  let files;
  const gi = gitInfo(dir);
  if (gi) {
    files = git(dir, ['ls-files', '-co', '--exclude-standard', '-z', '--', '.'])
      .split('\0').filter(Boolean)
      .filter((f) => fs.existsSync(path.join(dir, f))); // drop deleted-but-still-tracked files
  } else {
    files = [];
    const walk = (rel) => {
      for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        if (ent.name.startsWith('.') && ent.isDirectory()) continue;
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(r); } else files.push(r);
      }
    };
    walk('');
  }
  files = files.map((f) => f.split(path.sep).join('/'))
    .filter((f) => !f.split('/').some((s) => SKIP_DIRS.has(s)));
  return {
    label: 'working tree',
    files: files.filter(isCode).sort(),
    manifests: files.filter((f) => f === 'package.json' || f.endsWith('/package.json')).sort(),
    read: (rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; } },
  };
}

/** The files as they were at a git ref (branch, tag or commit). */
export function gitRefSource(dir, ref) {
  const { prefix } = gitInfo(dir);
  const top = git(dir, ['rev-parse', '--show-toplevel']).trim();
  const pre = prefix ? `${prefix}/` : '';
  const all = git(top, ['ls-tree', '-r', '--name-only', '-z', ref, '--', prefix || '.'])
    .split('\0').filter(Boolean)
    .filter((f) => f.startsWith(pre))
    .map((f) => f.slice(pre.length))
    .filter((f) => !f.split('/').some((s) => SKIP_DIRS.has(s)));
  const code = all.filter(isCode).sort();
  const manifests = all.filter((f) => f === 'package.json' || f.endsWith('/package.json')).sort();
  const wanted = [...code, ...manifests, ...CONFIG_FILES.filter((c) => all.includes(c))];

  // Read every file in one `git cat-file --batch` call instead of one process per file.
  const contents = new Map();
  if (wanted.length) {
    const buf = git(top, ['cat-file', '--batch'], wanted.map((f) => `${ref}:${pre}${f}`).join('\n') + '\n');
    let pos = 0;
    for (const f of wanted) {
      const nl = buf.indexOf(10, pos);
      const header = buf.slice(pos, nl).toString('utf8');
      pos = nl + 1;
      if (header.endsWith(' missing')) continue;
      const size = Number(header.split(' ')[2]);
      contents.set(f, buf.slice(pos, pos + size).toString('utf8'));
      pos += size + 1;
    }
  }
  return { label: ref, files: code, manifests, read: (rel) => contents.get(rel) ?? null };
}

/**
 * Blank out comments (keeping newlines so line numbers stay right) while leaving strings intact.
 * Handles '...', "...", `...${ ... }...` and // and /* comments. Regex literals are not special-cased.
 */
export function stripComments(src) {
  const out = src.split('');
  const stack = []; // template-literal nesting: brace depth inside each ${ }
  let i = 0;
  let mode = 'code';
  let braces = 0;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
      if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
      if (c === "'" || c === '"') { mode = c; i++; continue; }
      if (c === '`') { mode = '`'; i++; continue; }
      if (c === '{') braces++;
      if (c === '}') {
        if (stack.length && braces === stack[stack.length - 1]) { stack.pop(); mode = '`'; i++; continue; }
        braces--;
      }
      i++;
    } else if (mode === "'" || mode === '"') {
      if (c === '\\') { i += 2; continue; }
      if (c === mode || c === '\n') mode = 'code';
      i++;
    } else { // template literal
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { mode = 'code'; i++; continue; }
      if (c === '$' && n === '{') { stack.push(braces); mode = 'code'; i += 2; continue; }
      i++;
    }
  }
  return out.join('');
}

const IMPORT_RES = [
  // import x from 'y' | import { a, type b } from "y" | import 'y' | export * from 'y' | export { a } from 'y'
  /(?:^|[^.\w$])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s*)?['"]([^'"\n]+)['"]/g,
  // require('y')
  /(?:^|[^.\w$])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  // import('y')
  /(?:^|[^.\w$])import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

export function extractImports(src) {
  const code = stripComments(src);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0; let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const found = [];
  const seen = new Set();
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) {
      const spec = m[1];
      const line = lineOf(m.index + m[0].indexOf(spec));
      const key = `${spec}@${line}`;
      if (!seen.has(key)) { seen.add(key); found.push({ spec, line }); }
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

// ---------- resolving an import string to a file (or an npm package) ----------

const BUILTINS = new Set(['assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib']);

export function parseJsonc(text) {
  const noComments = stripComments(text).replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noComments);
}

/** Read "paths" aliases (e.g. "@/*": ["src/*"]) from tsconfig/jsconfig, plus any from archdiff config. */
export function loadAliases(source, cfgAliases = {}) {
  const aliases = [];
  for (const name of CONFIG_FILES) {
    const text = source.readConfig ? source.readConfig(name) : source.read(name);
    if (!text) continue;
    let json;
    try { json = parseJsonc(text); } catch { continue; }
    const co = json.compilerOptions || {};
    const baseUrl = path.posix.normalize(co.baseUrl || '.');
    for (const [pattern, targets] of Object.entries(co.paths || {})) {
      aliases.push({ pattern, targets: targets.map((t) => path.posix.join(baseUrl, t)) });
    }
    if (co.baseUrl) aliases.push({ baseUrl });
    break;
  }
  for (const [pattern, target] of Object.entries(cfgAliases)) {
    aliases.unshift({ pattern, targets: [].concat(target) });
  }
  return aliases;
}

export function makeResolver(fileSet, aliases) {
  const exts = CODE_EXT;
  const tryFile = (p) => {
    p = path.posix.normalize(p).replace(/^\.\//, '');
    if (p.startsWith('../')) return null;
    if (fileSet.has(p)) return p;
    for (const e of exts) if (fileSet.has(p + e)) return p + e;
    // TS ESM style: './foo.js' actually points at './foo.ts'
    const m = p.match(/\.(m|c)?jsx?$/);
    if (m) {
      const stem = p.slice(0, -m[0].length);
      for (const e of exts) if (fileSet.has(stem + e)) return stem + e;
    }
    for (const e of exts) if (fileSet.has(`${p}/index${e}`)) return `${p}/index${e}`;
    return null;
  };

  return function resolve(fromFile, spec) {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = spec.startsWith('/') ? spec.slice(1) : path.posix.join(path.posix.dirname(fromFile), spec);
      const file = tryFile(base);
      return file ? { kind: 'file', file } : { kind: 'unresolved' };
    }
    for (const a of aliases) {
      if (a.baseUrl) {
        const file = tryFile(path.posix.join(a.baseUrl, spec));
        if (file) return { kind: 'file', file };
        continue;
      }
      const star = a.pattern.indexOf('*');
      let captured = null;
      if (star < 0) {
        if (spec === a.pattern) captured = '';
        else if (a.pattern.endsWith('/') && spec.startsWith(a.pattern)) captured = spec.slice(a.pattern.length);
      } else {
        const pre = a.pattern.slice(0, star);
        const post = a.pattern.slice(star + 1);
        if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) {
          captured = spec.slice(pre.length, spec.length - post.length);
        }
      }
      if (captured === null) continue;
      for (const t of a.targets) {
        const file = tryFile(t.includes('*') ? t.replace('*', captured) : path.posix.join(t, captured));
        if (file) return { kind: 'file', file };
      }
    }
    const bare = spec.replace(/^node:/, '');
    if (spec.startsWith('node:') || BUILTINS.has(bare.split('/')[0])) return { kind: 'builtin' };
    const parts = spec.split('/');
    const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    return { kind: 'package', pkg };
  };
}
