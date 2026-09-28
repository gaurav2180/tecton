// Other ways to look at the architecture (the C4 container diagram lives in architecture.js):
//   tiers   horizontal bands: people, this repo's apps, data & queues, outside systems.
//           Hover anything to see what it talks to.
//   matrix  a grid of who talks to what: rows are the callers, columns what they call.
// Both follow Changes / Before / After and open the same side sheet as the diagram.
import { $$, h, icon } from '../lib/dom.js';
import { D, hasBase, state } from '../lib/data.js';
import { SYS, appColor, appIcon, appLabel, entrySummary, openSys, statusTag, storeIcon, svcById, visible } from './architecture.js';

/** @typedef {import('../../../types').App} App @typedef {import('../../../types').Store} Store @typedef {import('../../../types').OutsideDiff} Outside */

const ARCH_VIEWS = [
  { value: 'diagram', label: 'Diagram' },
  { value: 'tiers', label: 'Tiers' },
  { value: 'matrix', label: 'Matrix' },
];

const inDiff = () => state.view === 'diff' && hasBase;
const stCls = (x) => (inDiff() && x.status && x.status !== 'same' ? ` s-${x.status}` : '');
const outsideIcon = (x) => ({ Email: 'mail', 'Web / HTTP': 'globe' }[x.kind] || 'cloud');
const hostsOf = (x) => (x.hosts || []).map((hh) => (typeof hh === 'string' ? hh : hh.host));

/** Everything a node talks to, both ways (visible links only). */
function neighbours(id) {
  const out = new Set([id]);
  for (const l of SYS.links) if (visible(l) && (l.from === id || l.to === id)) { out.add(l.from); out.add(l.to); }
  return out;
}

// ------------------------------------------------------------------ tiers
function renderTiers(box) {
  const wrap = h('div', { class: 'tiers' });
  const hl = (id) => {
    wrap.classList.toggle('hl-on', !!id);
    const near = id ? neighbours(id) : null;
    $$('.tile', wrap).forEach((t) => t.classList.toggle('hl', !!near && near.has(t.dataset.id)));
  };
  /** @param {string} id @param {string} ic @param {string} name @param {string} sub @param {any} x @param {(() => void) | null} open @param {string} [color] */
  const tile = (id, ic, name, sub, x, open, color) => h(open ? 'button' : 'div', {
    class: `tile${stCls(x)}`, dataset: { id }, style: color ? { '--app': color } : null, title: open ? `${name}: details` : null,
    on: { click: open || (() => {}), mouseenter: () => hl(id), mouseleave: () => hl(null), focus: () => hl(id), blur: () => hl(null) },
  },
  h('span', { class: `ico-box${color ? ' app-ico' : ''}` }, icon(ic)),
  h('span', { class: 'tile-t' }, h('b', { text: name }), sub ? h('span', { class: 'faint', text: sub }) : null),
  statusTag(x));
  const tier = (title, sub, tiles, cls) => (tiles.length ? h('section', { class: `tier${cls ? ` ${cls}` : ''}` },
    h('div', { class: 'tier-h' }, h('b', { text: title }), sub ? h('span', { class: 'faint', text: sub }) : null),
    h('div', { class: 'tier-b' }, tiles)) : null);
  const count = (kind) => SYS.links.filter((l) => l.kind === kind && visible(l)).length;
  const between = (text) => h('div', { class: 'tier-gap', 'aria-hidden': 'true' }, icon('arrowRight'), h('span', { text }));

  const apps = SYS.apps.filter(visible);
  const stores = SYS.stores.filter(visible);
  const outside = SYS.outside.filter(visible);
  const people = SYS.hasUsers ? [tile('users', 'users', 'Users', 'Browser & API clients', { status: 'same' }, null)] : [];
  const appTiles = apps.map((a) => tile(a.id, appIcon(a), a.name, [a.framework, entrySummary(a)].filter(Boolean).join(' · '), a, () => openSys({ type: 'app', id: a.id }), appColor(a.id)));
  const storeTiles = stores.map((x) => tile(x.id, storeIcon(x), x.name, `${x.kind} · ${x.via.join(', ')}`, x, () => openSys({ type: 'svc', id: x.id })));
  const outTiles = outside.map((x) => tile(x.id, outsideIcon(x), x.name, x.id.startsWith('env:') ? `set by ${x.via[0] || 'an env var'}` : hostsOf(x).join(', ') || x.kind, x, () => openSys({ type: 'svc', id: x.id })));
  const calls = count('app');
  wrap.append(...[
    tier('People', 'who uses it', people),
    people.length ? between(`use ${appTiles.length === 1 ? 'the app' : 'the apps'} over HTTPS`) : null,
    tier('Apps', `this repo · ${D.project}${calls ? ` · ${calls} app-to-app ${calls === 1 ? 'call' : 'calls'}` : ''}`, appTiles, 'boundary'),
    storeTiles.length ? between(`read and write ${count('data')} ${count('data') === 1 ? 'time' : 'times'} into`) : null,
    tier('Data & queues', 'kept by the apps', storeTiles),
    outTiles.length ? between(`call ${outTiles.length} outside ${outTiles.length === 1 ? 'system' : 'systems'}`) : null,
    tier('Outside systems', 'run by someone else', outTiles),
  ].filter(Boolean));
  box.append(h('div', { class: 'alt-note' }, h('b', { text: 'How to read it: ' }), 'each band is one layer of the system, from the people who use it down to the services it depends on. Hover anything to light up what it talks to; click for details.'), wrap);
}

// ------------------------------------------------------------------ matrix
/** A short verb for a grid cell; the full label is in the tooltip. */
function cellText(l) {
  if (l.kind === 'users') return 'uses';
  if (l.kind === 'app') return 'HTTP';
  if (l.kind === 'data') {
    const x = svcById.get(l.to);
    if (l.labels.length) return l.labels.map((t) => t.replace(' jobs', '')).join(' + ');
    return x && x.kind === 'Queue' ? 'msgs' : 'r/w';
  }
  return l.to.startsWith('svc:') ? 'SDK' : l.to.startsWith('env:') ? 'env' : 'HTTPS';
}

function renderArchMatrix(box) {
  const apps = SYS.apps.filter(visible);
  const calledApps = apps.filter((a) => SYS.links.some((l) => l.kind === 'app' && l.to === a.id && visible(l)));
  /** @type {{ title: string, cols: { id: string, name: string, ic: string, x: any }[] }[]} */
  const groups = [
    { title: 'Apps', cols: calledApps.map((a) => ({ id: a.id, name: a.name, ic: appIcon(a), x: a })) },
    { title: 'Data & queues', cols: SYS.stores.filter(visible).map((x) => ({ id: x.id, name: x.name, ic: storeIcon(x), x })) },
    { title: 'Outside systems', cols: SYS.outside.filter(visible).map((x) => ({ id: x.id, name: x.name, ic: outsideIcon(x), x })) },
  ].filter((g) => g.cols.length);
  const cols = groups.flatMap((g) => g.cols);
  const rows = [...(SYS.hasUsers ? [{ id: 'users', name: 'Users', ic: 'users', x: { status: 'same' } }] : []), ...apps.map((a) => ({ id: a.id, name: a.name, ic: appIcon(a), x: a }))];
  const linkOf = new Map(SYS.links.filter(visible).map((l) => [`${l.from}→${l.to}`, l]));
  const openCol = (c) => (c.id.startsWith('store:') || c.id.startsWith('svc:') || c.id.startsWith('web:') || c.id.startsWith('env:') ? openSys({ type: 'svc', id: c.id }) : openSys({ type: 'app', id: c.id }));
  const table = h('table', { class: 'amx', 'aria-label': 'Who talks to what: rows call the columns' },
    h('thead', null,
      h('tr', null, h('th', { class: 'amx-corner', rowspan: 2 }, h('span', { text: 'calls →' }), h('span', { text: '↓ from' })),
        groups.map((g) => h('th', { class: 'amx-group', colspan: g.cols.length, text: g.title }))),
      h('tr', null, cols.map((c, j) => h('th', { class: `amx-col${stCls(c.x)}`, dataset: { c: j }, title: c.name },
        h('button', { on: { click: () => openCol(c) } }, h('span', { class: 'amx-rot', text: c.name })))))),
    h('tbody', null, rows.map((r) => h('tr', null,
      h('th', { class: `amx-row${stCls(r.x)}`, scope: 'row' },
        r.id === 'users' ? h('span', { class: 'amx-rh' }, icon('users'), 'Users')
          : h('button', { class: 'amx-rh', on: { click: () => openSys({ type: 'app', id: r.id }) } }, icon(r.ic), r.name)),
      cols.map((c, j) => {
        const l = linkOf.get(`${r.id}→${c.id}`);
        if (!l) return h('td', { class: 'amx-empty', dataset: { c: j } });
        const st = inDiff() && l.status && l.status !== 'same' ? ` ${l.status}` : '';
        const label = l.labels.length ? l.labels.join(' · ') : cellText(l);
        return h('td', { class: `amx-cell k-${l.kind}${st}`, dataset: { c: j }, tabindex: 0, role: 'button', title: `${appLabel(r.id)} → ${c.name}: ${label}${st ? ` (${l.status})` : ''}`,
          on: { click: () => openCol(c), keydown: (ev) => { if (ev.key === 'Enter') openCol(c); } } }, cellText(l));
      })))));
  table.addEventListener('pointerover', (ev) => {
    const td = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('td, th'));
    $$('.hc', table).forEach((el) => el.classList.remove('hc'));
    if (!td || td.dataset.c == null) return;
    td.parentElement.classList.add('hc');
    $$(`[data-c="${td.dataset.c}"]`, table).forEach((el) => el.classList.add('hc'));
  });
  table.addEventListener('pointerleave', () => $$('.hc', table).forEach((el) => el.classList.remove('hc')));
  box.append(
    h('div', { class: 'alt-note' }, h('b', { text: 'How to read it: ' }), 'each row is a caller, each column something it calls; the cell says how (HTTP, SQL reads & writes, queue jobs, an SDK). Click a column or cell for the exact lines.'),
    h('div', { class: 'amx-wrap' }, table));
}

/** Draw the chosen non-diagram view into `box`. */
function renderArchAlt(box) {
  if (!box) return;
  box.innerHTML = '';
  if (state.archView === 'tiers') renderTiers(box);
  else if (state.archView === 'matrix') renderArchMatrix(box);
}

export { ARCH_VIEWS, renderArchAlt };
