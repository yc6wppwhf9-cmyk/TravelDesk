-- Align TravelDesk with the company Travel & Expense Policy (V5, effective 1 Aug 2026).
-- Additive only: new columns, the L0–L10 band rows and the city categories.
-- The placeholder G1–G3 rows and their old columns are left in place (they have no
-- rank, so the app ignores them); supabase/manual/cleanup_legacy_policy.sql removes them.

-- ---------------------------------------------------------------- settings (5.1, 5.1.1, 5.3, 6.2)
alter table public.settings
  add column if not exists domestic_advance_days      integer not null default 30 check (domestic_advance_days >= 0),
  add column if not exists international_advance_days integer not null default 45 check (international_advance_days >= 0),
  add column if not exists air_min_surface_hours      numeric(5,1) not null default 12 check (air_min_surface_hours >= 0),
  add column if not exists require_approval_all       boolean not null default true,
  add column if not exists laundry_per_day            numeric(10,2) not null default 75 check (laundry_per_day >= 0),
  add column if not exists laundry_from_day           integer not null default 3 check (laundry_from_day >= 1);

-- ---------------------------------------------------------------- band entitlements (4, 5.1.2, 6.2, 7.1)
alter table public.policies
  add column if not exists rank                integer unique,
  add column if not exists rail_max_class      text not null default 'sleeper'
    check (rail_max_class in ('second_sitting', 'sleeper', 'chair_car', 'ac3', 'ac2', 'ac1')),
  add column if not exists road_max_mode       text not null default 'public_transport'
    check (road_max_mode in ('public_transport', 'economy_cab', 'ac_cab')),
  add column if not exists own_vehicle_allowed boolean not null default false,
  add column if not exists hotel_cap_a         numeric(10,2) not null default 0 check (hotel_cap_a >= 0),
  add column if not exists hotel_cap_b         numeric(10,2) not null default 0 check (hotel_cap_b >= 0),
  add column if not exists hotel_cap_c         numeric(10,2) not null default 0 check (hotel_cap_c >= 0),
  add column if not exists meal_cap_per_day    numeric(10,2) not null default 0 check (meal_cap_per_day >= 0),
  add column if not exists notes               text not null default '';

insert into public.policies
  (grade, rank, label, rail_max_class, road_max_mode, own_vehicle_allowed,
   hotel_cap_a, hotel_cap_b, hotel_cap_c, meal_cap_per_day, notes)
values
  ('L0',  0,  'Office Assistant / Driver',                        'sleeper', 'public_transport', false, 1500, 1000, 800,  500,
   'Sleeper / Second Class. Public transport only (bus/train preferred); Ola/Uber only if required. Metro hotel shared or up to 1500.'),
  ('L1',  1,  'Trainee / Promoters',                              'sleeper', 'public_transport', false, 1500, 1000, 800,  500,
   'Sleeper / Second Class. Public transport only (bus/train preferred); Ola/Uber only if required. Metro hotel shared or up to 1500.'),
  ('L2',  2,  'Executive / KAE',                                  'sleeper', 'economy_cab',      false, 2000, 1500, 1000, 500,
   'Sleeper / Second Class. Public transport / Ola, Uber, Rapido (economy / shared preferred).'),
  ('L3',  3,  'Senior Executive / Senior KAE',                    'sleeper', 'economy_cab',      false, 2000, 1500, 1000, 500,
   'Sleeper / Second Class. Public transport / Ola, Uber, Rapido (economy / shared preferred).'),
  ('L4',  4,  'Assistant Manager / Assistant KAM',                'ac3',     'ac_cab',           false, 2500, 2000, 1500, 600,
   '3AC / Chair Car. AC or non-AC cabs, public transport — economical choice mandatory.'),
  ('L5',  5,  'Manager / KAM / Lead',                             'ac3',     'ac_cab',           false, 2500, 2000, 1500, 600,
   '3AC / Chair Car. AC or non-AC cabs, public transport — economical choice mandatory.'),
  ('L6',  6,  'Senior Manager / Sr. KAM / RSM / Branch Manager',  'ac3',     'ac_cab',           true,  3000, 2500, 2000, 800,
   '3AC / Chair Car (2AC preferred for long travel — raise with justification). AC cabs or own vehicle.'),
  ('L7',  7,  'General Manager / Zonal Sales Manager',            'ac3',     'ac_cab',           true,  3000, 2500, 2000, 800,
   '3AC / Chair Car (2AC preferred for long travel — raise with justification). AC cabs or own vehicle.'),
  ('L8',  8,  'Assistant Vice President',                         'ac2',     'ac_cab',           true,  3500, 3000, 2500, 1000,
   '2AC / 3AC flexible based on availability. AC cabs or own vehicle.'),
  ('L9',  9,  'Vice President',                                   'ac2',     'ac_cab',           true,  3500, 3000, 2500, 1000,
   '2AC / 3AC flexible based on availability. AC cabs or own vehicle.'),
  ('L10', 10, 'MD / SVP / CFO',                                   'ac1',     'ac_cab',           true,  5000, 4500, 4000, 1500,
   'First Class / 2AC flexible. AC cabs or own vehicle. Meals on actuals, indicative 1500/day.')
on conflict (grade) do nothing;

alter table public.profiles alter column grade set default 'L0';

-- ---------------------------------------------------------------- city categories (6.1)
create table if not exists public.cities (
  name     text primary key check (name = lower(btrim(name)) and name <> ''),
  category text not null check (category in ('A', 'B'))   -- any city not listed is category C
);

insert into public.cities (name, category) values
  -- Category A
  ('mumbai','A'), ('bombay','A'), ('delhi','A'), ('new delhi','A'), ('delhi ncr','A'), ('ncr','A'),
  ('gurgaon','A'), ('gurugram','A'), ('noida','A'), ('greater noida','A'), ('ghaziabad','A'),
  ('bangalore','A'), ('bengaluru','A'), ('chennai','A'), ('madras','A'),
  ('kolkata','A'), ('calcutta','A'), ('hyderabad','A'), ('secunderabad','A'),
  -- Category B: named cities
  ('jammu','B'), ('varanasi','B'), ('agra','B'), ('kanpur','B'), ('meerut','B'), ('faridabad','B'),
  ('jalandhar','B'), ('chandigarh','B'), ('amritsar','B'), ('cuttack','B'), ('indore','B'), ('bhopal','B'),
  ('gwalior','B'), ('pune','B'), ('ahmedabad','B'), ('baroda','B'), ('vadodara','B'), ('surat','B'),
  ('nagpur','B'), ('nasik','B'), ('nashik','B'), ('cochin','B'), ('kochi','B'), ('vijayawada','B'),
  -- Category B: state / UT capitals not already in A
  ('lucknow','B'), ('jaipur','B'), ('patna','B'), ('gandhinagar','B'), ('thiruvananthapuram','B'),
  ('trivandrum','B'), ('bhubaneswar','B'), ('raipur','B'), ('ranchi','B'), ('dehradun','B'),
  ('shimla','B'), ('srinagar','B'), ('panaji','B'), ('panjim','B'), ('dispur','B'), ('guwahati','B'),
  ('shillong','B'), ('imphal','B'), ('aizawl','B'), ('kohima','B'), ('agartala','B'), ('itanagar','B'),
  ('gangtok','B'), ('amaravati','B'), ('puducherry','B'), ('pondicherry','B'), ('leh','B'),
  ('port blair','B'), ('daman','B'), ('kavaratti','B')
on conflict (name) do nothing;

alter table public.cities enable row level security;
create policy "signed-in users read cities" on public.cities for select to authenticated using (true);
revoke insert, update, delete, truncate on public.cities from anon, authenticated;
revoke all on public.cities from anon;

-- ---------------------------------------------------------------- trip / segment columns
alter table public.trips add column if not exists is_international boolean not null default false;
alter table public.trip_segments
  add column if not exists duration_hours numeric(5,1) check (duration_hours is null or duration_hours >= 0),
  add column if not exists city_category  text check (city_category is null or city_category in ('A', 'B', 'C'));

-- Same columns as before, with is_international appended (create or replace can only add at the end).
create or replace view public.trips_view with (security_invoker = true) as
select t.id, t.user_id, t.title, t.purpose, t.destination, t.start_date, t.end_date, t.is_urgent,
       t.urgency_reason, t.justification, t.total_estimate, t.violations, t.approval_reasons,
       t.requires_approval, t.status, t.approver_id, t.approval_comment, t.decided_at, t.booking_ref,
       t.admin_note, t.created_at, t.updated_at,
       u.full_name  as traveller_name,
       u.email      as traveller_email,
       u.department as department,
       u.grade      as grade,
       u.manager_id as manager_id,
       m.full_name  as manager_name,
       a.full_name  as approver_name,
       t.is_international
from public.trips t
join public.profiles u on u.id = t.user_id
left join public.profiles m on m.id = u.manager_id
left join public.profiles a on a.id = t.approver_id;
