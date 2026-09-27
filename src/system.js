// The "system" view: a C4-style architecture picture read straight from the code.
//   apps        each package.json is an app (Next.js site, API server, worker…)
//   entry pts   pages, API routes, HTTP endpoints and npm-script jobs inside each app
//   data        databases / storage the code talks to (from the libraries it imports)
//   outside     external services: hosts in URL literals + well-known SDKs
//   links       app → app (e.g. BACKEND_URL), app → data, app → outside services
import path from 'node:path';
import { stripComments, parseJsonc } from './scan.js';
import { globToRegex } from './graph.js';

const MAX_EVIDENCE = 25;
const EXCLUDE = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/__mocks__/**', '**/*.stories.*', '**/*.config.*',
  '**/test/**', '**/tests/**'].map(globToRegex);

// ---------------------------------------------------------------- knowledge tables
const STORES = [
  { match: /^(node:sqlite|better-sqlite3|sqlite3|sqlite|@libsql\/client)$/, id: 'sqlite', name: 'SQLite', kind: 'Database' },
  { match: /^(pg|postgres|@neondatabase\/serverless|@vercel\/postgres|pg-promise|slonik)$/, id: 'postgres', name: 'PostgreSQL', kind: 'Database' },
  { match: /^(mysql|mysql2|@planetscale\/database)$/, id: 'mysql', name: 'MySQL', kind: 'Database' },
  { match: /^(mongodb|mongoose)$/, id: 'mongodb', name: 'MongoDB', kind: 'Database' },
  { match: /^(redis|ioredis|@upstash\/redis|@vercel\/kv)$/, id: 'redis', name: 'Redis', kind: 'Cache / store' },
  { match: /^@prisma\/client$/, id: 'prisma', name: 'Database via Prisma', kind: 'Database' },
  { match: /^drizzle-orm(\/.*)?$/, id: 'drizzle', name: 'Database via Drizzle', kind: 'Database' },
  { match: /^(typeorm|sequelize|knex|kysely|@mikro-orm\/core)$/, id: 'sql-orm', name: 'SQL database (ORM)', kind: 'Database' },
  { match: /^@supabase\/supabase-js$/, id: 'supabase', name: 'Supabase', kind: 'Database' },
  { match: /^(firebase-admin|firebase)(\/firestore)?$|^@google-cloud\/firestore$/, id: 'firestore', name: 'Firebase / Firestore', kind: 'Database' },
  { match: /^@aws-sdk\/client-dynamodb$|^@aws-sdk\/lib-dynamodb$/, id: 'dynamodb', name: 'DynamoDB', kind: 'Database' },
  { match: /^@aws-sdk\/client-s3$|^@vercel\/blob$|^@google-cloud\/storage$/, id: 'blob', name: 'File storage', kind: 'Storage' },
  { match: /^@elastic\/elasticsearch$|^@opensearch-project\/opensearch$/, id: 'search', name: 'Elasticsearch', kind: 'Search' },
];
const SDKS = [
  [/^stripe$/, 'Stripe', 'Payments'], [/^razorpay$/, 'Razorpay', 'Payments'],
  [/^openai$/, 'OpenAI', 'AI'], [/^@anthropic-ai\/sdk$/, 'Anthropic', 'AI'], [/^@google\/generative-ai$|^@google\/genai$/, 'Google Gemini', 'AI'],
  [/^nodemailer$/, 'SMTP email', 'Email'], [/^resend$/, 'Resend', 'Email'], [/^@sendgrid\/mail$/, 'SendGrid', 'Email'], [/^postmark$/, 'Postmark', 'Email'],
  [/^twilio$/, 'Twilio', 'SMS'], [/^@sentry\//, 'Sentry', 'Monitoring'], [/^posthog-(js|node)$/, 'PostHog', 'Analytics'],
  [/^@vercel\/analytics/, 'Vercel Analytics', 'Analytics'], [/^mixpanel/, 'Mixpanel', 'Analytics'],
  [/^@clerk\//, 'Clerk', 'Auth'], [/^@auth0\//, 'Auth0', 'Auth'], [/^next-auth$|^@auth\/core$/, 'Auth.js', 'Auth'],
  [/^algoliasearch$/, 'Algolia', 'Search'], [/^@pinecone-database\//, 'Pinecone', 'Vector DB'], [/^cloudinary$/, 'Cloudinary', 'Media'],
  [/^pusher(-js)?$/, 'Pusher', 'Realtime'], [/^ably$/, 'Ably', 'Realtime'], [/^@slack\/web-api$/, 'Slack', 'Messaging'],
  [/^googleapis$/, 'Google APIs', 'API'], [/^@octokit\//, 'GitHub API', 'API'],
];
const FRAMEWORKS = [
  ['next', 'Next.js', 'web'], ['nuxt', 'Nuxt', 'web'], ['@remix-run/react', 'Remix', 'web'], ['@sveltejs/kit', 'SvelteKit', 'web'],
  ['astro', 'Astro', 'web'], ['@angular/core', 'Angular', 'web'], ['vue', 'Vue', 'web'], ['react-native', 'React Native', 'mobile'], ['expo', 'Expo', 'mobile'],
  ['@nestjs/core', 'NestJS', 'server'], ['express', 'Express', 'server'], ['fastify', 'Fastify', 'server'], ['koa', 'Koa', 'server'],
  ['hono', 'Hono', 'server'], ['@hapi/hapi', 'hapi', 'server'], ['electron', 'Electron', 'desktop'],
  ['react', 'React', 'web'],
];
const NOTABLE = ['typescript', 'tailwindcss', '@tanstack/react-query', 'zod', 'prisma', 'drizzle-orm', 'trpc', '@trpc/server', 'graphql',
  'socket.io', 'bullmq', 'node-cron', 'recharts', 'framer-motion', 'next-themes'];
const IGNORE_HOSTS = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local$|.*\.test$|.*\.example$|(www\.)?example\.(com|org|net)$|(www\.)?w3\.org$|schema\.org$|json-schema\.org$|(www\.)?schemas\.|.*\.xmlsoap\.org$|purl\.org$)/;

// ---------------------------------------------------------------- helpers
const rel = (root, f) => (root ? f.slice(root.length + 1) : f);
function lineAt(text, idx) { let n = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++; return n; }
function domainOf(host) {
  const parts = host.split('.');
  const two = parts.slice(-2).join('.');
  if (parts.length > 2 && /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join('.');
  return two;
}
function importSpecs(code) {
  const out = [];
  const re = /(?:^|[^.\w$])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s*)?['"]([^'"\n]+)['"]|(?:^|[^.\w$])(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code))) out.push({ spec: m[1] || m[2], idx: m.index });
  return out;
}
const pkgName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/** Turn a Next.js app-router file path into its URL, e.g. app/(shell)/pans/page.tsx -> /pans */
function nextRoute(relPath, kind) {
  const segs = relPath.split('/');
  const i = segs.indexOf('app') >= 0 ? segs.indexOf('app') : segs.indexOf('pages');
  const parts = segs.slice(i + 1, -1).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  if (kind === 'pages-router') {
    const last = segs[segs.length - 1].replace(/\.(t|j)sx?$/, '');
    if (last !== 'index') parts.push(last);
  }
  return `/${parts.join('/')}`;
}

// ---------------------------------------------------------------- main
export function detectSystem(source, graph, cfg = {}) {
  // 1. apps = folders with a package.json (deepest one owns a file)
  const manifests = (source.manifests || []).filter((m) => !m.includes('node_modules/'));
  const apps = [];
  for (const m of manifests) {
    let pkg;
    try { pkg = parseJsonc(source.read(m) || '{}'); } catch { continue; }
    const root = path.posix.dirname(m) === '.' ? '' : path.posix.dirname(m);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const fw = FRAMEWORKS.find(([d]) => deps[d]);
    apps.push({
      id: root || '.', root, name: root ? root.split('/').pop() : (pkg.name || 'app'), pkgName: pkg.name || null,
      framework: fw ? fw[1] : 'Node.js', role: fw ? fw[2] : 'service',
      tech: NOTABLE.filter((d) => deps[d]).map((d) => d.replace(/^@[^/]+\//, '').replace(/^@/, '')),
      scripts: pkg.scripts || {}, files: [],
    });
  }
  const workspaceOnly = (a) => a.root === '' && apps.length > 1 && !apps.some((b) => b !== a && b.root === '') && a.role === 'service' && a.files.length === 0;
  if (!apps.length) apps.push({ id: '.', root: '', name: cfg.project || 'app', framework: 'Node.js', role: 'service', tech: [], scripts: {}, files: [] });
  const byDepth = [...apps].sort((a, b) => b.root.length - a.root.length);
  const appOf = (f) => byDepth.find((a) => !a.root || f.startsWith(`${a.root}/`));
  const files = source.files.filter((f) => !EXCLUDE.some((re) => re.test(f)));
  for (const f of files) { const a = appOf(f); if (a) a.files.push(f); }

  const stores = new Map();
  const outside = new Map();
  const links = new Map();
  const addEv = (list, ev) => { if (list.length < MAX_EVIDENCE) list.push(ev); };
  const link = (from, to, kind, label, ev) => {
    const key = `${from}→${to}`;
    if (!links.has(key)) links.set(key, { id: key, from, to, kind, labels: new Set(), evidence: [], count: 0 });
    const l = links.get(key); l.count++; if (label) l.labels.add(label); if (ev) addEv(l.evidence, ev);
  };
  const envRefs = new Map(); // app id -> [{name, file, line}]

  for (const app of apps) {
    app.groups = { pages: [], api: [], endpoints: [], jobs: [] };
    const tsx = app.files.some((f) => /\.tsx?$/.test(f));
    if (tsx && !app.tech.includes('typescript')) app.tech.unshift('typescript');
    const isNext = app.framework === 'Next.js';

    for (const f of app.files) {
      const text = source.read(f);
      if (text == null) continue;
      const code = stripComments(text);
      const r = rel(app.root, f);
      const mod = graph && graph.moduleOf ? graph.moduleOf.get(f) : null;

      // entry points
      if (isNext) {
        if (/(^|\/)app\/(.*\/)?page\.(t|j)sx?$/.test(r)) app.groups.pages.push({ key: nextRoute(r, 'app'), label: nextRoute(r, 'app'), file: f, line: 1 });
        else if (/(^|\/)app\/(.*\/)?route\.(t|j)sx?$/.test(r)) {
          const methods = [...code.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
          const route = nextRoute(r, 'app');
          app.groups.api.push({ key: route, label: route, methods: [...new Set(methods)], file: f, line: 1 });
        } else if (/(^|\/)pages\/api\//.test(r)) app.groups.api.push({ key: nextRoute(r, 'pages-router'), label: nextRoute(r, 'pages-router'), methods: [], file: f, line: 1 });
        else if (/(^|\/)pages\/(?!_)[^/]+/.test(r) && /\.(t|j)sx?$/.test(r)) app.groups.pages.push({ key: nextRoute(r, 'pages-router'), label: nextRoute(r, 'pages-router'), file: f, line: 1 });
      }
      if (app.role === 'server') {
        for (const m of code.matchAll(/\b[\w$]+\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*['"`](\/[^'"`\s]*)['"`]/g)) {
          const method = m[1].toUpperCase();
          app.groups.endpoints.push({ key: `${method} ${m[2]}`, label: m[2], methods: [method], file: f, line: lineAt(code, m.index) });
        }
      }

      // imports -> data stores and SDK services
      for (const { spec, idx } of importSpecs(code)) {
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~/')) continue;
        const bare = spec.startsWith('node:') ? spec : pkgName(spec);
        const ev = { file: f, line: lineAt(code, idx), text: spec, module: mod };
        const st = STORES.find((x) => x.match.test(bare) || x.match.test(spec));
        if (st) {
          if (!stores.has(st.id)) stores.set(st.id, { id: `store:${st.id}`, name: st.name, kind: st.kind, via: new Set(), evidence: [], apps: new Set() });
          const S = stores.get(st.id); S.via.add(bare); S.apps.add(app.id); addEv(S.evidence, ev);
          link(app.id, `store:${st.id}`, 'data', null, ev);
          continue;
        }
        const sdk = SDKS.find(([re]) => re.test(bare));
        if (sdk) {
          const id = `svc:${sdk[1].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          if (!outside.has(id)) outside.set(id, { id, name: sdk[1], kind: sdk[2], hosts: new Set(), via: new Set(), evidence: [], apps: new Set() });
          const O = outside.get(id); O.via.add(bare); O.apps.add(app.id); addEv(O.evidence, ev);
          link(app.id, id, 'outside', sdk[2], ev);
        }
      }

      // URL literals -> outside services (skip JSX href/src links, which are just links for users)
      for (const m of code.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\[[^\]]+\])(?::\d+)?[^\s'"`)]*/gi)) {
        const host = m[1].toLowerCase();
        if (IGNORE_HOSTS.test(host)) continue;
        const before = code.slice(Math.max(0, m.index - 24), m.index);
        if (/(href|src|action|srcSet|xmlns(:\w+)?)\s*=\s*\{?\s*["'`]?$/.test(before)) continue;
        const dom = domainOf(host.replace(/^www\./, ''));
        const id = `web:${dom}`;
        if (!outside.has(id)) outside.set(id, { id, name: dom, kind: 'Web / HTTP', hosts: new Set(), via: new Set(), evidence: [], apps: new Set() });
        const O = outside.get(id); O.hosts.add(host); O.apps.add(app.id);
        const ev = { file: f, line: lineAt(code, m.index), text: m[0].slice(0, 90), module: mod };
        addEv(O.evidence, ev);
        link(app.id, id, 'outside', 'HTTPS', ev);
      }

      // env vars that point at another service (BACKEND_URL, API_BASE_URL, …)
      for (const m of code.matchAll(/(?:process\.env\.|import\.meta\.env\.)([A-Z0-9_]*(?:BACKEND|API|SERVER|SERVICE|GATEWAY)[A-Z0-9_]*(?:URL|ORIGIN|HOST|BASE|ENDPOINT)[A-Z0-9_]*)/g)) {
        if (!envRefs.has(app.id)) envRefs.set(app.id, []);
        envRefs.get(app.id).push({ name: m[1], file: f, line: lineAt(code, m.index), text: `process.env.${m[1]}`, module: mod });
      }
    }

    // npm scripts that run a file = jobs / CLIs
    for (const [name, cmd] of Object.entries(app.scripts)) {
      if (/^(start|dev|build|test|lint|format|prepare|postinstall|preview|typecheck|type-check|serve)$/.test(name)) continue;
      const m = String(cmd).match(/\b(?:node|tsx|ts-node|bun|deno run)\b[^&|;]*?\s((?:\.\/)?[\w./-]+\.(?:m?js|cjs|ts|mts))/);
      if (!m) continue;
      const file = path.posix.normalize(path.posix.join(app.root, m[1]));
      app.groups.jobs.push({ key: name, label: name, file, line: 1, cmd: String(cmd).slice(0, 120) });
    }
    for (const g of Object.values(app.groups)) {
      const seen = new Set();
      const uniq = g.filter((x) => (seen.has(x.key) ? false : seen.add(x.key)));
      g.length = 0; g.push(...uniq.sort((a, b) => a.key.localeCompare(b.key)));
    }
  }

  // 2. app -> app over HTTP, matched through env vars like BACKEND_URL
  const servers = apps.filter((a) => a.role === 'server' || a.groups.endpoints.length);
  for (const [appId, refs] of envRefs) {
    const candidates = servers.filter((s) => s.id !== appId);
    if (!candidates.length) continue;
    const byName = new Map();
    for (const r of refs) {
      const target = candidates.find((s) => r.name.toLowerCase().includes(s.name.toLowerCase())) || candidates[0];
      if (!byName.has(target.id)) byName.set(target.id, []);
      byName.get(target.id).push(r);
    }
    for (const [target, rs] of byName) {
      const names = [...new Set(rs.map((r) => r.name))];
      rs.forEach((r) => link(appId, target, 'app', `HTTP · ${names.join(', ')}`, r));
    }
  }

  // 3. who is the front door? web apps get "Users"; servers nobody in the repo calls get "Clients"
  const called = new Set([...links.values()].filter((l) => l.kind === 'app').map((l) => l.to));
  const finalApps = apps.filter((a) => a.files.length || !workspaceOnly(a));
  const entry = [];
  for (const a of finalApps) {
    if (['web', 'mobile', 'desktop'].includes(a.role)) entry.push(a.id);
    else if (a.groups.endpoints.length && !called.has(a.id)) entry.push(a.id);
  }
  for (const id of entry) link('users', id, 'users', 'HTTPS', null);

  // module summary per app (from the dependency graph)
  const modsByApp = new Map();
  if (graph && graph.moduleOf) {
    for (const [f, m] of graph.moduleOf) {
      const a = appOf(f); if (!a) continue;
      if (!modsByApp.has(a.id)) modsByApp.set(a.id, new Map());
      const mm = modsByApp.get(a.id); mm.set(m, (mm.get(m) || 0) + 1);
    }
  }

  return {
    apps: finalApps.map((a) => ({
      id: a.id, root: a.root, name: a.name, pkgName: a.pkgName, framework: a.framework, role: a.role, tech: a.tech.slice(0, 5),
      fileCount: a.files.length,
      modules: [...(modsByApp.get(a.id) || new Map())].sort((x, y) => y[1] - x[1]).map(([name, files]) => ({ name, files })),
      groups: a.groups,
    })),
    stores: [...stores.values()].map((s) => ({ ...s, via: [...s.via], apps: [...s.apps] })),
    outside: [...outside.values()].map((o) => ({ ...o, hosts: [...o.hosts].sort(), via: [...o.via], apps: [...o.apps] }))
      .sort((a, b) => b.evidence.length - a.evidence.length || a.name.localeCompare(b.name)),
    links: [...links.values()].map((l) => ({ ...l, labels: [...l.labels] })),
    hasUsers: entry.length > 0,
  };
}

// ---------------------------------------------------------------- base vs current
const st = (b, c) => (b && c ? 'same' : c ? 'added' : 'removed');

function mergeList(bl = [], cl = [], key = (x) => x.key) {
  const bm = new Map(bl.map((x) => [key(x), x]));
  const cm = new Map(cl.map((x) => [key(x), x]));
  const keys = [...new Set([...bm.keys(), ...cm.keys()])];
  return keys.map((k) => ({ ...(cm.get(k) || bm.get(k)), status: st(bm.has(k), cm.has(k)) }));
}

export function diffSystems(base, cur) {
  const apps = mergeList(base.apps, cur.apps, (a) => a.id).map((a) => {
    const b = base.apps.find((x) => x.id === a.id);
    const c = cur.apps.find((x) => x.id === a.id);
    const groups = {};
    for (const g of ['pages', 'api', 'endpoints', 'jobs']) {
      groups[g] = mergeList(b ? b.groups[g] : [], c ? c.groups[g] : []).sort((x, y) => x.key.localeCompare(y.key));
    }
    return { ...a, groups, fileCountBase: b ? b.fileCount : 0, fileCount: c ? c.fileCount : 0 };
  });
  const stores = mergeList(base.stores, cur.stores, (s) => s.id);
  const outside = mergeList(base.outside, cur.outside, (o) => o.id).map((o) => {
    const b = base.outside.find((x) => x.id === o.id);
    const c = cur.outside.find((x) => x.id === o.id);
    const bh = new Set(b ? b.hosts : []); const ch = new Set(c ? c.hosts : []);
    return { ...o, hosts: [...new Set([...bh, ...ch])].sort().map((h) => ({ host: h, status: st(bh.has(h), ch.has(h)) })) };
  });
  const links = mergeList(base.links, cur.links, (l) => l.id);
  const count = (arr, s) => arr.filter((x) => x.status === s).length;
  const allItems = apps.flatMap((a) => Object.values(a.groups).flat());
  return {
    apps, stores, outside, links, hasUsers: base.hasUsers || cur.hasUsers,
    summary: {
      apps: { total: cur.apps.length, added: count(apps, 'added'), removed: count(apps, 'removed') },
      entry: { total: allItems.filter((x) => x.status !== 'removed').length, added: count(allItems, 'added'), removed: count(allItems, 'removed') },
      stores: { total: cur.stores.length, added: count(stores, 'added'), removed: count(stores, 'removed') },
      outside: { total: cur.outside.length, added: count(outside, 'added'), removed: count(outside, 'removed') },
    },
  };
}
