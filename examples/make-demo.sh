#!/usr/bin/env bash
# Recreates the "demo-shop" test repo used to check tecton end to end.
#   bash examples/make-demo.sh /tmp/demo-shop
#   cd /tmp/demo-shop && node <tecton>/bin/tecton.js --open
# main = a small shop app; branch feature/payments (+ one uncommitted edit) breaks two rules,
# adds a module (payments), removes one (utils) and adds an outside service (Stripe).
set -euo pipefail
D="${1:-/tmp/demo-shop}"
rm -rf "$D"; mkdir -p "$D"; cd "$D"
git init -q -b main; git config user.email demo@example.com; git config user.name demo
mkdir -p src/app/cart src/components src/services src/db src/lib src/utils
cat > tsconfig.json <<'EOF'
{
  // Next.js style alias
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] }, },
}
EOF
cat > src/app/page.tsx <<'EOF'
import { ProductList } from '@/components/ProductList';
import { getProducts } from '@/services/products';
import { db } from '@/db/client'; // quick hack someone added long ago
export default async function Home() { const p = await getProducts(); db; return <ProductList items={p} />; }
EOF
cat > src/app/cart/page.tsx <<'EOF'
import Cart from '@/components/Cart';
export default function CartPage() { return <Cart />; }
EOF
cat > src/components/ProductList.tsx <<'EOF'
import React from 'react';
import { price } from '@/lib/format';
export function ProductList({ items }: any) { return <ul>{items.map((i: any) => <li key={i.id}>{price(i.cents)}</li>)}</ul>; }
EOF
cat > src/components/Cart.tsx <<'EOF'
import React, { useEffect } from 'react';
import { loadCart } from '../services/cart';
import { price } from '@/lib/format';
/* import { db } from '@/db/client'  <- commented out, must be ignored */
export default function Cart() { useEffect(() => { loadCart(); }, []); return <div>{price(100)}</div>; }
EOF
cat > src/services/products.ts <<'EOF'
import { db } from '@/db/client';
export async function getProducts() { return db.query('select * from products'); }
EOF
cat > src/services/cart.ts <<'EOF'
import { db } from '@/db/client';
import { toMoney } from '../utils/legacyMoney';
export async function loadCart() { const r = await db.query(`select * from cart where x = ${"'a'"}`); return toMoney(r); }
EOF
cat > src/db/client.ts <<'EOF'
import { Pool } from 'pg';
export const db = new Pool();
EOF
cat > src/lib/format.ts <<'EOF'
export const price = (c: number) => `₹${(c / 100).toFixed(2)}`;
EOF
cat > src/utils/legacyMoney.ts <<'EOF'
export const toMoney = (x: any) => x;
EOF
cat > src/services/products.test.ts <<'EOF'
import { getProducts } from './products';
EOF
cat > tecton.config.json <<'EOF'
{
  "root": "src",
  "rules": [
    { "name": "UI must not touch the database", "from": "components", "to": ["db", "npm:pg"],
      "message": "Components should call a service instead of querying the database." },
    { "name": "Pages go through services", "from": "app", "to": ["db"] },
    { "name": "lib stays dependency-free", "from": "lib", "allow": [] }
  ],
  "cycles": "warn"
}
EOF
cat > package.json <<'EOF'
{ "name": "demo-shop", "private": true, "dependencies": { "next": "15.0.0", "react": "19.0.0", "pg": "8.13.0", "stripe": "17.0.0" } }
EOF
# a small API server next to the shop: routers mounted under prefixes, a job queue, env-configured services
mkdir -p server/routes
cat > server/package.json <<'EOF'
{ "name": "api", "private": true, "type": "module",
  "dependencies": { "express": "4.21.0", "bullmq": "5.12.0", "node-cron": "3.0.3" },
  "scripts": { "start": "node index.js", "reindex": "node scripts/reindex.js" } }
EOF
cat > server/index.js <<'EOF'
import express from 'express';
import api from './routes/index.js';
const app = express();
app.use(express.json());
app.use('/api', api);
app.get('/health', (req, res) => res.send('ok'));
app.listen(4000);
EOF
cat > server/routes/index.js <<'EOF'
import { Router } from 'express';
import orders from './orders.js';
const r = Router();
r.use('/orders', orders);
export default r;
EOF
cat > server/routes/orders.js <<'EOF'
import { Router } from 'express';
import { emails } from '../queues.js';
const router = Router();
router.get('/', async (req, res) => res.json(await fetch(`${process.env.SHIPPING_API_URL}/rates`)));
router.post('/', async (req, res) => { await emails.add('receipt', req.body); res.status(201).end(); });
router.get('/:id', (req, res) => res.json({ id: req.params.id }));
export default router;
EOF
cat > server/queues.js <<'EOF'
import { Queue } from 'bullmq';
export const emails = new Queue('emails', { connection: { url: process.env.REDIS_URL } });
EOF
cat > server/.env.example <<'EOF'
DATABASE_URL=postgres://shop:shop@localhost:5432/shop
REDIS_URL=redis://localhost:6379
SHIPPING_API_URL=https://api.shipfast.io/v2
EOF
cat > src/services/orders.ts <<'EOF'
export const listOrders = () => fetch(`${process.env.API_URL}/api/orders`).then((r) => r.json());
EOF
git add -A && git commit -qm "initial shop"
git checkout -qb feature/payments
cat > src/components/Cart.tsx <<'EOF'
import React, { useEffect } from 'react';
import { loadCart } from '../services/cart';
import { price } from '@/lib/format';
import { db } from '@/db/client';
export default function Cart() { useEffect(() => { loadCart(); db.query('select 1'); }, []); return <div>{price(100)}</div>; }
EOF
mkdir -p src/payments
cat > src/payments/stripe.ts <<'EOF'
import Stripe from 'stripe';
import { db } from '@/db/client';
export const charge = async (n: number) => { await db.query('insert'); return new Stripe('k').charges.create({ amount: n }); };
EOF
cat > src/services/cart.ts <<'EOF'
import { db } from '@/db/client';
import { charge } from '@/payments/stripe';
export async function loadCart() { return db.query('select * from cart'); }
export async function checkout(n: number) { return charge(n); }
EOF
cat > server/routes/refunds.js <<'EOF'
import { Router } from 'express';
const router = Router();
router.post('/', async (req, res) => res.json(await fetch(process.env.FRAUD_CHECK_URL, { method: 'POST' })));
export default router;
EOF
cat > server/routes/index.js <<'EOF'
import { Router } from 'express';
import orders from './orders.js';
import refunds from './refunds.js';
const r = Router();
r.use('/orders', orders);
r.use('/refunds', refunds);
export default r;
EOF
cat > server/worker.js <<'EOF'
import { Worker } from 'bullmq';
import cron from 'node-cron';
import { emails } from './queues.js';
new Worker('emails', async (job) => { /* send the email */ });
cron.schedule('0 3 * * *', () => emails.add('daily-digest', {}));
EOF
cat >> server/.env.example <<'EOF'
FRAUD_CHECK_URL=
EOF
git rm -q src/utils/legacyMoney.ts
git add -A && git commit -qm "payments"
cat > src/lib/format.ts <<'EOF'
import { getProducts } from '@/services/products';
export const price = (c: number) => `₹${(c / 100).toFixed(2)}`;
export const cheapest = async () => (await getProducts())[0];
EOF
echo "demo repo ready at $D"
