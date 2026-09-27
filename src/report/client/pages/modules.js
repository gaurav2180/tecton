// Modules table page.
import { $, $$, h, icon, short } from '../lib/dom.js';
import { D, canScope, hasBase, nodeStats } from '../lib/data.js';
import { kindBadge, statusBadge } from '../ui/common.js';
import { goSelect } from './map.js';
import { goModule } from './module.js';

// ------------------------------------------------------------------ modules page
function renderModules() {
  const pg = $('#page-modules');
  pg.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', { text: 'Modules' }), h('p', { text: 'Each folder Tecton treats as one part of the app, with how much it uses and is used. Open one to see its files.' }))));
  let sort = { k: 'files', dir: -1 };
  let q = '';
  let onlyTouched = false;
  const rowsData = D.nodes.map((n) => ({ n, ...nodeStats.get(n.id), files: n.status === 'removed' ? n.filesBase : n.filesCur, edited: n.touched || 0 }));
  const maxF = Math.max(1, ...rowsData.map((r) => r.files));
  const cols = [['name', 'Module'], ['status', 'Status'], ['files', 'Files'], ...(canScope ? [['edited', 'Edited']] : []), ['uses', 'Uses'], ['usedBy', 'Used by'], ['viol', 'Rule breaks']];
  const thead = h('tr');
  cols.forEach(([k, label]) => thead.appendChild(h('th', { class: `sortable${k === 'uses' || k === 'usedBy' || k === 'viol' || k === 'edited' ? ' r' : ''}`, dataset: { k }, on: { click: () => { sort = { k, dir: sort.k === k ? -sort.dir : (k === 'name' ? 1 : -1) }; draw(); } } }, label, h('span', { class: 'sort' }))));
  const tbody = h('tbody');
  const inp = h('input', { type: 'search', placeholder: 'Search modules…', 'aria-label': 'Search modules', on: { input: (e) => { q = e.target.value.toLowerCase(); draw(); } } });
  function val(r, k) { return k === 'name' ? r.n.id : k === 'status' ? r.n.status : r[k]; }
  function draw() {
    $$('th', thead.parentNode || thead).forEach((th) => { const sp = $('.sort', th); if (sp) sp.textContent = th.dataset.k === sort.k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''; });
    tbody.innerHTML = '';
    rowsData.filter((r) => (!q || r.n.id.toLowerCase().includes(q)) && (!onlyTouched || r.edited))
      .sort((a, b) => { const x = val(a, sort.k); const y = val(b, sort.k); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir || a.n.id.localeCompare(b.n.id); })
      .forEach((r, i) => {
        const n = r.n;
        const open = () => (n.external ? goSelect({ type: 'node', id: n.id }) : goModule(n.id));
        tbody.appendChild(h('tr', { class: 'click enter', tabindex: 0, style: { animationDelay: `${Math.min(i, 12) * 0.02}s` }, on: { click: open, keydown: (e) => { if (e.key === 'Enter') open(); } } },
          h('td', null, h('div', { class: 'cell-mod' }, h('span', { class: `ico-box ${n.status === 'added' ? 'add' : n.status === 'removed' ? 'rem' : ''}`, style: { width: '26px', height: '26px' } }, icon(n.external ? 'pkg' : 'box')), short(n.id), n.external ? h('span', { class: 'faint', text: ' · npm' }) : null)),
          h('td', null, hasBase && n.status !== 'same' ? kindBadge(n.status) : h('span', { class: 'faint', text: n.external ? 'Package' : 'Unchanged' })),
          h('td', { class: 'num' }, n.external ? h('span', { class: 'faint', text: '—' }) : [h('span', { class: 'mini-bar' }, h('i', { style: { width: `${(r.files / maxF) * 100}%` } })), hasBase && n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur}` : String(r.files)]),
          canScope ? h('td', { class: 'r num' }, r.edited ? h('span', { class: 'chip acc', text: String(r.edited) }) : h('span', { class: 'faint', text: '0' })) : null,
          h('td', { class: 'r num', text: r.uses }),
          h('td', { class: 'r num', text: r.usedBy }),
          h('td', { class: 'r' }, r.viol ? statusBadge('serious', String(r.viol)) : h('span', { class: 'faint', text: '0' }))));
      });
  }
  const table = h('table', null, h('thead', null, thead), tbody);
  const touchSw = canScope ? h('label', { class: 'switch' }, h('input', { type: 'checkbox', on: { change: (e) => { onlyTouched = e.target.checked; draw(); } } }), 'Only modules this change touches') : null;
  pg.append(h('div', { class: 'toolbar' }, h('label', { class: 'input' }, icon('search'), inp), touchSw), h('div', { class: 'card' }, h('div', { class: 'tbl-wrap' }, table)));
  draw();
}

export { renderModules };
