(() => {
  'use strict';
  const D = JSON.parse(document.getElementById('data').textContent);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    applyProps(e, props);
    append(e, kids);
    return e;
  }
  function s(tag, props, ...kids) {
    const e = document.createElementNS(SVGNS, tag);
    applyProps(e, props);
    append(e, kids);
    return e;
  }
  function applyProps(e, p) {
    if (!p) return;
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.setAttribute('class', v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'on') for (const ev of Object.keys(v)) e.addEventListener(ev, v[ev]);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  function append(e, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      e.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    }
  }

  // Tecton mark: a T of three plates; the right arm has shifted 5u along a 2u fault (see brand/)
  const TECTON_MARK = '<rect class="pl" x="6" y="14" width="25" height="12" rx="3"/><rect class="pl-shift" x="33" y="9" width="25" height="12" rx="3"/><rect class="pl" x="25" y="28" width="14" height="30" rx="3"/>';
  const ICONS = {
    logo: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5l3 8M16 7.5l-3 8M8.5 6h7"/>',
    overview: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    map: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    compare: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    pkg: '<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.29 7 12 12l8.71-5"/><path d="M12 22V12"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    xcircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    cycle: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    sparkle: '<path d="M9.94 14.06 2 22M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M9 15h6M12 12v6"/>',
  };
  function icon(name, cls) {
    const e = document.createElementNS(SVGNS, 'svg');
    e.setAttribute('class', `i${cls ? ` ${cls}` : ''}`);
    e.setAttribute('viewBox', '0 0 24 24');
    e.setAttribute('aria-hidden', 'true');
    e.innerHTML = ICONS[name] || '';
    return e;
  }

  const short = (id) => (id.startsWith('npm:') ? id.slice(4) : id);
  const plural = (n, w, pl) => `${n.toLocaleString()} ${n === 1 ? w : (pl || `${w}s`)}`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function ago(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `${hr} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const store = {
    get(k) { try { return localStorage.getItem(`tecton:${k}`); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(`tecton:${k}`, v); } catch { /* storage unavailable */ } },
  };

  // ------------------------------------------------------------------ derived data
  const S = D.summary;
  const V = S.violations;
  const hasBase = D.hasBase;
  const nodesById = new Map(D.nodes.map((n) => [n.id, n]));
  const edgesById = new Map(D.edges.map((e) => [e.id, e]));
  const violById = new Map(D.violations.map((v) => [v.id, v]));
  const violEdges = { cur: new Map(), base: new Map() };
  const pushTo = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  D.violations.forEach((v) => v.edges.forEach((eid) => {
    if (v.status !== 'fixed') pushTo(violEdges.cur, eid, v);
    if (v.status !== 'new') pushTo(violEdges.base, eid, v);
  }));
  const failing = hasBase ? V.newErrors > 0 : D.violations.some((v) => v.severity === 'error');
  const curViols = D.violations.filter((v) => v.status !== 'fixed');
  const isChange = (e) => e.status !== 'same' || e.countBase !== e.countCur;
  const changeKind = (e) => (e.status === 'added' ? 'added' : e.status === 'removed' ? 'removed' : 'changed');
  const internalNodes = D.nodes.filter((n) => !n.external);

  const nodeStats = new Map(D.nodes.map((n) => [n.id, { uses: 0, usedBy: 0, viol: 0 }]));
  D.edges.forEach((e) => {
    if (e.status === 'removed') return;
    nodeStats.get(e.from).uses++;
    nodeStats.get(e.to).usedBy++;
  });
  curViols.forEach((v) => {
    const mods = v.kind === 'cycle' ? v.members : [v.from];
    mods.forEach((m) => { if (nodeStats.has(m)) nodeStats.get(m).viol++; });
  });

  const rules = (D.rules || []).map((r) => {
    const vs = D.violations.filter((v) => v.rule === r.key);
    const n = { new: 0, existing: 0, fixed: 0 };
    vs.forEach((v) => { n[v.status]++; });
    let state;
    if (n.new) state = 'new';
    else if (n.existing) state = 'existing';
    else if (n.fixed) state = 'fixed';
    else state = 'pass';
    return { ...r, viols: vs, n, state };
  });

  const changes = [
    ...internalNodes.filter((n) => n.status !== 'same').map((n) => ({
      type: 'node', id: n.id, kind: n.status, label: n.id,
      sub: plural(n.status === 'added' ? n.filesCur : n.filesBase, 'file'),
    })),
    ...D.edges.filter(isChange).map((e) => ({
      type: 'edge', id: e.id, kind: changeKind(e), label: `${short(e.from)} → ${short(e.to)}`, edge: e,
      viol: (violEdges.cur.get(e.id) || []).some((v) => v.status === 'new'),
    })),
  ];
  const kindOrder = { added: 0, removed: 1, changed: 2 };
  changes.sort((a, b) => (b.viol ? 1 : 0) - (a.viol ? 1 : 0) || kindOrder[a.kind] - kindOrder[b.kind] || a.label.localeCompare(b.label));

  // ------------------------------------------------------------------ state
  const PAGES = [
    { id: 'overview', title: 'Overview', icon: 'overview' },
    { id: 'system', title: 'Architecture', icon: 'layers' },
    { id: 'map', title: 'Dependency map', icon: 'map' },
    { id: 'rules', title: 'Rule checks', icon: 'shield' },
    { id: 'changes', title: 'Changes', icon: 'compare' },
    { id: 'modules', title: 'Modules', icon: 'box' },
  ];
  const state = { page: 'overview', view: hasBase ? 'diff' : 'cur', selected: null, focusOnly: false };

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
    return { added: statusBadge('add', 'Added'), removed: statusBadge('rem', 'Removed'), changed: statusBadge('chg', 'Changed'), same: statusBadge('neutral', 'Unchanged') }[kind];
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
    const fileDelta = hasBase && S.files.cur !== S.files.base ? [h('span', { class: 'chip', text: `${S.files.cur - S.files.base > 0 ? '+' : '−'}${Math.abs(S.files.cur - S.files.base)} vs ${baseShort()}` })] : [];
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
          ruleStateBadge(r.state))) : h('div', { class: 'card-b faint', text: 'No rules configured yet.' })));

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

  // ------------------------------------------------------------------ modules page
  function renderModules() {
    const pg = $('#page-modules');
    pg.append(h('div', { class: 'page-head' },
      h('div', null, h('h1', { text: 'Modules' }), h('p', { text: 'Each folder Tecton treats as one part of the app, with how much it uses and is used.' }))));
    let sort = { k: 'files', dir: -1 };
    let q = '';
    const rowsData = D.nodes.map((n) => ({ n, ...nodeStats.get(n.id), files: n.status === 'removed' ? n.filesBase : n.filesCur }));
    const maxF = Math.max(1, ...rowsData.map((r) => r.files));
    const cols = [['name', 'Module'], ['status', 'Status'], ['files', 'Files'], ['uses', 'Uses'], ['usedBy', 'Used by'], ['viol', 'Rule breaks']];
    const thead = h('tr');
    cols.forEach(([k, label]) => thead.appendChild(h('th', { class: `sortable${k === 'uses' || k === 'usedBy' || k === 'viol' ? ' r' : ''}`, dataset: { k }, on: { click: () => { sort = { k, dir: sort.k === k ? -sort.dir : (k === 'name' ? 1 : -1) }; draw(); } } }, label, h('span', { class: 'sort' }))));
    const tbody = h('tbody');
    const inp = h('input', { type: 'search', placeholder: 'Search modules…', 'aria-label': 'Search modules', on: { input: (e) => { q = e.target.value.toLowerCase(); draw(); } } });
    function val(r, k) { return k === 'name' ? r.n.id : k === 'status' ? r.n.status : r[k]; }
    function draw() {
      $$('th', thead.parentNode || thead).forEach((th) => { const sp = $('.sort', th); if (sp) sp.textContent = th.dataset.k === sort.k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''; });
      tbody.innerHTML = '';
      rowsData.filter((r) => !q || r.n.id.toLowerCase().includes(q))
        .sort((a, b) => { const x = val(a, sort.k); const y = val(b, sort.k); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir || a.n.id.localeCompare(b.n.id); })
        .forEach((r, i) => {
          const n = r.n;
          tbody.appendChild(h('tr', { class: 'click enter', style: { animationDelay: `${Math.min(i, 12) * 0.02}s` }, on: { click: () => goSelect({ type: 'node', id: n.id }) } },
            h('td', null, h('div', { class: 'cell-mod' }, h('span', { class: `ico-box ${n.status === 'added' ? 'add' : n.status === 'removed' ? 'rem' : ''}`, style: { width: '26px', height: '26px' } }, icon(n.external ? 'pkg' : 'box')), short(n.id), n.external ? h('span', { class: 'faint', text: ' · npm' }) : null)),
            h('td', null, hasBase && n.status !== 'same' ? kindBadge(n.status) : h('span', { class: 'faint', text: n.external ? 'Package' : 'Unchanged' })),
            h('td', { class: 'num' }, n.external ? h('span', { class: 'faint', text: '—' }) : [h('span', { class: 'mini-bar' }, h('i', { style: { width: `${(r.files / maxF) * 100}%` } })), hasBase && n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur}` : String(r.files)]),
            h('td', { class: 'r num', text: r.uses }),
            h('td', { class: 'r num', text: r.usedBy }),
            h('td', { class: 'r' }, r.viol ? statusBadge('serious', String(r.viol)) : h('span', { class: 'faint', text: '0' }))));
        });
    }
    const table = h('table', null, h('thead', null, thead), tbody);
    pg.append(h('div', { class: 'toolbar' }, h('label', { class: 'input' }, icon('search'), inp)), h('div', { class: 'card' }, h('div', { class: 'tbl-wrap' }, table)));
    draw();
  }

  // ------------------------------------------------------------------ system architecture
  const SYS = D.system || { apps: [], stores: [], outside: [], links: [], summary: null };
  const sysState = { expanded: new Set(), sel: null };
  const GROUPS = [
    { key: 'pages', title: 'Pages', icon: 'file', mono: true },
    { key: 'api', title: 'Routes & API', icon: 'code' },
    { key: 'endpoints', title: 'HTTP endpoints', icon: 'code' },
    { key: 'jobs', title: 'Jobs & scripts', icon: 'terminal', mono: true },
  ];
  const appIcon = (a) => ({ web: 'globe', mobile: 'phone', desktop: 'monitor', server: 'server' }[a.role] || 'box');
  const visible = (x) => present(x.status || 'same');
  const stClass = (x) => (state.view === 'diff' && x.status && x.status !== 'same' ? ` s-${x.status}` : '');
  const appById = new Map(SYS.apps.map((a) => [a.id, a]));
  const appLabel = (id) => (id === 'users' ? 'Users' : (appById.get(id) || {}).name || id);
  const svcById = new Map([...SYS.stores, ...SYS.outside].map((x) => [x.id, x]));

  function orderApps() {
    // callers to the left of the apps they call; front doors first
    const calls = SYS.links.filter((l) => l.kind === 'app');
    const rank = new Map(SYS.apps.map((a) => [a.id, ['web', 'mobile', 'desktop'].includes(a.role) ? 0 : 1]));
    for (let i = 0; i < 4; i++) calls.forEach((l) => { if (rank.has(l.to) && rank.has(l.from)) rank.set(l.to, Math.max(rank.get(l.to), rank.get(l.from) + 1)); });
    return [...SYS.apps].sort((a, b) => rank.get(a.id) - rank.get(b.id) || a.name.localeCompare(b.name));
  }

  function renderSystem() {
    const pg = $('#page-system');
    pg.innerHTML = '';
    const sum = SYS.summary;
    const vt = tabs([
      { value: 'diff', label: 'Changes', disabled: !hasBase },
      { value: 'base', label: 'Before', disabled: !hasBase },
      { value: 'cur', label: 'After' },
    ], state.view, (v) => { state.view = v; syncViews(); });
    vt.classList.add('sys-tabs');
    const delta = (o) => (hasBase && (o.added || o.removed) ? [o.added ? h('span', { class: 'chip add', text: `+${o.added}` }) : null, o.removed ? h('span', { class: 'chip rem', text: `−${o.removed}` }) : null] : null);
    const stat = (n, label, o, ic) => h('div', { class: 'sys-stat' }, icon(ic), h('b', { class: 'num', text: n }), h('span', { text: label }), delta(o));
    pg.append(h('div', { class: 'page-head' },
      h('div', null, h('h1', { text: 'Architecture' }), h('p', { text: 'Drawn from your code: the apps in this repo, their entry points, the data they keep and the outside services they call.' })),
      h('div', { class: 'right' }, vt)));
    if (sum) {
      pg.append(h('div', { class: 'sys-stats stagger' },
        stat(sum.apps.total, sum.apps.total === 1 ? 'app' : 'apps', sum.apps, 'layers'),
        stat(sum.entry.total, 'entry points', sum.entry, 'code'),
        stat(sum.stores.total, sum.stores.total === 1 ? 'data store' : 'data stores', sum.stores, 'database'),
        stat(sum.outside.total, sum.outside.total === 1 ? 'outside service' : 'outside services', sum.outside, 'cloud')));
    }

    const canvas = h('div', { class: 'sys-canvas card', id: 'sys-canvas' });
    const wires = s('svg', { class: 'sys-wires', id: 'sys-wires', 'aria-hidden': 'true' });
    canvas.appendChild(wires);

    // row 1: users
    if (SYS.hasUsers) {
      canvas.appendChild(h('div', { class: 'sys-row' },
        h('div', { class: 'sys-users', id: 'sys-node-users', dataset: { node: 'users' } }, h('span', { class: 'ico-box' }, icon('users')), h('div', null, h('b', { text: 'Users' }), h('div', { class: 'faint', text: 'browser / clients' })))));
    }
    // row 2: apps
    const appsRow = h('div', { class: 'sys-row sys-apps' });
    orderApps().filter((a) => visible(a)).forEach((a, i) => appsRow.appendChild(appCard(a, i)));
    canvas.appendChild(appsRow);
    // row 3: data + outside
    const stores = SYS.stores.filter(visible);
    const outside = SYS.outside.filter(visible);
    const bottom = h('div', { class: 'sys-row sys-bottom' });
    if (stores.length) {
      bottom.appendChild(h('div', { class: 'sys-panel', id: 'sys-data' },
        h('div', { class: 'sys-panel-h' }, icon('database'), 'Data', h('span', { class: 'count-s', text: stores.length })),
        h('div', { class: 'sys-stores' }, stores.map((x) => h('button', {
          class: `sys-store${stClass(x)}`, id: `sys-node-${cssId(x.id)}`, dataset: { node: x.id },
          on: { click: () => openSys({ type: 'svc', id: x.id }), mouseenter: () => hl(x.apps, x.id), mouseleave: () => hl(null) },
        }, h('span', { class: 'cyl' }, icon('database')), h('span', { class: 'grow' }, h('b', { text: x.name }), h('span', { class: 'faint', text: `${x.kind} · ${x.via.join(', ')}` })), statusTag(x))))));
    }
    if (outside.length) {
      bottom.appendChild(h('div', { class: 'sys-panel wide', id: 'sys-outside' },
        h('div', { class: 'sys-panel-h' }, icon('cloud'), 'Outside services', h('span', { class: 'count-s', text: outside.length })),
        h('div', { class: 'sys-svcs' }, outside.map((x) => h('button', {
          class: `sys-svc${stClass(x)}`, dataset: { node: x.id },
          on: { click: () => openSys({ type: 'svc', id: x.id }), mouseenter: () => hl(x.apps, x.id), mouseleave: () => hl(null) },
        },
        h('span', { class: 'ico-box' }, icon(x.kind === 'Email' ? 'mail' : x.kind === 'Web / HTTP' ? 'globe' : 'cloud')),
        h('span', { class: 'grow' },
          h('b', { text: x.name }),
          h('span', { class: 'faint mono-s', text: x.hosts && x.hosts.length ? x.hosts.filter(visible).map((hh) => hh.host).join(', ') : x.kind })),
        h('span', { class: 'who' }, x.apps.map((id) => h('i', { title: `used by ${appLabel(id)}`, text: appLabel(id).slice(0, 1).toUpperCase(), style: { background: appColor(id) } }))),
        statusTag(x))))));
    }
    if (bottom.children.length === 2) {
      // put the data panel on the side of the apps that use it, so wires don't cross
      const order = orderApps().map((a) => a.id);
      const avg = (ids) => (ids.length ? ids.reduce((n, id) => n + order.indexOf(id), 0) / ids.length : 0);
      const dataUsers = [...new Set(stores.flatMap((x) => x.apps))];
      const outUsers = [...new Set(outside.flatMap((x) => x.apps))];
      if (avg(dataUsers) > avg(outUsers)) bottom.appendChild(bottom.firstChild);
    }
    if (bottom.children.length) canvas.appendChild(bottom);
    if (!SYS.apps.length) canvas.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'ico-box' }, icon('layers')), h('h4', { text: 'No apps found' }), h('p', { text: 'Tecton looks for package.json files to find the apps in a repo.' })));

    canvas.appendChild(h('div', { class: 'sys-legend' },
      h('span', null, h('i', { class: 'lg app' }), 'app calls app'), h('span', null, h('i', { class: 'lg data' }), 'reads / writes data'),
      h('span', null, h('i', { class: 'lg out' }), 'calls outside service'),
      hasBase ? [h('span', null, h('i', { class: 'sw-add' }), 'new'), h('span', null, h('i', { class: 'sw-rem' }), 'removed')] : null));
    pg.appendChild(canvas);
    pg.appendChild(h('p', { class: 'faint sys-note', text: 'Detected from package.json files, imports, route files, route definitions and URLs in the code. Hover a service to see which app uses it; click anything for the exact lines.' }));
    if (!sysState.ro && window.ResizeObserver) {
      sysState.ro = new ResizeObserver(() => { if (state.page === 'system') drawWires(); });
    }
    if (sysState.ro) { sysState.ro.disconnect(); sysState.ro.observe(canvas); }
    requestAnimationFrame(() => { placeTabs(); drawWires(); });
  }
  const cssId = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const APP_COLORS = ['var(--accent)', 'var(--chg)', 'var(--add)', 'var(--viol)', 'var(--warn)'];
  function appColor(id) { const i = SYS.apps.findIndex((a) => a.id === id); return APP_COLORS[(i < 0 ? 0 : i) % APP_COLORS.length]; }
  function statusTag(x) {
    if (state.view !== 'diff' || !x.status || x.status === 'same') return null;
    return h('span', { class: `badge ${x.status === 'added' ? 'add' : 'rem'}`, text: x.status === 'added' ? 'New' : 'Removed' });
  }

  function appCard(a, idx) {
    const card = h('div', { class: `sys-app${stClass(a)}`, id: `sys-node-${cssId(a.id)}`, dataset: { node: a.id }, style: { '--app': appColor(a.id), animationDelay: `${idx * 0.06}s` },
      on: { mouseenter: () => hl([a.id]), mouseleave: () => hl(null) } });
    card.appendChild(h('button', { class: 'sys-app-h', on: { click: () => openSys({ type: 'app', id: a.id }) } },
      h('span', { class: 'ico-box app-ico' }, icon(appIcon(a))),
      h('span', { class: 'grow' },
        h('b', { text: a.name }),
        h('span', { class: 'faint mono-s', text: a.root ? `${a.root}/` : './ (repo root)' })),
      h('span', { class: 'badge neutral plain', text: a.framework }), statusTag(a)));
    if (a.tech.length) card.appendChild(h('div', { class: 'sys-tech' }, a.tech.map((t) => h('span', { class: 'chip', text: t }))));
    for (const g of GROUPS) {
      const items = (a.groups[g.key] || []).filter(visible);
      if (!items.length) continue;
      const k = `${a.id}:${g.key}`;
      const open = sysState.expanded.has(k);
      const limit = 6;
      const shown = open ? items : items.slice(0, limit);
      const added = items.filter((x) => x.status === 'added').length;
      card.appendChild(h('div', { class: 'sys-sec' },
        h('div', { class: 'sys-sec-h' }, icon(g.icon), g.title, h('span', { class: 'count-s', text: items.length }), state.view === 'diff' && added ? h('span', { class: 'chip add', text: `+${added}` }) : null),
        h('div', { class: `sys-items${g.key === 'pages' ? ' chips' : ''}` }, shown.map((x) => h('button', {
          class: `sys-item${stClass(x)}`, title: x.file, on: { click: () => openSys({ type: 'item', app: a.id, group: g.key, key: x.key }) },
        },
        x.methods && x.methods.length ? x.methods.map((m) => h('span', { class: `meth m-${m.toLowerCase()}`, text: m })) : null,
        h('span', { class: g.mono || x.methods ? 'mono-s' : '', text: x.label }),
        g.key === 'jobs' ? h('span', { class: 'faint mono-s grow-r', text: x.file.split('/').pop() }) : null))),
        items.length > limit ? h('button', { class: 'link-btn more', on: { click: () => { if (open) sysState.expanded.delete(k); else sysState.expanded.add(k); renderSystem(); } } }, open ? 'Show less' : `Show all ${items.length}`) : null));
    }
    const mods = a.modules || [];
    card.appendChild(h('div', { class: 'sys-sec code' },
      h('div', { class: 'sys-sec-h' }, icon('box'), 'Code', h('span', { class: 'faint', style: { marginLeft: 'auto', fontWeight: '400' }, text: `${plural(a.fileCount, 'file')} · ${plural(mods.length, 'module')}` })),
      h('div', { class: 'sys-mods' }, mods.slice(0, 8).map((m) => h('button', { class: 'chip mod', title: `${m.files} files — open on the dependency map`, on: { click: () => (nodesById.has(m.name) ? goSelect({ type: 'node', id: m.name }) : null) } }, (a.root ? m.name.replace(`${a.root}/`, '') : m.name) || m.name, h('span', { class: 'faint', text: ` ${m.files}` }))),
        mods.length > 8 ? h('span', { class: 'faint', style: { fontSize: '12px' }, text: `+${mods.length - 8} more` }) : null)));
    return card;
  }

  // ---- wires between boxes (drawn from the real on-screen positions)
  function linkStatusInView(ls) {
    const vis = ls.filter(visible);
    if (!vis.length) return null;
    if (state.view !== 'diff') return 'same';
    if (vis.every((l) => l.status === 'added')) return 'added';
    if (vis.every((l) => l.status === 'removed')) return 'removed';
    return 'same';
  }
  function drawWires() {
    const canvas = $('#sys-canvas');
    const svg = $('#sys-wires');
    if (!canvas || !svg || !canvas.offsetWidth) return;
    const cr = canvas.getBoundingClientRect();
    svg.setAttribute('width', cr.width); svg.setAttribute('height', canvas.scrollHeight);
    svg.innerHTML = `<defs>${[['users', '--text-3'], ['app', '--accent'], ['data', '--chg'], ['out', '--text-3'], ['add', '--add'], ['rem', '--rem'], ['hl', '--accent']].map(([k, c]) => `<marker id="sw-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1,1.5 L9,5 L1,8.5 Q2.5,5 1,1.5 z" style="fill: var(${c})"/></marker>`).join('')}</defs>`;
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }; };
    const nodeEl = (id) => $(`[data-node="${CSS.escape(id)}"]`, canvas);
    const wiresOut = [];
    const add = (from, to, kind, label, st, apps) => {
      const a = nodeEl(from); const b = to.el || nodeEl(to);
      if (!a || !b || !st) return;
      const A = box(a); const B = box(b);
      let p1; let p2; let horiz = false;
      if (B.y > A.y + A.h - 4) {
        p2 = [to.tx != null ? to.tx : B.x + B.w / 2, B.y];
        const cx = A.x + A.w / 2; // leave the box on the side facing the target, so wires fan out instead of stacking
        p1 = [cx + Math.max(-A.w * 0.35, Math.min(A.w * 0.35, (p2[0] - cx) * 0.4)), A.y + A.h];
      } else if (A.y > B.y + B.h - 4) { p1 = [A.x + A.w / 2, A.y]; p2 = [B.x + B.w / 2, B.y + B.h]; } else {
        horiz = true;
        const right = B.x > A.x;
        p1 = [right ? A.x + A.w : A.x, A.y + 30]; p2 = [right ? B.x : B.x + B.w, B.y + 30];
      }
      const d = horiz
        ? `M${p1[0]},${p1[1]} C${(p1[0] + p2[0]) / 2},${p1[1]} ${(p1[0] + p2[0]) / 2},${p2[1]} ${p2[0]},${p2[1]}`
        : `M${p1[0]},${p1[1]} C${p1[0]},${(p1[1] + p2[1]) / 2} ${p2[0]},${(p1[1] + p2[1]) / 2} ${p2[0]},${p2[1]}`;
      const g = s('g', { class: `wire k-${kind} w-${st}`, dataset: { apps: (apps || [from]).join('|') } });
      const mk = st === 'added' ? 'add' : st === 'removed' ? 'rem' : kind;
      const path = s('path', { d, class: 'wl', 'marker-end': `url(#sw-${mk})` });
      g.appendChild(path);
      svg.appendChild(g);
      if (!reduceMotion && (kind === 'app' || kind === 'users') && st !== 'removed') {
        const len = path.getTotalLength();
        const dot = s('circle', { r: 3, class: 'wdot' });
        const am = s('animateMotion', { dur: `${Math.max(1.8, len / 90).toFixed(2)}s`, repeatCount: 'indefinite', path: d });
        dot.appendChild(am); g.appendChild(dot);
      }
      if (label) {
        const len = path.getTotalLength();
        const pt = path.getPointAtLength(len / 2);
        if (horiz) pt.y -= 14; // sit above a side-to-side wire so the cards never cover it
        const w = label.length * 6.2 + 14;
        g.append(s('rect', { x: pt.x - w / 2, y: pt.y - 9, width: w, height: 18, rx: 9, class: 'wlbl' }), s('text', { x: pt.x, y: pt.y + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'wtxt' }, label));
      }
      wiresOut.push(g);
    };
    const links = SYS.links;
    // users -> apps
    links.filter((l) => l.kind === 'users').forEach((l) => add('users', l.to, 'users', null, linkStatusInView([l]), [l.to]));
    // app -> app
    links.filter((l) => l.kind === 'app').forEach((l) => add(l.from, l.to, 'app', l.labels[0] || 'HTTP', linkStatusInView([l]), [l.from, l.to]));
    // app -> each data store
    const dataPanel = $('#sys-data', canvas);
    links.filter((l) => l.kind === 'data').forEach((l) => {
      const st = linkStatusInView([l]);
      const store = svcById.get(l.to);
      const storeEl = nodeEl(l.to);
      // land on the panel's top edge, above the store it reads and writes
      const target = dataPanel && storeEl ? { el: dataPanel, tx: box(storeEl).x + box(storeEl).w / 2 } : l.to;
      add(l.from, target, 'data', store && store.kind === 'Database' ? 'SQL' : 'data', st, [l.from]);
    });
    // app -> outside panel (one wire per app, landing spread across the panel)
    const panel = $('#sys-outside', canvas);
    if (panel) {
      const P = box(panel);
      const xOf = (id) => { const el = nodeEl(id); return el ? box(el).x : 0; };
      const callers = SYS.apps.filter((a) => nodeEl(a.id) && links.some((l) => l.kind === 'outside' && l.from === a.id && visible(l))).sort((a, b) => xOf(a.id) - xOf(b.id));
      callers.forEach((a, i) => {
        const ls = links.filter((l) => l.kind === 'outside' && l.from === a.id);
        const st = linkStatusInView(ls);
        const vis = ls.filter(visible);
        const addedN = state.view === 'diff' ? vis.filter((l) => l.status === 'added').length : 0;
        add(a.id, { el: panel, tx: P.x + (P.w * (i + 1)) / (callers.length + 1) }, 'out', `HTTPS · ${vis.length}${addedN ? ` (+${addedN})` : ''}`, st, [a.id]);
      });
    }
    sysState.wires = wiresOut;
  }
  function hl(appIds, nodeId) {
    const canvas = $('#sys-canvas');
    if (!canvas) return;
    canvas.classList.toggle('hl-on', !!appIds);
    (sysState.wires || []).forEach((g) => {
      const apps = g.dataset.apps.split('|');
      g.classList.toggle('hl', !!appIds && apps.some((a) => appIds.includes(a)));
    });
    $$('.sys-app', canvas).forEach((el) => el.classList.toggle('hl', !!appIds && appIds.includes(el.dataset.node)));
    $$('.sys-svc, .sys-store', canvas).forEach((el) => {
      const svc = svcById.get(el.dataset.node);
      el.classList.toggle('hl', !!appIds && (el.dataset.node === nodeId || (!nodeId && svc && svc.apps.some((a) => appIds.includes(a)))));
    });
  }

  // ---- side sheet with the evidence
  function openSys(sel) {
    sysState.sel = sel;
    const sh = $('#sheet');
    sh.innerHTML = '';
    const body = h('div', { class: 'drawer-b' });
    let title; let sub; let ic; let tone = '';
    const evList = (list) => h('div', { class: 'ev' }, list.map((x) => h('div', { class: 'ev-row' }, h('code', { text: `${x.file}:${x.line}` }), x.text ? h('span', { class: 'to', text: x.text }) : null)));
    if (sel.type === 'app') {
      const a = appById.get(sel.id);
      title = a.name; sub = `${a.framework} app · ${a.root ? `${a.root}/` : 'repo root'}${a.pkgName && a.pkgName !== a.name ? ` · package "${a.pkgName}"` : ''}`; ic = appIcon(a);
      body.append(h('div', { class: 'kv-grid' },
        h('div', null, h('div', { class: 'k', text: 'Files' }), h('div', { class: 'v', text: a.fileCount })),
        h('div', null, h('div', { class: 'k', text: 'Entry points' }), h('div', { class: 'v', text: GROUPS.reduce((n, g) => n + (a.groups[g.key] || []).filter((x) => x.status !== 'removed').length, 0) })),
        h('div', null, h('div', { class: 'k', text: 'Modules' }), h('div', { class: 'v', text: (a.modules || []).length }))));
      const conns = SYS.links.filter((l) => (l.from === a.id || l.to === a.id) && visible(l));
      if (conns.length) {
        body.append(h('div', null, h('div', { class: 'sec-t', text: 'Connections' }), h('div', { class: 'pill-list' }, conns.map((l) => {
          const other = l.from === a.id ? l.to : l.from;
          const svc = svcById.get(other);
          return h('button', { class: 'pill-item', on: { click: () => (svc ? openSys({ type: 'svc', id: other }) : appById.has(other) ? openSys({ type: 'app', id: other }) : null) } },
            icon(svc ? (svc.kind === 'Database' ? 'database' : 'cloud') : other === 'users' ? 'users' : 'server', 'faint'),
            h('span', { class: 'grow', text: `${l.from === a.id ? '→ ' : '← '}${svc ? svc.name : appLabel(other)}` }),
            state.view === 'diff' && l.status !== 'same' ? kindBadge(l.status) : null,
            h('span', { class: 'faint', style: { fontSize: '12px' }, text: l.labels[0] || '' }));
        }))));
      }
      if (a.tech.length) body.append(h('div', null, h('div', { class: 'sec-t', text: 'Notable tech' }), h('div', { class: 'sys-tech', style: { padding: 0 } }, a.tech.map((t) => h('span', { class: 'chip', text: t })))));
    } else if (sel.type === 'svc') {
      const x = svcById.get(sel.id);
      const isStore = SYS.stores.includes(x);
      title = x.name; sub = `${x.kind}${x.via && x.via.length ? ` · via ${x.via.join(', ')}` : ''}`; ic = isStore ? 'database' : x.kind === 'Email' ? 'mail' : 'cloud';
      if (x.status && x.status !== 'same' && hasBase) body.append(h('div', null, kindBadge(x.status)));
      body.append(h('div', null, h('div', { class: 'sec-t', text: 'Used by' }), h('div', { class: 'pill-list' }, x.apps.map((id) => h('button', { class: 'pill-item', on: { click: () => openSys({ type: 'app', id }) } }, h('i', { class: 'dot', style: { background: appColor(id) } }), h('span', { class: 'grow', text: appLabel(id) }), h('span', { class: 'faint', style: { fontSize: '12px' }, text: (appById.get(id) || {}).framework || '' }))))));
      if (x.hosts && x.hosts.length) body.append(h('div', null, h('div', { class: 'sec-t', text: 'Hosts' }), h('div', { class: 'file-list' }, x.hosts.map((hh) => h('div', { class: state.view === 'diff' ? (hh.status === 'added' ? 'plus' : hh.status === 'removed' ? 'minus' : '') : '', text: hh.host })))));
      body.append(h('div', null, h('div', { class: 'sec-t', text: `Where the code uses it · ${x.evidence.length}${x.evidence.length >= 25 ? '+' : ''}` }), evList(x.evidence)));
    } else {
      const a = appById.get(sel.app);
      const g = GROUPS.find((gg) => gg.key === sel.group);
      const it = a.groups[sel.group].find((x) => x.key === sel.key);
      title = `${it.methods && it.methods.length ? `${it.methods.join(' / ')} ` : ''}${it.label}`; sub = `${g.title.replace(/s$/, '')} in ${a.name}`; ic = g.icon;
      if (it.status && it.status !== 'same' && hasBase) body.append(h('div', null, kindBadge(it.status)));
      body.append(h('div', null, h('div', { class: 'sec-t', text: 'Defined in' }), evList([{ file: it.file, line: it.line, text: it.cmd || null }])));
      const f = it.file;
      const mod = D.nodes.find((n) => n.files.some((ff) => ff.path === f));
      if (mod) body.append(h('button', { class: 'btn', on: { click: () => { closeSheet(); goSelect({ type: 'node', id: mod.id }); } } }, icon('map'), `Show module “${mod.id}” on the dependency map`));
    }
    sh.append(h('div', { class: 'drawer-h' },
      h('span', { class: `ico-box ${tone}` }, icon(ic)),
      h('div', { style: { minWidth: 0 } }, h('h3', { text: title }), h('div', { class: 'sub', text: sub })),
      h('button', { class: 'btn icon ghost', 'aria-label': 'Close', style: { marginLeft: 'auto' }, on: { click: closeSheet } }, icon('x'))), body);
    sh.classList.add('open');
  }
  function closeSheet() { const sh = $('#sheet'); if (sh) sh.classList.remove('open'); sysState.sel = null; }

  function syncViews() {
    const vt = $('#view-tabs'); if (vt) vt._set(state.view);
    applyMap();
    renderSystem();
  }

  // overview card: the system at a glance
  function systemGlance() {
    if (!SYS.apps.length) return null;
    const sum = SYS.summary;
    const flow = h('div', { class: 'glance' });
    if (SYS.hasUsers) flow.append(h('div', { class: 'g-node users' }, icon('users'), 'Users'), h('span', { class: 'g-arrow' }, icon('arrowRight')));
    orderApps().forEach((a, i, arr) => {
      const entry = GROUPS.map((g) => [g, (a.groups[g.key] || []).filter((x) => x.status !== 'removed').length]).filter(([, n]) => n);
      flow.append(h('button', { class: 'g-node g-app', style: { '--app': appColor(a.id) }, on: { click: () => { go('system'); setTimeout(() => openSys({ type: 'app', id: a.id }), 60); } } },
        h('span', { class: 'ico-box app-ico' }, icon(appIcon(a))),
        h('span', null, h('b', { text: a.name }), h('span', { class: 'faint', text: `${a.framework}${entry.length ? ` · ${entry.map(([g, n]) => `${n} ${g.title.toLowerCase().replace('routes & api', 'routes').replace('http endpoints', 'endpoints').replace('jobs & scripts', 'jobs')}`).join(' · ')}` : ''}` }))));
      if (i < arr.length - 1) flow.append(h('span', { class: 'g-arrow' }, icon('arrowRight')));
    });
    const tail = h('div', { class: 'g-tail' },
      SYS.stores.filter((x) => x.status !== 'removed').map((x) => h('span', { class: 'chip' }, icon('database'), x.name)),
      h('span', { class: 'chip' }, icon('cloud'), plural(sum.outside.total, 'outside service')),
      hasBase && sum.outside.added ? h('span', { class: 'chip add', text: `+${sum.outside.added} new ${sum.outside.added === 1 ? 'service' : 'services'}` }) : null,
      hasBase && sum.entry.added ? h('span', { class: 'chip add', text: `+${sum.entry.added} entry points` }) : null);
    return h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-h' }, h('h3', { text: 'Architecture' }), h('div', { class: 'right' }, h('button', { class: 'link-btn', on: { click: () => go('system') } }, 'Open diagram', icon('right')))),
      h('div', { class: 'card-b' }, flow, tail));
  }

  // ------------------------------------------------------------------ map
  const map = { built: false, animated: false, vb: { x: 0, y: 0, w: 100, h: 100 }, edgeEls: new Map(), nodeEls: new Map() };

  function pathD(pts) {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]; const b = pts[i]; const my = (b[1] - a[1]) / 2;
      d += ` C${a[0]},${a[1] + my} ${b[0]},${b[1] - my} ${b[0]},${b[1]}`;
    }
    return d;
  }
  // sample the same curve in JS (no DOM measuring needed, works while the page is hidden)
  function samplePath(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]; const b = pts[i]; const my = (b[1] - a[1]) / 2;
      const c1 = [a[0], a[1] + my]; const c2 = [b[0], b[1] - my];
      for (let k = 1; k <= 16; k++) {
        const t = k / 16; const u = 1 - t;
        out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
          u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
      }
    }
    let len = 0;
    const cum = [0];
    for (let i = 1; i < out.length; i++) { len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]); cum.push(len); }
    const half = len / 2;
    let j = cum.findIndex((c) => c >= half);
    if (j < 1) j = 1;
    const f = (half - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
    return { len, mid: [out[j - 1][0] + (out[j][0] - out[j - 1][0]) * f, out[j - 1][1] + (out[j][1] - out[j - 1][1]) * f] };
  }

  function renderMap() {
    const pg = $('#page-map');
    const viewTabs = tabs([
      { value: 'diff', label: 'Changes', disabled: !hasBase },
      { value: 'base', label: 'Before', disabled: !hasBase },
      { value: 'cur', label: 'After' },
    ], state.view, (v) => { state.view = v; applyMap(); });
    viewTabs.id = 'view-tabs';
    const focusSw = h('label', { class: 'switch glass', style: { display: hasBase ? '' : 'none' } },
      h('input', { type: 'checkbox', id: 'focus-sw', on: { change: (e) => { state.focusOnly = e.target.checked; if (state.focusOnly && state.view !== 'diff') { state.view = 'diff'; viewTabs._set('diff'); } applyMap(); } } }), 'Only changes');
    const legendItem = (cls, label) => h('span', null, s('svg', { viewBox: '0 0 22 8' }, s('g', { class: `edge ${cls}` }, s('path', { class: 'line', d: 'M1,4 L21,4' }))), label);
    const legend = h('div', { class: 'legend-float glass' },
      legendItem('same', 'Unchanged'), hasBase ? legendItem('added', 'New') : null, hasBase ? legendItem('removed', 'Removed') : null, legendItem('viol', 'Breaks a rule'));
    const pct = h('div', { class: 'pct', id: 'zoom-pct', text: '100%' });
    const zoomCtl = h('div', { class: 'zoom glass' },
      h('button', { 'aria-label': 'Zoom in', 'data-tip': 'Zoom in', on: { click: () => zoom(1 / 1.3) } }, icon('plus')),
      h('button', { 'aria-label': 'Zoom out', 'data-tip': 'Zoom out', on: { click: () => zoom(1.3) } }, icon('minus')),
      h('button', { 'aria-label': 'Fit to screen', 'data-tip': 'Fit to screen (F)', on: { click: () => fit(true) } }, icon('fit')),
      h('button', { 'aria-label': 'Export SVG', 'data-tip': 'Export as SVG', on: { click: exportSvg } }, icon('image')),
      pct);
    const minimap = h('div', { class: 'minimap glass', id: 'minimap' });
    const svg = s('svg', { id: 'map-svg', role: 'img', 'aria-label': 'Module dependency map' });
    const stage = h('div', { id: 'stage' }, svg);
    const drawer = h('aside', { class: 'drawer', id: 'drawer', 'aria-label': 'Details' });
    pg.append(h('div', { class: 'card map-card' }, stage,
      h('div', { class: 'float tl' }, h('div', { class: 'glass', style: { padding: '0', borderRadius: '11px' } }, viewTabs), focusSw, legend),
      h('div', { class: 'float br' }, zoomCtl),
      h('div', { class: 'float bl' }, minimap),
      drawer));
    buildGraph(svg);
    buildMinimap(minimap);
    wirePanZoom(stage, svg);
  }

  function buildGraph(svg) {
    const defs = s('defs');
    defs.innerHTML = '<filter id="nshadow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#101018" flood-opacity=".08"/></filter>'
      + '<pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" style="fill: var(--dot)"/></pattern>';
    ['line', 'add', 'rem', 'viol', 'accent'].forEach((k) => {
      const m = s('marker', { id: `arr-${k}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 10, markerHeight: 10, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
      m.appendChild(s('path', { d: 'M1,1.5 L9,5 L1,8.5 Q2.5,5 1,1.5 z', style: `fill: var(--${k})` }));
      defs.appendChild(m);
    });
    svg.appendChild(defs);
    svg.appendChild(s('rect', { x: -20000, y: -20000, width: 40000, height: 40000, fill: 'url(#dots)' }));
    const world = s('g', { id: 'world' });
    const edgeLayer = s('g');
    const nodeLayer = s('g');
    const labelLayer = s('g');
    world.append(edgeLayer, nodeLayer, labelLayer);
    svg.appendChild(world);

    const maxY = Math.max(1, D.height);
    D.edges.forEach((e, i) => {
      const d = pathD(e.points);
      const { len, mid } = samplePath(e.points);
      const g = s('g', { class: 'edge', style: `--len:${Math.ceil(len)};--d:${(e.points[0][1] / maxY) * 0.6 + 0.15}s` });
      g.appendChild(s('path', { class: 'glow', d }));
      const line = s('path', { class: 'line', d, id: `ep${i}` });
      g.appendChild(line);
      g.appendChild(s('path', { class: 'hit', d }));
      const needsFlow = e.status === 'added' || violEdges.cur.has(e.id);
      if (needsFlow && !reduceMotion) {
        const dot = s('circle', { class: 'flow', r: 2.6 });
        const am = s('animateMotion', { dur: `${Math.max(1.6, len / 70).toFixed(2)}s`, repeatCount: 'indefinite', rotate: 'auto' });
        am.appendChild(s('mpath', { href: `#ep${i}` }));
        dot.appendChild(am);
        g.appendChild(dot);
      }
      edgeLayer.appendChild(g);
      const wrap = s('g', { class: 'edge' });
      const lg = s('g', { class: 'lbl', transform: `translate(${mid[0].toFixed(1)},${mid[1].toFixed(1)})` });
      const lr = s('rect', { rx: 8, height: 16, y: -8 });
      const lt = s('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5 });
      lg.append(lr, lt);
      wrap.appendChild(lg);
      labelLayer.appendChild(wrap);
      const onClick = (ev) => { if (!map.dragMoved) { ev.stopPropagation(); select({ type: 'edge', id: e.id }); } };
      [g, wrap].forEach((el) => {
        el.addEventListener('click', onClick);
        el.addEventListener('pointermove', (ev) => { if (!map.drag) showTip(ev, edgeTip(e)); });
        el.addEventListener('pointerleave', hideTip);
      });
      wrap.style.cursor = 'pointer';
      map.edgeEls.set(e.id, { g, line, lbl: wrap, lr, lt });
    });

    D.nodes.forEach((n, i) => {
      const p = n.pos;
      const g = s('g', { class: `node${n.external ? ' external' : ''}`, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': n.id });
      const inner = s('g', { style: `--d:${(p.y / maxY) * 0.5 + (i % 5) * 0.03}s` });
      inner.appendChild(s('rect', { class: 'card-r', width: p.w, height: p.h, rx: n.external ? p.h / 2 : 10 }));
      const ic = s('g', { class: 'n-ico', transform: `translate(12,${(p.h - 16) / 2}) scale(0.667)`, html: n.external ? ICONS.pkg : ICONS.box });
      inner.appendChild(ic);
      inner.appendChild(s('text', { class: 'n-name', x: 36, y: 20 }, short(n.id)));
      const meta = s('text', { class: 'n-meta', x: 36, y: 35 });
      inner.appendChild(meta);
      const badge = (cls, text, w) => s('g', { class: `nbadge ${cls}`, transform: `translate(${p.w - w - 8},-8)` }, s('rect', { width: w, height: 15, rx: 4 }), s('text', { x: w / 2, y: 10.5, 'text-anchor': 'middle' }, text));
      inner.appendChild(badge('b-add', 'NEW', 34));
      inner.appendChild(badge('b-rem', 'GONE', 38));
      g.appendChild(inner);
      g.addEventListener('click', (ev) => { if (!map.dragMoved) { ev.stopPropagation(); select({ type: 'node', id: n.id }); } });
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select({ type: 'node', id: n.id }); } });
      g.addEventListener('pointermove', (ev) => { if (!map.drag) showTip(ev, nodeTip(n)); });
      g.addEventListener('pointerleave', hideTip);
      nodeLayer.appendChild(g);
      map.nodeEls.set(n.id, { g, inner, meta });
    });
    svg.addEventListener('click', () => { if (!map.dragMoved && state.selected) select(null); });
    map.world = world;
    map.svg = svg;
    map.built = true;
    applyMap();
  }

  function present(status) {
    if (state.view === 'diff') return true;
    return state.view === 'base' ? status !== 'added' : status !== 'removed';
  }
  const activeViol = () => (state.view === 'base' ? violEdges.base : violEdges.cur);

  function applyMap() {
    if (!map.built) return;
    const av = activeViol();
    const sel = state.selected;
    let keepN = null;
    let keepE = null;
    if (sel) {
      keepN = new Set(); keepE = new Set();
      if (sel.type === 'node') {
        keepN.add(sel.id);
        D.edges.forEach((e) => { if ((e.from === sel.id || e.to === sel.id) && present(e.status)) { keepE.add(e.id); keepN.add(e.from); keepN.add(e.to); } });
      } else if (sel.type === 'edge') {
        const se = edgesById.get(sel.id); keepE.add(se.id); keepN.add(se.from); keepN.add(se.to);
      } else {
        violById.get(sel.id).edges.forEach((id) => { const x = edgesById.get(id); if (x) { keepE.add(id); keepN.add(x.from); keepN.add(x.to); } });
      }
    } else if (state.focusOnly && state.view === 'diff') {
      keepN = new Set(); keepE = new Set();
      D.edges.forEach((e) => { if (isChange(e) || av.has(e.id)) { keepE.add(e.id); keepN.add(e.from); keepN.add(e.to); } });
      D.nodes.forEach((n) => { if (n.status !== 'same') keepN.add(n.id); });
    }
    const violNodes = new Set();
    D.edges.forEach((e) => {
      const E = map.edgeEls.get(e.id);
      const show = present(e.status);
      const st = state.view === 'diff' ? e.status : 'same';
      const viol = av.has(e.id) && show && !(state.view === 'diff' && e.status === 'removed');
      if (viol) { violNodes.add(e.from); violNodes.add(e.to); }
      const isSel = sel && sel.type === 'edge' && sel.id === e.id;
      const extra = E.g.classList.contains('draw-in') ? ' draw-in' : '';
      const cls = `edge ${st}${viol ? ' viol' : ''}${isSel ? ' sel' : ''}${!show ? ' gone' : ''}${keepE && !keepE.has(e.id) ? ' dim' : ''}`;
      E.g.setAttribute('class', cls + extra);
      E.lbl.setAttribute('class', cls);
      const mk = isSel ? 'accent' : viol ? 'viol' : st === 'added' ? 'add' : st === 'removed' ? 'rem' : 'line';
      E.line.setAttribute('marker-end', `url(#arr-${mk})`);
      let txt;
      if (state.view === 'diff') {
        if (e.status === 'added') txt = `+${e.countCur}`;
        else if (e.status === 'removed') txt = `−${e.countBase}`;
        else txt = e.countBase === e.countCur ? String(e.countCur) : `${e.countBase}→${e.countCur}`;
      } else txt = String(state.view === 'base' ? e.countBase : e.countCur);
      if (viol) txt = `⚠ ${txt}`;
      E.lt.textContent = txt;
      const w = Math.max(20, txt.length * 6.3 + 12);
      E.lr.setAttribute('width', w); E.lr.setAttribute('x', -w / 2);
    });
    D.nodes.forEach((n) => {
      const N = map.nodeEls.get(n.id);
      const show = present(n.status);
      const st = state.view === 'diff' ? n.status : 'same';
      const isSel = sel && sel.type === 'node' && sel.id === n.id;
      N.g.setAttribute('class', `node${n.external ? ' external' : ''} ${st}${violNodes.has(n.id) ? ' inviol' : ''}${isSel ? ' sel' : ''}${!show ? ' gone' : ''}${keepN && !keepN.has(n.id) ? ' dim' : ''}`);
      const files = state.view === 'base' ? n.filesBase : state.view === 'cur' ? n.filesCur : (n.status === 'removed' ? n.filesBase : n.filesCur);
      N.meta.textContent = n.external ? 'npm package' : (state.view === 'diff' && n.status === 'same' && n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur} files` : plural(files, 'file'));
    });
    updateMinimapClasses(violNodes);
    renderDrawer();
  }

  function nodeTip(n) {
    const st = nodeStats.get(n.id);
    return `<div class="tt">${esc(short(n.id))}${n.status !== 'same' && hasBase ? ` <span class="badge ${n.status === 'added' ? 'add' : 'rem'}">${n.status === 'added' ? 'New' : 'Removed'}</span>` : ''}</div>`
      + `${n.external ? '<div class="kv"><span>npm package</span><b></b></div>' : `<div class="kv"><span>Files</span><b>${hasBase && n.filesBase !== n.filesCur ? `${n.filesBase} → ${n.filesCur}` : n.status === 'removed' ? n.filesBase : n.filesCur}</b></div>`}`
      + `<div class="kv"><span>Uses</span><b>${st.uses}</b></div><div class="kv"><span>Used by</span><b>${st.usedBy}</b></div>`
      + (st.viol ? `<div class="kv"><span>Rule breaks</span><b style="color:var(--viol-text)">${st.viol}</b></div>` : '');
  }
  function edgeTip(e) {
    const vs = activeViol().get(e.id) || [];
    const n = e.status === 'removed' ? e.countBase : e.countCur;
    return `<div class="tt">${esc(short(e.from))} <span class="faint">→</span> ${esc(short(e.to))}</div>`
      + `<div class="kv"><span>Imports</span><b>${e.status === 'same' && e.countBase !== e.countCur ? `${e.countBase} → ${e.countCur}` : n}</b></div>`
      + (hasBase ? `<div class="kv"><span>Status</span><b>${e.status === 'added' ? 'New' : e.status === 'removed' ? 'Removed' : 'Unchanged'}</b></div>` : '')
      + vs.map((v) => `<div class="kv" style="color:var(--viol-text)"><span>⚠ ${esc(v.rule)}</span></div>`).join('');
  }

  // ---- drawer
  function renderDrawer() {
    const dr = $('#drawer');
    if (!dr) return;
    const sel = state.selected;
    if (!sel) { dr.classList.remove('open'); return; }
    dr.innerHTML = '';
    const closeBtn = h('button', { class: 'btn icon ghost', 'aria-label': 'Close details', style: { marginLeft: 'auto' }, on: { click: () => select(null) } }, icon('x'));
    const body = h('div', { class: 'drawer-b' });
    let head;
    if (sel.type === 'node') {
      const n = nodesById.get(sel.id);
      const st = nodeStats.get(n.id);
      head = h('div', { class: 'drawer-h' },
        h('span', { class: `ico-box ${n.status === 'added' && hasBase ? 'add' : n.status === 'removed' ? 'rem' : ''}` }, icon(n.external ? 'pkg' : 'box')),
        h('div', { style: { minWidth: 0 } }, h('h3', { text: short(n.id) }), h('div', { class: 'sub' }, n.external ? 'npm package' : `${hasBase ? ({ added: 'New module', removed: 'Removed module', same: 'Module' })[n.status] : 'Module'} · ${plural(n.status === 'removed' ? n.filesBase : n.filesCur, 'file')}`)),
        closeBtn);
      body.append(h('div', { class: 'kv-grid' },
        h('div', null, h('div', { class: 'k', text: 'Uses' }), h('div', { class: 'v', text: st.uses })),
        h('div', null, h('div', { class: 'k', text: 'Used by' }), h('div', { class: 'v', text: st.usedBy })),
        h('div', null, h('div', { class: 'k', text: 'Rule breaks' }), h('div', { class: 'v', style: st.viol ? { color: 'var(--viol-text)' } : null, text: st.viol }))));
      const outs = D.edges.filter((e) => e.from === n.id && present(e.status));
      const ins = D.edges.filter((e) => e.to === n.id && present(e.status));
      [['Uses', outs, 'to'], ['Used by', ins, 'from']].forEach(([title, list, end]) => {
        if (!list.length) return;
        body.append(h('div', null, h('div', { class: 'sec-t', text: `${title} · ${list.length}` }), h('div', { class: 'pill-list' }, list.map((e) => {
          const vs = activeViol().get(e.id);
          return h('button', { class: 'pill-item', on: { click: () => select({ type: 'edge', id: e.id }) } },
            icon(e[end].startsWith('npm:') ? 'pkg' : 'box', 'faint'), h('span', { class: 'grow', text: short(e[end]) }),
            vs ? statusBadge('serious', 'Rule') : null,
            state.view === 'diff' && e.status !== 'same' ? kindBadge(e.status) : null,
            h('span', { class: 'faint num mono', style: { fontSize: '11.5px' }, text: String(e.status === 'removed' ? e.countBase : e.countCur) }));
        }))));
      });
      if (n.files.length) {
        const files = n.files.filter((f) => !(state.view === 'base' && f.status === 'added') && !(state.view === 'cur' && f.status === 'removed'));
        body.append(h('div', null, h('div', { class: 'sec-t', text: `Files · ${files.length}` }), h('div', { class: 'file-list' },
          files.slice(0, 300).map((f) => h('div', { class: state.view === 'diff' ? (f.status === 'added' ? 'plus' : f.status === 'removed' ? 'minus' : '') : '', text: `${state.view === 'diff' && f.status === 'added' ? '+ ' : state.view === 'diff' && f.status === 'removed' ? '− ' : ''}${f.path}` })))));
      }
    } else if (sel.type === 'edge') {
      const e = edgesById.get(sel.id);
      const vs = activeViol().get(e.id) || [];
      head = h('div', { class: 'drawer-h' },
        h('span', { class: `ico-box ${vs.length ? 'viol' : e.status === 'added' ? 'add' : e.status === 'removed' ? 'rem' : ''}` }, icon(vs.length ? 'alert' : 'link')),
        h('div', { style: { minWidth: 0 } }, h('h3', null, short(e.from), h('span', { class: 'arrow', text: ' → ' }), short(e.to)),
          h('div', { class: 'sub', text: `${hasBase ? ({ added: 'New dependency', removed: 'Removed dependency', same: 'Dependency' })[e.status] : 'Dependency'} · ${e.status === 'same' && e.countBase !== e.countCur ? `imports ${e.countBase} → ${e.countCur}` : plural(e.status === 'removed' ? e.countBase : e.countCur, 'import')}` })),
        closeBtn);
      vs.forEach((v) => body.append(h('div', { class: 'callout' }, icon('alert'), h('div', null, h('b', { text: `Breaks “${v.rule}”` }), v.message ? h('div', { text: v.message }) : null))));
      body.append(h('div', { class: 'pill-list' },
        [e.from, e.to].map((id) => h('button', { class: 'pill-item', on: { click: () => select({ type: 'node', id }) } }, icon(id.startsWith('npm:') ? 'pkg' : 'box', 'faint'), h('span', { class: 'grow', text: short(id) }), h('span', { class: 'faint', style: { fontSize: '12px' }, text: id === e.from ? 'imports' : 'is imported' })))));
      if (e.addedImports && e.addedImports.length) body.append(h('div', null, h('div', { class: 'sec-t', text: 'Added in this change' }), evidence(e.addedImports, 'plus')));
      body.append(h('div', null, h('div', { class: 'sec-t', text: e.status === 'removed' ? 'Where it used to happen' : 'Where it happens' }), evidence(e.imports)));
    } else {
      const v = violById.get(sel.id);
      head = h('div', { class: 'drawer-h' },
        h('span', { class: 'ico-box viol' }, icon(v.kind === 'cycle' ? 'cycle' : 'alert')),
        h('div', { style: { minWidth: 0 } }, h('h3', { text: v.rule }), h('div', { class: 'sub', text: v.status === 'new' ? 'New in this change' : v.status === 'fixed' ? 'Fixed by this change' : hasBase ? 'Already existed before this change' : 'Found in the current code' })),
        closeBtn);
      body.append(h('div', null, violBadge(v), ' ', statusBadge(v.severity === 'error' ? 'critical' : 'warn', v.severity === 'error' ? 'Error' : 'Warning')));
      if (v.message) body.append(h('div', { class: 'callout' }, icon('alert'), v.message));
      body.append(h('div', { class: 'muted', text: v.kind === 'cycle' ? `These modules depend on each other in a loop: ${v.members.map(short).join(' ⇄ ')}` : `${short(v.from)} is not allowed to use ${short(v.to)}.` }));
      body.append(h('div', null, h('div', { class: 'sec-t', text: 'Where it happens' }), evidence(v.imports)));
    }
    dr.append(head, body);
    dr.classList.add('open');
  }

  function select(sel, reveal) {
    state.selected = sel && state.selected && state.selected.type === sel.type && state.selected.id === sel.id && !reveal ? null : sel;
    const s2 = state.selected;
    if (s2 && hasBase) {
      const obj = s2.type === 'node' ? nodesById.get(s2.id) : s2.type === 'edge' ? edgesById.get(s2.id) : null;
      const v = s2.type === 'viol' ? violById.get(s2.id) : null;
      if (state.view === 'cur' && ((obj && obj.status === 'removed') || (v && v.status === 'fixed'))) state.view = 'diff';
      if (state.view === 'base' && ((obj && obj.status === 'added') || (v && v.status === 'new'))) state.view = 'diff';
      const vt = $('#view-tabs'); if (vt) vt._set(state.view);
    }
    hideTip();
    applyMap();
    if (s2 && reveal) revealSelection();
  }
  function goSelect(sel) { go('map'); setTimeout(() => select(sel, true), 30); }

  // ---- pan / zoom
  function setVB() {
    const vb = map.vb;
    map.svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const r = $('#stage').getBoundingClientRect();
    const pctEl = $('#zoom-pct');
    if (pctEl && r.width) pctEl.textContent = `${Math.round((r.width / vb.w) * 100)}%`;
    updateMinimapViewport();
  }
  function stageRect() { return $('#stage').getBoundingClientRect(); }
  function fitTo(x0, y0, x1, y1, pad, animate) {
    const r = stageRect();
    const W = Math.max(1, r.width); const H = Math.max(1, r.height);
    const drawerW = state.selected && $('#drawer').classList.contains('open') && W > 700 ? Math.min(400, W) : 0;
    const topPad = 64;
    const cw = (x1 - x0) + pad * 2; const ch = (y1 - y0) + pad * 2 + topPad;
    const sc = Math.max(cw / (W - drawerW), ch / H, 0.55);
    const target = { w: W * sc, h: H * sc };
    target.x = (x0 + x1) / 2 - ((W - drawerW) * sc) / 2;
    target.y = (y0 + y1) / 2 - target.h / 2 - (topPad / 2) * sc; // leave room for the floating toolbar
    animateVB(target, animate);
  }
  let vbAnim = null;
  function animateVB(target, animate) {
    cancelAnimationFrame(vbAnim);
    if (!animate || reduceMotion) { Object.assign(map.vb, target); setVB(); return; }
    const from = { ...map.vb };
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 420);
      const k = 1 - (1 - p) ** 3;
      ['x', 'y', 'w', 'h'].forEach((key) => { map.vb[key] = from[key] + (target[key] - from[key]) * k; });
      setVB();
      if (p < 1) vbAnim = requestAnimationFrame(step);
    };
    vbAnim = requestAnimationFrame(step);
  }
  function fit(animate) { fitTo(0, -10, D.width, D.height, 48, animate); }
  function revealSelection() {
    const sel = state.selected;
    if (!sel) return;
    let ids = [];
    if (sel.type === 'node') {
      ids = [sel.id];
      D.edges.forEach((e) => { if ((e.from === sel.id || e.to === sel.id) && present(e.status)) ids.push(e.from, e.to); });
    } else if (sel.type === 'edge') { const e = edgesById.get(sel.id); ids = [e.from, e.to]; } else violById.get(sel.id).edges.forEach((k) => { const e = edgesById.get(k); if (e) ids.push(e.from, e.to); });
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    ids.forEach((id) => { const p = nodesById.get(id).pos; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); });
    fitTo(x0, y0, x1, y1, 90, true);
  }
  function zoom(f, cx, cy) {
    const r = stageRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const vb = map.vb;
    const px = vb.x + (cx / r.width) * vb.w; const py = vb.y + (cy / r.height) * vb.h;
    const nw = Math.min(Math.max(vb.w * f, 180), Math.max(D.width, D.height) * 6 + 2400);
    const k = nw / vb.w;
    vb.x = px - (px - vb.x) * k; vb.y = py - (py - vb.y) * k; vb.w *= k; vb.h *= k;
    setVB();
  }
  function wirePanZoom(stage) {
    stage.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = stageRect();
      if (ev.ctrlKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX) * 1.2 || ev.deltaMode) zoom(Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016)), ev.clientX - r.left, ev.clientY - r.top);
      else { map.vb.x += ev.deltaX * map.vb.w / r.width; map.vb.y += ev.deltaY * map.vb.h / r.height; setVB(); }
    }, { passive: false });
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      map.drag = { x: ev.clientX, y: ev.clientY, vx: map.vb.x, vy: map.vb.y }; map.dragMoved = false;
    });
    window.addEventListener('pointermove', (ev) => {
      if (!map.drag) return;
      const dx = ev.clientX - map.drag.x; const dy = ev.clientY - map.drag.y;
      if (!map.dragMoved && Math.abs(dx) + Math.abs(dy) > 4) { map.dragMoved = true; stage.classList.add('dragging'); hideTip(); }
      if (!map.dragMoved) return;
      const r = stageRect();
      map.vb.x = map.drag.vx - dx * map.vb.w / r.width; map.vb.y = map.drag.vy - dy * map.vb.h / r.height; setVB();
    });
    window.addEventListener('pointerup', () => { map.drag = null; stage.classList.remove('dragging'); setTimeout(() => { map.dragMoved = false; }, 0); });
  }

  // ---- minimap
  function buildMinimap(box) {
    const pad = 20;
    const svg = s('svg', { viewBox: `${-pad} ${-pad} ${D.width + pad * 2} ${D.height + pad * 2}`, preserveAspectRatio: 'xMidYMid meet' });
    const g = s('g');
    D.edges.forEach((e) => g.appendChild(s('path', { d: pathD(e.points), style: 'fill:none;stroke:var(--border-strong);stroke-width:2', 'vector-effect': 'non-scaling-stroke' })));
    D.nodes.forEach((n) => { const r = s('rect', { class: 'mn', x: n.pos.x, y: n.pos.y, width: n.pos.w, height: n.pos.h, rx: 8, dataset: null }); r.dataset.id = n.id; g.appendChild(r); });
    const vp = s('rect', { class: 'vp', rx: 6 });
    svg.append(g, vp);
    box.appendChild(svg);
    map.mini = { svg, vp, pad };
    const jump = (ev) => {
      const r = svg.getBoundingClientRect();
      const vbW = D.width + pad * 2; const vbH = D.height + pad * 2;
      const scale = Math.max(vbW / r.width, vbH / r.height);
      const offX = (r.width * scale - vbW) / 2; const offY = (r.height * scale - vbH) / 2;
      const x = (ev.clientX - r.left) * scale - offX - pad; const y = (ev.clientY - r.top) * scale - offY - pad;
      animateVB({ ...map.vb, x: x - map.vb.w / 2, y: y - map.vb.h / 2 }, ev.type === 'click');
    };
    let dragging = false;
    box.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); dragging = true; jump(ev); });
    window.addEventListener('pointermove', (ev) => { if (dragging) jump(ev); });
    window.addEventListener('pointerup', () => { dragging = false; });
  }
  function updateMinimapViewport() {
    if (!map.mini) return;
    const vb = map.vb;
    const vp = map.mini.vp;
    vp.setAttribute('x', vb.x); vp.setAttribute('y', vb.y); vp.setAttribute('width', vb.w); vp.setAttribute('height', vb.h);
  }
  function updateMinimapClasses(violNodes) {
    if (!map.mini) return;
    $$('rect.mn', map.mini.svg).forEach((r) => {
      const n = nodesById.get(r.dataset.id);
      const st = state.view === 'diff' ? n.status : 'same';
      r.setAttribute('class', `mn ${st}${violNodes.has(n.id) ? ' inviol' : ''}`);
      r.style.opacity = present(n.status) ? '' : '0';
    });
  }

  // ---- intro animation (first visit to the map)
  function introAnimation() {
    if (map.animated || reduceMotion) { map.animated = true; return; }
    map.animated = true;
    map.edgeEls.forEach((E) => E.g.classList.add('draw-in'));
    map.nodeEls.forEach((N) => N.inner.classList.add('pop-in'));
    $$('.lbl', map.world).forEach((l) => { l.style.opacity = '0'; l.style.transition = 'opacity .4s'; });
    setTimeout(() => $$('.lbl', map.world).forEach((l) => { l.style.opacity = ''; }), 900);
    setTimeout(() => {
      map.edgeEls.forEach((E) => E.g.classList.remove('draw-in'));
      map.nodeEls.forEach((N) => N.inner.classList.remove('pop-in'));
    }, 1900);
  }

  // ---- export
  function exportSvg() {
    const src = map.svg;
    const clone = src.cloneNode(true);
    const pad = 32;
    clone.setAttribute('viewBox', `${-pad} ${-pad - 10} ${D.width + pad * 2} ${D.height + pad * 2 + 10}`);
    clone.setAttribute('width', D.width + pad * 2);
    clone.setAttribute('height', D.height + pad * 2 + 10);
    clone.setAttribute('xmlns', SVGNS);
    const origEls = [src, ...src.querySelectorAll('*')];
    const cloneEls = [clone, ...clone.querySelectorAll('*')];
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'display'];
    origEls.forEach((o, i) => {
      const cs = getComputedStyle(o);
      const c = cloneEls[i];
      if (o.classList && (o.classList.contains('gone') || o.classList.contains('hit') || o.classList.contains('flow'))) { c.setAttribute('data-drop', '1'); return; }
      c.setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
      c.removeAttribute('class');
    });
    clone.querySelectorAll('[data-drop]').forEach((e) => e.remove());
    const bg = s('rect', { x: -20000, y: -20000, width: 40000, height: 40000, style: `fill:${getComputedStyle(document.body).backgroundColor}` });
    clone.insertBefore(bg, clone.firstChild);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`], { type: 'image/svg+xml' });
    download(blob, `${D.project}-architecture.svg`);
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

  // ------------------------------------------------------------------ command palette
  const pal = { items: [], filtered: [], idx: 0 };
  function buildPaletteItems() {
    const items = [];
    PAGES.forEach((p) => items.push({ group: 'Pages', label: p.title, icon: p.icon, run: () => go(p.id) }));
    internalNodes.forEach((n) => items.push({ group: 'Modules', label: n.id, hint: plural(n.status === 'removed' ? n.filesBase : n.filesCur, 'file'), icon: 'box', run: () => goSelect({ type: 'node', id: n.id }) }));
    D.edges.forEach((e) => items.push({ group: 'Dependencies', label: `${short(e.from)} → ${short(e.to)}`, hint: hasBase && e.status !== 'same' ? (e.status === 'added' ? 'new' : 'removed') : plural(e.countCur || e.countBase, 'import'), icon: 'link', run: () => goSelect({ type: 'edge', id: e.id }) }));
    (D.system ? D.system.apps : []).forEach((a) => items.push({ group: 'Architecture', label: `${a.name} (${a.framework} app)`, icon: appIcon(a), run: () => { go('system'); setTimeout(() => openSys({ type: 'app', id: a.id }), 60); } }));
    (D.system ? [...D.system.stores, ...D.system.outside] : []).forEach((x) => items.push({ group: 'Architecture', label: x.name, hint: x.kind, icon: D.system.stores.includes(x) ? 'database' : 'cloud', run: () => { go('system'); setTimeout(() => openSys({ type: 'svc', id: x.id }), 60); } }));
    (D.system ? D.system.apps : []).forEach((a) => ['pages', 'api', 'endpoints', 'jobs'].forEach((g) => (a.groups[g] || []).forEach((x) => items.push({ group: 'Entry points', label: `${x.methods && x.methods.length ? `${x.methods.join('/')} ` : ''}${x.label}`, hint: a.name, icon: g === 'jobs' ? 'terminal' : g === 'pages' ? 'file' : 'code', run: () => { go('system'); setTimeout(() => openSys({ type: 'item', app: a.id, group: g, key: x.key }), 60); } }))));
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
    const input = h('input', { placeholder: 'Search modules, dependencies, rules, actions…', 'aria-label': 'Command palette search', autocomplete: 'off' });
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
      const groups = ['Pages', 'Architecture', 'Rules', 'Modules', 'Entry points', 'Dependencies', 'Actions'];
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

  // ------------------------------------------------------------------ routing
  function go(page) { if (location.hash !== `#${page}`) location.hash = page; else show(page); }
  let countedUp = false;
  function show(page) {
    if (!PAGES.some((p) => p.id === page)) page = 'overview';
    state.page = page;
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
    $('#crumb-cur').textContent = PAGES.find((p) => p.id === page).title;
    document.title = `${PAGES.find((p) => p.id === page).title} · ${D.project} · Tecton`;
    $('#content').scrollTop = 0;
    hideTip();
    requestAnimationFrame(placeTabs);
    if (page === 'overview' && !countedUp) {
      countedUp = true;
      $$('[data-count]', $('#page-overview')).forEach((el) => countUp(el, Number(el.dataset.count)));
    }
    if (page !== 'system') closeSheet();
    if (page === 'system') renderSystem();
    if (page === 'map') {
      requestAnimationFrame(() => {
        if (!map.fitted) { fit(false); map.fitted = true; }
        introAnimation();
      });
    }
  }
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
    if (state.page === 'map' && (e.key === 'f' || e.key === 'F')) fit(true);
    if (/^[1-6]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) go(PAGES[Number(e.key) - 1].id);
  });

  // ------------------------------------------------------------------ boot
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
    svg.appendChild(clone);
    box.insertBefore(svg, box.firstChild);
  })();
  window.addEventListener('resize', () => { placeTabs(); if (state.page === 'map' && !state.selected) fit(false); });
  show(location.hash.slice(1) || 'overview');
})();
