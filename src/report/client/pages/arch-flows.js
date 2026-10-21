// Flows: what each entry point does, step by step. The CLI traced every page, route, endpoint, job,
// schedule and queue worker through its own handler and the files it imports (src/system.js, traceFlows);
// here a flow is drawn as a tree: the trigger, the entry point, then every store, service and other app
// it reaches. A call to another route continues into that route's flow; a job put on a queue continues
// into the worker that runs it. Every step shows the line that does it and the files that lead there.
import { h, icon, plural } from '../lib/dom.js';
import { D, hasBase, state } from '../lib/data.js';
import { GROUPS, SYS, appById, appColor, appIcon, openSys, outsideIcon, setArchView, storeIcon, svcById, visible } from './architecture.js';
import { goModule } from './module.js';
import { go } from '../ui/router.js';

/** @typedef {import('../../../types').App} App @typedef {import('../../../types').EntryPoint} Entry @typedef {import('../../../types').FlowStep} Step */
/** @typedef {{ app: App, g: typeof GROUPS[number], e: Entry, id: string }} Ref */

const fl = { sel: /** @type {string | null} */ (null), q: '' };
const MAX_DEPTH = 4;
const inDiff = () => state.view === 'diff' && hasBase;
const stCls = (x) => (inDiff() && x.status && x.status !== 'same' ? ` s-${x.status}` : '');
const badge = (x) => (inDiff() && x.status && x.status !== 'same' ? h('span', { class: `badge ${x.status === 'added' ? 'add' : 'rem'}`, text: x.status === 'added' ? 'New' : 'Removed' }) : null);
const steps = (e) => (e.flow || []).filter(visible);
const base = (f) => f.split('/').pop();

/** @returns {Ref[]} every visible entry point, app by app */
function allEntries() {
  const out = [];
  for (const a of SYS.apps.filter(visible)) {
    for (const g of GROUPS) for (const e of (a.groups[g.key] || []).filter(visible)) out.push({ app: a, g, e, id: `${a.id}|${g.key}|${e.key}` });
  }
  return out;
}
/** The route or endpoint a step calls. */
function endpointRef(appId, key) {
  const a = appById.get(appId);
  if (!a) return null;
  for (const gk of ['api', 'endpoints']) {
    const e = (a.groups[gk] || []).find((x) => x.key === key);
    if (e) return { app: a, g: GROUPS.find((x) => x.key === gk), e, id: `${a.id}|${gk}|${e.key}` };
  }
  return null;
}
/** Who sets this entry point off: callers of a route, producers for a queue worker. */
function callersOf(ref, all) {
  if (ref.g.key === 'workers') return all.filter((r) => steps(r.e).some((s) => s.to === ref.e.queue && s.label === 'adds jobs'));
  if (ref.g.key === 'api' || ref.g.key === 'endpoints') return all.filter((r) => r.id !== ref.id && steps(r.e).some((s) => s.to === ref.app.id && s.ep === ref.e.key));
  return [];
}
function trigger(ref) {
  const { g, e } = ref;
  if (g.key === 'pages') return { ic: 'users', text: 'A user opens this page' };
  if (g.key === 'api' || g.key === 'endpoints') return { ic: 'globe', text: 'An HTTP request arrives' };
  if (g.key === 'jobs') return { ic: 'terminal', text: `Someone runs npm run ${e.key}`, sub: e.cmd || null };
  if (g.key === 'schedules') return { ic: 'clock', text: `Runs ${e.human || 'on a schedule'}`, sub: e.cmd || e.label };
  return { ic: 'queue', text: `A job lands in the ${e.label}` };
}

/** A file:line that opens the module drill-down on that file. */
function codeRef(file, line) {
  const mod = D.nodes.find((n) => n.files.some((ff) => ff.path === file));
  const label = `${file}:${line}`;
  return mod
    ? h('button', { class: 'fl-code', title: `Open ${file} in module “${mod.id}”`, on: { click: () => goModule(mod.id, file) } }, label)
    : h('code', { class: 'fl-code', text: label });
}
function viaLine(s) {
  const last = s.via[s.via.length - 1];
  const chain = s.via.length > 1 ? s.via.slice(0, -1).map(base).join(' → ') : null;
  return h('div', { class: 'fl-ev' }, codeRef(last, s.line), chain ? h('span', { class: 'faint', title: s.via.join('\n→ '), text: `via ${chain}` }) : null);
}

/** One step, and what happens after it (the called route's flow, the worker that runs the job). */
function stepItem(s, depth, seen, all) {
  const app = appById.get(s.to);
  const svc = svcById.get(s.to);
  const isStore = !!svc && SYS.stores.includes(svc);
  let ic; let verb; let name; let open;
  if (app) {
    ic = appIcon(app); verb = 'calls'; name = s.label && s.label !== 'HTTP' ? `${s.label} on ${app.name}` : app.name;
    open = () => openSys({ type: 'app', id: app.id });
  } else if (isStore) {
    ic = storeIcon(svc); verb = s.label === 'adds jobs' ? 'adds a job to' : svc.kind === 'Queue' ? 'sends messages to' : 'reads & writes'; name = svc.name;
    open = () => openSys({ type: 'svc', id: svc.id });
  } else {
    ic = svc ? outsideIcon(svc) : 'cloud'; verb = 'calls'; name = svc ? svc.name : s.to;
    open = svc ? () => openSys({ type: 'svc', id: svc.id }) : null;
  }
  const kids = [];
  if (depth < MAX_DEPTH) {
    const target = app && s.ep ? endpointRef(app.id, s.ep) : null;
    if (target && !seen.has(target.id)) kids.push(...steps(target.e).map((x) => stepItem(x, depth + 1, new Set(seen).add(target.id), all)));
    if (isStore && s.label === 'adds jobs') {
      for (const w of all.filter((r) => r.g.key === 'workers' && r.e.queue === s.to && !seen.has(r.id))) {
        kids.push(h('li', { class: 'fl-step fl-hand' },
          h('div', { class: 'fl-card' },
            h('span', { class: 'ico-box app-ico', style: { '--app': appColor(w.app.id) } }, icon('queue')),
            h('div', { class: 'fl-t' }, h('div', null, h('span', { class: 'fl-verb', text: 'then a worker in ' }), h('b', { text: w.app.name }), h('span', { class: 'fl-verb', text: ' runs the job' })), h('div', { class: 'fl-ev' }, codeRef(w.e.file, w.e.line)))),
          steps(w.e).length ? h('ol', { class: 'fl-steps' }, steps(w.e).map((x) => stepItem(x, depth + 1, new Set(seen).add(w.id), all))) : null));
      }
    }
  }
  return h('li', { class: `fl-step${stCls(s)}` },
    h('div', { class: 'fl-card' },
      h('span', { class: `ico-box${app ? ' app-ico' : ''}`, style: app ? { '--app': appColor(app.id) } : null }, icon(ic)),
      h('div', { class: 'fl-t' },
        h('div', null, h('span', { class: 'fl-verb', text: `${verb} ` }), open ? h('button', { class: 'fl-name', on: { click: open } }, name) : h('b', { text: name }), badge(s)),
        viaLine(s))),
    kids.length ? h('ol', { class: 'fl-steps' }, kids) : null);
}

function renderFlow(ref, all) {
  const { app, g, e } = ref;
  const t = trigger(ref);
  const callers = callersOf(ref, all);
  const list = steps(e);
  const title = `${e.methods && e.methods.length ? `${e.methods.join(' / ')} ` : ''}${e.label}`;
  return h('div', { class: 'fl-main' },
    h('div', { class: 'fl-head' },
      h('span', { class: 'ico-box app-ico', style: { '--app': appColor(app.id) } }, icon(g.icon)),
      h('div', { style: { minWidth: 0 } }, h('h3', { class: 'mono-s', text: title }), h('div', { class: 'faint', text: `${g.title.replace(/s$/, '').replace('Routes & API', 'Route')} in ${app.name} · ${e.file}:${e.line}` })),
      badge(e)),
    h('ol', { class: 'fl-steps fl-root' },
      h('li', { class: 'fl-step fl-trigger' },
        h('div', { class: 'fl-card' }, h('span', { class: 'ico-box' }, icon(t.ic)),
          h('div', { class: 'fl-t' }, h('b', { text: t.text }), t.sub ? h('div', { class: 'fl-ev' }, h('code', { class: 'fl-code', text: t.sub })) : null,
            callers.length ? h('div', { class: 'fl-callers' }, h('span', { class: 'faint', text: g.key === 'workers' ? 'Jobs come from ' : 'Called from ' }),
              callers.slice(0, 6).map((c) => h('button', { class: 'chip', on: { click: () => { fl.sel = c.id; rerender(); } } }, `${c.app.name} · ${c.e.methods && c.e.methods.length ? `${c.e.methods[0]} ` : ''}${c.e.label}`)),
              callers.length > 6 ? h('span', { class: 'faint', text: ` and ${callers.length - 6} more` }) : null) : null))),
      h('li', { class: `fl-step fl-entry${stCls(e)}` },
        h('div', { class: 'fl-card' }, h('span', { class: 'ico-box app-ico', style: { '--app': appColor(app.id) } }, icon(appIcon(app))),
          h('div', { class: 'fl-t' }, h('div', null, h('b', { text: app.name }), h('span', { class: 'fl-verb', text: ` runs ${title}` })), h('div', { class: 'fl-ev' }, codeRef(e.file, e.line)))),
        list.length
          ? h('ol', { class: 'fl-steps' }, list.map((s) => stepItem(s, 0, new Set([ref.id]), all)))
          : h('div', { class: 'fl-none', text: 'Its code doesn’t reach a data store, an outside service or another app that Tecton can see.' }))));
}

let box0 = null;
function rerender() { if (box0) renderFlows(box0); }

/** The Flows view: entry points on the left, the chosen one's flow on the right. */
function renderFlows(box) {
  box0 = box;
  box.innerHTML = '';
  const all = allEntries();
  if (!all.length) {
    box.append(h('div', { class: 'empty-state' }, h('div', { class: 'ico-box' }, icon('route')), h('h4', { text: 'No entry points found' }), h('p', { text: 'Flows start at pages, API routes, HTTP endpoints, npm scripts, cron schedules and queue workers.' })));
    return;
  }
  if (!all.some((r) => r.id === fl.sel)) fl.sel = all.reduce((best, r) => (steps(r.e).length > steps(best.e).length ? r : best), all[0]).id;
  const sel = all.find((r) => r.id === fl.sel);
  const q = fl.q.trim().toLowerCase();
  const shown = q ? all.filter((r) => `${r.app.name} ${r.e.label} ${(r.e.methods || []).join(' ')} ${r.e.file}`.toLowerCase().includes(q)) : all;
  const listBox = h('div', { class: 'fl-items' });
  let lastApp = null;
  for (const r of shown) {
    if (r.app !== lastApp) { lastApp = r.app; listBox.append(h('div', { class: 'fl-app' }, h('i', { class: 'dot', style: { background: appColor(r.app.id) } }), r.app.name)); }
    const n = steps(r.e).length;
    listBox.append(h('button', { class: `fl-item${r.id === fl.sel ? ' on' : ''}${stCls(r.e)}`, title: `${r.e.file}:${r.e.line}`, 'aria-current': r.id === fl.sel ? 'true' : null, on: { click: () => { fl.sel = r.id; rerender(); } } },
      r.e.methods && r.e.methods.length ? r.e.methods.map((m) => h('span', { class: `meth m-${m.toLowerCase()}`, text: m })) : icon(r.g.icon, 'faint'),
      h('span', { class: `grow${r.e.human ? '' : ' mono-s'}`, text: r.e.human || r.e.label }),
      h('span', { class: 'fl-n faint', title: plural(n, 'step'), text: n || '–' })));
  }
  if (!shown.length) listBox.append(h('div', { class: 'faint', style: { padding: '10px' }, text: 'Nothing matches.' }));
  const search = h('input', { class: 'fl-q', type: 'search', placeholder: `Filter ${plural(all.length, 'entry point')}`, value: fl.q, 'aria-label': 'Filter entry points' });
  search.addEventListener('input', () => {
    fl.q = search.value;
    const pos = search.selectionStart;
    rerender();
    const again = /** @type {HTMLInputElement} */ (box.querySelector('.fl-q'));
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  box.append(
    h('div', { class: 'alt-note' }, h('b', { text: 'How to read it: ' }), 'pick an entry point to see what happens when it runs, traced through its own code and the files it imports. A call to another route continues into that route; a job put on a queue continues into the worker that runs it. Every step names the line that does it.'),
    h('div', { class: 'flows' }, h('div', { class: 'fl-list' }, search, listBox), renderFlow(sel, all)));
}

/** Overview card: the entry points that do the most, each with what it reaches. Null when nothing was traced. */
function flowsGlance() {
  const all = allEntries().filter((r) => steps(r.e).length);
  if (!all.length) return null;
  const top = all.slice().sort((a, b) => steps(b.e).length - steps(a.e).length).slice(0, 5);
  const nameOf = (s) => (appById.get(s.to) ? `${appById.get(s.to).name}${s.label && s.label !== 'HTTP' ? ` ${s.label}` : ''}` : (svcById.get(s.to) || { name: s.to }).name);
  const open = (id) => { fl.sel = id; go('system'); setArchView('flows'); };
  return h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', { text: 'Request flows' }), h('div', { class: 'right' }, h('button', { class: 'link-btn', on: { click: () => open(fl.sel || top[0].id) } }, 'Open flows', icon('right')))),
    h('div', { class: 'list', style: { marginTop: '12px' } }, top.map((r) => h('button', { class: 'row-btn', on: { click: () => open(r.id) } },
      h('span', { class: 'ico-box app-ico', style: { '--app': appColor(r.app.id) } }, icon(r.g.icon)),
      h('span', { class: 'main-t' },
        h('div', { class: 't1 mono-s', text: `${r.e.methods && r.e.methods.length ? `${r.e.methods.join(' / ')} ` : ''}${r.e.human || r.e.label}` }),
        h('div', { class: 't2', text: `${r.app.name} → ${steps(r.e).map(nameOf).join(', ')}` }))))));
}

export { renderFlows, flowsGlance };
