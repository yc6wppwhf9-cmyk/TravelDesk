-- Optional one-off cleanup. Run it in the Supabase SQL editor (Dashboard → SQL Editor).
--
-- The first migration shipped placeholder grades G1–G3 with a different set of columns.
-- Policy V5 added bands L0–L10 alongside them; the app ignores the old rows (rank is null).
-- This removes the leftovers so the policies table only holds the V5 bands.

begin;

-- Move anyone still on a placeholder grade to the lowest band (an admin can then reassign).
update public.profiles set grade = 'L0'
 where grade in (select grade from public.policies where rank is null);

delete from public.policies where rank is null;

alter table public.policies
  drop column if exists flight_class,
  drop column if exists train_class,
  drop column if exists hotel_max_per_night,
  drop column if exists daily_allowance,
  drop column if exists max_trip_budget,
  drop column if exists advance_days;

alter table public.policies alter column rank set not null;

commit;
