// Tiny zero-dependency test runner: `npm test`
import assert from 'node:assert/strict';
import { extractImports, stripComments, makeResolver, codeOf, isCode, isExtra } from '../src/scan.js';
import { nameMatches, globToRegex, makeGrouper, buildGraph } from '../src/graph.js';
import { evaluate } from '../src/rules.js';
import { layout } from '../src/layout.js';
import { detectSystem, describeCron } from '../src/system.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; } };

test('finds all import styles', () => {
  const src = `import a from './a';
import { b, type C } from "@/b";
import './side-effect.css';
export * from '../c';
export { d } from './d';
const e = require('e-pkg');
const f = await import('./f');
import type { G } from './g';`;
  assert.deepEqual(extractImports(src).map((x) => x.spec),
    ['./a', '@/b', './side-effect.css', '../c', './d', 'e-pkg', './f', './g']);
});

test('ignores imports inside comments but keeps strings and line numbers', () => {
  const src = `// import x from 'nope1'\n/* import y from 'nope2' */\nconst s = "// not a comment";\nimport z from 'yes';`;
  const found = extractImports(src);
  assert.deepEqual(found, [{ spec: 'yes', line: 4 }]);
  assert.ok(stripComments(src).includes('"// not a comment"'));
});

test('template literals with nested expressions do not confuse the scanner', () => {
  const src = 'const q = `a ${ {x: 1}.x } // b`;\nimport k from "k";';
  assert.deepEqual(extractImports(src).map((x) => x.spec), ['k']);
});

test('resolves relative, index, .js→.ts, aliases and packages', () => {
  const files = new Set(['src/a.ts', 'src/lib/index.ts', 'src/util.ts', 'src/ui/Button.tsx']);
  const r = makeResolver(files, [{ pattern: '@/*', targets: ['src/*'] }]);
  assert.deepEqual(r('src/ui/Button.tsx', '../a'), { kind: 'file', file: 'src/a.ts' });
  assert.deepEqual(r('src/a.ts', './lib'), { kind: 'file', file: 'src/lib/index.ts' });
  assert.deepEqual(r('src/a.ts', './util.js'), { kind: 'file', file: 'src/util.ts' });
  assert.deepEqual(r('src/a.ts', '@/ui/Button'), { kind: 'file', file: 'src/ui/Button.tsx' });
  assert.deepEqual(r('src/a.ts', '@scope/pkg/sub'), { kind: 'package', pkg: '@scope/pkg' });
  assert.deepEqual(r('src/a.ts', 'node:fs'), { kind: 'builtin' });
  assert.deepEqual(r('src/a.ts', 'path'), { kind: 'builtin' });
});

test('name and glob matching', () => {
  assert.ok(nameMatches('features/*', 'features/cart'));
  assert.ok(!nameMatches('db', 'dbx'));
  assert.ok(globToRegex('src/**/*.test.*').test('src/a/b/c.test.ts'));
  assert.ok(globToRegex('**/*.test.*').test('x.test.js'));
});

const graph = (edges) => {
  const modules = new Map();
  const map = new Map();
  for (const [from, to] of edges) {
    modules.set(from, { files: [] });
    if (!to.startsWith('npm:')) modules.set(to, { files: [] });
    map.set(`${from}→${to}`, { from, to, external: to.startsWith('npm:'), count: 1, imports: [] });
  }
  return { modules, edges: map };
};

test('explicit modules match single files and folders', () => {
  const g = makeGrouper({ root: '', modules: { cfg: ['src/config.js'], api: ['src/routes/'] } }, []);
  assert.equal(g.moduleOf('src/config.js'), 'cfg');
  assert.equal(g.moduleOf('src/routes/a.js'), 'api');
  assert.equal(g.moduleOf('src/other/b.js'), 'src/other'.split('/')[0]);
});

test('zero config: a monorepo is grouped by app and package, not by apps/ and packages/', () => {
  const files = ['apps/web/src/page.tsx', 'apps/api/index.js', 'packages/ui/src/Button.tsx', 'scripts/seed.js', 'index.js'];
  const g = makeGrouper({}, files);
  assert.deepEqual(files.map((f) => g.moduleOf(f)), ['apps/web', 'apps/api', 'packages/ui', 'scripts', '(root)']);
  // an explicit depth, or a src/ folder, keeps the old behaviour
  assert.equal(makeGrouper({ depth: 1 }, files).moduleOf('apps/web/src/page.tsx'), 'apps');
  assert.equal(makeGrouper({}, ['src/apps/x/a.ts']).moduleOf('src/apps/x/a.ts'), 'apps');
});

test('forbid, allow-list and cycle rules', () => {
  const g = graph([['ui', 'db'], ['ui', 'lib'], ['lib', 'svc'], ['svc', 'lib'], ['lib', 'npm:lodash']]);
  const v = evaluate(g, { rules: [{ from: 'ui', to: ['db'] }, { name: 'lib leaf', from: 'lib', allow: [] }] });
  const ids = v.map((x) => x.id).sort();
  assert.deepEqual(ids, ['cycle|lib|svc', 'lib leaf|lib|svc', 'rule 1|ui|db']);
});

test('layout is deterministic and handles cycles', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a'], ['a', 'd']].map(([from, to]) => ({ id: `${from}→${to}`, from, to }));
  const one = layout(nodes, edges);
  const two = layout([...nodes].reverse(), [...edges].reverse());
  assert.deepEqual(one.pos, two.pos);
  for (const e of edges) assert.ok(one.routes[e.id].length >= 2);
});

test('system view finds apps, entry points, data and outside services', () => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { express: '4' }, scripts: { 'sync:x': 'node scripts/sync.js' } }),
    'web/package.json': JSON.stringify({ dependencies: { next: '16', react: '19' } }),
    'src/routes.js': "import { Router } from 'express';\nimport Stripe from 'stripe';\nimport { DatabaseSync } from 'node:sqlite';\nr.get('/health', f);\nr.post('/pay', f);\nfetch('https://api.example-bank.co.in/v1');\n// fetch('https://ignored-comment.com')",
    'scripts/sync.js': "fetch('https://data.vendor.io/feed')",
    'web/app/(shell)/pans/page.tsx': 'export default function P() { return <a href="https://docs.site.com">docs</a>; }',
    'web/app/api/check/route.ts': 'export async function POST() { return fetch(`${process.env.BACKEND_URL}/pay`); }',
  };
  const source = { files: Object.keys(files).filter((f) => !f.endsWith('.json')), manifests: ['package.json', 'web/package.json'], read: (f) => files[f] };
  const sys = detectSystem(source, null);
  const app = (id) => sys.apps.find((a) => a.id === id);
  assert.equal(app('.').framework, 'Express');
  assert.equal(app('web').framework, 'Next.js');
  assert.deepEqual(app('.').groups.endpoints.map((x) => x.key), ['GET /health', 'POST /pay']);
  assert.deepEqual(app('.').groups.jobs.map((x) => x.key), ['sync:x']);
  assert.deepEqual(app('web').groups.pages.map((x) => x.key), ['/pans']);
  assert.deepEqual(app('web').groups.api.map((x) => `${x.methods.join()} ${x.key}`), ['POST /api/check']);
  assert.deepEqual(sys.stores.map((x) => x.name), ['SQLite']);
  assert.deepEqual(sys.outside.map((x) => x.name).sort(), ['Stripe', 'example-bank.co.in', 'vendor.io']);
  assert.ok(sys.links.some((l) => l.from === 'web' && l.to === '.' && l.kind === 'app'));
  assert.ok(sys.links.some((l) => l.from === 'users' && l.to === 'web'));
});

const sourceOf = (files) => ({
  files: Object.keys(files).filter((f) => isCode(f)),
  manifests: Object.keys(files).filter((f) => f.endsWith('package.json')),
  extras: Object.keys(files).filter((f) => isExtra(f)),
  read: (f) => files[f] ?? null,
});
const endpoints = (sys, id) => sys.apps.find((a) => a.id === id).groups.endpoints.map((x) => x.key);

test('Express router prefixes are followed across files and local routers', () => {
  const sys = detectSystem(sourceOf({
    'server/package.json': JSON.stringify({ dependencies: { express: '4' } }),
    'server/index.js': `import express from 'express';
import api from './routes/index.js';
const app = express();
const v1 = express.Router();
v1.get('/ping', f);
app.use(express.json());
app.use('/api', auth, api);
app.use('/v1', v1);
app.get('/health', h);
axios.get('/not-a-route');`,
    'server/routes/index.js': "import { Router } from 'express';\nimport users from './users';\nconst r = Router();\nr.use('/users', users);\nr.get('/', x);\nexport default r;",
    'server/routes/users.js': "const router = require('express').Router();\nrouter.get('/:id', f);\nrouter.route('/').get(a).post(b);\nmodule.exports = router;",
  }), null);
  assert.deepEqual(endpoints(sys, 'server'), ['GET /api', 'GET /api/users', 'GET /api/users/:id', 'GET /health', 'GET /v1/ping', 'POST /api/users']);
});

test('Fastify register prefixes, route objects, Hono basePath and NestJS decorators', () => {
  const sys = detectSystem(sourceOf({
    'fast/package.json': JSON.stringify({ dependencies: { fastify: '4' } }),
    'fast/app.js': "const app = require('fastify')();\napp.register(require('./items'), { prefix: '/shop' });",
    'fast/items.js': "module.exports = async (fastify) => { fastify.route({ method: ['GET', 'POST'], url: '/items', handler }); };",
    'hono/package.json': JSON.stringify({ dependencies: { hono: '4' } }),
    'hono/index.ts': "import { Hono } from 'hono';\nimport books from './books';\nconst app = new Hono().basePath('/api');\napp.route('/books', books);",
    'hono/books.ts': "import { Hono } from 'hono';\nconst b = new Hono();\nb.get('/', c);\nexport default b;",
    'nest/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '10' } }),
    'nest/src/main.ts': "const app = await NestFactory.create(AppModule);\napp.setGlobalPrefix('api');",
    'nest/src/users.controller.ts': "@Controller('users')\nexport class Users {\n  @Get() all() {}\n  @Get(':id') one() {}\n  @Post() create(@Body() b) {}\n}",
  }), null);
  assert.deepEqual(endpoints(sys, 'fast'), ['GET /shop/items', 'POST /shop/items']);
  assert.deepEqual(endpoints(sys, 'hono'), ['GET /api/books']);
  assert.deepEqual(endpoints(sys, 'nest'), ['GET /api/users', 'GET /api/users/:id', 'POST /api/users']);
});

test('Vue and Svelte files: script blocks are read, Nuxt and SvelteKit routes found', () => {
  const vue = '<template>\n  <p>import nope from "x"</p>\n</template>\n<script setup lang="ts">\nimport Card from "./Card.vue";\n</script>';
  assert.deepEqual(extractImports(codeOf('a.vue', vue)), [{ spec: './Card.vue', line: 5 }]);
  const sys = detectSystem(sourceOf({
    'nx/package.json': JSON.stringify({ dependencies: { nuxt: '3' } }),
    'nx/pages/index.vue': vue,
    'nx/pages/users/[id].vue': '<template/>',
    'nx/server/api/items.get.ts': 'export default defineEventHandler(() => 1)',
    'kit/package.json': JSON.stringify({ devDependencies: { '@sveltejs/kit': '2' } }),
    'kit/src/routes/+page.svelte': '<script>import x from "$lib/x";</script>',
    'kit/src/routes/(app)/blog/[slug]/+page.svelte': '<h1/>',
    'kit/src/routes/api/x/+server.ts': 'export const POST = async () => {};',
  }), null);
  const g = (id, k) => sys.apps.find((a) => a.id === id).groups[k].map((x) => `${(x.methods || []).join()} ${x.key}`.trim());
  assert.deepEqual(g('nx', 'pages'), ['/', '/users/[id]']);
  assert.deepEqual(g('nx', 'api'), ['GET GET /api/items']);
  assert.deepEqual(g('kit', 'pages'), ['/', '/blog/[slug]']);
  assert.deepEqual(g('kit', 'api'), ['POST /api/x']);
});

test('queues, cron schedules and .env.example services', () => {
  const sys = detectSystem(sourceOf({
    'package.json': JSON.stringify({ dependencies: { next: '15' } }),
    'worker/package.json': JSON.stringify({ dependencies: { bullmq: '5', 'node-cron': '3' } }),
    'worker/jobs.ts': `import { Queue, Worker } from 'bullmq';
import cron from 'node-cron';
const EMAILS = 'emails';
export const q = new Queue<Job>(EMAILS, { connection });
new Worker('emails', async () => {});
q.add('digest', {}, { repeat: { pattern: '0 8 * * 1' } });
cron.schedule('*/15 * * * *', () => {});
fetch(process.env.PAYMENTS_API_URL);`,
    'worker/.env.example': 'DATABASE_URL=postgres://u:p@db:5432/app\nSEARCH_API_URL=https://search.vendor.com/v1 # hosted search\nPAYMENTS_API_URL=\nNEXT_PUBLIC_SITE_URL=https://mysite.com\nPORT=3000',
    'vercel.json': JSON.stringify({ crons: [{ path: '/api/cleanup', schedule: '0 3 * * *' }] }),
    'app/api/cleanup/route.ts': 'export async function GET() {}',
  }), null);
  const w = sys.apps.find((a) => a.id === 'worker');
  assert.deepEqual(w.groups.schedules.map((x) => [x.label, x.human]), [['*/15 * * * *', 'every 15 minutes'], ['0 8 * * 1', 'every Monday at 08:00']]);
  assert.deepEqual(sys.apps.find((a) => a.id === '.').groups.schedules.map((x) => [x.human, x.cmd]), [['every day at 03:00', 'calls /api/cleanup']]);
  assert.deepEqual(sys.stores.map((x) => `${x.name}:${x.kind}`), ['PostgreSQL:Database', 'emails queue:Queue']);
  const emails = sys.links.find((l) => l.to === 'store:queue-emails');
  assert.deepEqual(emails.labels.sort(), ['adds jobs', 'runs jobs']);
  assert.deepEqual(sys.outside.map((x) => `${x.name}:${x.kind}`).sort(), ['Payments API:Set by env var', 'vendor.com:Web / HTTP']);
  assert.ok(!sys.outside.some((x) => x.name === 'mysite.com'));
});

test('env vars naming one of our own servers link the apps instead', () => {
  const sys = detectSystem(sourceOf({
    'web/package.json': JSON.stringify({ dependencies: { next: '15' } }),
    'web/lib/api.ts': 'fetch(`${process.env.BACKEND_URL}/x`); fetch(process.env.BILLING_API_URL);',
    'web/.env.example': 'BACKEND_URL=\nBILLING_API_URL=https://billing.partner.io',
    'backend/package.json': JSON.stringify({ dependencies: { express: '4' } }),
    'backend/index.js': "app.get('/x', f);",
  }), null);
  assert.ok(sys.links.some((l) => l.from === 'web' && l.to === 'backend' && l.labels[0] === 'HTTP · BACKEND_URL'));
  assert.deepEqual(sys.outside.map((x) => x.name), ['partner.io']);
});

test('file-level imports are recorded for the drill-down (including Vue files)', () => {
  const files = {
    'src/ui/Card.vue': '<template><b/></template>\n<script setup>\nimport { fmt } from "../lib/fmt";\nimport Badge from "./Badge.vue";\n</script>',
    'src/ui/Badge.vue': '<script>export default {}</script>',
    'src/lib/fmt.ts': "import dayjs from 'dayjs';\nexport const fmt = 1;",
  };
  const g = buildGraph({ files: Object.keys(files), manifests: [], read: (f) => files[f] ?? null }, {});
  assert.deepEqual([...g.fileDeps.get('src/ui/Card.vue')], [['src/lib/fmt.ts', 3], ['src/ui/Badge.vue', 4]]);
  assert.deepEqual([...g.edges.keys()].sort(), ['lib→npm:dayjs', 'ui→lib']);
});

test('cron expressions in plain words', () => {
  assert.equal(describeCron('* * * * *'), 'every minute');
  assert.equal(describeCron('0 * * * *'), 'every hour');
  assert.equal(describeCron('30 */6 * * *'), 'every 6 hours');
  assert.equal(describeCron('0 0 9 * * 1-5'), 'weekdays at 09:00');
  assert.equal(describeCron('0 12 1 * *'), 'every month on day 1 at 12:00');
  assert.equal(describeCron('*/10 * * * * *'), 'every 10 seconds');
  assert.equal(describeCron('@daily'), 'every day at midnight');
  assert.equal(describeCron('5 4 * 2 3'), null);
});

console.log(`${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);
