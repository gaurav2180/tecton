// SVG export, downloads and copying the PR summary.
import { SVGNS, h, s } from '../lib/dom.js';
import { D } from '../lib/data.js';
import { toast } from './shell.js';
import { map } from '../pages/map.js';

// ---- export
/** A standalone copy of an on-screen SVG: computed styles inlined, helper-only elements dropped. */
function exportSvgFrom(src, box, name, drop) {
  const clone = src.cloneNode(true);
  clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  clone.setAttribute('width', Math.round(box.w));
  clone.setAttribute('height', Math.round(box.h));
  clone.setAttribute('xmlns', SVGNS);
  const origEls = [src, ...src.querySelectorAll('*')];
  const cloneEls = [clone, ...clone.querySelectorAll('*')];
  const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'display'];
  const dropCls = ['gone', ...drop];
  origEls.forEach((o, i) => {
    const cs = getComputedStyle(o);
    const c = cloneEls[i];
    if (o.classList && dropCls.some((k) => o.classList.contains(k))) { c.setAttribute('data-drop', '1'); return; }
    c.setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    c.removeAttribute('class');
  });
  clone.querySelectorAll('[data-drop]').forEach((e) => e.remove());
  const bg = s('rect', { x: box.x, y: box.y, width: box.w, height: box.h, style: `fill:${getComputedStyle(document.body).backgroundColor}` });
  clone.insertBefore(bg, clone.firstChild);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`], { type: 'image/svg+xml' });
  download(blob, name);
}
function exportSvg() {
  const pad = 32;
  exportSvgFrom(map.svg, { x: -pad, y: -pad - 10, w: D.width + pad * 2, h: D.height + pad * 2 + 10 }, `${D.project}-dependency-map.svg`, ['hit', 'flow']);
  toast('Map exported as SVG', 'download');
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function copySummary() {
  const text = D.markdown || '';
  const done = () => toast('PR summary copied as Markdown', 'copy');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
  function fallback() {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Could not copy — use the JSON/Markdown output instead', 'alert'); }
    ta.remove();
  }
}

export { exportSvgFrom, exportSvg, download, copySummary };
