<p align="center"><img src="brand/tecton-banner.png" alt="Tecton: see every shift in your architecture before it becomes a crack" width="720"></p>

# Tecton

**See every shift in your architecture before it becomes a crack.**

Tecton draws your project as a map of **modules** (folders) and the **dependencies** between them,
compares it with a git branch, and checks **house rules** such as "components must not talk to the
database directly". You get an interactive HTML page, an optional Markdown summary for pull requests,
and a non-zero exit code when a change breaks a rule.

- No dependencies. Needs Node 18+ and git.
- Understands `import`, `export … from`, `require()`, `import()`, `tsconfig`/`jsconfig` path aliases
  (like `@/components/...`), `index` files, `./file.js` → `file.ts`, and the `<script>` blocks of Vue and Svelte files.
- Compares against the point where your branch split off, so work merged to `main` meanwhile
  doesn't show up as your change.

## Quick start

```bash
cd your-project
npx tecton
```

That's it: no install, no config. Tecton maps your code, compares it with `main` (or `master`) and opens the report in your browser.
The report goes to a temp folder, so nothing is added to your project. It works in a single app, in a monorepo (`apps/*` and `packages/*` become the parts), and without git (as a snapshot).

When you want more:

```bash
npx tecton serve         # the same report, refreshed in your browser every time you save
npx tecton init          # add tecton.config.json with your modules and a first rule, so CI can enforce it
```

In CI, or when output is piped, it writes `./tecton-report.html` and opens nothing (or pass `--out`). Use `--no-open` or `BROWSER=none` to skip the browser anywhere.

## The report

One self-contained HTML file (fonts included, works offline) laid out like a small SaaS app:

- **Overview**: pass/fail status, counters, a breakdown of dependency changes, rule checks, a live map preview and files per module.
- **Architecture**: a C4 container diagram read from your code. Users sit on top, your repo is a dashed system boundary holding its apps, databases (cylinders) and queues (pipes), and outside systems sit on the right. Every connector is labelled (`HTTP · API_URL`, `reads & writes · SQL`, `adds jobs`), queue traffic is dotted, and connectors from one app travel as a bundle. Pan, zoom, hover an app to trace its connections, and export as SVG.
  Prefer another picture? Switch to **Tiers** (bands from people down to outside systems) or **Matrix** (a grid of which app talks to what, and how). What it finds:
  - **Apps**: every `package.json` (Next.js, Nuxt, SvelteKit, Express, Fastify, NestJS, Hono, Koa, …).
  - **Entry points**:
    - pages and API routes: Next.js app/pages router, Nuxt `pages/` and `server/api/`, SvelteKit `+page.svelte` / `+server.ts`
    - HTTP endpoints, with their full path: Express/Koa/Hono routers mounted with `app.use('/api', router)`, even across files; Fastify `register(plugin, { prefix })` and `route({ method, url })`; Hono `basePath`/`route`; NestJS `@Controller` + `@Get` with `setGlobalPrefix`
    - npm-script jobs
    - **cron schedules** in plain words ("every day at 03:00"), from `node-cron`, `cron`, `node-schedule`, BullMQ repeatable jobs, NestJS `@Cron` and `vercel.json`
  - **Data and queues**: SQLite, Postgres, MySQL, Mongo, Redis, Prisma, Drizzle, S3, …, plus **queues** (BullMQ, Bull and Bee-Queue by queue name; SQS, RabbitMQ, Kafka, Pub/Sub, Service Bus, QStash, Inngest, …). Connection strings in `.env.example` name the real engine (`DATABASE_URL=postgres://…` next to Prisma shows "PostgreSQL via Prisma").
  - **Outside services**: hosts in URLs, SDKs such as Stripe, OpenAI and nodemailer, URLs in `.env.example`, and services that are only named by an env var (`FRAUD_CHECK_URL=` becomes "Fraud Check").
  - App-to-app calls are found through env vars like `BACKEND_URL`. New or removed pieces are highlighted, and clicking anything shows every entry point and the exact lines behind it.
- **Dependency map**: pick **Graph** (layered boxes and arrows), **Matrix** (a dependency structure matrix: rows import columns, loops show as mirrored cells) or **Radial** (modules around a circle, imports as curves; tightly knit groups stand out). Your choice is remembered.
  Too much at once? **Simple** (next to **Detailed**, on both diagrams) shows only names and arrows, in the same layout.
  Switch between **Changes / Before / After**. Boxes never move between views, so you can flip back and forth.
  Green = new dependency, red dashed = removed, orange = breaks a rule. Numbers on arrows are how many imports.
  - **Only changes** shows just the dependencies that moved.
  - **Only touched** shows the modules whose files this change edits (marked with an indigo dot) and what they connect to: the PR at a glance.
  - Click a box or arrow for its files and the exact `file:line` imports. Double-click a box to open its files.
  - Also includes a minimap, zoom (scroll or pinch) and SVG export.
- **Module pages**: open any module (from the Modules table, the map, or ⌘K) to see its **files and how they connect**. Its neighbouring modules appear as rounded boxes, and imports that break a rule are orange.
  Click a file for everything it imports and everything that imports it, with line numbers. Toggle **Only changed files** to focus on the diff.
- **Rule checks**: every rule with its status. Expand one to see each break and where it happens.
- **Changes** and **Modules**: tables you can filter, search and sort. Modules can be narrowed to the ones this change touches.
- **⌘K / Ctrl K** (or `/`): a command palette to jump to any module, file, dependency, rule, entry point or action.
  Keys `1`–`6` switch pages, `F` fits the map, `Esc` closes things.
- Light, dark and system themes. **Copy PR summary** puts the Markdown summary on your clipboard.

The Geist fonts are embedded under the SIL Open Font License (`src/report/fonts/OFL-LICENSE.txt`).

## Watch mode

`tecton serve [dir]` starts a local server (default `http://127.0.0.1:4321`, or `--port`) and rebuilds the
report whenever a source file, `package.json`, `tsconfig.json`, `tecton.config.json` or `.env.example` changes, and when you commit or switch branches.
The open page reloads itself and keeps the page you were on. If something can't be read (a broken config, say), the last good report stays up and a small status pill shows the error.

## Config (`tecton.config.json`)

Projects set up with the old name keep working: `archdiff.config.json` is read if there's no `tecton.config.json`.

```jsonc
{
  "root": "src",          // folder to analyse (default: "src" if it exists, else the project folder)
  "depth": 1,             // 1 = src/components, src/lib...; 2 = src/features/cart, src/features/auth...
  "cycles": "warn",       // flag modules that depend on each other in a loop: "warn" | "error" | "off"
  "rules": [
    // forbidden: "from" may not use anything in "to"
    { "name": "UI must not touch the database", "from": "components", "to": ["db", "npm:pg"],
      "message": "Call a service instead." },
    // allow-list: "from" may only use these internal modules
    { "name": "lib stays dependency-free", "from": "lib", "allow": [] },
    // wildcards work, and "severity": "warn" reports without failing CI
    { "name": "features stay independent", "from": "features/*", "to": ["features/*"], "severity": "warn" }
  ],

  // optional
  "modules": { "ui": ["src/components", "src/app/**/_components/**"] }, // group folders by hand (first match wins)
  "exclude": ["src/generated/**"],     // tests, stories and *.config.* files are skipped already
  "aliases": { "~/": "src/" },         // extra import aliases beyond tsconfig "paths"
  "externals": false,                  // true = draw every npm package; otherwise only ones named in rules
  "base": "develop"                    // default branch to compare with
}
```

Module names are folder paths under `root` (`components`, `features/cart`). npm packages are `npm:<name>`.
A module can import itself freely; rules are about arrows between modules.

## Command line

```
tecton [dir] [--base <ref>] [--head <ref>] [--out report.html] [--md summary.md] [--json data.json]
             [--config file] [--no-merge-base] [--strict] [--no-open]
tecton serve [dir] [--port 4321] [--base <ref>] [--no-open]
tecton init [dir]
tecton --version
```

Exit code: `1` if the change adds a rule break with severity `error` (`--strict`: any rule break), `2` for usage errors.
Without git (or without a base branch) it shows a snapshot and fails on any rule break.

## In CI

### GitHub Action

```yaml
# .github/workflows/tecton.yml
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: gaurav2180/tecton@v0.5.0
```

The action compares the pull request with its base branch and does four things:

1. Writes the Markdown summary (with a Mermaid diagram of only the parts that changed) to the job summary.
2. Posts it as a PR comment and updates that comment on every push, so the PR doesn't collect a new comment each time.
3. Uploads the HTML report as an artifact and links it from the comment.
4. Fails the check if the change adds a rule break.

Inputs: `working-directory`, `base`, `config`, `strict`, `comment`, `fail-on-break`, `upload-report`, `report-name`, `github-token`.
Outputs: `new-breaks`, `failing`, `report-path`, `summary-path`. See [`action.yml`](action.yml) and [`examples/github-workflow.yml`](examples/github-workflow.yml).

### Any other CI

```bash
npx tecton --base "origin/$BASE_BRANCH" --head HEAD --out tecton-report.html --md tecton.md
```

## Development

The CLI is plain JavaScript on Node built-ins. The report's browser code lives in `src/report/client/` as ES modules, is typed with JSDoc against `src/types.d.ts`, and is bundled with esbuild into `src/report/dist/client.js`. That bundle is committed, so the CLI and the GitHub Action run straight from a checkout.

```bash
npm install            # dev tools only: esbuild, TypeScript, Playwright
npm run dev            # rebuild the client bundle on change (use with: node bin/tecton.js serve <project>)
npm run build          # build the bundle once; commit src/report/dist/client.js with your change
npm run typecheck      # tsc over the CLI and the browser code
npm test               # unit tests (no dependencies needed)
npm run test:ui        # the report in a real browser: every page, light and dark, desktop and phone
npm run check          # everything CI runs
```

The UI tests compare screenshots against baselines in `test/ui/__screenshots__/<platform>/`. After a deliberate visual change, run `npm run test:ui -- --update-snapshots` and review the new images before committing them.

## Brand

The logo files are in [`brand/`](brand/): the mark, lockups for light and dark, app icons, a favicon and a social banner. See `CLAUDE.md` for how to use them.

## Limits (v0.4)

- JS/TS, plus the `<script>` blocks of Vue and Svelte files. Imports inside templates aren't read.
- Imports and routes are found with a careful text scan, not a full parser, so exotic code can occasionally be missed.
  Router prefixes are followed through imports, `require()` and local variables, but not through routers built dynamically (for example in a loop).
- The architecture view is heuristic. Queue names and cron expressions must be written as literals (or a constant in the same file). URLs built at run time from config show up only if they are named in `.env.example`.
- Module diagrams are drawn for modules with up to 250 files. Bigger modules get the file table only.
