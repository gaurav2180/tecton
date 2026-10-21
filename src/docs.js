// `tecton docs`: the architecture as a Markdown file (ARCHITECTURE.md) with Mermaid diagrams, written from
// the same model as the report. High level (the system: users, apps, data, outside services), request flows
// (one flowchart per entry point, with the lines that do each step), low level (modules and their files),
// rules, and the docs already in the folder. Deterministic: the same code gives the same file, so it diffs well.
import path from 'node:path';

const MAX_FLOWS = 30; // flowcharts; the rest of the entry points go in a table
const MAX_MAP = 60; // modules on the module diagram
const MAX_FILE_MAPS = 30; // per-module file diagrams
const MAX_MODULE_FILES = 40; // bigger modules get a table, not a diagram
const MAX_LIST = 50;

// key, kind (for tables), word (for counts)
const GROUPS = [
  ['pages', 'Page', 'page'], ['api', 'API route', 'route'], ['endpoints', 'HTTP endpoint', 'endpoint'],
  ['jobs', 'Script', 'job'], ['schedules', 'Schedule', 'schedule'], ['workers', 'Queue worker', 'queue worker'],
];
// outside systems by purpose (the report's panel uses the same groups)
const CATS = [
  ['Payments', ['Payments']], ['AI', ['AI', 'Vector DB']], ['Email & messaging', ['Email', 'SMS', 'Messaging', 'Realtime']],
  ['Sign-in', ['Auth']], ['Monitoring & analytics', ['Monitoring', 'Analytics']], ['Other services', []],
  ['Web APIs', ['Web / HTTP']], ['Address set at deploy time', ['Set by env var']],
];
const catOf = (x) => (CATS.find(([, kinds]) => kinds.includes(x.kind)) || CATS[5])[0];

// ---------------------------------------------------------------- Markdown and Mermaid helpers
const plural = (n, w, pl) => `${n} ${n === 1 ? w : pl || `${w}s`}`;
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const list = (arr, n = MAX_LIST) => arr.slice(0, n).join(', ') + (arr.length > n ? ` and ${arr.length - n} more` : '');
/** A quoted Mermaid label; a newline in it becomes a line break. */
const lbl = (s) => `"${String(s).replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/\n/g, '<br/>')}"`;
const anchor = (s) => s.toLowerCase().replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '-');
/** Mermaid node ids: short, unique and stable for one diagram. */
function idMaker(prefix) {
  const ids = new Map();
  return (key) => { if (!ids.has(key)) ids.set(key, `${prefix}${ids.size}`); return ids.get(key); };
}
const STYLE = [
  '  classDef app stroke:#5B5BD6,stroke-width:2px',
  '  classDef data stroke:#8C8A85',
  '  classDef ext stroke:#8C8A85,stroke-dasharray:4 3',
  '  classDef person stroke:#5B5BD6',
];

/**
 * @param {import('./types.js').ReportModel} model
 * @param {{ about?: string | null, docs?: { path: string, title: string }[], outDir?: string, root?: string }} [opts]
 */
export function toArchitectureDoc(model, opts = {}) {
  const sys = model.system;
  const live = (x) => !x.status || x.status !== 'removed';
  const apps = sys.apps.filter(live);
  const stores = sys.stores.filter(live);
  const outside = sys.outside.filter(live);
  const links = sys.links.filter(live);
  const appById = new Map(apps.map((a) => [a.id, a]));
  const svcById = new Map([...stores, ...outside].map((x) => [x.id, x]));
  const entries = (a, g) => (a.groups[g] || []).filter(live);
  const steps = (e) => (e.flow || []).filter(live);
  const nameOf = (id) => (id === 'users' ? 'Users' : appById.has(id) ? appById.get(id).name : (svcById.get(id) || { name: id }).name);
  const entryTitle = (e) => `${e.methods && e.methods.length ? `${e.methods.join(' / ')} ` : ''}${e.human || e.label}`;
  const summaryOf = (a) => GROUPS.map(([g, , w]) => [entries(a, g).length, w]).filter(([n]) => n).map(([n, w]) => plural(n, w)).join(', ');

  const out = [];
  const push = (...l) => out.push(...l);

  push(`# ${model.project} architecture`, '');
  push(`> Generated from the code by [Tecton](https://github.com/gaurav2180/tecton) ${model.version} with \`npx tecton docs\`. Run it again to refresh: this file is rewritten each time, so keep your own notes in other files (they are linked under [Further reading](#further-reading)).`, '');
  if (opts.about) push(opts.about, '');

  const sections = ['System overview', 'Apps', 'Request flows', 'Data and outside services', 'Modules', 'Rules', 'Further reading'];
  push('**Contents:** ' + sections.map((t) => `[${t}](#${anchor(t)})`).join(' · '), '');

  // ---------------------------------------------------------------- high level
  push('## System overview', '');
  const appWords = apps.map((a) => `**${a.name}** (${a.framework}${summaryOf(a) ? `: ${summaryOf(a)}` : ''})`);
  const sentences = [];
  if (apps.length) sentences.push(`${model.project} is made of ${plural(apps.length, 'app')}: ${list(appWords)}.`);
  const appCalls = links.filter((l) => l.kind === 'app');
  if (appCalls.length) sentences.push(`${list(appCalls.map((l) => `${nameOf(l.from)} calls ${nameOf(l.to)}`))}.`);
  if (stores.length) sentences.push(`They keep data in ${list(stores.map((x) => `**${x.name}**`))}.`);
  if (outside.length) sentences.push(`They call ${plural(outside.length, 'outside service')}: ${list(outside.map((x) => x.name), 12)}.`);
  push(sentences.join(' ') || 'No apps were found (Tecton looks for package.json files).', '');
  if (apps.length) {
    const id = idMaker('n');
    push('```mermaid', 'flowchart LR');
    if (sys.hasUsers) push(`  ${id('users')}([${lbl('Users')}]):::person`);
    push(`  subgraph repo[${lbl(`${model.project} (this repo)`)}]`);
    for (const a of apps) push(`    ${id(a.id)}[${lbl(`${a.name}\n${a.framework}${summaryOf(a) ? ` · ${summaryOf(a)}` : ''}`)}]:::app`);
    for (const x of stores) push(x.kind === 'Queue' ? `    ${id(x.id)}[[${lbl(x.name)}]]:::data` : `    ${id(x.id)}[(${lbl(x.name)})]:::data`);
    push('  end');
    // outside systems are one box here (one line per app); the next diagram says which app calls which
    if (outside.length) push(`  ${id('outside')}[${lbl(`Outside systems\n${plural(outside.length, 'service')}`)}]:::ext`);
    const drawnEdges = new Set();
    for (const l of links) {
      if (!svcById.has(l.to) && !appById.has(l.to)) continue;
      const to = svcById.get(l.to);
      const target = l.kind === 'outside' && outside.some((x) => x.id === l.to) ? 'outside' : l.to;
      if (drawnEdges.has(`${l.from}>${target}`)) continue;
      drawnEdges.add(`${l.from}>${target}`);
      const queue = to && to.kind === 'Queue';
      const label = l.kind === 'users' ? 'HTTPS' : l.kind === 'app' ? l.labels[0] || 'HTTP' : queue ? l.labels.join(' · ') : '';
      push(`  ${id(l.from)} ${queue ? '-.->' : '-->'}${label ? `|${lbl(label)}|` : ''} ${id(target)}`);
    }
    push(...STYLE, '```', '');
  }
  // which app calls which outside services, grouped by purpose (apps left, groups right: lays out cleanly)
  if (outside.length) {
    push('### Outside services', '');
    const id = idMaker('o');
    const lines = [];
    const callers = apps.filter((a) => links.some((l) => l.from === a.id && l.kind === 'outside'));
    for (const a of callers) lines.push(`  ${id(a.id)}[${lbl(a.name)}]:::app`);
    for (const [cat] of CATS) {
      const names = outside.filter((x) => catOf(x) === cat).map((x) => x.name).sort();
      if (names.length) lines.push(`  ${id(`cat:${cat}`)}[${lbl(`${cat}\n${names.slice(0, 6).join(', ')}${names.length > 6 ? ` +${names.length - 6}` : ''}`)}]:::ext`);
    }
    const seen = new Set();
    for (const l of links.filter((x) => x.kind === 'outside' && svcById.has(x.to))) {
      const key = `${l.from}>${catOf(svcById.get(l.to))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  ${id(l.from)} --> ${id(`cat:${catOf(svcById.get(l.to))}`)}`);
    }
    push('```mermaid', 'flowchart LR', ...lines, ...STYLE, '```', '');
  }

  // ---------------------------------------------------------------- apps
  push('## Apps', '');
  for (const a of apps) {
    push(`### ${a.name}`, '');
    push(`${a.framework} app in ${code(a.root ? `${a.root}/` : './')} · ${plural(a.fileCount, 'file')}${a.tech.length ? ` · ${a.tech.join(', ')}` : ''}${a.pkgName && a.pkgName !== a.name ? ` · package ${code(a.pkgName)}` : ''}`, '');
    const talks = links.filter((l) => l.from === a.id && l.kind !== 'users').map((l) => `${nameOf(l.to)}${l.labels.length ? ` (${l.labels.join(', ')})` : ''}`);
    const callers = links.filter((l) => l.to === a.id).map((l) => nameOf(l.from));
    if (callers.length) push(`- **Used by:** ${list(callers)}`);
    if (talks.length) push(`- **Talks to:** ${list(talks)}`);
    if (a.modules && a.modules.length) push(`- **Modules:** ${list(a.modules.map((m) => `${m.name} (${m.files})`), 20)}`);
    if (callers.length || talks.length || (a.modules && a.modules.length)) push('');
    const rows = GROUPS.flatMap(([g, title]) => entries(a, g).map((e) => [title, e]));
    if (rows.length) {
      push('| Entry point | Kind | Defined in | Reaches |', '|---|---|---|---|');
      for (const [title, e] of rows.slice(0, MAX_LIST * 2)) {
        push(`| ${code(entryTitle(e))} | ${title} | ${code(`${e.file}:${e.line}`)} | ${cell(steps(e).map((s) => nameOf(s.to) + (s.ep ? ` ${s.label || ''}` : '')).join(', ') || '–')} |`);
      }
      if (rows.length > MAX_LIST * 2) push(`| …and ${rows.length - MAX_LIST * 2} more | | | |`);
      push('');
    } else push('_No entry points found._', '');
  }

  // ---------------------------------------------------------------- request flows
  push('## Request flows', '');
  push('What happens when each entry point runs: traced through its own handler and the files it imports, to the data stores, outside services and other routes it reaches. A call to another route continues into that route; a job put on a queue continues into the worker that runs it.', '');
  const all = apps.flatMap((a) => GROUPS.flatMap(([g, title]) => entries(a, g).map((e) => ({ a, g, title, e }))));
  const endpoint = (appId, key) => { const a = appById.get(appId); if (!a) return null; for (const g of ['api', 'endpoints']) { const e = entries(a, g).find((x) => x.key === key); if (e) return { a, g, e }; } return null; };
  const workers = (queue) => all.filter((r) => r.g === 'workers' && r.e.queue === queue);
  const traced = all.filter((r) => steps(r.e).length);
  const drawn = traced.slice().sort((p, r) => steps(r.e).length - steps(p.e).length).slice(0, MAX_FLOWS);
  const drawnSet = new Set(drawn);
  for (const r of traced.filter((x) => drawnSet.has(x))) {
    push(`### ${code(entryTitle(r.e))} in ${r.a.name}`, '');
    const id = idMaker('f');
    const lines = [];
    const notes = [];
    const drawnNodes = new Set([`entry:${r.a.id}|${r.e.key}`]);
    const trig = r.g === 'pages' ? 'A user opens the page' : r.g === 'api' || r.g === 'endpoints' ? 'An HTTP request' : r.g === 'jobs' ? `npm run ${r.e.key}` : r.g === 'schedules' ? `Runs ${r.e.human || r.e.label}` : `A job in the ${r.e.label}`;
    lines.push(`  ${id('trigger')}([${lbl(trig)}]):::person --> ${id(`entry:${r.a.id}|${r.e.key}`)}[${lbl(`${r.a.name}\n${entryTitle(r.e)}`)}]:::app`);
    const walk = (from, e, depth, seen) => {
      for (const s of steps(e)) {
        const to = svcById.get(s.to);
        const target = appById.has(s.to) && s.ep ? endpoint(s.to, s.ep) : null;
        const key = target ? `entry:${target.a.id}|${target.e.key}` : s.to;
        const fresh = !drawnNodes.has(key);
        drawnNodes.add(key);
        let node;
        if (target) node = `${id(key)}[${lbl(`${target.a.name}\n${entryTitle(target.e)}`)}]:::app`;
        else if (appById.has(s.to)) node = `${id(key)}[${lbl(appById.get(s.to).name)}]:::app`;
        else if (to && to.kind === 'Queue') node = `${id(key)}[[${lbl(to.name)}]]:::data`;
        else if (to && stores.includes(to)) node = `${id(key)}[(${lbl(to.name)})]:::data`;
        else node = `${id(key)}[${lbl(nameOf(s.to))}]:::ext`;
        const verb = target || appById.has(s.to) ? s.label || 'HTTP' : s.label === 'adds jobs' ? 'adds a job' : '';
        lines.push(`  ${from} ${s.label === 'adds jobs' ? '-.->' : '-->'}${verb ? `|${lbl(verb)}|` : ''} ${fresh ? node : id(key)}`);
        const doing = target || appById.has(s.to) ? `calls ${s.label || ''} on **${nameOf(s.to)}**` : s.label === 'adds jobs' ? `adds a job to **${nameOf(s.to)}**` : to && stores.includes(to) ? `reads & writes **${nameOf(s.to)}**` : `calls **${nameOf(s.to)}**`;
        const via = s.via.length > 1 ? ` via ${s.via.slice(0, -1).map(code).join(' → ')}` : '';
        notes.push(`${'  '.repeat(depth)}- ${doing.replace(/ {2,}/g, ' ')}: ${code(`${s.via[s.via.length - 1]}:${s.line}`)}${via}`);
        if (depth >= 3) continue;
        if (target && !seen.has(key)) walk(id(key), target.e, depth + 1, new Set(seen).add(key));
        if (s.label === 'adds jobs') {
          for (const w of workers(s.to)) {
            const wk = `entry:${w.a.id}|${w.e.key}`;
            if (seen.has(wk)) continue;
            lines.push(`  ${id(key)} --> ${drawnNodes.has(wk) ? id(wk) : `${id(wk)}[${lbl(`${w.a.name} worker\nruns the job`)}]:::app`}`);
            drawnNodes.add(wk);
            notes.push(`${'  '.repeat(depth + 1)}- then a worker in **${w.a.name}** runs the job: ${code(`${w.e.file}:${w.e.line}`)}`);
            walk(id(wk), w.e, depth + 2, new Set(seen).add(wk));
          }
        }
      }
    };
    walk(id(`entry:${r.a.id}|${r.e.key}`), r.e, 0, new Set([`entry:${r.a.id}|${r.e.key}`]));
    push('```mermaid', 'flowchart LR', ...lines, ...STYLE, '```', '');
    push(`Starts in ${code(`${r.e.file}:${r.e.line}`)}.`, '', ...notes, '');
  }
  const rest = all.filter((x) => !drawnSet.has(x));
  if (rest.length) {
    push(traced.length > drawn.length ? '### Other entry points' : '### Entry points that reach nothing else', '');
    push('| Entry point | App | Defined in | Reaches |', '|---|---|---|---|');
    for (const r of rest.slice(0, MAX_LIST * 4)) push(`| ${code(entryTitle(r.e))} | ${r.a.name} | ${code(`${r.e.file}:${r.e.line}`)} | ${cell(steps(r.e).map((s) => nameOf(s.to)).join(', ') || '–')} |`);
    if (rest.length > MAX_LIST * 4) push(`| …and ${rest.length - MAX_LIST * 4} more | | | |`);
    push('');
  }
  if (!all.length) push('_No entry points found: flows start at pages, API routes, HTTP endpoints, npm scripts, cron schedules and queue workers._', '');

  // ---------------------------------------------------------------- data and outside services
  push('## Data and outside services', '');
  if (stores.length) {
    push('| Data store | Kind | Through | Used by | For example |', '|---|---|---|---|---|');
    for (const x of stores) push(`| **${cell(x.name)}** | ${x.kind} | ${cell(x.via.join(', '))} | ${cell(x.apps.map(nameOf).join(', '))} | ${x.evidence[0] ? code(`${x.evidence[0].file}:${x.evidence[0].line}`) : '–'} |`);
    push('');
  }
  if (outside.length) {
    push('| Outside service | Purpose | Address | Used by | For example |', '|---|---|---|---|---|');
    const sorted = outside.slice().sort((p, r) => CATS.findIndex(([c]) => c === catOf(p)) - CATS.findIndex(([c]) => c === catOf(r)) || p.name.localeCompare(r.name));
    for (const x of sorted) {
      const hosts = x.hosts.map((hh) => (typeof hh === 'string' ? hh : hh.host)).filter(Boolean);
      const where = x.kind === 'Set by env var' ? `set by ${code(x.via[0] || 'an env var')}` : hosts.length ? hosts.map(code).join(', ') : x.via.map(code).join(', ');
      push(`| **${cell(x.name)}** | ${catOf(x)} | ${cell(where) || '–'} | ${cell(x.apps.map(nameOf).join(', '))} | ${x.evidence[0] ? code(`${x.evidence[0].file}:${x.evidence[0].line}`) : '–'} |`);
    }
    push('');
  }
  if (!stores.length && !outside.length) push('_No data stores or outside services found._', '');

  // ---------------------------------------------------------------- low level: modules and files
  push('## Modules', '');
  const mods = model.nodes.filter((n) => !n.external && live(n));
  const edges = model.edges.filter((e) => !e.external && live(e));
  const viol = new Set(model.violations.filter((v) => v.status !== 'fixed').flatMap((v) => v.edges));
  push(`The code is grouped into ${plural(mods.length, 'module')} (folders, or what ${code('tecton.config.json')} says). An arrow means "imports from"; the number is how many imports. Thick arrows break a rule.`, '');
  const degree = (n) => edges.filter((e) => e.from === n.id || e.to === n.id).length;
  const shown = mods.slice().sort((p, r) => degree(r) - degree(p) || p.id.localeCompare(r.id)).slice(0, MAX_MAP);
  const shownIds = new Set(shown.map((n) => n.id));
  if (shown.length) {
    const id = idMaker('m');
    const lines = ['```mermaid', 'flowchart TD'];
    for (const n of shown.slice().sort((p, r) => p.id.localeCompare(r.id))) lines.push(`  ${id(n.id)}[${lbl(`${n.id}\n${plural(n.filesCur, 'file')}`)}]`);
    const styles = [];
    edges.filter((e) => shownIds.has(e.from) && shownIds.has(e.to)).forEach((e, i) => {
      const bad = viol.has(e.id);
      lines.push(`  ${id(e.from)} ${bad ? '==>' : '-->'}${e.countCur > 1 || bad ? `|${lbl(`${bad ? '⚠ ' : ''}${e.countCur}`)}|` : ''} ${id(e.to)}`);
      if (bad) styles.push(`  linkStyle ${i} stroke:#EA580C,stroke-width:3px`);
    });
    push(...lines, ...styles, '```', '');
    if (mods.length > shown.length) push(`_The ${MAX_MAP} most connected modules are drawn; all ${mods.length} are in the table._`, '');
  }
  if (mods.length) {
    push('| Module | Files | Imports from | Used by | npm packages |', '|---|---|---|---|---|');
    const npm = (m) => model.edges.filter((e) => e.external && e.from === m && live(e)).map((e) => e.to.replace(/^npm:/, ''));
    for (const n of mods.slice().sort((p, r) => p.id.localeCompare(r.id))) {
      push(`| **${cell(n.id)}** | ${n.filesCur} | ${cell(edges.filter((e) => e.from === n.id).map((e) => e.to).join(', ') || '–')} | ${cell(edges.filter((e) => e.to === n.id).map((e) => e.from).join(', ') || '–')} | ${cell(list(npm(n.id), 8) || '–')} |`);
    }
    push('');
  }
  // file diagrams per module (inside <details> so the page stays short)
  const F = model.files;
  if (F && F.files.length) {
    const files = F.files.map(([p, m, st], i) => ({ i, p, m, st })).filter((f) => f.st !== 'r');
    const deps = F.deps.filter((d) => d[2] !== 'r');
    const byMod = new Map();
    files.forEach((f) => { if (!byMod.has(f.m)) byMod.set(f.m, []); byMod.get(f.m).push(f); });
    const candidates = mods.filter((n) => (byMod.get(n.id) || []).length >= 2 && (byMod.get(n.id) || []).length <= MAX_MODULE_FILES).sort((p, r) => p.id.localeCompare(r.id)).slice(0, MAX_FILE_MAPS);
    if (candidates.length) {
      push('### Inside each module', '', 'Files and how they import each other; boxes with a dashed border are other modules.', '');
      const fileOf = new Map(F.files.map(([p, m], i) => [i, { p, m }]));
      for (const n of candidates) {
        const own = byMod.get(n.id);
        const ownIdx = new Set(own.map((f) => f.i));
        const id = idMaker('x');
        const nodes = [];
        const lines = [];
        const common = own.map((f) => f.p.split('/').slice(0, -1).join('/')).reduce((acc, d) => { while (acc && d !== acc && !d.startsWith(`${acc}/`)) acc = acc.split('/').slice(0, -1).join('/'); return acc; });
        const short = (p) => (common ? p.slice(common.length + 1) : p);
        for (const f of own) nodes.push(`  ${id(f.p)}[${lbl(short(f.p))}]`);
        const outer = new Set();
        const seenE = new Set();
        for (const [a, b] of deps) {
          if (!ownIdx.has(a)) continue;
          const to = fileOf.get(b);
          const key = ownIdx.has(b) ? `${a}>${b}` : `${a}>${to.m}`;
          if (seenE.has(key)) continue;
          seenE.add(key);
          if (ownIdx.has(b)) lines.push(`  ${id(fileOf.get(a).p)} --> ${id(to.p)}`);
          else { outer.add(to.m); lines.push(`  ${id(fileOf.get(a).p)} -.-> ${id(`mod:${to.m}`)}`); }
        }
        for (const m of [...outer].sort()) nodes.push(`  ${id(`mod:${m}`)}[${lbl(m)}]:::ext`);
        push(`<details><summary><b>${n.id}</b> · ${plural(own.length, 'file')}${common ? ` in <code>${common}/</code>` : ''}</summary>`, '');
        push('```mermaid', 'flowchart LR', ...nodes, ...lines, '  classDef ext stroke:#8C8A85,stroke-dasharray:4 3', '```', '', '</details>', '');
      }
    }
  }

  // ---------------------------------------------------------------- rules
  push('## Rules', '');
  const breaks = model.violations.filter((v) => v.status !== 'fixed');
  if (model.rules.length) {
    push('| Rule | Status |', '|---|---|');
    for (const r of model.rules) {
      const mine = breaks.filter((v) => v.rule === r.key);
      push(`| ${cell(r.key)}${r.message ? ` <br/><sub>${cell(r.message)}</sub>` : ''} | ${mine.length ? `${r.severity === 'error' ? '❌' : '⚠️'} ${plural(mine.length, 'break')}` : '✅ passes'} |`);
    }
    push('');
  }
  if (breaks.length) {
    push('| Break | Where | For example |', '|---|---|---|');
    for (const v of breaks.slice(0, MAX_LIST)) push(`| ${cell(v.rule)} | ${cell(v.kind === 'cycle' ? (v.members || []).join(' ⇄ ') : `${v.from} → ${v.to}`)} | ${v.imports[0] ? code(`${v.imports[0].file}:${v.imports[0].line}`) : '–'} |`);
    push('');
  }
  if (!model.ruleCount) push(`_No house rules yet. Add some ("components must not use db") with ${code('npx tecton init')}; loops between modules are always checked._`, '');

  // ---------------------------------------------------------------- docs already in the folder
  push('## Further reading', '');
  const docs = opts.docs || [];
  if (docs.length) {
    push('Docs found in this folder:', '');
    for (const d of docs.slice(0, 80)) push(`- [${d.title.replace(/[[\]]/g, '')}](${encodeURI(d.path)})${d.title !== path.posix.basename(d.path) ? ` · ${code(d.path)}` : ''}`);
    if (docs.length > 80) push(`- …and ${docs.length - 80} more`);
    push('');
  } else push('_No other Markdown docs in this folder._', '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** The project's one-paragraph description: package.json "description", else README's first real paragraph. */
export function aboutOf(readme, pkgDescription) {
  if (pkgDescription) return pkgDescription;
  if (!readme) return null;
  for (const block of readme.replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || /^(#|!\[|\[!\[|<|```|>|\||[-*] )/.test(t)) continue; // headings, badges, html, code, quotes, tables, lists
    return t.replace(/\s*\n\s*/g, ' ');
  }
  return null;
}

/** A Markdown file's title: its first heading, else the file name. */
export function docTitle(file, text) {
  const m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(text || '') || /^title:\s*["']?(.+?)["']?\s*$/m.exec(text || '');
  return m ? m[1].replace(/[*_`]/g, '').trim() : path.posix.basename(file);
}
