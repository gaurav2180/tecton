# Tecton

**Tecton** (npm package and command: `tecton`) is a CLI that reads a JS/TS codebase and writes one self-contained HTML report. The report has three parts:
- a **module dependency map**, diffed against a git base (Before / After / Changes)
- **architecture rule checks**, which fail CI on new breaks
- a **system architecture diagram**: apps, entry points, data stores and outside services

It can also write a Markdown summary for PR comments (with Mermaid) and raw JSON.

## Commands
- `npm test`: zero-dependency unit tests (`test/run.js`). Run them after every change.
- `npm run build`: bundle the report's client (`src/report/client/**`) into `src/report/dist/client.js`. **Run it after any client change and commit the bundle.** `npm run dev` watches instead, and pairs well with `tecton serve`, whose next rebuild picks up the new bundle.
- `npm run typecheck`: `tsc` over the Node side (`tsconfig.json`) and the browser side (`src/report/client/tsconfig.json`).
- `npm run test:ui`: Playwright opens the demo reports and checks every page for script errors and against screenshot baselines (`test/ui/__screenshots__/<platform>/`), plus the main interactions. After an intended visual change, run `npm run test:ui -- --update-snapshots` and review the new PNGs.
  - Where Playwright can't download its browser, point it at one on disk: `TECTON_CHROMIUM=/path/to/chrome-headless-shell`.
- `npm run check`: all of the above, as CI runs it (`.github/workflows/ci.yml`).
- `bash examples/make-demo.sh /tmp/demo-shop && cd /tmp/demo-shop && node <repo>/bin/tecton.js --open`: end-to-end check on a demo repo that breaks two rules.
- `node bin/tecton.js <dir> --base <ref> --head <ref> --out r.html --md r.md --json r.json`: see `--help`.
- `node bin/tecton.js serve <dir> [--port 4321]`: watch mode (live-reloading report).
- `npm pack --dry-run`: check what ships to npm (`files` in package.json). `action.yml` is the GitHub Action (composite; runs `bin/tecton.js` from the action checkout).
- Regenerate `examples/demo-report.html` after UI changes: run the demo with `--out <repo>/examples/demo-report.html`.

## Hard constraints
- **No runtime dependencies.** Node >= 18 built-ins only (`fs`, `path`, `child_process`). Don't add packages to `dependencies`. Dev tools (esbuild, TypeScript, Playwright) are `devDependencies` only.
- The report is **one HTML file that works offline**. No CDN scripts or fonts: Geist is inlined as base64 from `src/report/fonts/` (OFL licence kept alongside).
- The client is vanilla JS (no framework) in ES modules, bundled by esbuild.
- **The built bundle `src/report/dist/client.js` is committed**, so the CLI, the GitHub Action (which runs from a bare checkout) and the npm package never need a build step. CI fails if it is stale.
- The code is plain JavaScript typed with JSDoc. Shared shapes live in `src/types.d.ts`: the report model the CLI writes and the page reads. View-only shapes live in `src/report/client/types.d.ts`.
- **Output must be deterministic.** The same input gives the same layout, so boxes never move between Before, After and Changes. Layout runs once on base ∪ current.
- Plain-language UI copy. The users are developers, but explanations should read simply (no jargon like "SCC" or "fan-in").

## Pipeline (bin/tecton.js)
**Product rule: `npx tecton` with no arguments and no config must just work and show the result.**
- A person at a terminal gets the report in a temp folder, opened in the browser. CI or piped output (`interactive()`) gets `./tecton-report.html` and no browser. `--no-open` and `BROWSER=none` skip the browser anywhere.
- With no config, `makeGrouper` picks `src/` if it exists, and groups files under `apps/`, `packages/`, … one level deeper (`WORKSPACE_DIRS`).

`analyze(dir, opts)` runs steps 1–6 and returns the report model. `report()` writes the files; `serve()` re-runs `analyze` on file changes (`fs.watch` recursive, polling fallback) and pushes `building`/`reload`/`failed` over server-sent events to a snippet injected into the served page only. Usage errors throw `UsageError` (exit 2) so `serve` survives a broken config.
1. `src/scan.js` defines two sources: `workingTreeSource(dir)` (git ls-files, or a directory walk) and `gitRefSource(dir, ref)`, which reads every file in one `git cat-file --batch`. Each source exposes `{ files, manifests, extras, read(path) }`. `extras` holds `.env.example`-style files and `vercel.json`. `.vue`/`.svelte` count as code; `codeOf(file, text)` keeps only their `<script>` blocks, with line numbers intact. The same file holds `stripComments` (which keeps strings and line numbers), `extractImports` (regex-based) and `makeResolver` (relative paths, index files, `.js→.ts`, tsconfig `paths`/`baseUrl`, npm packages, builtins).
2. `src/graph.js` does the grouping. `makeGrouper(cfg)` maps a file to a module name (explicit `modules` first, then the folder under `root` at `depth`). `buildGraph(source, cfg)` returns `{ modules, edges, stats, moduleOf, fileDeps }`, where each edge keeps up to 60 `{file,line,spec,target}` evidence items and `fileDeps` is file → Map(target file → line).
   - In bin, `fileLevel()` turns both snapshots into `model.files = { files: [path, module, s|a|r, edited], deps: [fromIdx, toIdx, s|a|r, line] }`. "Edited" compares base and current content, ignoring CRLF.
   - `nodes[].touched` counts edited files per module. Together these feed the module drill-down and the "touched" filter.
3. `src/rules.js`: `evaluate(graph, cfg)` returns violations from forbid (`to`) and allow-list (`allow`) rules, plus loops found with Tarjan's algorithm (`cycles`). `from` can be a string or an array, and `*` wildcards work.
4. `src/diff.js`: `diffGraphs` merges base and current into nodes/edges with `status: same|added|removed`, and marks violations `new|existing|fixed`.
5. `src/system.js` builds the system view.
   - `detectSystem(source, graph)` finds apps (each `package.json`, with the framework from its deps).
   - It finds entry points in the groups `pages`, `api`, `endpoints`, `jobs` and `schedules` (`ENTRY_GROUPS`):
     - file routes: Next, Nuxt, SvelteKit
     - HTTP endpoints: `scanServerCode()` reads routes, mounts and base paths per file, and `makePrefixer()` follows `use`/`route`/`register` mounts across files through `bindingsOf()` + the resolver. It also handles NestJS decorators.
     - npm scripts that run a file
     - cron: `findCrons()` + `describeCron()`, and `vercel.json`
   - It finds stores: the `STORES` table, including queues with `kind: 'Queue'`; BullMQ/Bull/Bee-Queue queues are found by name. Connection strings in env files are mapped through `SCHEME_STORES`.
   - It finds outside services: URL literals grouped by domain, the `SDKS` table, URLs in `.env.example`, and empty `*_URL` vars, which become `env:<NAME>` services of kind "Set by env var".
   - It links apps to each other through `*_URL`-style env vars like `BACKEND_URL`, unless `.env.example` points that var at an outside host.
   - `diffSystems(base, cur)` adds statuses to all of it.
6. `src/layout.js` is a Sugiyama-style layered layout for the dependency map (break loops, assign layers, add dummy nodes, reduce crossings with barycenters, then coordinates).
7. `src/report.js`: `toHtml(model)` inlines `template.html`, the client bundle (`dist/client.js`), the fonts and the JSON data. `toMarkdown(model)` writes the PR summary. Its Mermaid colours are the brand product signals (`COLORS`).
   - The bundle includes `layout.js`, so module file diagrams are laid out in the page by the same deterministic code.

## Brand: use it for everything
The logo system lives in `brand/`. Its source of truth is the "Tecton logo" design canvas, which has construction, lockups, colour and in-use boards.
- **Mark**: a capital T made of three rounded plates on a 64-unit grid:
  - left arm A `x6 y14 25×12`
  - right arm B `x33 y9 25×12`, the *moved plate*: split from A by a 2u fault and shifted up 5u
  - stem C `x25 y28 14×30`
  - every corner radius is 3u
  - Never redraw it by eye. Copy the rects from `brand/tecton-mark.svg` (the report uses `TECTON_MARK` in `src/report/client/lib/dom.js`).
- **Colour rule**: only the moved plate is coloured. The rest is ink.
  - Light backgrounds: ink `#0E0F13` + shift indigo `#5B5BD6`.
  - Dark backgrounds: paper `#FAFAF7` + indigo `#7C7FF2`.
  - On an indigo background: white, with the moved plate at 55% white.
- **Wordmark**: lowercase `tecton`, Geist SemiBold, −5.5% tracking. Use the outlined SVGs (`tecton-logo*.svg`, `tecton-wordmark.svg`); don't set it as live text in brand assets. Prose uses "Tecton" (capital T); the command and package are `tecton`.
- **Neutrals**: page ground "sediment" `#F6F5F2` (the report's light `--bg`), white surfaces, warm borders `#E6E3DC`. The UI accent is the same indigo.
- **Product signals** (green new `#16A34A`, red removed `#DC2626`, orange rule break `#EA580C`) belong to the report. Never put them in the logo.
- **Files**:
  - `tecton-mark(-dark|-mono).svg`
  - `tecton-logo(-dark|-mono).svg` and `@2x.png`
  - `tecton-app-icon(-indigo).svg` with 512/192 PNGs and `apple-touch-icon.png`
  - `tecton-favicon.svg`: thicker 16px plates that follow light/dark; inlined into every report by `report.js`
  - `favicon-32.png`
  - `tecton-banner.svg`/`.png` (1280×640, for social / README)
- **Clear space** = the stem width (14u). **Minimum size**: 16px for the mark, 20px mark height for the lockup.
- **Tagline**: "See every shift in your architecture before it becomes a crack."

## Report UI (src/report/)
- `template.html` holds all the CSS. Design tokens are CSS variables on `:root`; dark mode is defined twice (`prefers-color-scheme` and `[data-theme]`).
- `client/` holds ES modules, bundled into one IIFE by `scripts/build.js`:
  - `main.js`: boot. It renders every page once, listens for `hashchange` and keys, then shows the page in the URL.
  - `lib/dom.js`: `h()`/`s()` build DOM/SVG, and `ICONS` holds Lucide-style paths.
  - `lib/data.js`: the embedded model `D`, everything derived from it, and `state`.
  - `ui/`: `router` (`go`/`show`), `shell` (sidebar, top bar, theme, toasts), `common` (tabs, badges, tooltip), `palette`, `export`.
  - `pages/`: one module per page, each with a `render*()` function.
- **Load order rule:** only `lib/dom.js`, `lib/data.js` and `main.js` run code at load time. `dom` imports nothing and `data` imports only `dom`. Pages may import each other freely, since those cycles are safe because pages only call each other inside functions. Don't add top-level code to a page that calls into another page.
- Pages are Overview, Architecture, Dependency map (`renderMap`/`applyMap`), Rule checks, Changes and Modules.
- Architecture is a C4 container diagram in pure SVG. `archModel` → `archLayout` → `routeWires` → `buildArch`, then `applyArch` for the view and `archHl` for hover.
  - Layout: Users (C4 person) on top. The repo is a dashed boundary with its title at the bottom-left. App containers sit in one row, callers left of callees, wrapping after 4. Databases (cylinders) and queues (horizontal pipes) form a row below. Outside systems stack in columns to the right.
  - Routing: A* on an 8px grid around boxes with 12px clearance. Wires leaving one side share a port and travel as a bundle: cells a source already owns are cheaper. Labels go on each wire's last free stretch.
  - Keep costs in Float64Array: float32 rounding broke the stale-entry check and produced huge detours.
  - It has its own pan/zoom (`archPanZoom`, `archFit`, min 50% on phones) and SVG export through the shared `exportSvgFrom`.
- **Diagram kinds.** Both diagram pages let the viewer pick how to see them: `state.mapView` / `state.archView`, remembered in localStorage.
  - Dependency map: Graph (`map.js`), Matrix (a dependency structure matrix) and Radial, the last two in `map-views.js`.
  - Architecture: Diagram (`architecture.js`), Tiers and Matrix, the last two in `arch-views.js`.
  - The default view stays built underneath the others (hidden, not destroyed) so its zoom survives a switch.
  - The other views are re-rendered from scratch by `renderMapAlt` / `renderArchAlt` on every view, selection or Changes/Before/After change.
  - Add a new kind by adding it to `MAP_VIEWS` / `ARCH_VIEWS` and a branch in the render function. It must follow `present()`/statuses and open the same drawer/sheet.
- **Dependency map visual rules** (after users found the loop-heavy map ugly):
  - Only rule breaks with severity "error" are strong orange. Loops and warn-level rules are thin amber (`.warnv`, via `violLevel()`).
  - A loop reports only the imports that close it (`loopClosers()` in `rules.js`), not every arrow inside it.
  - Arrows sharing a side of a box are spread along it (`layout.js`).
  - Labels are hidden when the count is 1 and nothing changed, and are placed clear of boxes and other labels.
  - No glow and no moving dots on any diagram.
  - The `loops` UI fixture guards this.
- **Level of detail:** `state.detail` (`full`|`simple`), set by `setDetail()` in `ui/common.js`, toggles `html.detail-simple`. CSS then hides labels, meta lines and npm boxes; architecture boxes swap `.an-full` for `.an-simple` (centred name). Shapes and positions never change.
- **No decorative accent stripes** (coloured top/left bars on cards, rows or nav items). The user found them "AI slop". Show state with background tint, icon colour or a badge instead.
- A module page (`#module:<name>`, `renderModule`, not in `PAGES`/the nav) shows that module's files as a diagram (`fileGraph` → `drawFileMap` → `applyFileMap`), a files table, and a per-file `#sheet` (`openFileSheet`). Open it with `goModule(id, file?)`.
- `state.touchedOnly` / `touchedMods` drive the map's "Only touched" filter. Edited files use the indigo accent (`.tdot`, `chip acc`, `badge acc`), because blue `--chg` already means "import count changed".
- It also includes the ⌘K palette, toasts, the drawer / `#sheet` side panels and SVG export.
- Shared state is `state.view` (`diff|base|cur`) plus `state.selected`.
- Respect `prefers-reduced-motion`. Visual QA is `npm run test:ui`: 1440px and 390px (iPhone 13), in light and dark. When a screenshot changes on purpose, update the baselines and look at the new images before committing them.

## Gotchas
- A JSON literal embedded in `<script>` must escape `<` and U+2028/2029. Never write a raw U+2028 into a JS source file, because it breaks regex literals.
- `execFileSync` with `input` needs a Buffer and `encoding: null`.
- The config file is `tecton.config.json`; `archdiff.config.json` (the old name) is still read as a fallback.
- Modules listed in config as a single file (`"src/config.js"`) must match exactly. Folder paths match everything inside.
- The preview on the overview is a clone of the map. It has ids, roles and aria labels stripped so it doesn't duplicate interactive elements.
- SVG `url(#…)` references (markers, filters) to defs inside a `display:none` page don't paint in Chrome: the element vanishes. Any SVG shown outside the map page needs its own defs with unique ids (see `fm-arr-*`/`fm-shadow` in `drawFileMap`).
- The Bash tool can eat backslashes in heredocs and `python -c` (and `$$` in double-quoted `node -e`). Edit regex-heavy source with the Edit/Write tools.
- `npx playwright install` deletes browser builds that the installed Playwright version doesn't use, including ones other projects may rely on.
- Type imports in the Node code need the extension (`import('./types.js')`, which resolves to `types.d.ts`) because of `nodenext` resolution. The client uses `bundler` resolution and doesn't.

## Ideas / backlog
- Publish to npm: `npm publish` (the name `tecton` was free as of 2026-09). The repo is github.com/gaurav2180/tecton; tag each release so `uses: gaurav2180/tecton@vX.Y.Z` works.
- Route detection inside Next.js custom servers, tRPC routers and GraphQL resolvers.
- Queue names from constants in other files; GitHub Actions `schedule:` crons as jobs.
- A PR-scoped Markdown mode that lists touched files per module.
