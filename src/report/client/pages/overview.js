// Overview page.
import { $, esc, h, icon, plural, short } from '../lib/dom.js';
import { D, S, V, changes, curViols, failing, hasBase, internalNodes, rules } from '../lib/data.js';
import { baseShort } from '../ui/shell.js';
import { hideTip, kindBadge, ruleStateBadge, showTip } from '../ui/common.js';
import { openRule } from './rules.js';
import { systemGlance } from './architecture.js';
import { goSelect } from './map.js';
import { go } from '../ui/router.js';

// ------------------------------------------------------------------ overview
function renderOverview() {
  const pg = $('#page-overview');
  const newCount = V.newErrors + V.newWarnings;
  const heroTitle = !hasBase
    ? (failing ? `${plural(curViols.length, 'rule break')} in this codebase` : 'All architecture rules pass')
    : failing ? `This change breaks ${plural(V.newErrors, 'architecture rule')}` : newCount ? `No new errors, ${plural(V.newWarnings, 'new warning')}` : 'This change keeps the architecture clean';
  const heroText = !hasBase
    ? 'No git base was found, so this is a snapshot of the current code checked against your rules.'
    : failing ? 'New dependencies cross boundaries your team set in tecton.config.json. CI will fail until they are removed or the rules are updated.'
      : `Compared with ${baseShort()}, nothing crosses a boundary you have set.${V.fixed ? ` It also fixes ${plural(V.fixed, 'earlier rule break')}.` : ''}`;

  const hero = h('div', { class: `card hero ${failing ? 'fail' : 'pass'}` },
    h('div', { class: 'hero-icon' }, icon(failing ? 'alert' : 'check')),
    h('div', null,
      h('h2', { text: heroTitle }),
      h('p', { text: heroText }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', on: { click: () => go(curViols.length ? 'rules' : 'map') } }, icon(curViols.length ? 'shield' : 'map'), curViols.length ? 'Review rule breaks' : 'Open the map'),
        h('button', { class: 'btn', on: { click: () => go('changes') } }, icon('compare'), 'See all changes'))),
    h('div', { class: 'big' },
      h('div', { class: 'v num', dataset: { count: hasBase ? newCount : curViols.length }, text: '0' }),
      h('div', { class: 'l', text: hasBase ? 'new rule breaks' : 'rule breaks' })));

  const modDelta = hasBase ? [S.modules.added ? h('span', { class: 'chip add', text: `+${S.modules.added} new` }) : null, S.modules.removed ? h('span', { class: 'chip rem', text: `−${S.modules.removed} gone` }) : null] : [];
  const depDelta = hasBase ? [S.deps.added ? h('span', { class: 'chip add', text: `+${S.deps.added}` }) : null, S.deps.removed ? h('span', { class: 'chip rem', text: `−${S.deps.removed}` }) : null, S.deps.changed ? h('span', { class: 'chip chg', text: `${S.deps.changed} changed` }) : null] : [];
  const fileDelta = [
    hasBase && S.touched && S.touched.files ? h('span', { class: 'chip acc', text: `${S.touched.files} edited` }) : null,
    hasBase && S.files.cur !== S.files.base ? h('span', { class: 'chip', text: `${S.files.cur - S.files.base > 0 ? '+' : '−'}${Math.abs(S.files.cur - S.files.base)} vs ${baseShort()}` }) : null];
  const stat = (label, ic, value, delta, fallback) => h('div', { class: 'card stat' },
    h('div', { class: 'l' }, icon(ic), label),
    h('div', { class: 'v num', dataset: { count: value }, text: '0' }),
    h('div', { class: 'delta' }, delta.filter(Boolean).length ? delta : h('span', { class: 'faint', text: fallback })));
  const stats = h('div', { class: 'grid stats stagger' },
    stat('Modules', 'box', S.modules.total, modDelta, hasBase ? 'No modules added or removed' : 'Current snapshot'),
    stat('Dependencies', 'link', S.deps.total, depDelta, hasBase ? 'No links changed' : 'Links between modules'),
    stat('Rule breaks', 'shield', curViols.length, [
      V.newErrors ? h('span', { class: 'chip viol', text: `${V.newErrors} new` }) : null,
      V.existing ? h('span', { class: 'chip', text: `${V.existing} existing` }) : null,
      V.fixed ? h('span', { class: 'chip add', text: `${V.fixed} fixed` }) : null], `${rules.length} rules checked`),
    stat('Files analysed', 'file', S.files.cur, fileDelta, 'JS / TS source files'));

  // dependency change breakdown (stacked bar)
  const unchanged = D.edges.filter((e) => e.status === 'same' && e.countBase === e.countCur).length;
  const segs = [
    { k: 'Added', n: S.deps.added, c: 'var(--add)' },
    { k: 'Removed', n: S.deps.removed, c: 'var(--rem)' },
    { k: 'Import count changed', n: S.deps.changed, c: 'var(--chg)' },
    { k: 'Unchanged', n: unchanged, c: 'var(--neutral-bar)' },
  ];
  const totalSeg = segs.reduce((a, b) => a + b.n, 0) || 1;
  const depCard = h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', { text: 'Dependency changes' }), h('div', { class: 'right' }, h('button', { class: 'link-btn', on: { click: () => go('changes') } }, 'View all', icon('right')))),
    h('div', { class: 'card-b', style: { paddingBottom: '6px' } },
      h('div', { class: 'stackbar', role: 'img', 'aria-label': segs.map((x) => `${x.k}: ${x.n}`).join(', ') },
        segs.filter((x) => x.n).map((x, i) => h('span', {
          style: { width: `${(x.n / totalSeg) * 100}%`, background: x.c, animationDelay: `${i * 0.08}s` },
          on: { pointermove: (ev) => showTip(ev, `<div class="tt">${esc(x.k)}</div><div class="kv"><span>Dependencies</span><b>${x.n}</b></div><div class="kv"><span>Share</span><b>${Math.round((x.n / totalSeg) * 100)}%</b></div>`), pointerleave: hideTip },
        }))),
      h('div', { class: 'legend-row' }, segs.map((x) => h('span', null, h('i', { class: 'sw', style: { background: x.c } }), x.k, h('b', { class: 'num', text: x.n }))))),
    h('div', { class: 'list', style: { marginTop: '10px' } },
      changes.length ? changes.slice(0, 5).map(changeRow) : h('div', { class: 'card-b faint', text: hasBase ? 'The structure did not change.' : 'No comparison available.' })));

  const rulesCard = h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', { text: 'Rule checks' }), h('div', { class: 'right' }, h('button', { class: 'link-btn', on: { click: () => go('rules') } }, 'Details', icon('right')))),
    h('div', { class: 'list', style: { marginTop: '12px' } },
      rules.length ? rules.map((r) => h('button', { class: 'row-btn', on: { click: () => { go('rules'); openRule(r.key); } } },
        h('span', { class: `ico-box ${r.state === 'new' ? 'rem' : r.state === 'existing' ? 'viol' : 'good'}` }, icon(r.kind === 'cycle' ? 'cycle' : r.state === 'pass' || r.state === 'fixed' ? 'check' : 'alert')),
        h('span', { class: 'main-t' }, h('div', { class: 't1', text: r.key }), h('div', { class: 't2', text: ruleScope(r) })),
        ruleStateBadge(r.state))) : h('div', { class: 'card-b faint', text: 'No rules yet. Run `tecton init` in your project to add some, like "components must not use db". Loops between modules are checked already.' })));

  // preview + module sizes
  const preview = h('div', { class: 'preview', id: 'preview', role: 'link', tabindex: 0, 'aria-label': 'Open the architecture map', on: { click: () => go('map'), keydown: (e) => { if (e.key === 'Enter') go('map'); } } },
    h('button', { class: 'btn open', tabindex: -1 }, 'Open map', icon('arrowRight')));
  const previewCard = h('div', { class: 'card' }, h('div', { class: 'card-h', style: { paddingBottom: '14px' } }, h('h3', { text: 'Architecture preview' }), h('div', { class: 'right' }, h('span', { class: 'faint', style: { fontSize: '12.5px' }, text: `${S.modules.total} modules · ${S.deps.total} links` }))), preview);

  const sized = internalNodes.slice().sort((a, b) => Math.max(b.filesCur, b.filesBase) - Math.max(a.filesCur, a.filesBase)).slice(0, 8);
  const maxF = Math.max(1, ...sized.map((n) => Math.max(n.filesCur, n.filesBase)));
  const sizeCard = h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', { text: 'Files per module' }), h('div', { class: 'right' }, h('button', { class: 'link-btn', on: { click: () => go('modules') } }, 'All modules', icon('right')))),
    h('div', { class: 'card-b' }, h('div', { class: 'bars' }, sized.map((n, i) => {
      const f = n.status === 'removed' ? n.filesBase : n.filesCur;
      return h('div', { class: `bar-row ${n.status}`, on: { pointermove: (ev) => showTip(ev, `<div class="tt">${esc(n.id)}</div><div class="kv"><span>Files now</span><b>${n.filesCur}</b></div>${hasBase ? `<div class="kv"><span>Files before</span><b>${n.filesBase}</b></div>` : ''}`), pointerleave: hideTip } },
        h('span', { class: 'n', text: n.id }),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.max(2, (f / maxF) * 100)}%`, animationDelay: `${i * 0.05}s` } })),
        h('span', { class: 'num muted', style: { fontSize: '12.5px' }, text: hasBase && n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur}` : String(f) }));
    }))));

  pg.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', { text: 'Overview' }), h('p', { text: hasBase ? `How ${D.curLabel} reshapes ${D.project} compared with ${baseShort()}.` : `A snapshot of ${D.project}.` })),
      h('div', { class: 'right' }, h('button', { class: 'btn', on: { click: () => go('map') } }, icon('map'), 'Open map'))),
    h('div', { class: 'stagger' }, hero),
    stats,
    systemGlance(),
    h('div', { class: 'grid two stagger', style: { marginTop: '14px' } }, depCard, rulesCard),
    h('div', { class: 'grid two stagger', style: { marginTop: '14px' } }, previewCard, sizeCard));
}
function changeRow(c) {
  const e = c.edge;
  const ic = c.type === 'node' ? (c.kind === 'added' ? 'filePlus' : 'box') : c.viol ? 'alert' : 'link';
  const tone = c.viol ? 'viol' : c.kind === 'added' ? 'add' : c.kind === 'removed' ? 'rem' : 'chg';
  const sub = c.type === 'node'
    ? `${c.kind === 'added' ? 'New module' : 'Module removed'} · ${c.sub}`
    : e.status === 'same' ? `Imports ${e.countBase} → ${e.countCur}` : `${plural(e.status === 'added' ? e.countCur : e.countBase, 'import')}${c.viol ? ' · breaks a rule' : ''}`;
  return h('button', { class: 'row-btn', on: { click: () => goSelect({ type: c.type, id: c.id }) } },
    h('span', { class: `ico-box ${tone}` }, icon(ic)),
    h('span', { class: 'main-t' }, h('div', { class: 't1', text: c.label }), h('div', { class: 't2', text: sub })),
    kindBadge(c.kind), icon('right', 'chev'));
}
function ruleScope(r) {
  if (Array.isArray(r.from)) r = { ...r, from: r.from.join(', ') };
  if (r.kind === 'cycle') return 'No module may depend on itself through others';
  if (r.to) return `${r.from} must not use ${r.to.map(short).join(', ')}`;
  if (r.allow) return r.allow.length ? `${r.from} may only use ${r.allow.join(', ')}` : `${r.from} may not use other modules`;
  return r.from || '';
}

export { renderOverview, changeRow, ruleScope };
