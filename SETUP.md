# Reach Backend — Setup Guide

## What's in this package

```
reach-backend/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/page.tsx       Clerk sign-in page
│   │   └── sign-up/page.tsx       Clerk sign-up page
│   ├── (app)/
│   │   ├── home/page.tsx          Main app page
│   │   └── onboarding/page.tsx    Permissions setup after signup
│   └── api/
│       ├── groups/                Groups CRUD
│       ├── plans/                 Plans + voting
│       ├── payments/              Stripe PaymentIntents
│       ├── user/data/             GDPR data rights
│       └── webhooks/
│           ├── stripe/            Stripe event handler
│           └── clerk/             Clerk user sync
├── components/
│   └── ReachApp.tsx               Paste reach-app.jsx here
├── lib/
│   ├── supabase.ts                Database clients
│   ├── stripe.ts                  Stripe client
│   ├── encryption.ts              AES-256 for passport data
│   └── email.ts                   Transactional emails
├── types/database.ts              TypeScript types
├── middleware.ts                  Route protection
├── next.config.js                 Security headers
├── supabase/schema.sql            Database schema + RLS
├── .env.example                   Secret keys template
└── .gitignore                     Keeps secrets out of GitHub
```

---

## Step 1 — Copy this folder to your Desktop

Unzip reach-backend.zip and move the folder to your Desktop.

---

## Step 2 — Open in VS Code

Open Terminal (Command + Space → Terminal) and run:
```
cd ~/Desktop/reach-backend
code .
```

---

## Step 3 — Create your secrets file

In the VS Code terminal run:
```
cp .env.example .env.local
```

Open .env.local in VS Code and fill in keys from each service below.

---

## Step 4 — Supabase (database)

1. Go to supabase.com → create a project
2. Go to Settings → API and copy:
   - Project URL → NEXT_PUBLIC_SUPABASE_URL
   - anon public key → NEXT_PUBLIC_SUPABASE_ANON_KEY
   - service_role key → SUPABASE_SERVICE_ROLE_KEY
3. Go to SQL Editor → New Query
4. Open supabase/schema.sql, copy everything, paste into SQL editor → Run

---

## Step 5 — Clerk (authentication)

1. Go to clerk.com → create an app called Reach
2. Go to API Keys and copy:
   - Publishable key → NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
   - Secret key → CLERK_SECRET_KEY
3. Go to User & Authentication → Social Connections → enable Google
4. Go to Webhooks → Add Endpoint
   - URL: https://yourapp.vercel.app/api/webhooks/clerk (update after deploy)
   - Events: user.created, user.updated, user.deleted
   - Copy signing secret → CLERK_WEBHOOK_SECRET

---

## Step 6 — Stripe (payments)

1. Go to stripe.com → create account
2. Keep TEST MODE on
3. Go to Developers → API Keys and copy:
   - Publishable key → NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
   - Secret key → STRIPE_SECRET_KEY
4. Go to Developers → Webhooks → Add Endpoint
   - URL: https://yourapp.vercel.app/api/webhooks/stripe
   - Events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
   - Copy signing secret → STRIPE_WEBHOOK_SECRET

---

## Step 7 — Encryption key

In VS Code terminal run:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output → paste next to ENCRYPTION_KEY in .env.local

---

## Step 8 — Add your app code

1. Open components/ReachApp.tsx
2. Copy the entire contents of reach-app.jsx
3. Paste it into ReachApp.tsx, replacing the placeholder export default function

---

## Step 9 — Install and run

```
npm install
npm run dev
```

Open http://localhost:3000 in your browser.
Open http://YOUR_NETWORK_IP:3000 on your iPhone (same WiFi).

To find your network IP, open a new terminal tab and run:
```
ipconfig getifaddr en0
```

---

## Step 10 — Deploy to Vercel

1. Go to github.com → create a private repo called reach-app
2. In VS Code terminal run:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOURNAME/reach-app.git
   git push -u origin main
   ```
3. Go to vercel.com → Add New Project → import your repo
4. Before clicking Deploy → click Environment Variables
5. Copy every line from .env.local into Vercel
6. Click Deploy

---

## Test cards (Stripe test mode — no real money)

| Card number          | What it does              |
|----------------------|---------------------------|
| 4242 4242 4242 4242  | Always succeeds           |
| 4000 0025 0000 3155  | Triggers 3D Secure / MFA  |
| 4000 0000 0000 9995  | Always declined           |

Use any future expiry date and any 3-digit CVC.

---

## Security checklist before going live

- [ ] .env.local is in .gitignore (run: git status — it should not appear)
- [ ] Supabase RLS enabled on all tables
- [ ] Stripe in TEST mode during development
- [ ] Only switch to LIVE Stripe keys in Vercel environment variables
- [ ] Clerk MFA set to required in dashboard before launch
- [ ] Privacy Policy and Terms pages live and linked in the app
