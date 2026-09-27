#!/usr/bin/env node
// Tecton — draw a JS/TS codebase as a map of modules, compare it with a git branch, and check house rules.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { workingTreeSource, gitRefSource, gitInfo, refExists, git, parseJsonc, isCode, isExtra } from '../src/scan.js';
import { buildGraph, makeGrouper } from '../src/graph.js';
import { evaluate } from '../src/rules.js';
import { diffGraphs } from '../src/diff.js';
import { layout } from '../src/layout.js';
import { detectSystem, diffSystems } from '../src/system.js';
import { toHtml, toMarkdown } from '../src/report.js';

/** @typedef {import('../src/types.js').Graph} Graph @typedef {import('../src/types.js').Source} Source @typedef {import('../src/types.js').FileGraph} FileGraph */

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `Tecton — see every shift in your architecture before it becomes a crack

Usage
  tecton [dir] [options]      map the code, compare it with main, check rules and open the report
  tecton serve [dir]          open the report in your browser and refresh it whenever a file changes
  tecton init [dir]           create tecton.config.json with your modules and an example rule

Options
  --base <ref>        what to compare against (default: main, then master)
  --head <ref>        compare a commit instead of the files on disk (e.g. HEAD in CI)
  --no-merge-base     compare with the tip of --base instead of where your branch split off
  --out <file>        write the HTML report here (default: a temp file that opens in your browser;
                      ./tecton-report.html in CI or when output is not a terminal)
  --md <file>         also write a Markdown summary with a Mermaid diagram (for PR comments)
  --json <file>       also write the raw data as JSON
  --config <file>     config path (default: <dir>/tecton.config.json)
  --no-open           don't open the report in the browser
  --strict            fail on any rule break, not only new ones
  --port <n>          serve: port to listen on (default: 4321)
  -v, --version       print the version
  -h, --help          show this help

Exit code is 1 when the change introduces a new rule break (severity "error"), so it can gate CI.
`;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c(1); const dim = c(2); const red = c(31); const green = c(32); const yellow = c(33); const cyan = c(36);

class UsageError extends Error {}
const fail = (msg) => { throw new UsageError(msg); };

function parseArgs(argv) {
  const o = { _: [], mergeBase: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) fail(`${a} needs a value`); return v; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--base') o.base = val();
    else if (a === '--head') o.head = val();
    else if (a === '--out') o.out = val();
    else if (a === '--md') o.md = val();
    else if (a === '--json') o.json = val();
    else if (a === '--config') o.config = val();
    else if (a === '--port') { o.port = Number(val()); if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) fail('--port needs a number'); }
    else if (a === '--open') o.open = true;
    else if (a === '--no-open') o.open = false;
    else if (a === '--strict') o.strict = true;
    else if (a === '--no-merge-base') o.mergeBase = false;
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

function loadConfig(dir, file) {
  let p = file ? path.resolve(file) : path.join(dir, 'tecton.config.json');
  // projects set up before the rename keep working
  if (!file && !fs.existsSync(p) && fs.existsSync(path.join(dir, 'archdiff.config.json'))) p = path.join(dir, 'archdiff.config.json');
  if (!fs.existsSync(p)) { if (file) fail(`config not found: ${p}`); return { cfg: {}, path: null }; }
  try { return { cfg: parseJsonc(fs.readFileSync(p, 'utf8')), path: p }; } catch (e) { return fail(`could not read ${p}: ${e.message}`); }
}

function pickBase(dir, opts, cfg) {
  if (!gitInfo(dir)) return null;
  const candidates = opts.base ? [opts.base] : cfg.base ? [cfg.base] : ['main', 'master', 'origin/main', 'origin/master'];
  const ref = candidates.find((r) => refExists(dir, r));
  if (!ref) { if (opts.base) fail(`git ref not found: ${opts.base}`); return null; }
  let commit = ref;
  let label = ref;
  if (opts.mergeBase) {
    try {
      const head = opts.head || 'HEAD';
      const mb = git(dir, ['merge-base', ref, head]).trim();
      const tip = git(dir, ['rev-parse', ref]).trim();
      commit = mb;
      if (mb !== tip) label = `${ref} (where your branch split off, ${mb.slice(0, 7)})`;
    } catch { /* unrelated histories or no HEAD yet: use the tip */ }
  }
  return { ref: commit, label };
}

function init(dir) {
  const target = path.join(dir, 'tecton.config.json');
  if (fs.existsSync(target)) fail(`${target} already exists`);
  const src = workingTreeSource(dir);
  const grouper = makeGrouper({}, src.files);
  const mods = [...new Set(src.files.map((f) => grouper.moduleOf(f)).filter(Boolean))].sort();
  const pick = (...names) => names.find((n) => mods.includes(n));
  const ui = pick('components', 'ui', 'app', 'pages', 'views');
  const data = pick('db', 'database', 'prisma', 'models', 'repositories', 'server');
  const rules = [];
  if (ui && data) rules.push({ name: `${ui} must not talk to ${data} directly`, from: ui, to: [data], message: 'Go through a service/API layer instead.' });
  else rules.push({ name: 'example: replace with your own rule', from: mods[0] || 'components', to: [mods[1] || 'db'] });
  const cfg = { root: grouper.root, depth: 1, cycles: 'warn', rules };
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${green('created')} ${target}`);
  console.log(`modules found under ${bold(grouper.root || '.')}: ${mods.map(cyan).join(', ') || dim('(none)')}`);
  console.log(dim('Edit "rules" to describe what may depend on what, then run: tecton'));
}

function openFile(target) {
  if (process.env.BROWSER === 'none') return; // the usual way to say "don't open a browser"
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}

/**
 * Files inside modules, with how they changed, plus file → file imports. Feeds the per-module drill-down
 * and the "touched in this change" filter. Kept compact: files = [path, module, status, edited], deps = [from, to, status, line].
 * @param {Graph} prev
 * @param {Graph} cur
 * @param {Source | null} baseSrc
 * @param {Source} curSrc
 * @returns {FileGraph}
 */
function fileLevel(prev, cur, baseSrc, curSrc) {
  const same = (a, b) => a != null && b != null && a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
  const all = [...new Set([...prev.moduleOf.keys(), ...cur.moduleOf.keys()])].sort();
  const idx = new Map(all.map((f, i) => [f, i]));
  const files = all.map((f) => {
    const inB = prev.moduleOf.has(f); const inC = cur.moduleOf.has(f);
    const st = inB && inC ? 's' : inC ? 'a' : 'r';
    const edited = baseSrc ? (st !== 's' || !same(baseSrc.read(f), curSrc.read(f))) : false;
    return /** @type {FileGraph['files'][number]} */ ([f, cur.moduleOf.get(f) || prev.moduleOf.get(f), st, edited ? 1 : 0]);
  });
  /** @type {Map<string, FileGraph['deps'][number]>} */
  const deps = new Map();
  const add = (g, st) => {
    for (const [from, targets] of g.fileDeps) {
      for (const [to, line] of targets) {
        if (!idx.has(from) || !idx.has(to)) continue;
        const k = `${from}>${to}`;
        const had = deps.get(k);
        if (had) had[2] = 's'; else deps.set(k, [idx.get(from), idx.get(to), st, line]);
      }
    }
  };
  add(cur, prev === cur ? 's' : 'a');
  if (prev !== cur) add(prev, 'r');
  return { files, deps: [...deps.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
}

/** Read the code (and the base), compare, check rules and build the report model. */
function analyze(dir, opts) {
  const { cfg } = loadConfig(dir, opts.config);
  const t0 = Date.now();
  if (opts.head && !gitInfo(dir)) fail('--head needs a git repository');
  const curSrc = opts.head ? gitRefSource(dir, opts.head) : workingTreeSource(dir);
  const base = pickBase(dir, opts, cfg);
  const baseSrc = base ? gitRefSource(dir, base.ref) : null;

  const cur = buildGraph(curSrc, cfg);
  const prev = baseSrc ? buildGraph(baseSrc, cfg) : cur;
  if (!cur.modules.size) fail(`no JS/TS files found under ${path.join(dir, cur.root)} (set "root" in tecton.config.json)`);
  const curViol = evaluate(cur, cfg);
  const baseViol = baseSrc ? evaluate(prev, cfg) : curViol;
  const d = diffGraphs(prev, cur, baseViol, curViol, cfg);

  const sysCur = detectSystem(curSrc, cur, { project: path.basename(dir), aliases: cfg.aliases });
  const sysBase = baseSrc ? detectSystem(baseSrc, prev, { project: path.basename(dir), aliases: cfg.aliases }) : sysCur;
  const system = diffSystems(sysBase, sysCur);

  const files = fileLevel(prev, cur, baseSrc, curSrc);
  const touched = new Map();
  for (const [, mod, , edited] of files.files) if (edited) touched.set(mod, (touched.get(mod) || 0) + 1);

  const lay = layout(d.nodes, d.edges);
  /** @type {import('../src/types.js').ReportModel} */
  const model = {
    project: path.basename(dir),
    curLabel: opts.head ? opts.head : 'your working copy',
    baseLabel: base ? base.label : null,
    hasBase: !!base,
    ruleCount: (cfg.rules || []).length,
    generatedAt: new Date().toISOString(),
    width: lay.width, height: lay.height,
    summary: { ...d.summary, touched: { files: files.files.filter((f) => f[3]).length, modules: touched.size } },
    nodes: d.nodes.map((n) => ({ ...n, pos: lay.pos[n.id], touched: touched.get(n.id) || 0 })),
    edges: d.edges.map((e) => ({ ...e, points: lay.routes[e.id] })),
    violations: d.violations,
    rules: [
      ...(cfg.rules || []).map((r, i) => ({
        key: r.name || `rule ${i + 1}`, kind: 'rule', from: r.from, to: r.to ? [].concat(r.to) : null,
        allow: r.allow ? [].concat(r.allow) : null, severity: r.severity || 'error', message: r.message || null,
      })),
      ...((cfg.cycles ?? 'warn') !== 'off' ? [{ key: 'No circular dependencies', kind: 'cycle', severity: cfg.cycles ?? 'warn', message: 'Modules should not depend on each other in a loop.' }] : []),
    ],
    files,
    version: VERSION,
    system,
  };
  model.markdown = toMarkdown(model);
  const failing = d.violations.filter((v) => v.severity === 'error' && v.status !== 'fixed'
    && (opts.strict || !base || v.status === 'new')).length;
  return { model, d, base, ms: Date.now() - t0, failing };
}

function printSummary({ d, base, ms }, opts) {
  const S = d.summary;
  console.log(`${bold('tecton')} ${dim(`${S.files.cur} files · ${S.modules.total} modules · ${S.deps.total} dependencies · ${ms}ms`)}`);
  if (base) {
    console.log(`compared with ${cyan(base.label)}: modules ${green(`+${S.modules.added}`)}/${red(`−${S.modules.removed}`)}, dependencies ${green(`+${S.deps.added}`)}/${red(`−${S.deps.removed}`)}`);
    for (const e of d.edges.filter((x) => x.status !== 'same')) {
      console.log(`  ${e.status === 'added' ? green('+') : red('−')} ${e.from} → ${e.to}`);
    }
  } else {
    console.log(dim('no git base found; showing a snapshot only'));
  }
  const relevant = d.violations.filter((v) => (base ? v.status !== 'existing' : true) || opts.strict);
  for (const v of relevant) {
    const where = v.kind === 'cycle' ? v.members.join(' ⇄ ') : `${v.from} → ${v.to}`;
    const tag = v.status === 'fixed' ? green('fixed') : v.severity === 'error' ? red(base ? 'NEW' : 'ERROR') : yellow('warn');
    const ev = v.imports[0] ? dim(` (${v.imports[0].file}:${v.imports[0].line})`) : '';
    console.log(`  ${tag} ${v.rule}: ${where}${ev}`);
  }
  const existing = d.violations.filter((v) => v.status === 'existing').length;
  if (base && existing && !opts.strict) console.log(dim(`  ${existing} rule break(s) already existed before this change`));
}

/** Run by a person (not CI, not piped)? Then the report opens in the browser by default. */
const interactive = () => !!process.stdout.isTTY && !process.env.CI;

function report(dir, opts) {
  const res = analyze(dir, opts);
  // a person at a terminal just wants to see it: open it, and keep it out of their project folder.
  // CI and scripts get a predictable file and no browser.
  const open = opts.open ?? interactive();
  const out = opts.out ? path.resolve(opts.out)
    : open ? path.join(os.tmpdir(), 'tecton', `${res.model.project.replace(/[^\w.-]+/g, '-') || 'report'}.html`)
      : path.resolve('tecton-report.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toHtml(res.model));
  if (opts.md) fs.writeFileSync(path.resolve(opts.md), res.model.markdown);
  if (opts.json) fs.writeFileSync(path.resolve(opts.json), JSON.stringify(res.model, null, 2));
  printSummary(res, opts);
  console.log(`report: ${out}`);
  if (open) { openFile(out); console.log(dim('opening it in your browser (--no-open to skip)')); }
  if (!res.model.ruleCount && !opts.config) console.log(dim('tip: add rules ("components must not use db") with: tecton init'));
  return res.failing ? 1 : 0;
}

// ------------------------------------------------------------------ tecton serve
const WATCHED_NAMES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'tecton.config.json', 'archdiff.config.json']);
const IGNORED_DIRS = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|coverage|\.turbo|\.vercel|\.cache|\.output|\.svelte-kit)(\/|$)/;
/** Does a change to this path (relative to the project) change the report? Commits and branch switches count too. */
const relevant = (rel) => {
  if (rel === '.git/HEAD' || rel.startsWith('.git/refs/heads/')) return true;
  if (rel.startsWith('.git/') || IGNORED_DIRS.test(rel)) return false;
  return isCode(rel) || isExtra(rel) || WATCHED_NAMES.has(path.posix.basename(rel));
};

// Added to the served page only: reloads on change and shows a small "live" pill.
const LIVE_SNIPPET = `<script>(() => {
  const pill = document.createElement('div');
  pill.setAttribute('role', 'status');
  pill.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:90;display:flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;font:500 12px/1 Geist,system-ui,sans-serif;background:var(--surface,#fff);color:var(--text-2,#444);border:1px solid var(--border,#E6E3DC);box-shadow:0 4px 14px rgba(16,16,24,.08)';
  const dot = document.createElement('i');
  dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#16A34A';
  const txt = document.createElement('span');
  pill.append(dot, txt);
  const set = (color, t) => { dot.style.background = color; txt.textContent = t; };
  set('#16A34A', 'Live');
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(pill));
  const es = new EventSource('/__tecton/events');
  es.addEventListener('building', () => set('#5B5BD6', 'Updating…'));
  es.addEventListener('reload', () => location.reload());
  es.addEventListener('failed', (e) => set('#DC2626', 'Update failed: ' + e.data));
  es.onerror = () => set('#8C8A85', 'Disconnected');
  es.onopen = () => set('#16A34A', 'Live');
})();</script>`;

function serve(dir, opts) {
  const clients = new Set();
  const send = (event, data = '') => { for (const res of clients) res.write(`event: ${event}\ndata: ${String(data).replace(/\n/g, ' ')}\n\n`); };
  let html = null;
  let building = false;
  let again = false;

  const rebuild = (why) => {
    if (building) { again = true; return; }
    building = true;
    send('building');
    const t = new Date().toTimeString().slice(0, 8);
    try {
      const res = analyze(dir, opts);
      html = toHtml(res.model).replace('</body>', `${LIVE_SNIPPET}\n</body>`);
      const S = res.d.summary;
      const status = res.failing ? red(`${res.failing} rule break${res.failing === 1 ? '' : 's'}`) : green('rules pass');
      console.log(`${dim(t)} ${why ? `${cyan('↻')} ${dim(why)} · ` : ''}${S.modules.total} modules · ${S.deps.total} dependencies · ${status} ${dim(`${res.ms}ms`)}`);
      send('reload');
    } catch (e) {
      console.error(`${dim(t)} ${red('update failed:')} ${e.message}`);
      send('failed', e.message);
      if (!html) html = `<!doctype html><meta charset="utf-8"><title>Tecton</title><body style="font:14px system-ui;padding:40px"><h1>Tecton could not read this project</h1><pre>${e.message.replace(/[<&]/g, (ch) => (ch === '<' ? '&lt;' : '&amp;'))}</pre>${LIVE_SNIPPET}</body>`;
    }
    building = false;
    if (again) { again = false; setTimeout(() => rebuild('more changes'), 50); }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__tecton/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  // keep the event streams alive through proxies and sleeping laptops
  setInterval(() => { for (const r of clients) r.write(': ping\n\n'); }, 25000).unref();

  rebuild(null);

  // watch the folder; fall back to polling where recursive watching is unsupported
  let timer = null;
  const changed = new Set();
  const schedule = (rel) => {
    changed.add(rel);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = [...changed]; changed.clear();
      rebuild(list.length === 1 ? list[0] : `${list.length} files changed`);
    }, 200);
  };
  const gi = gitInfo(dir);
  try {
    fs.watch(dir, { recursive: true }, (_ev, name) => {
      if (!name) return;
      const rel = name.split(path.sep).join('/');
      if (relevant(rel)) schedule(rel);
    });
    // the repo's .git may sit above the analysed folder
    if (gi && gi.prefix) fs.watch(path.join(gi.top, '.git'), { recursive: true }, (_ev, name) => { if (name && relevant(`.git/${name.split(path.sep).join('/')}`)) schedule('git'); });
  } catch {
    let last = null;
    const signature = () => {
      const src = workingTreeSource(dir);
      const stat = (f) => { try { const s = fs.statSync(path.join(dir, f)); return `${f}:${s.mtimeMs}:${s.size}`; } catch { return f; } };
      const head = gi ? stat(path.relative(dir, path.join(gi.top, '.git', 'HEAD'))) : '';
      return [...src.files, ...src.manifests, ...(src.extras || []), 'tecton.config.json'].map(stat).join('|') + head;
    };
    setInterval(() => { const s = signature(); if (last !== null && s !== last) schedule('files changed'); last = s; }, 1000).unref();
    console.log(dim('(recursive file watching is not available here; checking for changes every second)'));
  }

  const host = '127.0.0.1';
  let port = opts.port ?? 4321;
  const tries = opts.port == null ? 10 : 1;
  let attempt = 0;
  server.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
    if (e.code === 'EADDRINUSE' && ++attempt < tries) { port++; server.listen(port, host); return; }
    console.error(red(`tecton: could not listen on ${host}:${port}: ${e.message}`));
    process.exit(2);
  });
  server.on('listening', () => {
    const link = `http://${host}:${port}/`;
    console.log(`${bold('tecton serve')} ${cyan(link)} ${dim(`watching ${dir} · Ctrl+C to stop`)}`);
    if (opts.open ?? interactive()) openFile(link);
  });
  server.listen(port, host);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }
  const cmd = opts._[0];
  if (cmd === 'init') { init(path.resolve(opts._[1] || '.')); return 0; }
  if (cmd === 'serve') {
    const dir = path.resolve(opts._[1] || '.');
    if (!fs.existsSync(dir)) fail(`folder not found: ${dir}`);
    serve(dir, opts);
    return undefined; // keeps running
  }
  const dir = path.resolve(cmd || '.');
  if (!fs.existsSync(dir)) fail(`folder not found: ${dir}`);
  return report(dir, opts);
}

try {
  const code = main();
  if (code !== undefined) process.exitCode = code;
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(red(`tecton: ${e.message}`));
  process.exitCode = 2;
}
