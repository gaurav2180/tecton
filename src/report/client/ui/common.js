// Small shared UI pieces: tabs, badges, evidence lists, count-up numbers and the tooltip.
import { $, $$, h, reduceMotion } from '../lib/dom.js';
import { hasBase } from '../lib/data.js';

// ------------------------------------------------------------------ small UI factories
function tabs(options, value, onChange) {
  const wrap = h('div', { class: 'tabs', role: 'group' });
  const ind = h('span', { class: 'ind' });
  wrap.appendChild(ind);
  const btns = options.map((o) => h('button', {
    'aria-pressed': String(o.value === value), dataset: { value: o.value }, disabled: o.disabled,
    style: o.disabled ? { opacity: '.45', cursor: 'not-allowed' } : null,
    on: { click: () => { if (o.disabled) return; set(o.value); onChange(o.value); } },
  }, o.label, o.count != null ? h('span', { class: 'c', text: o.count }) : null));
  btns.forEach((b) => wrap.appendChild(b));
  function place() {
    const on = btns.find((b) => b.getAttribute('aria-pressed') === 'true');
    if (!on || !on.offsetWidth) return;
    ind.style.left = `${on.offsetLeft}px`;
    ind.style.width = `${on.offsetWidth}px`;
  }
  function set(v) { btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === v))); place(); }
  wrap._place = place;
  wrap._set = set;
  return wrap;
}
const placeTabs = () => $$('.tabs').forEach((t) => t._place && t._place());

function statusBadge(kind, text) { return h('span', { class: `badge ${kind}`, text }); }
function ruleStateBadge(st) {
  return {
    new: statusBadge('critical', 'New break'), existing: statusBadge('serious', 'Failing'),
    fixed: statusBadge('good', 'Fixed'), pass: statusBadge('good', 'Passing'),
  }[st];
}
function violBadge(v) {
  if (!hasBase) return statusBadge(v.severity === 'error' ? 'critical' : 'warn', v.severity === 'error' ? 'Error' : 'Warning');
  if (v.status === 'new') return statusBadge(v.severity === 'error' ? 'critical' : 'warn', v.severity === 'error' ? 'New' : 'New warning');
  if (v.status === 'fixed') return statusBadge('good', 'Fixed');
  return statusBadge('neutral', 'Already there');
}
function kindBadge(kind) {
  return { added: statusBadge('add', 'Added'), removed: statusBadge('rem', 'Removed'), changed: statusBadge('chg', 'Changed'), edited: statusBadge('acc', 'Edited'), same: statusBadge('neutral', 'Unchanged') }[kind];
}
function evidence(list, cls) {
  return h('div', { class: 'ev' }, list.map((x) => h('div', { class: `ev-row ${cls || ''}` }, h('code', { text: `${x.file}:${x.line}` }), h('span', { class: 'to', text: `→ ${x.spec}` }))));
}
function countUp(el, to) {
  if (reduceMotion || to === 0) { el.textContent = to.toLocaleString(); return; }
  const t0 = performance.now();
  const dur = 900;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(to * (1 - (1 - p) ** 3)).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ tooltip
const tip = $('#tip');
function showTip(ev, html) {
  tip.innerHTML = html;
  tip.classList.add('show');
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + pad; let y = ev.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
function hideTip() { tip.classList.remove('show'); }

export { tabs, placeTabs, statusBadge, ruleStateBadge, violBadge, kindBadge, evidence, countUp, tip, showTip, hideTip };
