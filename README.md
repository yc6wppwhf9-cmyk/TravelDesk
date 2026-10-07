# TravelDesk

**Live:** https://travel-desk-seven.vercel.app

Company travel portal for **High Spirit Commercial Ventures Pvt Ltd**, built around the
*Travel & Expense Policy V5 (effective 1 Aug 2026)*.

- **Employees** plan a trip itinerary (train, flight, bus, cab, hotel) and see a live policy check
  against their band entitlement before submitting.
- **Reporting managers** approve or reject requests. Urgent and short-notice requests are flagged
  and listed first.
- **Admins (Travel Desk)** see every booking in one place, filter and export to CSV, mark trips as
  booked with the PNR or booking reference, manage people (band, role, manager) and edit the
  policy rules.

## How it works

| Layer | What |
| --- | --- |
| Front end | Static single-page app in `public/` (vanilla JS + `@supabase/supabase-js` from CDN). `server.js` is a tiny static server. Any static host works. |
| Auth | Supabase Auth (email + password). The **first account to sign up becomes admin**; everyone after that starts as an employee in band L0 until an admin assigns them. |
| Data & rules | Supabase Postgres (`supabase/migrations`). Tables are read-only to the browser and protected by Row Level Security. Every write goes through a `SECURITY DEFINER` function that re-validates the policy server-side, so the rules can't be bypassed from the browser. |

### Policy rules enforced (from the V5 PDF)

| Policy section | Rule in the portal |
| --- | --- |
| 4 | Bands L0–L10 with designations |
| 5.1 | Domestic requests ≥ 30 days ahead; shorter notice means **urgent**, and needs justification plus manager approval |
| 5.1 | All travel requires Reporting Manager approval (admin can switch this to "only exceptions") |
| 5.1.1 | Air only when the rail/road journey is over 12 hours (the traveller enters the surface journey time) |
| 5.1.2 | Rail class ceiling per band; road mode per band; own vehicle only for L6 and above |
| 5.3 | Foreign travel: 45 days notice, always needs approval, hotel cap agreed with manager |
| 6.1 / 6.2 | Hotel cap per night by band × city category A/B/C (city list seeded, editable); no hotel for single-day trips |
| 6.2 | Laundry ₹75/day from day 3 (shown as an entitlement) |
| 7.1 | Meal cap per day by band (shown as an entitlement) |

### Finding options (flights, trains, hotels)

- Each itinerary item has **search links** pre-filled with the route and dates: Google Flights,
  MakeMyTrip and Cleartrip for flights (airport codes for about 70 Indian cities are built in), IRCTC
  and Google for trains, redBus for buses, Booking.com and Google Hotels for stays. Admin and HR see
  the same links on an approved trip under **Find & book**. The link formats couldn't be checked from
  the build server (these sites block automated requests), so click-test each one once from a normal
  browser.
- **Preferred hotels** (admin → *Preferred Hotels*): the travel desk lists hotels with corporate
  rates per city. When an employee adds a hotel stay, the hotels in that city appear, marked
  *Within your cap* or *Above your cap* for their band. *Use this hotel* fills in the name and
  the total cost for the nights booked.
- Live fares and in-app booking need a travel-supplier API (TBO, Tripjack, a corporate booking
  platform, etc.). That is the next step once credentials are available.

An itinerary that breaks a rule can still be submitted with a justification. The manager sees each
exception spelled out before deciding.

### Trip lifecycle

```
submit ──► pending_approval ──► approved ──► booked (travel desk adds PNR)
              │                    │
              └──► rejected        └──► cancelled (traveller or admin)
```

Who approves: the traveller's active reporting manager. If no manager is set, any admin approves.
Nobody can approve their own trip. Every step is recorded in the trip timeline.

## Running locally

```bash
npm install
npm start            # http://localhost:3000
```

`public/config.js` holds the Supabase URL and **publishable** key. These are safe to ship to the
browser, because RLS and the database functions do the access control.

## First-time setup

1. **Turn off "Confirm email"** under *Authentication → Sign In / Providers → Email* if you don't
   want confirmation emails. Otherwise users must click the link in their email before signing in.
   If you keep it on, set *Authentication → URL Configuration → Site URL* to where the portal is
   hosted.
2. Open the portal and **create the first account**. It becomes the admin.
3. In **Travel Policy**, set *Allowed sign-up email domain* (e.g. `highspirit.in`) so only company
   emails can register.
4. Ask employees to sign up, then in **People** set each person's band, department, role and
   reporting manager.

## Database migrations

Applied to the Supabase project `TravelDesk` (`jnlrvehlenrtbdqmgbbr`), in order:

1. `20261007000000_traveldesk_schema.sql`: tables, RLS, trip workflow functions
2. `20261007000100_policy_v5_tables.sql`: V5 settings, band entitlements L0–L10, city categories
3. `20261007000200_policy_v5_functions.sql`: V5 policy engine and admin functions
4. `20261007000300_friendly_labels.sql`: readable class names in policy messages
5. `20261007000400_preferred_hotels.sql`: preferred hotels per city with corporate rates

`supabase/manual/cleanup_legacy_policy.sql` is an **optional** one-off script. It removes the
placeholder grades G1–G3 and their unused columns from the first migration. The app already
ignores them. Run it in the Supabase SQL editor if you want a tidy `policies` table.

## Ideas for next steps

- Email or Slack notifications to managers when an urgent trip is submitted (Supabase Edge Function + webhook)
- Multi-stage approval (Manager → Management/HR/Finance), as section 5.1 of the policy describes
- Post-trip expense claims with bill uploads (Supabase Storage), checked against the meal, hotel and laundry caps
