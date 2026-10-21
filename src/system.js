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

// ---------------------------------------------------------------- reading code for request flows
/** Index of the bracket that closes the one at `open` (strings skipped); -1 if none in reach. */
function closeOf(code, open, limit = 200000) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < code.length && i < open + limit; i++) {
    const c = code[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Where the call that starts at `idx` ends, following chained calls: x.route('/p').get(a).post(b) */
function callEnd(code, idx) {
  const open = code.indexOf('(', idx);
  if (open < 0) return idx;
  let end = closeOf(code, open);
  if (end < 0) return idx;
  for (;;) {
    const mm = /^\s*\.\s*[\w$]+\s*\(/.exec(code.slice(end + 1, end + 80));
    if (!mm) break;
    const e2 = closeOf(code, end + mm[0].length);
    if (e2 < 0) break;
    end = e2;
  }
  return end + 1;
}

/** End of the statement whose value starts at `p` (a newline ends it unless the expression clearly goes on). */
function stmtEnd(code, p) {
  let depth = 0;
  let quote = null;
  while (/\s/.test(code[p] || '')) p++;
  for (let i = p; i < code.length && i < p + 100000; i++) {
    const c = code[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth < 0) return i; }
    else if (depth === 0 && c === ';') return i;
    else if (depth === 0 && c === '\n') {
      if (/[=+\-*/|&,?:(>]\s*$/.test(code.slice(Math.max(p, i - 3), i)) || /^\s*[.?:+\-*/|&,=]/.test(code.slice(i + 1, i + 40))) continue;
      return i;
    }
  }
  return code.length;
}

/** Names declared in a file (functions, classes, consts): name -> [start, end) of the declaration. */
function localDecls(code) {
  const out = new Map();
  for (const m of code.matchAll(/\b(?:(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(|class\s+([\w$]+)[^{]*\{|(?:const|let|var)\s+([\w$]+)\s*(?::[^=;\n]{1,80})?=(?!=))/g)) {
    const name = m[1] || m[2] || m[3];
    if (out.has(name)) continue;
    let end;
    if (m[1]) {
      const close = closeOf(code, m.index + m[0].length - 1);
      const brace = close < 0 ? -1 : code.indexOf('{', close);
      end = brace < 0 ? -1 : closeOf(code, brace);
    } else if (m[2]) end = closeOf(code, m.index + m[0].length - 1);
    else end = stmtEnd(code, m.index + m[0].length);
    if (end > 0) out.set(name, [m.index, end + 1]);
  }
  return out;
}

/** Class properties typed by a constructor parameter (`private orders: OrdersService`): name -> type. */
function propTypes(code) {
  const out = new Map();
  for (const m of code.matchAll(/\b(?:private|public|protected|readonly)\s+(?:readonly\s+)?([\w$]+)\s*:\s*([\w$]+)/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * Every import and re-export in a file, with the names it brings in (null = all of them: namespace,
 * side-effect, require or dynamic import). Type-only imports are skipped: they never run.
 * @returns {{ spec: string, idx: number, names: string[] | null, re: Map<string, string> | '*' | null }[]}
 */
export function importsOf(code) {
  const out = [];
  const list = (s) => s.split(',').map((p) => p.trim()).filter((p) => p && !p.startsWith('type '));
  for (const m of code.matchAll(/(?:^|[^.\w$])import\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+[\w$]+)?\s*(?:from\s*)?['"]([^'"\n]+)['"]/g)) {
    if (m[1]) continue;
    const whole = m[0];
    const names = /\*\s*as\s/.test(whole) || (!m[2] && m[3] == null) ? null : [...(m[2] ? ['default'] : []), ...list(m[3] || '').map((p) => p.split(/\s+as\s+/)[0].trim())];
    out.push({ spec: m[4], idx: m.index, names, re: null });
  }
  for (const m of code.matchAll(/(?:^|[^.\w$])export\s+(type\s+)?(?:\{([^}]*)\}|\*(?:\s*as\s+([\w$]+))?)\s*from\s*['"]([^'"\n]+)['"]/g)) {
    if (m[1]) continue;
    if (m[2] != null) {
      const re = new Map(list(m[2]).map((p) => { const [a, b] = p.split(/\s+as\s+/).map((x) => x.trim()); return [b || a, a]; }));
      out.push({ spec: m[4], idx: m.index, names: [...re.values()], re });
    } else if (m[3]) out.push({ spec: m[4], idx: m.index, names: null, re: new Map([[m[3], '*']]) });
    else out.push({ spec: m[4], idx: m.index, names: null, re: '*' });
  }
  for (const m of code.matchAll(/(?:^|[^.\w$])(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) out.push({ spec: m[1], idx: m.index, names: null, re: null });
  return out;
}

// URL paths in calls: '/orders/${id}?x=1' -> '/orders/:p'
const normPath = (p) => p.replace(/\$\{[^}]*\}/g, ':p').replace(/[?#].*$/, '') || '/';
const segsOf = (p) => p.split('/').filter(Boolean);
const isParamSeg = (x) => /^[:[{*$]/.test(x);
function segsMatch(a, b) {
  for (let i = 0; i < b.length; i++) {
    if (/^\[\[?\.\.\.|^\*/.test(b[i])) return true; // catch-all segment
    if (i >= a.length) return false;
    if (isParamSeg(a[i]) || isParamSeg(b[i])) continue;
    if (a[i] !== b[i]) return false;
  }
  return a.length === b.length;
}
/** The route or endpoint of `app` a call to `callPath` lands on: an exact match first, else the only route whose tail matches (the base URL holds the rest, e.g. …/api). */
export function endpointFor(app, callPath, method) {
  const list = [...app.groups.api, ...app.groups.endpoints];
  const okMethod = (e) => !method || !e.methods || !e.methods.length || e.methods.includes(method) || e.methods.includes('ALL');
  const a = segsOf(callPath);
  const exact = list.filter((e) => okMethod(e) && segsMatch(a, segsOf(e.label)));
  if (exact.length) return exact.find((e) => method && e.methods && e.methods.includes(method)) || exact[0];
  const tail = list.filter((e) => { const b = segsOf(e.label); return okMethod(e) && b.length > a.length && segsMatch(a, b.slice(b.length - a.length)); });
  return tail.length === 1 ? tail[0] : null;
}
/** The HTTP method of the call whose URL starts at `pos`: axios.post(…), fetch(…, { method: 'POST' }); null when unknown. */
function callMethod(code, pos) {
  const open = code.lastIndexOf('(', pos);
  if (open < 0 || pos - open > 160) return null;
  const head = code.slice(Math.max(0, open - 40), open);
  const m = /\.\s*(get|post|put|patch|delete)\s*(?:<[^>()]*>)?\s*$/i.exec(head);
  if (m) return m[1].toUpperCase();
  if (/\b(fetch|\$fetch|ofetch|useFetch|useSWR)\s*$/.test(head)) {
    const { args } = callArgs(code, open);
    const opt = args[1] ? /\bmethod\s*:\s*['"`](\w+)['"`]/.exec(args[1]) : null;
    return opt ? opt[1].toUpperCase() : 'GET';
  }
  return null;
}
const HTTP_CLIENTS = 'axios|ky|got|api|apiClient|httpClient|client|http|instance|request|superagent|fetcher';
const REL_CALL = new RegExp(`(?:\\b(?:fetch|\\$fetch|ofetch|useFetch|useSWR)\\s*\\(|\\b(${HTTP_CLIENTS})\\s*\\.\\s*(?:get|post|put|patch|delete)\\s*(?:<[^>()]*>)?\\s*\\()\\s*(['"\`])(\\/(?!\\/)[^'"\`\\s?#]*)`, 'g');
/** The URL path glued onto an env var read: `process.env.X + '/p'` or `${process.env.X}/p`. */
function pathAfter(after) {
  let m = /^\s*(?:(?:\|\||\?\?)\s*(['"`])[^'"`]*\1\s*)?\)?\s*\+\s*(['"`])(\/[^'"`\s?#]*)/.exec(after);
  if (m) return m[3];
  m = /^\s*(?:(?:\|\||\?\?)[^}]*)?\}(\/[^`\s?#]*)/.exec(after);
  return m ? m[1] : null;
}

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

/** Where a workspace package's code starts, in the order to try: main/module/exports, then src/index, index. */
function pkgEntries(pkg) {
  const ex = pkg.exports && (typeof pkg.exports === 'string' ? pkg.exports : pkg.exports['.']);
  const exp = ex && (typeof ex === 'string' ? ex : ex.import || ex.default || ex.require || null);
  return uniq([exp, pkg.module, pkg.main, pkg.types, 'src/index', 'index'].filter((x) => typeof x === 'string').map((x) => x.replace(/^\.\//, '')));
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
      scripts: pkg.scripts || {}, files: [], pkgEntries: pkgEntries(pkg),
    });
  }
  const workspaceOnly = (a) => a.root === '' && apps.length > 1 && !apps.some((b) => b !== a && b.root === '') && a.role === 'service' && a.files.length === 0;
  if (!apps.length) apps.push({ id: '.', root: '', name: cfg.project || 'app', framework: 'Node.js', role: 'service', tech: [], scripts: {}, files: [], pkgEntries: [] });
  const byDepth = [...apps].sort((a, b) => b.root.length - a.root.length);
  const appOf = (f) => byDepth.find((a) => !a.root || f.startsWith(`${a.root}/`));
  const appsById = new Map(apps.map((a) => [a.id, a]));
  const files = source.files.filter((f) => !EXCLUDE.some((re) => re.test(f)));
  const codeSet = new Set(files);
  for (const f of files) { const a = appOf(f); if (a) a.files.push(f); }
  const resolve = makeResolver(new Set(source.files), loadAliases(source, cfg.aliases));
  const workspace = new Map(apps.filter((a) => a.pkgName).map((a) => [a.pkgName, a]));
  /** The file an import points at: relative, a tsconfig alias, or another package of this repo by name. */
  const resolveAny = (f, spec) => {
    const r = resolve(f, spec);
    if (r.kind === 'file') return r.file;
    const ws = workspace.get(pkgName(spec));
    if (!ws) return null;
    const sub = spec.slice(pkgName(spec).length).replace(/^\//, '');
    const pre = ws.root ? `${ws.root}/` : '';
    for (const c of sub ? [sub, `src/${sub}`] : ws.pkgEntries) { const x = resolve(f, `/${pre}${c}`); if (x.kind === 'file') return x.file; }
    return null;
  };

  // for request flows: what each line of code touches (a store, a service, an HTTP call) and what each file imports
  const touches = new Map(); // file -> [{ line, text, to?, label?, spec?, call? }]
  const fileImports = new Map(); // file -> [{ file, names, re }]
  const spanOf = new Map(); // entry point -> where its own code is: { file, a, b } (character range) or { file, call }
  const touch = (ev, t) => { if (ev && ev.file && codeSet.has(ev.file)) pushTo(touches, ev.file, { line: ev.line, text: ev.text || null, ...t }); };

  const stores = new Map();
  const outside = new Map();
  const links = new Map();
  const addEv = (list, ev) => { if (list.length < MAX_EVIDENCE) list.push(ev); };
  const link = (from, to, kind, label, ev) => {
    const key = `${from}→${to}`;
    if (!links.has(key)) links.set(key, { id: key, from, to, kind, labels: new Set(), evidence: [], count: 0 });
    const l = links.get(key); l.count++; if (label) l.labels.add(label); if (ev) addEv(l.evidence, ev);
  };
  const addStore = (st, appId, via, ev, label, spec) => {
    if (!stores.has(st.id)) stores.set(st.id, { id: `store:${st.id}`, name: st.name, kind: st.kind, via: new Set(), evidence: [], apps: new Set() });
    const S = stores.get(st.id); S.via.add(via); S.apps.add(appId); if (ev) addEv(S.evidence, ev);
    link(appId, `store:${st.id}`, 'data', label || null, ev);
    touch(ev, { to: `store:${st.id}`, label: label || null, spec: spec || null });
  };
  const addOutside = (id, name, kind, appId, via, ev, label, host, spec) => {
    if (!outside.has(id)) outside.set(id, { id, name, kind, hosts: new Set(), via: new Set(), evidence: [], apps: new Set() });
    const O = outside.get(id); if (via) O.via.add(via); if (host) O.hosts.add(host); O.apps.add(appId); if (ev) addEv(O.evidence, ev);
    link(appId, id, 'outside', label, ev);
    touch(ev, { to: id, label, spec: spec || null });
  };
  const envRefs = new Map(); // app id -> [{name, file, line}] for *_URL-style vars that may point at another app
  const envUse = new Map(); // env var name -> Set of app ids whose code reads it

  for (const app of apps) {
    app.groups = { pages: [], api: [], endpoints: [], jobs: [], schedules: [], workers: [] };
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
      for (const im of importsOf(code)) {
        const t = resolveAny(f, im.spec);
        if (t && t !== f) pushTo(fileImports, f, { file: t, names: im.names, re: im.re });
      }

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

      // cron schedules (the job's own code is the call's callback, or the method under @Cron)
      for (const c of findCrons(code)) {
        const e = { key: `${c.expr} · ${f}`, label: c.expr, human: c.human, file: f, line: lineAt(code, c.idx) };
        app.groups.schedules.push(e);
        if (/^(schedule|new\s+CronJob)/.test(code.slice(c.idx, c.idx + 12))) spanOf.set(e, { file: f, a: c.idx, b: callEnd(code, c.idx) });
        else if (code.startsWith('@Cron', c.idx)) {
          const params = code.indexOf('(', callEnd(code, c.idx));
          const body = params < 0 ? -1 : code.indexOf('{', closeOf(code, params));
          if (body > 0) spanOf.set(e, { file: f, a: c.idx, b: closeOf(code, body) + 1 });
        }
      }

      // HTTP calls to a path on the same origin: fetch('/api/orders'), axios.post('/orders')
      const recvs = scans.has(f) ? new Set(scans.get(f).routes.map((r) => r.recv)) : null;
      for (const c of code.matchAll(REL_CALL)) {
        if (c[1] && recvs && recvs.has(c[1])) continue; // a route definition, not a call
        const pos = c.index + c[0].length - c[3].length;
        touch({ file: f, line: lineAt(code, c.index), text: c[0].replace(/\s+/g, ' ').slice(0, 90) }, { call: { path: normPath(c[3]), method: callMethod(code, pos) } });
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
            const line = lineAt(code, q.index);
            addStore({ id: `queue-${name}`, name: `${name} queue`, kind: 'Queue' }, app.id, bare, { ...ev, line, text: q[0].slice(0, 90) }, q[1] === 'Worker' ? 'runs jobs' : q[1] === 'QueueEvents' ? 'listens' : 'adds jobs');
            if (q[1] === 'Worker') {
              // a worker is an entry point: its callback runs whenever a job lands in the queue
              const w = { key: `${name} · ${f}`, label: `${name} queue`, file: f, line, queue: `store:queue-${name}` };
              app.groups.workers.push(w);
              spanOf.set(w, { file: f, a: q.index, b: callEnd(code, q.index) });
            }
          }
          continue;
        }
        const st = STORES.find((x) => x.match.test(bare) || x.match.test(spec));
        if (st) { addStore(st, app.id, bare, ev, st.kind === 'Queue' ? 'messages' : null, bare); continue; }
        const sdk = SDKS.find(([re]) => re.test(bare));
        if (sdk) addOutside(`svc:${sdk[1].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, sdk[1], sdk[2], app.id, bare, ev, sdk[2], null, bare);
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
        const line = lineAt(code, e.index);
        if (/(BACKEND|API|SERVER|SERVICE|GATEWAY)[A-Z0-9_]*(URL|ORIGIN|HOST|BASE|ENDPOINT)/.test(e[1])) {
          pushTo(envRefs, app.id, { name: e[1], file: f, line, text: `process.env.${e[1]}`, module: mod });
        }
        // the path glued onto it, directly or through a const: `${API_URL}/orders`
        const end = e.index + e[0].length;
        const paths = [];
        const direct = pathAfter(code.slice(end, end + 200));
        if (direct != null) paths.push({ path: direct, pos: end, line });
        const as = /(?:const|let|var)\s+([\w$]+)\s*(?::[^=;\n]{1,40})?=\s*\(?\s*$/.exec(code.slice(Math.max(0, e.index - 80), e.index));
        if (as) {
          const nm = as[1].replace(/\$/g, '\\$');
          for (const u of code.matchAll(new RegExp(`\\$\\{\\s*${nm}\\s*\\}(\\/[^\`\\s?#]*)|\\b${nm}\\s*\\+\\s*(['"\`])(\\/[^'"\`\\s?#]*)`, 'g'))) {
            paths.push({ path: u[1] || u[3], pos: u.index, line: lineAt(code, u.index) });
          }
        }
        touch({ file: f, line, text: `process.env.${e[1]}` }, { call: { env: e[1], path: null, method: null } });
        for (const p of paths) {
          const ls = code.lastIndexOf('\n', p.pos) + 1;
          touch({ file: f, line: p.line, text: code.slice(ls, code.indexOf('\n', p.pos) >>> 0).trim().slice(0, 90) }, { call: { env: e[1], path: normPath(p.path), method: callMethod(code, p.pos) } });
        }
      }
    }

    // HTTP endpoints, with the prefixes of the routers they are mounted under
    if (scans.size) {
      const prefixes = makePrefixer(scans);
      const nest = [...scans.values()].map((s) => s.nestPrefix).find((p) => p != null) || '';
      for (const [f, sc] of scans) {
        const nestAt = sc.routes.filter((r) => r.recv === '@nest').map((r) => r.idx).sort((a, b) => a - b);
        for (const rt of sc.routes) {
          const pres = rt.recv === '@nest' ? [nest] : prefixes(f, rt.recv);
          // the handler's own code: the route call with its callbacks, or a NestJS method up to the next route
          const span = { file: f, a: rt.idx, b: rt.recv === '@nest' ? (nestAt.find((i) => i > rt.idx) ?? sc.code.length) : callEnd(sc.code, rt.idx) };
          for (const pre of pres) {
            const full = joinPath(pre, rt.path);
            for (const method of rt.methods) {
              const e = { key: `${method} ${full}`, label: full, methods: [method], file: f, line: lineAt(sc.code, rt.idx) };
              app.groups.endpoints.push(e);
              spanOf.set(e, span);
            }
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
  // API_URL names the app called "api"; BILLING_API_URL doesn't (its core is "billing"). Generic words count only when nothing else is left.
  const GENERIC = new Set(['api', 'server', 'service', 'backend', 'app', 'svc']);
  const coreOf = (words) => { const w = words.filter((x) => x && !GENERIC.has(x)); return (w.length ? w : words).join('-'); };
  const serverNamed = (name, appId) => {
    const want = coreOf(envServiceName(name).toLowerCase().split(/\s+/));
    return servers.find((s) => s.id !== appId && coreOf(s.name.toLowerCase().split(/[^a-z0-9]+/)) === want);
  };
  // the paths an app calls on a var (`${API_URL}/orders`): the server that has those routes is the one it means
  const pathsOn = (appId, name) => appsById.get(appId).files.flatMap((f) => (touches.get(f) || []).filter((t) => t.call && t.call.env === name && t.call.path != null).map((t) => t.call));
  const pathsHit = (name, appId) => { const calls = pathsOn(appId, name); return servers.find((s) => s.id !== appId && calls.some((k) => endpointFor(s, k.path, k.method))); };
  const namesOwnServer = (name, users) => users.some((u) => serverNamed(name, u) || pathsHit(name, u));
  const envExample = new Map(); // var name -> value in an example env file
  const envOut = new Map(); // `${app}|${VAR}` -> stores and services that var points at (for code that reads it)
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
        const e = { key: `${c.schedule} · ${f}${c.path ? ` · ${c.path}` : ''}`, label: c.schedule, human: describeCron(c.schedule), file: f, line, cmd: c.path ? `calls ${c.path}` : null };
        app.groups.schedules.push(e);
        if (c.path) spanOf.set(e, { file: f, call: c.path });
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
            pushTo(envOut, `${u}|${name}`, { to: orm.id, label: null });
          } else {
            addStore(base, u, name, ev, base.kind === 'Queue' ? 'messages' : null);
            pushTo(envOut, `${u}|${name}`, { to: `store:${base.id}`, label: base.kind === 'Queue' ? 'messages' : null });
          }
        }
        return;
      }
      const url = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\[[^\]]+\])/i.exec(value);
      if (url) {
        const host = url[1].toLowerCase();
        if (IGNORE_HOSTS.test(host) || SELF_VAR.test(name)) return;
        const dom = domainOf(host.replace(/^www\./, ''));
        users.forEach((u) => { addOutside(`web:${dom}`, dom, 'Web / HTTP', u, name, ev, 'HTTPS', host); pushTo(envOut, `${u}|${name}`, { to: `web:${dom}`, label: 'HTTPS' }); });
        return;
      }
      // a URL that is only set per environment: we know the name, not the host
      // (unless its name points at one of our own servers, e.g. API_URL next to an app called "api": that's an app link)
      if (!value && URL_VAR.test(name) && !SELF_VAR.test(name) && !STORE_VAR.test(name) && !namesOwnServer(name, users)) {
        users.forEach((u) => { addOutside(`env:${name}`, envServiceName(name), 'Set by env var', u, name, ev, name, null); pushTo(envOut, `${u}|${name}`, { to: `env:${name}`, label: name }); });
      }
    });
  }

  // 3. app -> app over HTTP, matched through env vars like BACKEND_URL
  const external = (n) => { const v = envExample.get(n); return !!v && /^https?:\/\//i.test(v) && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(v); };
  const envApp = new Map(); // `${app}|${VAR}` -> the app that var points at
  for (const [appId, refs] of envRefs) {
    const candidates = servers.filter((s) => s.id !== appId);
    if (!candidates.length) continue;
    const byName = new Map();
    for (const r of refs) {
      if (external(r.name) || outside.has(`env:${r.name}`)) continue; // points at a service outside this repo
      const target = serverNamed(r.name, appId) || pathsHit(r.name, appId) || candidates[0];
      envApp.set(`${appId}|${r.name}`, target.id);
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

  // 4. request flows: for every entry point, the stores, services and other routes its code reaches
  traceFlows({ apps, appOf, appsById, links, touches, fileImports, spanOf, envApp, envOut, resolveAny, source });

  // 5. who is the front door? web apps get "Users"; servers nobody in the repo calls get "Clients"
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

// ---------------------------------------------------------------- request flows
const MAX_FLOW = 40;

/** Identifiers a piece of code uses: not words inside strings, not property names (`res.json`), except `this.x`. */
function identsIn(text) {
  const t = text
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|\$\{([^}]*)\}|[^`\\$]|\$(?!\{))*`/g, (m) => ` ${[...m.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(' ')} `);
  const out = new Set();
  for (const m of t.matchAll(/(\bthis\s*\.\s*|(?<!\.)\.\s*)?([A-Za-z_$][\w$]*)/g)) if (!m[1] || /^this/.test(m[1])) out.add(m[2]);
  return out;
}

/** Imported names in a file: local name -> { spec, name } (name: the export it takes, 'default', or null for all of it). */
function localImports(code) {
  const b = new Map();
  const each = (list, sep, spec) => list.split(',').forEach((p) => {
    const [a, c] = p.trim().replace(/^type\s+/, '').split(sep).map((x) => x.trim());
    if (/^[\w$]+$/.test(c || a || '')) b.set(c || a, { spec, name: a });
  });
  for (const m of code.matchAll(/\bimport\s+(type\s+)?([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*(?:\*\s*as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    if (m[2]) b.set(m[2], { spec: m[5], name: 'default' });
    if (m[4]) b.set(m[4], { spec: m[5], name: null });
    if (m[3]) each(m[3], /\s+as\s+/, m[5]);
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+(?:([\w$]+)|\{([^}]*)\})\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (m[1]) b.set(m[1], { spec: m[3], name: null });
    if (m[2]) each(m[2], ':', m[3]);
  }
  return b;
}

/** What a file exports by name, and whether it passes on another file's exports wholesale (or is CommonJS: unknown). */
function exportInfo(code) {
  const names = new Set();
  for (const m of code.matchAll(/\bexport\s+(?:(default)\b|(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|enum)\s+([\w$]+))/g)) names.add(m[1] || m[2]);
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) m[1].split(',').forEach((p) => { const n = p.trim().split(/\s+as\s+/).pop(); if (n) names.add(n.trim()); });
  return { names, star: /\bexport\s*\*\s*from/.test(code), unknown: /\bmodule\.exports\b|\bexports\.[\w$]+\s*=/.test(code) };
}

/**
 * Follow every entry point's code: its own lines (the route handler, the worker callback, the whole page file),
 * then the files it imports, following only the names it takes through barrel files. Each store, service and
 * HTTP call found on the way becomes a step of its flow, with the shortest chain of files that leads there.
 */
function traceFlows({ apps, appOf, appsById, links, touches, fileImports, spanOf, envApp, envOut, resolveAny, source }) {
  const linked = (id) => [...links.values()].filter((l) => l.kind === 'app' && l.from === id).map((l) => appsById.get(l.to)).filter(Boolean);
  const callLabel = (c, ep) => [c.method || (ep && ep.methods && ep.methods.length === 1 ? ep.methods[0] : ''), ep ? ep.label : c.path || ''].filter(Boolean).join(' ') || 'HTTP';

  // every touch gets a target: env vars and HTTP calls become the app, route, store or service they point at
  const resolved = new Map();
  for (const [f, list] of touches) {
    const app = appOf(f);
    if (!app) continue;
    const out = [];
    for (const t of list) {
      if (!t.call) { out.push(t); continue; }
      const c = t.call;
      if (c.env) {
        const target = envApp.get(`${app.id}|${c.env}`);
        if (target) {
          const ep = c.path != null ? endpointFor(appsById.get(target), c.path, c.method) : null;
          out.push({ ...t, to: target, label: callLabel(c, ep), ep: ep ? ep.key : null });
        } else for (const o of envOut.get(`${app.id}|${c.env}`) || []) out.push({ ...t, to: o.to, label: o.label });
      } else {
        for (const cand of [app, ...linked(app.id)]) {
          const ep = endpointFor(cand, c.path, c.method);
          if (ep) { out.push({ ...t, to: cand.id, label: callLabel(c, ep), ep: ep.key }); break; }
        }
      }
    }
    resolved.set(f, out);
  }

  const infoCache = new Map();
  const info = (f) => {
    if (!infoCache.has(f)) {
      const text = source.read(f);
      const code = text == null ? '' : stripComments(codeOf(f, text));
      infoCache.set(f, { code, imps: localImports(code), decls: localDecls(code), props: propTypes(code), exp: exportInfo(code) });
    }
    return infoCache.get(f);
  };
  const wholeFile = (f) => ({ own: resolved.get(f) || [], next: fileImports.get(f) || [] });

  /** Where an entry point starts: its own lines and the imports they use. */
  const startOf = (e, app) => {
    const sp = spanOf.get(e);
    if (sp && sp.call) {
      const ep = endpointFor(app, normPath(sp.call), 'GET');
      return { own: ep ? [{ to: app.id, label: `GET ${ep.label}`, ep: ep.key, line: e.line, text: `calls ${sp.call}` }] : [], next: [] };
    }
    if (!sp || sp.b - sp.a < 8) {
      const start = wholeFile(e.file);
      // a Next.js page also runs the layouts around it
      if (/(^|\/)app\/(.*\/)?page\.(t|j)sx?$/.test(e.file)) {
        const extra = [];
        for (let dir = path.posix.dirname(e.file); /(^|\/)app(\/|$)/.test(dir); dir = path.posix.dirname(dir)) {
          for (const ext of ['tsx', 'jsx', 'ts', 'js']) if (touches.has(`${dir}/layout.${ext}`) || fileImports.has(`${dir}/layout.${ext}`)) extra.push({ file: `${dir}/layout.${ext}`, names: null, re: null });
          if (/(^|\/)app$/.test(dir)) break;
        }
        return { own: start.own, next: [...start.next, ...extra] };
      }
      return start;
    }
    return fromSpans(sp.file, [[sp.a, sp.b]]);
  };

  /**
   * The touches and imports that only some code of a file uses: the given character ranges, plus every
   * function, class or const of the same file they mention (and what those mention, and so on).
   */
  const fromSpans = (file, spans) => {
    const { code, imps, decls, props } = info(file);
    const lines = [];
    const files = new Map();
    const specs = new Set();
    const seen = new Set();
    const lineOf = (i) => { let n = 1; for (let k = 0; k < i && k < code.length; k++) if (code.charCodeAt(k) === 10) n++; return n; };
    const visit = (x, y) => {
      lines.push([lineOf(x), lineOf(y)]);
      for (const id of identsIn(code.slice(x, y))) {
        const imp = imps.get(id) || (props.has(id) ? imps.get(props.get(id)) : null);
        if (imp) {
          const t = resolveAny(file, imp.spec);
          if (t) { const had = files.get(t); files.set(t, had === null || imp.name === null ? null : [...(had || []), imp.name]); } else specs.add(pkgName(imp.spec));
          continue;
        }
        const d = decls.get(id);
        if (d && !seen.has(id) && !(d[0] <= x && d[1] >= y)) { seen.add(id); visit(d[0], d[1]); }
      }
    };
    spans.forEach(([a, b]) => visit(a, b));
    const own = (resolved.get(file) || []).filter((t) => lines.some(([p, q]) => t.line >= p && t.line <= q) || (t.spec && specs.has(t.spec)));
    return { own, next: [...files].map(([f, names]) => ({ file: f, names, re: null })) };
  };

  /** Where the exports `names` of a file are declared; null when one can't be found (then the whole file counts). */
  const exportSpans = (file, names) => {
    const { code, decls, exp } = info(file);
    if (exp.unknown) return null;
    const out = [];
    for (const nm of names) {
      if (nm === 'default') {
        const m = /\bexport\s+default\s+(?:async\s+)?(?:function\s*\*?\s*([\w$]+)?\s*\(|class\s+([\w$]+)?|([\w$]+)\s*[;\n])/.exec(code);
        if (!m) return null;
        const id = m[1] || m[2] || m[3];
        if (id && decls.has(id)) { out.push(decls.get(id)); continue; }
        const open = code.indexOf(m[0].includes('(') ? '(' : '{', m.index + 'export default'.length);
        const close = open < 0 ? -1 : closeOf(code, open);
        const body = m[0].includes('(') && close > 0 ? code.indexOf('{', close) : open;
        const end = body < 0 ? -1 : closeOf(code, body);
        if (end < 0) return null;
        out.push([m.index, end + 1]);
        continue;
      }
      // `export { a as b }`: the local name is a
      const alias = new RegExp(`\\bexport\\s*\\{[^}]*\\b([\\w$]+)\\s+as\\s+${nm.replace(/\$/g, '\\$')}\\b`).exec(code);
      const d = decls.get(alias ? alias[1] : nm);
      if (!d) return null;
      out.push(d);
    }
    return out;
  };

  const trace = (e, app) => {
    const reach = new Map();
    const add = (t, via) => {
      if (!t.to || t.label === 'runs jobs' || t.label === 'listens' || (t.to === app.id && !t.ep)) return;
      const key = `${t.to}|${t.ep || ''}`;
      const cur = reach.get(key);
      if (cur && cur.via.length <= via.length) return;
      reach.set(key, { to: t.to, label: t.label || null, ...(t.ep ? { ep: t.ep } : {}), line: t.line, text: t.text, via });
    };
    const start = startOf(e, app);
    start.own.forEach((t) => add(t, [e.file]));
    const seen = new Set();
    let frontier = start.next.map((n) => ({ file: n.file, names: n.names, via: [e.file, n.file] }));
    for (let depth = 0; frontier.length && depth < 12 && seen.size < 4000; depth++) {
      const next = [];
      for (const n of frontier) {
        const key = `${n.file}|${n.names ? [...n.names].sort().join(',') : '*'}`;
        if (seen.has(key) || seen.has(`${n.file}|*`)) continue;
        seen.add(key);
        const imps = fileImports.get(n.file) || [];
        const go = (file, names) => next.push({ file, names, via: n.via.length < 8 ? [...n.via, file] : n.via });
        // through a barrel: `export { a } from './a'` sends name a on; only what's left is this file's own
        let rest = n.names;
        if (n.names) {
          rest = [];
          for (const nm of n.names) {
            const hit = imps.find((im) => im.re instanceof Map && im.re.has(nm));
            if (hit) go(hit.file, hit.re.get(nm) === '*' ? null : [hit.re.get(nm)]);
            else rest.push(nm);
          }
          if (!rest.length) continue;
        }
        // only some exports are used: follow just their code, when each can be found
        const spans = rest ? exportSpans(n.file, rest) : null;
        if (spans) {
          const part = fromSpans(n.file, spans);
          part.own.forEach((t) => add(t, n.via));
          part.next.forEach((x) => go(x.file, x.names));
          for (const im of imps) {
            if (im.re === '*') {
              const ex = info(im.file).exp;
              const provides = rest.filter((nm) => ex.unknown || ex.names.has(nm));
              if (provides.length) go(im.file, provides);
            }
          }
          continue;
        }
        (resolved.get(n.file) || []).forEach((t) => add(t, n.via));
        for (const im of imps) {
          if (im.re instanceof Map) { if (!n.names) go(im.file, im.names); continue; }
          if (im.re === '*') {
            if (!rest) { go(im.file, null); continue; }
            const ex = info(im.file).exp;
            const provides = ex.unknown ? rest : rest.filter((nm) => ex.names.has(nm));
            if (provides.length) go(im.file, provides);
            else if (ex.star) go(im.file, rest);
            continue;
          }
          go(im.file, im.names);
        }
      }
      frontier = next;
    }
    // a call that names its route says more than the bare "uses API_URL" next to it
    const withEp = new Set([...reach.values()].filter((r) => r.ep).map((r) => r.to));
    const rank = (r) => (appsById.has(r.to) ? 0 : r.to.startsWith('store:') ? 1 : 2);
    return [...reach.values()].filter((r) => r.ep || !withEp.has(r.to))
      .sort((a, b) => rank(a) - rank(b) || a.to.localeCompare(b.to) || String(a.ep || '').localeCompare(String(b.ep || '')))
      .slice(0, MAX_FLOW);
  };

  for (const app of apps) {
    for (const g of Object.values(app.groups)) for (const e of g) e.flow = trace(e, app);
  }
}

// ---------------------------------------------------------------- base vs current
export const ENTRY_GROUPS = ['pages', 'api', 'endpoints', 'jobs', 'schedules', 'workers'];
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
      const bl = (b && b.groups[g]) || [];
      const cl = (c && c.groups[g]) || [];
      groups[g] = mergeList(bl, cl).sort((x, y) => x.key.localeCompare(y.key)).map((x) => {
        const be = bl.find((y) => y.key === x.key);
        const ce = cl.find((y) => y.key === x.key);
        // each step of the flow gets its own status: "this change makes /checkout call Stripe"
        return be && ce ? { ...x, flow: mergeList(be.flow || [], ce.flow || [], (r) => `${r.to}|${r.ep || ''}`) } : x;
      });
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
