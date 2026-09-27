// The ⌘K command palette.
import { $, $$, h, icon, plural, short } from '../lib/dom.js';
import { D, FILES, PAGES, hasBase, internalNodes, rules } from '../lib/data.js';
import { applyTheme, toast } from './shell.js';
import { openRule } from '../pages/rules.js';
import { GROUPS, appIcon, openSys } from '../pages/architecture.js';
import { goSelect } from '../pages/map.js';
import { copySummary, download, exportSvg } from './export.js';
import { goModule } from '../pages/module.js';
import { go } from './router.js';

// ------------------------------------------------------------------ command palette
const pal = { items: [], filtered: [], idx: 0 };
function buildPaletteItems() {
  const items = [];
  PAGES.forEach((p) => items.push({ group: 'Pages', label: p.title, icon: p.icon, run: () => go(p.id) }));
  internalNodes.forEach((n) => items.push({ group: 'Modules', label: n.id, hint: plural(n.status === 'removed' ? n.filesBase : n.filesCur, 'file'), icon: 'box', run: () => goSelect({ type: 'node', id: n.id }) }));
  D.edges.forEach((e) => items.push({ group: 'Dependencies', label: `${short(e.from)} → ${short(e.to)}`, hint: hasBase && e.status !== 'same' ? (e.status === 'added' ? 'new' : 'removed') : plural(e.countCur || e.countBase, 'import'), icon: 'link', run: () => goSelect({ type: 'edge', id: e.id }) }));
  (D.system ? D.system.apps : []).forEach((a) => items.push({ group: 'Architecture', label: `${a.name} (${a.framework} app)`, icon: appIcon(a), run: () => { go('system'); setTimeout(() => openSys({ type: 'app', id: a.id }), 60); } }));
  (D.system ? [...D.system.stores, ...D.system.outside] : []).forEach((x) => items.push({ group: 'Architecture', label: x.name, hint: x.kind, icon: D.system.stores.includes(x) ? 'database' : 'cloud', run: () => { go('system'); setTimeout(() => openSys({ type: 'svc', id: x.id }), 60); } }));
  FILES.slice(0, 5000).forEach((f) => items.push({ group: 'Files', label: f.path, hint: f.module, icon: 'file', run: () => goModule(f.module, f.path) }));
  (D.system ? D.system.apps : []).forEach((a) => GROUPS.forEach(({ key: g, icon: gi }) => (a.groups[g] || []).forEach((x) => items.push({ group: 'Entry points', label: `${x.methods && x.methods.length ? `${x.methods.join('/')} ` : ''}${x.label}`, hint: x.human ? `${x.human} · ${a.name}` : a.name, icon: gi, run: () => { go('system'); setTimeout(() => openSys({ type: 'item', app: a.id, group: g, key: x.key }), 60); } }))));
  rules.forEach((r) => items.push({ group: 'Rules', label: r.key, hint: { new: 'new break', existing: 'failing', fixed: 'fixed', pass: 'passing' }[r.state], icon: 'shield', run: () => { go('rules'); setTimeout(() => openRule(r.key), 50); } }));
  items.push({ group: 'Actions', label: 'Copy PR summary (Markdown)', icon: 'copy', run: copySummary });
  items.push({ group: 'Actions', label: 'Export map as SVG', icon: 'image', run: () => { go('map'); setTimeout(exportSvg, 80); } });
  items.push({ group: 'Actions', label: 'Download report data (JSON)', icon: 'download', run: () => { const { markdown, ...rest } = D; download(new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' }), `${D.project}-tecton.json`); toast('JSON downloaded', 'download'); } });
  items.push({ group: 'Actions', label: 'Switch to light theme', icon: 'sun', run: () => applyTheme('light') });
  items.push({ group: 'Actions', label: 'Switch to dark theme', icon: 'moon', run: () => applyTheme('dark') });
  items.push({ group: 'Actions', label: 'Use system theme', icon: 'monitor', run: () => applyTheme('system') });
  pal.items = items;
}
function score(label, q) {
  if (!q) return 1;
  const l = label.toLowerCase();
  const i = l.indexOf(q);
  if (i >= 0) return 100 - i;
  let pos = 0;
  for (const ch of q) { pos = l.indexOf(ch, pos); if (pos < 0) return 0; pos++; }
  return 10;
}
function openPalette() {
  const ov = $('#palette-ov');
  ov.innerHTML = '';
  const input = h('input', { placeholder: 'Search modules, files, rules, actions…', 'aria-label': 'Command palette search', autocomplete: 'off' });
  const list = h('div', { class: 'pal-list', role: 'listbox' });
  ov.append(h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Command palette' },
    h('div', { class: 'pal-in' }, icon('search'), input, h('span', { class: 'kbd', text: 'Esc' })),
    list,
    h('div', { class: 'pal-foot' }, h('span', null, h('span', { class: 'kbd', text: '↑↓' }), 'navigate'), h('span', null, h('span', { class: 'kbd', text: '↵' }), 'open'), h('span', null, h('span', { class: 'kbd', text: 'Esc' }), 'close'))));
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    pal.filtered = pal.items.map((it) => ({ it, sc: score(`${it.label} ${it.group}`, q) })).filter((x) => x.sc > 0)
      .sort((a, b) => (q ? b.sc - a.sc : 0)).map((x) => x.it);
    if (!q) pal.filtered = pal.items.filter((it) => it.group === 'Pages' || it.group === 'Actions' || it.group === 'Rules' || it.group === 'Architecture').concat(pal.items.filter((it) => it.group === 'Modules').slice(0, 6));
    const groups = ['Pages', 'Architecture', 'Rules', 'Modules', 'Files', 'Entry points', 'Dependencies', 'Actions'];
    pal.filtered.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group));
    pal.filtered = pal.filtered.slice(0, 60);
    pal.idx = Math.min(pal.idx, Math.max(0, pal.filtered.length - 1));
    list.innerHTML = '';
    if (!pal.filtered.length) { list.appendChild(h('div', { class: 'pal-empty', text: 'No results' })); return; }
    let last = null;
    pal.filtered.forEach((it, i) => {
      if (it.group !== last) { list.appendChild(h('div', { class: 'pal-group', text: it.group })); last = it.group; }
      const row = h('div', { class: `pal-item${i === pal.idx ? ' on' : ''}`, role: 'option', 'aria-selected': String(i === pal.idx), on: { mousemove: () => { if (pal.idx !== i) { pal.idx = i; mark(); } }, click: () => runItem(i) } },
        icon(it.icon), h('span', { class: 'grow', text: it.label }), it.hint ? h('span', { class: 'faint', style: { fontSize: '12px' }, text: it.hint }) : null, h('span', { class: 'enter', text: '↵' }));
      row.dataset.i = i;
      list.appendChild(row);
    });
  };
  const mark = () => {
    $$('.pal-item', list).forEach((r) => { const on = Number(r.dataset.i) === pal.idx; r.classList.toggle('on', on); r.setAttribute('aria-selected', String(on)); if (on) r.scrollIntoView({ block: 'nearest' }); });
  };
  const runItem = (i) => { const it = pal.filtered[i]; closePalette(); if (it) it.run(); };
  input.addEventListener('input', () => { pal.idx = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pal.idx = Math.min(pal.filtered.length - 1, pal.idx + 1); mark(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 1); mark(); }
    if (e.key === 'Enter') { e.preventDefault(); runItem(pal.idx); }
  });
  ov.onclick = (e) => { if (e.target === ov) closePalette(); };
  pal.idx = 0;
  draw();
  ov.classList.add('open');
  setTimeout(() => input.focus(), 10);
}
function closePalette() { $('#palette-ov').classList.remove('open'); }

export { pal, buildPaletteItems, score, openPalette, closePalette };
