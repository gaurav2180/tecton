#!/usr/bin/env node
// Tecton — draw a JS/TS codebase as a map of modules, compare it with a git branch, and check house rules.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { workingTreeSource, gitRefSource, gitInfo, refExists, git, parseJsonc } from '../src/scan.js';
import { buildGraph, makeGrouper } from '../src/graph.js';
import { evaluate } from '../src/rules.js';
import { diffGraphs } from '../src/diff.js';
import { layout } from '../src/layout.js';
import { detectSystem, diffSystems } from '../src/system.js';
import { toHtml, toMarkdown } from '../src/report.js';

const VERSION = '0.3.0';

const HELP = `Tecton — see every shift in your architecture before it becomes a crack

Usage
  tecton [dir] [options]      compare the code on disk with a git branch and write a report
  tecton init [dir]           create tecton.config.json with your modules and an example rule

Options
  --base <ref>        what to compare against (default: main, then master)
  --head <ref>        compare a commit instead of the files on disk (e.g. HEAD in CI)
  --no-merge-base     compare with the tip of --base instead of where your branch split off
  --out <file>        HTML report path (default: tecton-report.html)
  --md <file>         also write a Markdown summary with a Mermaid diagram (for PR comments)
  --json <file>       also write the raw data as JSON
  --config <file>     config path (default: <dir>/tecton.config.json)
  --open              open the report in your browser
  --strict            fail on any rule break, not only new ones
  -h, --help          show this help

Exit code is 1 when the change introduces a new rule break (severity "error"), so it can gate CI.
`;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c(1); const dim = c(2); const red = c(31); const green = c(32); const yellow = c(33); const cyan = c(36);

function parseArgs(argv) {
  const o = { _: [], mergeBase: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) die(`${a} needs a value`); return v; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--base') o.base = val();
    else if (a === '--head') o.head = val();
    else if (a === '--out') o.out = val();
    else if (a === '--md') o.md = val();
    else if (a === '--json') o.json = val();
    else if (a === '--config') o.config = val();
    else if (a === '--open') o.open = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--no-merge-base') o.mergeBase = false;
    else if (a.startsWith('-')) die(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

function die(msg) { console.error(red(`tecton: ${msg}`)); process.exit(2); }

function loadConfig(dir, file) {
  let p = file ? path.resolve(file) : path.join(dir, 'tecton.config.json');
  // projects set up before the rename keep working
  if (!file && !fs.existsSync(p) && fs.existsSync(path.join(dir, 'archdiff.config.json'))) p = path.join(dir, 'archdiff.config.json');
  if (!fs.existsSync(p)) { if (file) die(`config not found: ${p}`); return { cfg: {}, path: null }; }
  try { return { cfg: parseJsonc(fs.readFileSync(p, 'utf8')), path: p }; } catch (e) { die(`could not read ${p}: ${e.message}`); }
}

function pickBase(dir, opts, cfg) {
  if (!gitInfo(dir)) return null;
  const candidates = opts.base ? [opts.base] : cfg.base ? [cfg.base] : ['main', 'master', 'origin/main', 'origin/master'];
  const ref = candidates.find((r) => refExists(dir, r));
  if (!ref) { if (opts.base) die(`git ref not found: ${opts.base}`); return null; }
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
  if (fs.existsSync(target)) die(`${target} already exists`);
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

function openFile(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP); return 0; }
  if (opts._[0] === 'init') { init(path.resolve(opts._[1] || '.')); return 0; }

  const dir = path.resolve(opts._[0] || '.');
  if (!fs.existsSync(dir)) die(`folder not found: ${dir}`);
  const { cfg } = loadConfig(dir, opts.config);
  const t0 = Date.now();

  if (opts.head && !gitInfo(dir)) die('--head needs a git repository');
  const curSrc = opts.head ? gitRefSource(dir, opts.head) : workingTreeSource(dir);
  const base = pickBase(dir, opts, cfg);
  const baseSrc = base ? gitRefSource(dir, base.ref) : null;

  const cur = buildGraph(curSrc, cfg);
  const prev = baseSrc ? buildGraph(baseSrc, cfg) : cur;
  if (!cur.modules.size) die(`no JS/TS files found under ${path.join(dir, cur.root)} (set "root" in tecton.config.json)`);
  const curViol = evaluate(cur, cfg);
  const baseViol = baseSrc ? evaluate(prev, cfg) : curViol;
  const d = diffGraphs(prev, cur, baseViol, curViol, cfg);

  const sysCur = detectSystem(curSrc, cur, { project: path.basename(dir) });
  const sysBase = baseSrc ? detectSystem(baseSrc, prev, { project: path.basename(dir) }) : sysCur;
  const system = diffSystems(sysBase, sysCur);

  const lay = layout(d.nodes, d.edges);
  const model = {
    project: path.basename(dir),
    curLabel: opts.head ? opts.head : 'your working copy',
    baseLabel: base ? base.label : null,
    hasBase: !!base,
    ruleCount: (cfg.rules || []).length,
    generatedAt: new Date().toISOString(),
    width: lay.width, height: lay.height,
    summary: d.summary,
    nodes: d.nodes.map((n) => ({ ...n, pos: lay.pos[n.id] })),
    edges: d.edges.map((e) => ({ ...e, points: lay.routes[e.id] })),
    violations: d.violations,
    rules: [
      ...(cfg.rules || []).map((r, i) => ({
        key: r.name || `rule ${i + 1}`, kind: 'rule', from: r.from, to: r.to ? [].concat(r.to) : null,
        allow: r.allow ? [].concat(r.allow) : null, severity: r.severity || 'error', message: r.message || null,
      })),
      ...((cfg.cycles ?? 'warn') !== 'off' ? [{ key: 'No circular dependencies', kind: 'cycle', severity: cfg.cycles ?? 'warn', message: 'Modules should not depend on each other in a loop.' }] : []),
    ],
    version: VERSION,
    system,
  };
  const markdown = toMarkdown(model);
  model.markdown = markdown;

  const out = path.resolve(opts.out || 'tecton-report.html');
  fs.writeFileSync(out, toHtml(model));
  if (opts.md) fs.writeFileSync(path.resolve(opts.md), markdown);
  if (opts.json) fs.writeFileSync(path.resolve(opts.json), JSON.stringify(model, null, 2));

  // ---- terminal summary ----
  const S = d.summary;
  console.log(`${bold('tecton')} ${dim(`${S.files.cur} files · ${S.modules.total} modules · ${S.deps.total} dependencies · ${Date.now() - t0}ms`)}`);
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
  console.log(`report: ${out}`);
  if (opts.open) openFile(out);

  const failing = d.violations.filter((v) => v.severity === 'error' && v.status !== 'fixed'
    && (opts.strict || !base || v.status === 'new')).length;
  return failing ? 1 : 0;
}

process.exitCode = main();
