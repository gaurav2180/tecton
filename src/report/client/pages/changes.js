// Changes page.
import { $, h, icon, short } from '../lib/dom.js';
import { changes, hasBase, violEdges } from '../lib/data.js';
import { baseShort } from '../ui/shell.js';
import { kindBadge, tabs } from '../ui/common.js';
import { goSelect } from './map.js';

// ------------------------------------------------------------------ changes page
function renderChanges() {
  const pg = $('#page-changes');
  pg.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', { text: 'Changes' }), h('p', { text: hasBase ? `Every module and dependency that differs from ${baseShort()}.` : 'Nothing to compare against — run Tecton inside a git repo with a main branch.' }))));
  if (!hasBase) {
    pg.append(h('div', { class: 'card' }, h('div', { class: 'empty-state' }, h('div', { class: 'ico-box' }, icon('compare')), h('h4', { text: 'No comparison' }), h('p', { text: 'Commit your code to git and create a main branch, or pass --base <branch>.' }))));
    return;
  }
  let filter = 'all';
  let q = '';
  const count = (k) => changes.filter((c) => k === 'all' || c.kind === k).length;
  const t = tabs([
    { value: 'all', label: 'All', count: count('all') },
    { value: 'added', label: 'Added', count: count('added') },
    { value: 'removed', label: 'Removed', count: count('removed') },
    { value: 'changed', label: 'Changed', count: count('changed') },
  ], filter, (v) => { filter = v; draw(); });
  const inp = h('input', { type: 'search', placeholder: 'Filter by module…', 'aria-label': 'Filter changes', on: { input: (e) => { q = e.target.value.toLowerCase(); draw(); } } });
  const tbody = h('tbody');
  const card = h('div', { class: 'card' }, h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', { text: 'Change' }), h('th', { text: 'What' }), h('th', { class: 'r', text: 'Imports' }), h('th', { text: 'Rules' }), h('th'))),
    tbody)));
  const empty = h('div', { class: 'empty-state', style: { display: 'none' } }, h('div', { class: 'ico-box' }, icon('search')), h('h4', { text: 'No matching changes' }), h('p', { text: 'Try a different filter.' }));
  card.appendChild(empty);
  function draw() {
    tbody.innerHTML = '';
    const rows = changes.filter((c) => (filter === 'all' || c.kind === filter) && (!q || c.label.toLowerCase().includes(q)));
    rows.forEach((c, i) => {
      const e = c.edge;
      const vs = e ? (violEdges.cur.get(e.id) || []) : [];
      const tr = h('tr', { class: 'click enter', style: { animationDelay: `${Math.min(i, 12) * 0.025}s` }, on: { click: () => goSelect({ type: c.type, id: c.id }) } },
        h('td', null, kindBadge(c.kind)),
        h('td', null, h('div', { class: 'cell-mod' }, h('span', { class: `ico-box ${c.viol ? 'viol' : c.kind === 'added' ? 'add' : c.kind === 'removed' ? 'rem' : 'chg'}`, style: { width: '26px', height: '26px' } }, icon(c.type === 'node' ? 'box' : 'link')),
          c.type === 'node' ? h('span', null, c.label, h('span', { class: 'faint', text: c.kind === 'added' ? ' · new module' : ' · module removed' }))
            : h('span', null, short(e.from), h('span', { class: 'arrow', text: ' → ' }), short(e.to)))),
        h('td', { class: 'r num mono' }, c.type === 'node' ? h('span', { class: 'faint', text: c.sub }) : e.status === 'same' ? `${e.countBase} → ${e.countCur}` : e.status === 'added' ? `+${e.countCur}` : `−${e.countBase}`),
        h('td', null, vs.length ? vs.map((v) => h('span', { class: `badge ${v.status === 'new' ? (v.severity === 'error' ? 'critical' : 'warn') : 'neutral'}`, text: v.rule, style: { marginRight: '4px' } })) : h('span', { class: 'faint', text: '—' })),
        h('td', { class: 'r' }, icon('right', 'faint')));
      tbody.appendChild(tr);
    });
    empty.style.display = rows.length ? 'none' : 'block';
  }
  draw();
  pg.append(h('div', { class: 'toolbar' }, t, h('label', { class: 'input' }, icon('search'), inp)), card);
}

export { renderChanges };
