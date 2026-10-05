# WEIGHT. — Personal Weight Analytics

A public-read, owner-write bodyweight analytics app built with React, Cloudflare Workers, and Cloudflare D1.

The UI uses the supplied **deep navy / teal / electric aqua / coral** palette. Dark mode is the default; light mode keeps the same accent colors.

## Included historical data

This project already contains the supplied Google Sheet history:

- **95 historical weigh-ins**
- **2026-04-23 through 2026-10-05**
- Only **Date + Weight** were imported
- Historical **Phase = NULL**
- Historical **Notes = NULL**
- The Google Sheet's saved weekly-average values were deliberately ignored
- The app calculates the rolling 7-day average itself from the raw weigh-ins

The cleaned source is included as `historical-entries.csv`, and the same rows are seeded automatically by `schema.sql` using `INSERT OR IGNORE`.

## Features

- Public dashboard anyone can view
- Owner login required to add, edit, delete, import, export, or change phase
- Persistent current phase: **Cut / Maintain / Gain**
- Current phase stays selected until you explicitly change it
- New entries automatically inherit the current phase
- Weight + optional Notes entry at the top
- One entry per calendar day
- If today already has an entry, saving another weight prompts you before replacing it
- Edit/delete historical entries
- Historical/imported rows may have no phase or notes
- Missed days stay `null`; the app never invents a weight
- Rolling 7-calendar-day average using only real measurements in each window
- Graph ranges: **7D / 30D / 3M / 6M / 1Y / ALL**
- Selected-range loss/gain metric
- Toggle Daily Weight and 7-Day Average lines
- CSV export of raw entry data
- CSV import; missing Phase/Notes stay `NULL`
- Shared cloud data across phone, PC, etc.
- Responsive mobile/desktop design

## Stack

- React + TypeScript + Vite
- Recharts
- Cloudflare Workers
- Cloudflare D1
- HMAC-signed HttpOnly owner session cookie

## Database

### `weight_entries`

- `date` — ISO date, unique
- `weight` — pounds
- `phase` — `Cut`, `Maintain`, `Gain`, or `NULL`
- `notes` — text or `NULL`
- `created_at`, `updated_at`

There is no stored weekly-average column. It is derived from the raw rows at runtime.

### `settings`

- persistent current phase
- date the current phase started

The starter settings use `Cut`, beginning `2026-10-05`. Change this from the dashboard whenever your phase changes.

## Run locally

### 1. Install dependencies

```bash
npm install
```

### 2. Create D1

```bash
npx wrangler login
npx wrangler d1 create weight-tracker-db
```

Copy the returned database ID into `wrangler.jsonc` in place of:

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

### 3. Initialize the local DB + historical entries

```bash
npx wrangler d1 execute weight-tracker-db --local --file=./schema.sql
```

Because the seed uses `INSERT OR IGNORE`, running `schema.sql` again does not duplicate dates.

### 4. Create local secrets

Copy `.dev.vars.example` to `.dev.vars`:

```env
ADMIN_PASSWORD=choose-a-long-password
SESSION_SECRET=choose-a-long-random-secret
```

Do not commit `.dev.vars`.

### 5. Start

```bash
npm run dev
```

## Deploy to Cloudflare

Initialize the production DB, including the supplied historical entries:

```bash
npx wrangler d1 execute weight-tracker-db --remote --file=./schema.sql
```

Set the two production secrets:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Then deploy:

```bash
npm run deploy
```

## Import behavior

CSV requires at least Date and Weight:

```csv
Date,Weight (lb),Phase,Notes
2026-10-01,160.8,,
2026-10-02,159.9,Cut,"Basketball"
```

If Phase or Notes is absent/blank, it remains `NULL`. The app does **not** guess a phase from the current setting for imported history.

The importer ignores unrelated columns such as `Day` or `Weekly Averages`, so an old Google Sheet export can still be used directly.

## Missing days and rolling averages

A missed day has no database row. On the chart, the daily-weight series receives a `null` for that calendar date. The rolling 7-day average uses only actual weigh-ins from that trailing 7-calendar-day window; a missing day is never treated as zero and is never interpolated into the database.

## Public/private behavior

Public visitors can view the dashboard, chart, history, phases, and notes. Only the owner can modify data. Because notes are public by design, do not write anything there that you do not want visitors to see.
