// The "system" view: a C4-style architecture picture read straight from the code.
//   apps        each package.json is an app (Next.js site, API server, worker…)
//   entry pts   pages, API routes, HTTP endpoints (with router prefixes), npm-script jobs and cron schedules
//   data        databases, storage and queues the code talks to (from imports, queue names and env files)
//   outside     external services: hosts in URL literals, well-known SDKs and URLs in .env.example files
//   links       app → app (e.g. BACKEND_URL), app → data, app → outside services
import path from 'node:path';
import { stripComments, parseJsonc, codeOf, makeResolver, loadAliases } from './scan.js';
import { globToRegex } from './graph.js';

const MAX_EVIDENCE = 25;
const MAX_PREFIXES = 4;
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
  // queues (BullMQ, Bull and Bee-Queue are handled by name below)
  { match: /^@aws-sdk\/client-sqs$|^sqs-consumer$|^sqs-producer$/, id: 'sqs', name: 'Amazon SQS', kind: 'Queue' },
  { match: /^(amqplib|amqp-connection-manager|rascal)$/, id: 'rabbitmq', name: 'RabbitMQ', kind: 'Queue' },
  { match: /^(kafkajs|node-rdkafka|@confluentinc\/kafka-javascript)$/, id: 'kafka', name: 'Kafka', kind: 'Queue' },
  { match: /^@google-cloud\/pubsub$/, id: 'pubsub', name: 'Google Pub/Sub', kind: 'Queue' },
  { match: /^@azure\/service-bus$/, id: 'servicebus', name: 'Azure Service Bus', kind: 'Queue' },
  { match: /^@upstash\/qstash$/, id: 'qstash', name: 'QStash', kind: 'Queue' },
  { match: /^(agenda|@hokify\/agenda)$/, id: 'agenda', name: 'Agenda jobs', kind: 'Queue' },
  { match: /^inngest$/, id: 'inngest', name: 'Inngest', kind: 'Queue' },
  { match: /^@trigger\.dev\/sdk$/, id: 'trigger', name: 'Trigger.dev', kind: 'Queue' },
];
const NAMED_QUEUE_PKGS = new Set(['bullmq', 'bull', 'bee-queue']);
// connection strings in env files: scheme -> store
const SCHEME_STORES = {
  postgres: 'postgres', postgresql: 'postgres', mysql: 'mysql', mongodb: 'mongodb', 'mongodb+srv': 'mongodb',
  redis: 'redis', rediss: 'redis', amqp: 'rabbitmq', amqps: 'rabbitmq', libsql: 'sqlite',
};
const ORM_STORES = new Set(['prisma', 'drizzle', 'sql-orm']);
/** @type {[RegExp, string, string][]} SDK import pattern, service name, kind */
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
  ['astro', 'Astro', 'web'], ['@angular/core', 'Angular', 'web'], ['vue', 'Vue', 'web'], ['svelte', 'Svelte', 'web'],
  ['react-native', 'React Native', 'mobile'], ['expo', 'Expo', 'mobile'],
  ['@nestjs/core', 'NestJS', 'server'], ['express', 'Express', 'server'], ['fastify', 'Fastify', 'server'], ['koa', 'Koa', 'server'],
  ['hono', 'Hono', 'server'], ['@hapi/hapi', 'hapi', 'server'], ['electron', 'Electron', 'desktop'],
  ['react', 'React', 'web'],
];
const NOTABLE = ['typescript', 'tailwindcss', '@tanstack/react-query', 'zod', 'prisma', 'drizzle-orm', 'trpc', '@trpc/server', 'graphql',
  'socket.io', 'bullmq', 'node-cron', 'recharts', 'framer-motion', 'next-themes'];
const IGNORE_HOSTS = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local$|.*\.test$|.*\.example$|(www\.)?example\.(com|org|net)$|(www\.)?w3\.org$|schema\.org$|json-schema\.org$|(www\.)?schemas\.|.*\.xmlsoap\.org$|purl\.org$)/;
// names that look like `x.get('/path')` but are HTTP clients or plain objects, not servers
const NOT_ROUTERS = new Set(['axios', 'got', 'ky', 'superagent', 'request', 'http', 'https', 'fetch', 'client', 'httpClient', 'apiClient',
  '$http', 'instance', 'res', 'req', 'ctx', 'headers', 'map', 'cache', 'params', 'searchParams', 'url', 'store', 'redis', 'db',
  'this', 'window', 'document', 'localStorage', 'sessionStorage', 'config', 'cookies', 'formData', 'supertest', 'agent']);
// env vars that name a URL, and ones that point back at the app itself
const URL_VAR = /_(URL|URI|HOST|ENDPOINT|ORIGIN)$/;
const SELF_VAR = /(^|_)(SITE|APP|PUBLIC_URL|VERCEL|NEXTAUTH|AUTH_URL|CALLBACK|REDIRECT|FRONTEND|CLIENT|CORS|SELF|WEB)(_|$)|^(URL|HOST|PORT)$/;
const STORE_VAR = /(DATABASE|(^|_)DB(_|$)|POSTGRES|PG|MYSQL|MONGO|REDIS|KV|CACHE|QUEUE|AMQP|RABBIT|KAFKA|SUPABASE|PRISMA|SQLITE)/;
const UPPER_WORDS = new Set(['API', 'AI', 'SMS', 'S3', 'CDN', 'ID', 'URL', 'HTTP', 'GRPC', 'ML', 'LLM', 'CRM', 'ERP', 'SSO', 'OCR']);

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
const uniq = (arr) => [...new Set(arr)];
const pushTo = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

/** Join URL path pieces: ('/api', 'users/', '/:id') -> '/api/users/:id' */
export function joinPath(...parts) {
  const p = parts.map((x) => (x || '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  return `/${p}`;
}

/** Turn a file-system route (Next app/pages router, Nuxt, SvelteKit) into its URL. Route groups "(x)" and slots "@x" vanish. */
function fsRoute(segs) {
  return joinPath(...segs.filter((s) => s && s !== 'index' && !/^\(.*\)$/.test(s) && !s.startsWith('@')));
}
function nextRoute(relPath, kind) {
  const segs = relPath.split('/');
  const i = segs.indexOf('app') >= 0 ? segs.indexOf('app') : segs.indexOf('pages');
  const parts = segs.slice(i + 1, -1);
  if (kind === 'pages-router') parts.push(segs[segs.length - 1].replace(/\.(t|j)sx?$/, ''));
  return fsRoute(parts);
}
const exportedMethods = (code) => uniq([...code.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]));

/** Split the arguments of the call whose "(" is at `open`. Returns top-level argument strings. */
export function callArgs(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  let quote = null;
  for (let i = open; i < code.length && i < open + 6000; i++) {
    const c = code[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(code.slice(start, i).trim()); return { args: args.filter(Boolean), end: i + 1 }; }
      continue;
    }
    if (c === ',' && depth === 1) { args.push(code.slice(start, i).trim()); start = i + 1; }
  }
  return { args: [], end: open + 1 };
}
const strLit = (s) => { const m = /^(['"`])([^'"`]*)\1$/.exec(s || ''); return m ? m[2] : null; };

/** Which names a file imports, and from where: { name -> spec } */
function bindingsOf(code) {
  const b = new Map();
  const names = (list, sep) => list.split(',').map((p) => p.trim().split(sep).pop().trim()).filter((n) => /^[\w$]+$/.test(n));
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*(?:\*\s*as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) b.set(m[1], m[4]);
    if (m[3]) b.set(m[3], m[4]);
    if (m[2]) names(m[2], /\s+as\s+/).forEach((n) => b.set(n, m[4]));
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+(?:([\w$]+)|\{([^}]*)\})\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (m[1]) b.set(m[1], m[3]);
    if (m[2]) names(m[2], ':').forEach((n) => b.set(n, m[3]));
  }
  return b;
}

/** What a mount's router argument refers to: another file (spec) or a local variable (ident). */
function targetOf(arg) {
  let m = /^(?:await\s+)?(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(arg);
  if (m) return { spec: m[1] };
  m = /^(?:await\s+)?([\w$]+)(?:\s*\.\s*[\w$]+)*(?:\s*\(\s*\))?$/.exec(arg);
  if (m) return { ident: m[1] };
  return null;
}

/**
 * Read one server file: its routes, where it mounts sub-routers, and base paths set on a router.
 * Understands Express/Koa/Hono/Fastify style `x.get('/p')`, Express `x.route('/p').get()`,
 * Fastify `x.route({ method, url })`, mounts `x.use('/p', r)` / `x.route('/p', r)` / `x.register(r, { prefix })`,
 * Hono `.basePath('/p')`, koa-router `new Router({ prefix })` and NestJS `@Controller` + `@Get` decorators.
 */
export function scanServerCode(code) {
  const routes = [];
  const mounts = [];
  const bases = new Map();
  const METHOD = '(get|post|put|patch|delete|all|head|options)';
  for (const m of code.matchAll(new RegExp(`([\\w$]+)\\s*\\.\\s*${METHOD}\\s*\\(\\s*['"\`](\\/[^'"\`\\s]*)['"\`]`, 'g'))) {
    if (NOT_ROUTERS.has(m[1])) continue;
    routes.push({ recv: m[1], methods: [m[2].toUpperCase()], path: m[3], idx: m.index });
  }
  for (const m of code.matchAll(/([\w$]+)\s*\.\s*route\s*\(/g)) {
    if (NOT_ROUTERS.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const { args, end } = callArgs(code, open);
    const p = strLit(args[0]);
    if (args.length === 1 && p != null && p.startsWith('/')) {
      // Express: router.route('/p').get(a).post(b)
      let pos = end;
      const methods = [];
      for (;;) {
        const mm = new RegExp(`^\\s*\\.\\s*${METHOD}\\s*\\(`).exec(code.slice(pos, pos + 40));
        if (!mm) break;
        methods.push(mm[1].toUpperCase());
        pos = callArgs(code, pos + mm[0].length - 1).end;
      }
      if (methods.length) routes.push({ recv: m[1], methods, path: p, idx: m.index });
    } else if (args.length === 1 && args[0].startsWith('{')) {
      // Fastify: fastify.route({ method: ['GET', 'HEAD'], url: '/p', handler })
      const url = /\b(?:url|path)\s*:\s*['"`](\/[^'"`]*)['"`]/.exec(args[0]);
      const meth = /\bmethod\s*:\s*(\[[^\]]*\]|['"`]\w+['"`])/.exec(args[0]);
      if (url) routes.push({ recv: m[1], methods: meth ? [...meth[1].matchAll(/\w+/g)].map((x) => x[0].toUpperCase()) : ['ALL'], path: url[1], idx: m.index });
    } else if (args.length >= 2 && p != null) {
      const t = targetOf(args[args.length - 1]);
      if (t) mounts.push({ recv: m[1], path: p, ...t, idx: m.index });
    }
  }
  for (const m of code.matchAll(/([\w$]+)\s*\.\s*(use|register)\s*\(/g)) {
    if (NOT_ROUTERS.has(m[1])) continue;
    const { args } = callArgs(code, m.index + m[0].length - 1);
    if (!args.length) continue;
    if (m[2] === 'use') {
      const p = strLit(args[0]);
      const rest = p != null ? args.slice(1) : args;
      if (p != null && !p.startsWith('/')) continue;
      for (let i = rest.length - 1; i >= 0; i--) {
        const t = targetOf(rest[i]);
        if (t) { mounts.push({ recv: m[1], path: p || '', ...t, idx: m.index }); break; }
      }
    } else {
      const t = targetOf(args[0]);
      const pre = args[1] ? /\bprefix\s*:\s*['"`]([^'"`]*)['"`]/.exec(args[1]) : null;
      if (t) mounts.push({ recv: m[1], path: pre ? pre[1] : '', ...t, idx: m.index });
    }
  }
  for (const m of code.matchAll(/([\w$]+)\s*=\s*new\s+Hono\s*(?:<[^>]*>)?\s*\([^)]*\)\s*\.\s*basePath\s*\(\s*['"`]([^'"`]*)['"`]/g)) bases.set(m[1], m[2]);
  for (const m of code.matchAll(/([\w$]+)\s*=\s*new\s+(?:Koa)?Router\s*\(\s*\{[^}]*?\bprefix\s*:\s*['"`]([^'"`]*)['"`]/g)) bases.set(m[1], m[2]);
  for (const m of code.matchAll(/([\w$]+)\s*\.\s*prefix\s*\(\s*['"`](\/[^'"`]*)['"`]\s*\)/g)) bases.set(m[1], m[2]);

  // NestJS decorators
  if (/@Controller\s*\(/.test(code)) {
    let ctrl = null;
    const re = /@(Controller|Get|Post|Put|Patch|Delete|All|Head|Options)\s*\(\s*(?:(['"`])([^'"`]*)\2|\{[^}]*?\bpath\s*:\s*(['"`])([^'"`]*)\4[^}]*\})?\s*[,)]/g;
    for (const m of code.matchAll(re)) {
      const p = m[3] ?? m[5] ?? '';
      if (m[1] === 'Controller') { ctrl = p; continue; }
      if (ctrl == null) continue;
      routes.push({ recv: '@nest', methods: [m[1] === 'All' ? 'ALL' : m[1].toUpperCase()], path: joinPath(ctrl, p), idx: m.index });
    }
  }
  const global = /\.\s*setGlobalPrefix\s*\(\s*['"`]([^'"`]*)['"`]/.exec(code);
  return { routes, mounts, bases, nestPrefix: global ? global[1] : null };
}

/** Full URL prefixes for routes defined on `recv` in `file`, following mounts across files. */
function makePrefixer(scans) {
  const into = new Map(); // file -> mounts elsewhere that point at it
  for (const [file, sc] of scans) for (const m of sc.mounts) if (m.targetFile) pushTo(into, m.targetFile, { file, recv: m.recv, path: m.path });
  const filePrefixes = (f, seen) => {
    const list = into.get(f);
    if (!list || seen.has(f)) return [''];
    const next = new Set(seen).add(f);
    return uniq(list.flatMap((m) => recvPrefixes(m.file, m.recv, next, 0).map((p) => joinPath(p, m.path)))).slice(0, MAX_PREFIXES);
  };
  const recvPrefixes = (f, recv, seen, depth) => {
    const sc = scans.get(f);
    const base = (sc && sc.bases.get(recv)) || '';
    const local = sc && depth < 6 ? sc.mounts.filter((m) => m.targetLocal === recv && m.recv !== recv) : [];
    const outer = local.length
      ? local.flatMap((m) => recvPrefixes(f, m.recv, seen, depth + 1).map((p) => joinPath(p, m.path)))
      : filePrefixes(f, seen);
    return uniq(outer.map((p) => joinPath(p, base))).slice(0, MAX_PREFIXES);
  };
  return (f, recv) => recvPrefixes(f, recv, new Set(), 0);
}

// ---------------------------------------------------------------- cron schedules
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const isCron = (s) => /^@(yearly|annually|monthly|weekly|daily|midnight|hourly)$/.test(s)
  || (/^[\d*/,?LW#A-Za-z-]+(\s+[\d*/,?LW#A-Za-z-]+){4,6}$/.test(s.trim()) && s.trim().split(/\s+/).filter((f) => /[\d*]/.test(f)).length >= 3);

/** Plain words for common cron expressions ("0 3 * * *" -> "every day at 03:00"); null when unusual. */
export function describeCron(expr) {
  const nick = { '@yearly': 'once a year', '@annually': 'once a year', '@monthly': 'once a month', '@weekly': 'once a week', '@daily': 'every day at midnight', '@midnight': 'every day at midnight', '@hourly': 'every hour' }[expr];
  if (nick) return nick;
  let f = expr.trim().split(/\s+/);
  if (f.length === 6) {
    const sec = /^\*\/(\d+)$/.exec(f[0]);
    if (sec && f.slice(1).every((x) => x === '*')) return `every ${sec[1]} seconds`;
    if (f[0] !== '0' && f[0] !== '*') return null;
    f = f.slice(1);
  }
  if (f.length !== 5) return null;
  const [mi, hr, dom, mon, dow] = f;
  const num = (x) => /^\d+$/.test(x);
  const at = () => `${hr.padStart(2, '0')}:${mi.padStart(2, '0')}`;
  if (dom === '*' && mon === '*' && dow === '*') {
    if (mi === '*' && hr === '*') return 'every minute';
    let m = /^\*\/(\d+)$/.exec(mi);
    if (m && hr === '*') return `every ${m[1]} minutes`;
    if (num(mi) && hr === '*') return mi === '0' ? 'every hour' : `every hour at :${mi.padStart(2, '0')}`;
    m = /^\*\/(\d+)$/.exec(hr);
    if (m && num(mi)) return `every ${m[1]} hours`;
    if (num(mi) && num(hr)) return `every day at ${at()}`;
  }
  if (num(mi) && num(hr) && mon === '*') {
    if (dom === '*' && /^[0-7]$/.test(dow)) return `every ${DAYS[Number(dow) % 7]} at ${at()}`;
    if (dom === '*' && dow === '1-5') return `weekdays at ${at()}`;
    if (num(dom) && dow === '*') return `every month on day ${dom} at ${at()}`;
  }
  return null;
}
const CRON_RES = [
  /\bschedule(?:Job)?\s*\(\s*(?:['"`][\w:.-]+['"`]\s*,\s*)?['"`]([^'"`]+)['"`]/g, // node-cron, node-schedule
  /\bnew\s+CronJob\s*\(\s*['"`]([^'"`]+)['"`]/g, // cron
  /\bcronTime\s*:\s*['"`]([^'"`]+)['"`]/g, // CronJob.from({ cronTime })
  /\brepeat\s*:\s*\{[^}]*?\b(?:pattern|cron)\s*:\s*['"`]([^'"`]+)['"`]/g, // BullMQ / Bull repeatable jobs
  /@Cron\s*\(\s*['"`]([^'"`]+)['"`]/g, // NestJS
];
function findCrons(code) {
  const out = [];
  for (const re of CRON_RES) {
    for (const m of code.matchAll(re)) if (isCron(m[1])) out.push({ expr: m[1].trim(), human: describeCron(m[1].trim()), idx: m.index });
  }
  for (const m of code.matchAll(/@Cron\s*\(\s*CronExpression\.(\w+)/g)) {
    out.push({ expr: `CronExpression.${m[1]}`, human: m[1].toLowerCase().replace(/_/g, ' ').replace(/(\d+)(am|pm)/, '$1 $2'), idx: m.index });
  }
  return out;
}

/** "PAYMENTS_API_URL" -> "Payments API" */
function envServiceName(name) {
  const core = name.replace(/^(NEXT_PUBLIC|VITE|PUBLIC|REACT_APP|NUXT_PUBLIC|EXPO_PUBLIC)_/, '').replace(/_(BASE_)?(URL|URI|HOST|ENDPOINT|ORIGIN)$/, '');
  return core.split('_').filter(Boolean).map((w) => (UPPER_WORDS.has(w) ? w : w[0] + w.slice(1).toLowerCase())).join(' ') || name;
}

// ---------------------------------------------------------------- main
/**
 * @param {import('./types.js').Source} source
 * @param {import('./types.js').Graph | null} graph
 * @param {{ project?: string, aliases?: import('./types.js').Config['aliases'] }} [cfg]
 * @returns {import('./types.js').SystemSnapshot}
 */
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
  const resolve = makeResolver(new Set(source.files), loadAliases(source, cfg.aliases));

  const stores = new Map();
  const outside = new Map();
  const links = new Map();
  const addEv = (list, ev) => { if (list.length < MAX_EVIDENCE) list.push(ev); };
  const link = (from, to, kind, label, ev) => {
    const key = `${from}→${to}`;
    if (!links.has(key)) links.set(key, { id: key, from, to, kind, labels: new Set(), evidence: [], count: 0 });
    const l = links.get(key); l.count++; if (label) l.labels.add(label); if (ev) addEv(l.evidence, ev);
  };
  const addStore = (st, appId, via, ev, label) => {
    if (!stores.has(st.id)) stores.set(st.id, { id: `store:${st.id}`, name: st.name, kind: st.kind, via: new Set(), evidence: [], apps: new Set() });
    const S = stores.get(st.id); S.via.add(via); S.apps.add(appId); if (ev) addEv(S.evidence, ev);
    link(appId, `store:${st.id}`, 'data', label || null, ev);
  };
  const addOutside = (id, name, kind, appId, via, ev, label, host) => {
    if (!outside.has(id)) outside.set(id, { id, name, kind, hosts: new Set(), via: new Set(), evidence: [], apps: new Set() });
    const O = outside.get(id); if (via) O.via.add(via); if (host) O.hosts.add(host); O.apps.add(appId); if (ev) addEv(O.evidence, ev);
    link(appId, id, 'outside', label, ev);
  };
  const envRefs = new Map(); // app id -> [{name, file, line}] for *_URL-style vars that may point at another app
  const envUse = new Map(); // env var name -> Set of app ids whose code reads it

  for (const app of apps) {
    app.groups = { pages: [], api: [], endpoints: [], jobs: [], schedules: [] };
    const tsx = app.files.some((f) => /\.tsx?$/.test(f));
    if (tsx && !app.tech.includes('typescript')) app.tech.unshift('typescript');
    const fwk = app.framework;
    const scans = new Map();
    let namedQueuePkg = null;
    let namedQueues = 0;

    for (const f of app.files) {
      const text = source.read(f);
      if (text == null) continue;
      const code = stripComments(codeOf(f, text));
      const r = rel(app.root, f);
      const mod = graph && graph.moduleOf ? graph.moduleOf.get(f) : null;
      let m;

      // entry points from file-system routing
      if (fwk === 'Next.js') {
        if (/(^|\/)app\/(.*\/)?page\.(t|j)sx?$/.test(r)) app.groups.pages.push({ key: nextRoute(r, 'app'), label: nextRoute(r, 'app'), file: f, line: 1 });
        else if (/(^|\/)app\/(.*\/)?route\.(t|j)sx?$/.test(r)) {
          const route = nextRoute(r, 'app');
          app.groups.api.push({ key: route, label: route, methods: exportedMethods(code), file: f, line: 1 });
        } else if (/(^|\/)pages\/api\//.test(r)) app.groups.api.push({ key: nextRoute(r, 'pages-router'), label: nextRoute(r, 'pages-router'), methods: [], file: f, line: 1 });
        else if (/(^|\/)pages\/(?!_)[^/]+/.test(r) && /\.(t|j)sx?$/.test(r)) app.groups.pages.push({ key: nextRoute(r, 'pages-router'), label: nextRoute(r, 'pages-router'), file: f, line: 1 });
      } else if (fwk === 'Nuxt') {
        if ((m = /(?:^|\/)pages\/(.+)\.vue$/.exec(r))) { const route = fsRoute(m[1].split('/')); app.groups.pages.push({ key: route, label: route, file: f, line: 1 }); }
        else if ((m = /(?:^|\/)server\/(api|routes)\/(.+?)(?:\.(get|post|put|patch|delete|head|options))?\.(t|j)s$/.exec(r))) {
          const route = fsRoute([m[1] === 'api' ? 'api' : '', ...m[2].split('/')]);
          app.groups.api.push({ key: m[3] ? `${m[3].toUpperCase()} ${route}` : route, label: route, methods: m[3] ? [m[3].toUpperCase()] : [], file: f, line: 1 });
        }
      } else if (fwk === 'SvelteKit') {
        if ((m = /(?:^|\/)routes\/(?:(.*)\/)?\+page\.svelte$/.exec(r))) { const route = fsRoute((m[1] || '').split('/')); app.groups.pages.push({ key: route, label: route, file: f, line: 1 }); }
        else if ((m = /(?:^|\/)routes\/(?:(.*)\/)?\+server\.(t|j)s$/.exec(r))) {
          const route = fsRoute((m[1] || '').split('/'));
          app.groups.api.push({ key: route, label: route, methods: exportedMethods(code), file: f, line: 1 });
        }
      }
      if (app.role === 'server') {
        const sc = scanServerCode(code);
        if (sc.routes.length || sc.mounts.length || sc.nestPrefix != null) {
          const binds = bindingsOf(code);
          for (const mt of sc.mounts) {
            const spec = mt.spec || (mt.ident && binds.get(mt.ident));
            if (spec) { const res = resolve(f, spec); if (res.kind === 'file') mt.targetFile = res.file; } else if (mt.ident) mt.targetLocal = mt.ident;
          }
          scans.set(f, { ...sc, code });
        }
      }

      // cron schedules
      for (const c of findCrons(code)) {
        app.groups.schedules.push({ key: `${c.expr} · ${f}`, label: c.expr, human: c.human, file: f, line: lineAt(code, c.idx) });
      }

      // imports -> data stores, queues and SDK services
      let queuesRead = false;
      for (const { spec, idx } of importSpecs(code)) {
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~/')) continue;
        const bare = spec.startsWith('node:') ? spec : pkgName(spec);
        const ev = { file: f, line: lineAt(code, idx), text: spec, module: mod };
        if (NAMED_QUEUE_PKGS.has(bare)) {
          namedQueuePkg = namedQueuePkg || bare;
          if (queuesRead) continue;
          queuesRead = true;
          for (const q of code.matchAll(/\b(?:new\s+)?(Queue|Worker|QueueEvents|Bull|BeeQueue)\s*(?:<[^>()]*>)?\s*\(\s*(?:(['"`])([\w:./-]+)\2|([A-Za-z_$][\w$]*))/g)) {
            let name = q[3];
            if (!name && q[4]) { const c = new RegExp(`\\b(?:const|let|var)\\s+${q[4].replace(/\$/g, '\\$')}\\s*=\\s*['"\`]([\\w:./-]+)['"\`]`).exec(code); name = c && c[1]; }
            if (!name) continue;
            namedQueues++;
            addStore({ id: `queue-${name}`, name: `${name} queue`, kind: 'Queue' }, app.id, bare, { ...ev, line: lineAt(code, q.index), text: q[0].slice(0, 90) }, q[1] === 'Worker' ? 'runs jobs' : q[1] === 'QueueEvents' ? 'listens' : 'adds jobs');
          }
          continue;
        }
        const st = STORES.find((x) => x.match.test(bare) || x.match.test(spec));
        if (st) { addStore(st, app.id, bare, ev, st.kind === 'Queue' ? 'messages' : null); continue; }
        const sdk = SDKS.find(([re]) => re.test(bare));
        if (sdk) addOutside(`svc:${sdk[1].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, sdk[1], sdk[2], app.id, bare, ev, sdk[2]);
      }

      // URL literals -> outside services (skip JSX href/src links, which are just links for users)
      for (const u of code.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\[[^\]]+\])(?::\d+)?[^\s'"`)]*/gi)) {
        const host = u[1].toLowerCase();
        if (IGNORE_HOSTS.test(host)) continue;
        const before = code.slice(Math.max(0, u.index - 24), u.index);
        if (/(href|src|action|srcSet|xmlns(:\w+)?)\s*=\s*\{?\s*["'`]?$/.test(before)) continue;
        const dom = domainOf(host.replace(/^www\./, ''));
        addOutside(`web:${dom}`, dom, 'Web / HTTP', app.id, null, { file: f, line: lineAt(code, u.index), text: u[0].slice(0, 90), module: mod }, 'HTTPS', host);
      }

      // env vars: which app reads what, and *_URL vars that may point at another service (BACKEND_URL, API_BASE_URL, …)
      for (const e of code.matchAll(/(?:process\.env\.|import\.meta\.env\.|process\.env\[\s*['"])([A-Z][A-Z0-9_]*)/g)) {
        if (!envUse.has(e[1])) envUse.set(e[1], new Set());
        envUse.get(e[1]).add(app.id);
        if (/(BACKEND|API|SERVER|SERVICE|GATEWAY)[A-Z0-9_]*(URL|ORIGIN|HOST|BASE|ENDPOINT)/.test(e[1])) {
          pushTo(envRefs, app.id, { name: e[1], file: f, line: lineAt(code, e.index), text: `process.env.${e[1]}`, module: mod });
        }
      }
    }

    // HTTP endpoints, with the prefixes of the routers they are mounted under
    if (scans.size) {
      const prefixes = makePrefixer(scans);
      const nest = [...scans.values()].map((s) => s.nestPrefix).find((p) => p != null) || '';
      for (const [f, sc] of scans) {
        for (const rt of sc.routes) {
          const pres = rt.recv === '@nest' ? [nest] : prefixes(f, rt.recv);
          for (const pre of pres) {
            const full = joinPath(pre, rt.path);
            for (const method of rt.methods) app.groups.endpoints.push({ key: `${method} ${full}`, label: full, methods: [method], file: f, line: lineAt(sc.code, rt.idx) });
          }
        }
      }
    }
    if (namedQueuePkg && !namedQueues) addStore({ id: namedQueuePkg, name: `${namedQueuePkg === 'bee-queue' ? 'Bee-Queue' : namedQueuePkg === 'bull' ? 'Bull' : 'BullMQ'} queue`, kind: 'Queue' }, app.id, namedQueuePkg, null, 'jobs');

    // npm scripts that run a file = jobs / CLIs
    for (const [name, cmd] of Object.entries(app.scripts)) {
      if (/^(start|dev|build|test|lint|format|prepare|postinstall|preview|typecheck|type-check|serve)$/.test(name)) continue;
      const sm = String(cmd).match(/\b(?:node|tsx|ts-node|bun|deno run)\b[^&|;]*?\s((?:\.\/)?[\w./-]+\.(?:m?js|cjs|ts|mts))/);
      if (!sm) continue;
      const file = path.posix.normalize(path.posix.join(app.root, sm[1]));
      app.groups.jobs.push({ key: name, label: name, file, line: 1, cmd: String(cmd).slice(0, 120) });
    }
  }

  // 2. extra files: vercel.json cron schedules and .env.example service URLs
  const servers = apps.filter((a) => a.role === 'server' || a.groups.endpoints.length);
  const serverNamed = (name, appId) => servers.find((s) => s.id !== appId && name.toLowerCase().includes(s.name.toLowerCase()));
  const namesOwnServer = (name, users) => users.some((u) => serverNamed(name, u));
  const envExample = new Map(); // var name -> value in an example env file
  for (const f of source.extras || []) {
    const text = source.read(f);
    const app = appOf(f);
    if (text == null || !app) continue;
    if (f.endsWith('vercel.json')) {
      let json;
      try { json = parseJsonc(text); } catch { continue; }
      for (const c of json.crons || []) {
        if (!c || typeof c.schedule !== 'string') continue;
        const line = Math.max(1, text.split('\n').findIndex((l) => l.includes(c.schedule)) + 1);
        app.groups.schedules.push({ key: `${c.schedule} · ${f}${c.path ? ` · ${c.path}` : ''}`, label: c.schedule, human: describeCron(c.schedule), file: f, line, cmd: c.path ? `calls ${c.path}` : null });
      }
      continue;
    }
    text.split('\n').forEach((raw, i) => {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
      if (!m) return;
      const name = m[1];
      const value = m[2].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
      envExample.set(name, value);
      const users = envUse.has(name) ? [...envUse.get(name)] : [app.id];
      const ev = { file: f, line: i + 1, text: `${name}=${value}`.slice(0, 90), module: null };
      const scheme = (/^([a-z][a-z0-9+.-]*):\/\//i.exec(value) || [])[1];
      const storeId = scheme && SCHEME_STORES[scheme.toLowerCase()];
      if (storeId) {
        const base = STORES.find((x) => x.id === storeId);
        for (const u of users) {
          // DATABASE_URL=postgres://… next to Prisma/Drizzle: name the engine on the ORM box instead of adding a second one
          const orm = [...stores.values()].find((s) => ORM_STORES.has(s.id.slice(6)) && s.apps.has(u));
          if (orm && base.kind === 'Database') {
            if (/^Database via /.test(orm.name) || orm.name === 'SQL database (ORM)') orm.name = orm.name === 'SQL database (ORM)' ? `${base.name} (ORM)` : `${base.name} via ${orm.name.slice(13)}`;
            orm.via.add(name); addEv(orm.evidence, ev); link(u, orm.id, 'data', null, ev);
          } else addStore(base, u, name, ev, base.kind === 'Queue' ? 'messages' : null);
        }
        return;
      }
      const url = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\[[^\]]+\])/i.exec(value);
      if (url) {
        const host = url[1].toLowerCase();
        if (IGNORE_HOSTS.test(host) || SELF_VAR.test(name)) return;
        const dom = domainOf(host.replace(/^www\./, ''));
        users.forEach((u) => addOutside(`web:${dom}`, dom, 'Web / HTTP', u, name, ev, 'HTTPS', host));
        return;
      }
      // a URL that is only set per environment: we know the name, not the host
      // (unless its name points at one of our own servers, e.g. API_URL next to an app called "api": that's an app link)
      if (!value && URL_VAR.test(name) && !SELF_VAR.test(name) && !STORE_VAR.test(name) && !namesOwnServer(name, users)) {
        users.forEach((u) => addOutside(`env:${name}`, envServiceName(name), 'Set by env var', u, name, ev, name, null));
      }
    });
  }

  // 3. app -> app over HTTP, matched through env vars like BACKEND_URL
  const external = (n) => { const v = envExample.get(n); return !!v && /^https?:\/\//i.test(v) && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(v); };
  for (const [appId, refs] of envRefs) {
    const candidates = servers.filter((s) => s.id !== appId);
    if (!candidates.length) continue;
    const byName = new Map();
    for (const r of refs) {
      if (external(r.name) || outside.has(`env:${r.name}`)) continue; // points at a service outside this repo
      const target = serverNamed(r.name, appId) || candidates[0];
      pushTo(byName, target.id, r);
    }
    for (const [target, rs] of byName) {
      const names = uniq(rs.map((r) => r.name));
      rs.forEach((r) => link(appId, target, 'app', `HTTP · ${names.join(', ')}`, r));
    }
  }

  // tidy entry points: one entry per key, sorted
  for (const app of apps) {
    for (const g of Object.values(app.groups)) {
      const seen = new Set();
      const kept = g.filter((x) => (seen.has(x.key) ? false : seen.add(x.key)));
      g.length = 0; g.push(...kept.sort((a, b) => a.key.localeCompare(b.key)));
    }
  }

  // 4. who is the front door? web apps get "Users"; servers nobody in the repo calls get "Clients"
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
      modules: [...(modsByApp.get(a.id) || new Map())].sort((x, y) => y[1] - x[1]).map(([name, n]) => ({ name, files: n })),
      groups: a.groups,
    })),
    stores: [...stores.values()].map((s) => ({ ...s, via: [...s.via], apps: [...s.apps] }))
      .sort((a, b) => Number(a.kind === 'Queue') - Number(b.kind === 'Queue') || a.name.localeCompare(b.name)),
    outside: [...outside.values()].map((o) => ({ ...o, hosts: [...o.hosts].sort(), via: [...o.via], apps: [...o.apps] }))
      .sort((a, b) => b.evidence.length - a.evidence.length || a.name.localeCompare(b.name)),
    links: [...links.values()].map((l) => ({ ...l, labels: [...l.labels] })),
    hasUsers: entry.length > 0,
  };
}

// ---------------------------------------------------------------- base vs current
export const ENTRY_GROUPS = ['pages', 'api', 'endpoints', 'jobs', 'schedules'];
const st = (b, c) => (b && c ? 'same' : c ? 'added' : 'removed');

function mergeList(bl = [], cl = [], key = (x) => x.key) {
  const bm = new Map(bl.map((x) => [key(x), x]));
  const cm = new Map(cl.map((x) => [key(x), x]));
  const keys = [...new Set([...bm.keys(), ...cm.keys()])];
  return keys.map((k) => ({ ...(cm.get(k) || bm.get(k)), status: st(bm.has(k), cm.has(k)) }));
}

/**
 * @param {import('./types.js').SystemSnapshot} base
 * @param {import('./types.js').SystemSnapshot} cur
 * @returns {import('./types.js').System}
 */
export function diffSystems(base, cur) {
  const apps = mergeList(base.apps, cur.apps, (a) => a.id).map((a) => {
    const b = base.apps.find((x) => x.id === a.id);
    const c = cur.apps.find((x) => x.id === a.id);
    const groups = {};
    for (const g of ENTRY_GROUPS) {
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
