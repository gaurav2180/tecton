// Entry point: listens for navigation and keys, renders every page once and shows the one in the URL.
import { $, $$, s } from './lib/dom.js';
import { D, PAGES, state } from './lib/data.js';
import { applyTheme, closeSidebar, currentTheme, renderSidebar, renderTopbar } from './ui/shell.js';
import { placeTabs, setDetail } from './ui/common.js';
import { renderOverview } from './pages/overview.js';
import { renderRules } from './pages/rules.js';
import { renderChanges } from './pages/changes.js';
import { renderModules } from './pages/modules.js';
import { archFit, closeSheet, renderSystem } from './pages/architecture.js';
import { fit, map, placeAlt, renderMap, select } from './pages/map.js';
import { buildPaletteItems, closePalette, openPalette } from './ui/palette.js';
import { go, show } from './ui/router.js';

window.addEventListener('hashchange', () => show(location.hash.slice(1)));

// ------------------------------------------------------------------ keyboard
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('#palette-ov').classList.contains('open')) closePalette(); else openPalette(); return; }
  if (e.key === 'Escape') {
    if ($('#palette-ov').classList.contains('open')) closePalette();
    else if ($('#sheet') && $('#sheet').classList.contains('open')) closeSheet();
    else if (state.selected) select(null);
    else closeSidebar();
    return;
  }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); }
  if (state.page === 'map' && state.mapView === 'graph' && (e.key === 'f' || e.key === 'F')) fit(true);
  if (state.page === 'system' && state.archView === 'diagram' && (e.key === 'f' || e.key === 'F')) archFit(true);
  if (/^[1-6]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) go(PAGES[Number(e.key) - 1].id);
});

// ------------------------------------------------------------------ boot
setDetail(state.detail, true);
renderSidebar();
renderTopbar();
renderOverview();
renderMap();
renderSystem();
renderRules();
renderChanges();
renderModules();
buildPaletteItems();
applyTheme(currentTheme());
$('#scrim').addEventListener('click', closeSidebar);
// architecture preview on the overview = a live copy of the map
(() => {
  const box = $('#preview');
  if (!box || !map.world) return;
  const pad = 30;
  const svg = s('svg', { viewBox: `${-pad} ${-pad} ${D.width + pad * 2} ${D.height + pad * 2}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
  const clone = map.world.cloneNode(true);
  clone.removeAttribute('id');
  $$('[id], [tabindex], [role], [aria-label]', clone).forEach((el) => ['id', 'tabindex', 'role', 'aria-label'].forEach((a) => el.removeAttribute(a)));
  // its own arrowheads and shadow: the map's defs sit on a hidden page, and browsers don't paint those
  const defs = /** @type {SVGDefsElement} */ (map.svg.querySelector('defs').cloneNode(true));
  $$('[id]', defs).forEach((el) => el.setAttribute('id', `pv-${el.id}`));
  $$('[marker-end]', clone).forEach((el) => el.setAttribute('marker-end', el.getAttribute('marker-end').replace('url(#', 'url(#pv-')));
  svg.append(defs, clone);
  box.insertBefore(svg, box.firstChild);
})();
window.addEventListener('resize', () => {
  placeTabs();
  if (state.page === 'map') { placeAlt(); if (!state.selected && state.mapView === 'graph') fit(false); }
  if (state.page === 'system' && state.archView === 'diagram') archFit(false);
});
show(location.hash.slice(1) || 'overview');
