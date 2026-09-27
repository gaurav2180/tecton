// Rule checks page.
import { $, $$, h, icon, plural, reduceMotion, short } from '../lib/dom.js';
import { D, hasBase, rules } from '../lib/data.js';
import { evidence, ruleStateBadge, statusBadge, violBadge } from '../ui/common.js';
import { ruleScope } from './overview.js';
import { goSelect } from './map.js';

// ------------------------------------------------------------------ rules page
function renderRules() {
  const pg = $('#page-rules');
  const failingRules = rules.filter((r) => r.state === 'new' || r.state === 'existing').length;
  pg.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', { text: 'Rule checks' }), h('p', { text: `The boundaries set in tecton.config.json, checked against ${hasBase ? D.curLabel : 'the current code'}.` })),
    h('div', { class: 'right' },
      h('span', { class: 'badge neutral plain', text: plural(rules.length, 'rule') }),
      failingRules ? statusBadge('critical', `${failingRules} failing`) : null,
      statusBadge('good', `${rules.length - failingRules} passing`))));
  if (!rules.length) {
    pg.append(h('div', { class: 'card' }, h('div', { class: 'empty-state' },
      h('div', { class: 'ico-box' }, icon('shield')),
      h('h4', { text: 'No rules yet' }),
      h('p', null, 'Run ', h('code', { text: 'tecton init' }), ' to create a starter tecton.config.json, then describe which parts of the app may use which.'))));
    return;
  }
  const list = h('div', { class: 'card', id: 'rule-list' });
  rules.forEach((r) => {
    const body = h('div', { class: 'rule-inner' },
      r.message ? h('div', { class: 'callout', style: { background: 'var(--surface-2)', color: 'var(--text-2)' } }, icon('sparkle'), r.message) : null,
      r.viols.length ? r.viols.map((v) => h('div', { class: 'viol-card' },
        h('div', { class: 'top' }, violBadge(v),
          h('span', { text: v.kind === 'cycle' ? v.members.map(short).join(' ⇄ ') : `${short(v.from)} → ${short(v.to)}` }),
          h('span', { class: 'faint', style: { fontSize: '12.5px' }, text: `· ${plural(v.count, v.kind === 'cycle' ? 'link' : 'import')}` }),
          h('button', { class: 'link-btn', style: { marginLeft: 'auto' }, on: { click: () => goSelect({ type: 'viol', id: v.id }) } }, icon('map'), 'Show on map')),
        evidence(v.imports.slice(0, 8)),
        v.imports.length > 8 ? h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' }, text: `+ ${v.imports.length - 8} more` }) : null))
        : h('div', { class: 'faint', text: 'Nothing breaks this rule.' }));
    const item = h('div', { class: 'rule', dataset: { key: r.key } },
      h('button', { class: 'rule-h', 'aria-expanded': 'false', on: { click: (ev) => toggleRule(ev.currentTarget.parentNode) } },
        h('span', { class: `ico-box ${r.state === 'new' ? 'rem' : r.state === 'existing' ? 'viol' : 'good'}` }, icon(r.kind === 'cycle' ? 'cycle' : r.state === 'pass' || r.state === 'fixed' ? 'check' : 'alert')),
        h('span', null, h('div', { class: 'nm', text: r.key }), h('div', { class: 'sub', text: r.severity === 'error' ? 'Error · fails CI' : 'Warning · reported only' })),
        h('span', { class: 'scope sub', text: ruleScope(r) }),
        h('span', { class: 'cnt sub num', text: r.viols.length ? plural(r.viols.filter((v) => v.status !== 'fixed').length, 'break') : '—' }),
        ruleStateBadge(r.state),
        icon('right', 'chev')),
      h('div', { class: 'rule-body' }, h('div', null, body)));
    list.appendChild(item);
  });
  pg.append(list);
  const first = rules.find((r) => r.state === 'new') || rules.find((r) => r.state === 'existing');
  if (first) openRule(first.key);
}
function toggleRule(el, force) {
  const open = force ?? !el.classList.contains('open');
  el.classList.toggle('open', open);
  $('.rule-h', el).setAttribute('aria-expanded', String(open));
}
function openRule(key) {
  const el = $$('.rule').find((r) => r.dataset.key === key);
  if (el) { toggleRule(el, true); setTimeout(() => el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }), 60); }
}

export { renderRules, toggleRule, openRule };
