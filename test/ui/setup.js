// Builds the fixtures the UI specs open:
//   demo-shop   examples/make-demo.sh: a Next.js shop + Express API on a feature branch that breaks two rules
//   big         four apps, many stores, queues and outside services (stress test for the architecture diagram)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(os.tmpdir(), 'tecton-ui-fixtures');

/** Git for Windows' bash, not WSL's (which is first on PATH on many Windows machines). */
function bash() {
  if (process.platform !== 'win32') return 'bash';
  const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(); // …/Git/mingw64/libexec/git-core
  const candidate = path.resolve(exec, '..', '..', '..', 'bin', 'bash.exe');
  return fs.existsSync(candidate) ? candidate : 'bash';
}

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

function bigRepo(dir) {
  const json = (o) => JSON.stringify(o);
  write(dir, {
    'web/package.json': json({ dependencies: { next: '15', react: '19', '@sentry/nextjs': '8', stripe: '1', 'posthog-js': '1' } }),
    'web/app/page.tsx': "import * as Sentry from '@sentry/nextjs';\nimport posthog from 'posthog-js';\nfetch(process.env.API_URL + '/x');\nfetch('https://cdn.contentful.com/spaces');\n",
    'web/app/pay/route.ts': "import Stripe from 'stripe';\nexport async function POST() {}\n",
    'admin/package.json': json({ dependencies: { next: '15', react: '19' } }),
    'admin/app/page.tsx': "fetch(process.env.API_URL + '/admin');\nfetch(process.env.BILLING_API_URL);\n",
    'admin/.env.example': 'BILLING_API_URL=\nAPI_URL=http://localhost:4000\n',
    'api/package.json': json({ dependencies: { express: '4', pg: '8', ioredis: '5', bullmq: '5', openai: '4', '@aws-sdk/client-s3': '3', resend: '1', twilio: '1' } }),
    'api/index.js': "import express from 'express';\nimport pg from 'pg';\nimport Redis from 'ioredis';\nimport { Queue } from 'bullmq';\nimport OpenAI from 'openai';\nimport { S3Client } from '@aws-sdk/client-s3';\nimport { Resend } from 'resend';\nimport twilio from 'twilio';\nconst app = express();\nnew Queue('emails');\nnew Queue('thumbnails');\napp.get('/x', f);\napp.post('/admin', f);\nfetch('https://api.github.com/repos');\nfetch('https://hooks.slack.com/x');\n",
    'worker/package.json': json({ dependencies: { bullmq: '5', pg: '8', 'node-cron': '3', '@elastic/elasticsearch': '8' } }),
    'worker/index.js': "import { Worker } from 'bullmq';\nimport pg from 'pg';\nimport cron from 'node-cron';\nimport { Client } from '@elastic/elasticsearch';\nnew Worker('emails', f);\nnew Worker('thumbnails', f);\ncron.schedule('0 * * * *', f);\nfetch('https://api.mapbox.com/geocoding');\nfetch(process.env.FRAUD_URL);\n",
    'worker/.env.example': 'FRAUD_URL=\nGEO_API_URL=https://api.mapbox.com\n',
  });
}

function tecton(dir, out) {
  try {
    execFileSync(process.execPath, [path.join(repo, 'bin', 'tecton.js'), dir, '--out', out, '--json', out.replace(/\.html$/, '.json')], { stdio: 'pipe' });
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = rule breaks, which the demo has on purpose
  }
}

export default function setup() {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  fs.mkdirSync(FIXTURES, { recursive: true });
  const demo = path.join(FIXTURES, 'demo-shop');
  execFileSync(bash(), [path.join(repo, 'examples', 'make-demo.sh'), demo], { stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } });
  tecton(demo, path.join(FIXTURES, 'demo.html'));
  const big = path.join(FIXTURES, 'big');
  bigRepo(big);
  tecton(big, path.join(FIXTURES, 'big.html'));
}
