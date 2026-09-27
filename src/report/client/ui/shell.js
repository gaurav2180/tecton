// Theme, toasts, the sidebar and the top bar.
import { $, $$, TECTON_MARK, ago, h, icon, s, store } from '../lib/dom.js';
import { D, PAGES, changes, curViols, failing, hasBase, internalNodes } from '../lib/data.js';
import { copySummary } from './export.js';
import { openPalette } from './palette.js';

// ------------------------------------------------------------------ theme
function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
  store.set('theme', mode);
  $$('.theme-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}
const currentTheme = () => store.get('theme') || 'system';

// ------------------------------------------------------------------ toasts
function toast(msg, ic = 'check') {
  const t = h('div', { class: 'toast', role: 'status' }, icon(ic), msg);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 2600);
}

// ------------------------------------------------------------------ sidebar & top bar
function badgeFor(p) {
  if (p === 'rules') return curViols.length ? h('span', { class: `count${failing ? ' bad' : ''}` }, curViols.length) : null;
  if (p === 'changes') return hasBase ? h('span', { class: 'count' }, changes.length) : null;
  if (p === 'system') return (D.system && hasBase && (D.system.summary.entry.added + D.system.summary.outside.added + D.system.summary.stores.added + D.system.summary.apps.added)) ? h('span', { class: 'count', text: 'new' }) : null;
  if (p === 'modules') return h('span', { class: 'count' }, internalNodes.filter((n) => n.status !== 'removed').length);
  return null;
}
function renderSidebar() {
  const sb = $('#sidebar');
  const initials = D.project.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AD';
  sb.append(
    h('div', { class: 'logo' },
      h('div', { class: 'logo-mark', 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 64 64', html: TECTON_MARK })),
      h('b', { text: 'tecton' }),
      h('span', { class: 'ver', text: `v${D.version || '0'}` })),
    h('div', { class: 'project' },
      h('div', { class: 'name' }, h('span', { class: 'avatar', text: initials }), h('span', { text: D.project, title: D.project })),
      h('div', { class: 'compare' }, icon('branch'),
        h('span', { class: 'ref', text: D.curLabel, title: D.curLabel }),
        hasBase ? [h('span', { class: 'vs', text: 'vs' }), h('span', { class: 'ref', text: baseShort(), title: D.baseLabel })] : [h('span'), h('span', { class: 'faint', text: 'snapshot only' })])),
    h('div', { class: 'nav-label', text: 'Report' }),
    h('nav', { class: 'nav', 'aria-label': 'Pages' },
      PAGES.map((p) => h('a', { href: `#${p.id}`, dataset: { page: p.id } }, icon(p.icon), h('span', { text: p.title }), badgeFor(p.id)))),
    h('div', { class: 'side-foot' },
      h('div', { class: 'theme-seg', role: 'group', 'aria-label': 'Theme' },
        [['system', 'monitor', 'System theme'], ['light', 'sun', 'Light theme'], ['dark', 'moon', 'Dark theme']].map(([m, ic, lbl]) =>
          h('button', { dataset: { mode: m }, 'aria-label': lbl, title: lbl, on: { click: () => applyTheme(m) } }, icon(ic)))),
      h('div', { class: 'gen' }, icon('clock'), h('span', { text: `Generated ${ago(D.generatedAt)}` }))));
  $$('.nav a', sb).forEach((a) => a.addEventListener('click', () => closeSidebar()));
}
function baseShort() { return (D.baseLabel || '').replace(/\s*\(.*$/, ''); }
function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); }

function renderTopbar() {
  const tb = $('#topbar');
  tb.append(
    h('button', { class: 'btn icon ghost menu-btn', 'aria-label': 'Open menu', on: { click: openSidebar } }, icon('menu')),
    h('div', { class: 'crumbs' },
      h('span', { class: 'muted hide-sm', text: D.project }),
      h('span', { class: 'sep hide-sm', text: '/' }),
      h('span', { class: 'cur', id: 'crumb-cur', text: 'Overview' })),
    h('div', { class: 'top-actions' },
      h('button', { class: 'search-btn', on: { click: openPalette }, 'aria-label': 'Search' },
        icon('search'), h('span', { class: 'lbl-t', text: 'Search modules, rules…' }), h('span', { class: 'kbd', text: navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K' })),
      h('span', { class: `status-pill ${failing ? 'fail' : 'pass'}`, title: failing ? 'This change would fail the CI check' : 'This change passes the CI check' },
        h('span', { class: 'pulse' }), h('span', { class: 'lbl-t', text: failing ? 'Check failing' : 'Check passing' })),
      h('button', { class: 'btn', on: { click: copySummary } }, icon('copy'), h('span', { class: 'lbl-t', text: 'Copy PR summary' }))));
}

export { applyTheme, currentTheme, toast, badgeFor, renderSidebar, baseShort, openSidebar, closeSidebar, renderTopbar };
