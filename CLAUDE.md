# archdiff

A CLI that reads a JS/TS codebase and writes one self-contained HTML report. The report has three parts:
- a **module dependency map**, diffed against a git base (Before / After / Changes)
- **architecture rule checks**, which fail CI on new breaks
- a **system architecture diagram**: apps, entry points, data stores and outside services

It can also write a Markdown summary for PR comments (with Mermaid) and raw JSON.

## Commands
- `npm test`: zero-dependency test runner (`test/run.js`). Run it after every change.
- `bash examples/make-demo.sh /tmp/demo-shop && cd /tmp/demo-shop && node <repo>/bin/archdiff.js --open`: end-to-end check on a demo repo that breaks two rules.
- `node bin/archdiff.js <dir> --base <ref> --head <ref> --out r.html --md r.md --json r.json`: see `--help`.
- Regenerate `examples/demo-report.html` after UI changes: run the demo with `--out <repo>/examples/demo-report.html`.

## Hard constraints
- **No runtime dependencies.** Node >= 18 built-ins only (`fs`, `path`, `child_process`). Don't add packages to `dependencies`.
- The report is **one HTML file that works offline**. No CDN scripts or fonts: Geist is inlined as base64 from `src/report/fonts/` (OFL licence kept alongside). The client JS is vanilla (no framework, no build step).
- **Output must be deterministic.** The same input gives the same layout, so boxes never move between Before, After and Changes. Layout runs once on base ∪ current.
- Plain-language UI copy. The users are developers, but explanations should read simply (no jargon like "SCC" or "fan-in").

## Pipeline (bin/archdiff.js)
1. `src/scan.js` defines two sources: `workingTreeSource(dir)` (git ls-files, or a directory walk) and `gitRefSource(dir, ref)`, which reads every file in one `git cat-file --batch`. Each source exposes `{ files, manifests, read(path) }`. The same file holds `stripComments` (which keeps strings and line numbers), `extractImports` (regex-based) and `makeResolver` (relative paths, index files, `.js→.ts`, tsconfig `paths`/`baseUrl`, npm packages, builtins).
2. `src/graph.js` does the grouping. `makeGrouper(cfg)` maps a file to a module name (explicit `modules` first, then the folder under `root` at `depth`). `buildGraph(source, cfg)` returns `{ modules, edges, stats, moduleOf }`, where each edge keeps up to 60 `{file,line,spec,target}` evidence items.
3. `src/rules.js`: `evaluate(graph, cfg)` returns violations from forbid (`to`) and allow-list (`allow`) rules, plus loops found with Tarjan's algorithm (`cycles`). `from` can be a string or an array, and `*` wildcards work.
4. `src/diff.js`: `diffGraphs` merges base and current into nodes/edges with `status: same|added|removed`, and marks violations `new|existing|fixed`.
5. `src/system.js` builds the system view.
   - `detectSystem(source, graph)` finds apps (each `package.json`, with the framework from its deps), entry points (Next pages and route handlers, Express `x.get('/path')`, npm scripts that run a file), stores (the `STORES` table) and outside services (URL literals grouped by domain, plus the `SDKS` table).
   - It links apps to each other through `*_URL`-style env vars like `BACKEND_URL`.
   - `diffSystems(base, cur)` adds statuses to all of it.
6. `src/layout.js` is a Sugiyama-style layered layout for the dependency map (break loops, assign layers, add dummy nodes, reduce crossings with barycenters, then coordinates).
7. `src/report.js`: `toHtml(model)` inlines `template.html`, `client.js`, the fonts and the JSON data. `toMarkdown(model)` writes the PR summary.

## Report UI (src/report/)
- `template.html` holds all the CSS. Design tokens are CSS variables on `:root`; dark mode is defined twice (`prefers-color-scheme` and `[data-theme]`).
- `client.js` is one IIFE. `h()`/`s()` build DOM/SVG and `ICONS` holds Lucide-style paths. There's a page per `render*()` function, and routing is by `#hash`.
- Pages are Overview, Architecture (`renderSystem`, whose wires are drawn from real DOM rects in `drawWires`), Dependency map (`renderMap`/`applyMap`), Rule checks, Changes and Modules.
- It also includes the ⌘K palette, toasts, the drawer / `#sheet` side panels and SVG export.
- Shared state is `state.view` (`diff|base|cur`) plus `state.selected`.
- Respect `prefers-reduced-motion`. Visual QA means rendering the report headless (Playwright) at 1440px and 390px in light and dark, then looking at the screenshots.

## Gotchas
- A JSON literal embedded in `<script>` must escape `<` and U+2028/2029. Never write a raw U+2028 into a JS source file, because it breaks regex literals.
- `execFileSync` with `input` needs a Buffer and `encoding: null`.
- Modules listed in config as a single file (`"src/config.js"`) must match exactly. Folder paths match everything inside.
- The preview on the overview is a clone of the map. It has ids, roles and aria labels stripped so it doesn't duplicate interactive elements.

## Ideas / backlog
- Publish to npm (`npx archdiff`) and ship a ready-made GitHub Action.
- A watch mode (`archdiff serve`) that live-reloads the report as files change.
- Express router prefixes (`app.use('/api', router)`), Fastify/Nest route decorators, and Vue/Svelte files.
- Per-file drill-down inside a module, and a "PR-scoped" view that shows only touched modules.
- Detect queues (BullMQ, SQS), cron schedules and env-only service URLs (`.env.example`).
