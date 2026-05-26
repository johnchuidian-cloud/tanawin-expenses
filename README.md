# Tanawin Expenses — Prototype v0.1

Mobile-first expense tracker for Tanawin Bed and Breakfast.

## What's here so far

- ✅ Project foundation (Next.js 14 + TypeScript + Tailwind)
- ✅ Data model (entries, receipts, PCF ledger, users, flags, notes)
- ✅ Validation rules (arithmetic, duplicate, outlier, missing category)
- ✅ Mock data layer (swappable with Supabase later)
- ✅ Login screen (PIN-based, pick from user list)
- ✅ Staff home screen (PCF balance, attention bar, top categories, recent entries, month-on-month)
- ⏳ Quick-entry flow (next)
- ⏳ Receipt scan + reconciliation (next)
- ⏳ Admin dashboard (next)
- ⏳ Excel export (next)

## How to run

```bash
npm install
npm run dev
```

Then open http://localhost:3000 on a desktop browser, OR access via
http://YOUR-COMPUTER-IP:3000 from a phone on the same WiFi.

## Login credentials (prototype only)

- Lexi (admin): 1234
- Maria (staff): 0001
- Joel (staff): 0002
- Rolly (staff): 0003

## Important caveat

Everything is in-memory. Refresh = reset. This is intentional for v0 — we don't
want fake data being mistaken for real data. Once Supabase is connected, data
will persist.

## Folder map

- `app/` — pages (login, staff home, admin home, etc.)
- `components/` — shared UI pieces (bottom nav, etc.)
- `lib/` — business logic (types, validation, store, format, auth)
- `mocks/` — seed data based on the real Q1+April patterns

