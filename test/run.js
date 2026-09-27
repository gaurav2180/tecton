// Tiny zero-dependency test runner: `npm test`
import assert from 'node:assert/strict';
import { extractImports, stripComments, makeResolver } from '../src/scan.js';
import { nameMatches, globToRegex, makeGrouper } from '../src/graph.js';
import { evaluate } from '../src/rules.js';
import { layout } from '../src/layout.js';
import { detectSystem } from '../src/system.js';

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

console.log(`${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);
