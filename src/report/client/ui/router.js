// Hash routing: #overview, #map, #module:<name>, …
import { $, $$ } from '../lib/dom.js';
import { D, PAGES, nodesById, state } from '../lib/data.js';
import { countUp, hideTip, placeTabs } from './common.js';
import { applyArch, arch, archFit, closeSheet, renderSystem } from '../pages/architecture.js';
import { renderArchAlt } from '../pages/arch-views.js';
import { fit, introAnimation, map, placeAlt } from '../pages/map.js';
import { renderModule } from '../pages/module.js';

// ------------------------------------------------------------------ routing
function go(page) { if (location.hash !== `#${page}`) location.hash = page; else show(page); }
let countedUp = false;
function show(page) {
  let modId = null;
  if (page.startsWith('module:')) {
    try { modId = decodeURIComponent(page.slice(7)); } catch { modId = null; }
    const n = modId && nodesById.get(modId);
    page = n && !n.external ? 'module' : 'modules';
  }
  if (page !== 'module' && !PAGES.some((p) => p.id === page)) page = 'overview';
  state.page = page;
  const title = page === 'module' ? modId : PAGES.find((p) => p.id === page).title;
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === (page === 'module' ? 'modules' : page)));
  $('#crumb-cur').textContent = page === 'module' ? `Modules / ${modId}` : title;
  document.title = `${title} · ${D.project} · Tecton`;
  $('#content').scrollTop = 0;
  hideTip();
  requestAnimationFrame(placeTabs);
  if (page === 'overview' && !countedUp) {
    countedUp = true;
    $$('[data-count]', $('#page-overview')).forEach((el) => countUp(el, Number(el.dataset.count)));
  }
  if (page !== 'system') closeSheet();
  if (page === 'system') {
    if (!arch.svg) renderSystem();
    else { $$('.sys-tabs').forEach((t) => t._set && t._set(state.view)); applyArch(); if (state.archView !== 'diagram') renderArchAlt($('#arch-alt')); }
    requestAnimationFrame(() => { if (!arch.fitted && state.archView === 'diagram') arch.fitted = archFit(false); });
  }
  if (page === 'module') renderModule(modId);
  if (page === 'map') {
    placeAlt();
    requestAnimationFrame(() => {
      if (!map.fitted) { fit(false); map.fitted = true; }
      introAnimation();
    });
  }
}

export { go, countedUp, show };
