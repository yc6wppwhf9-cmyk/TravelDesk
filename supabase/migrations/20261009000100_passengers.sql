-- Passenger details needed to issue tickets (name as on ID, gender, age, mobile, preferences),
-- guest passengers who are not TravelDesk users, and the actual booked cost entered by the travel desk.

-- Personal details kept apart from profiles so colleagues can't read each other's phone / DOB.
create table if not exists public.person_details (
  id            uuid primary key references public.profiles (id) on delete cascade,
  id_name       text not null default '',
  gender        text not null default '' check (gender in ('', 'male', 'female', 'other')),
  date_of_birth date,
  phone         text not null default '',
  meal_pref     text not null default '',
  berth_pref    text not null default '',
  updated_at    timestamptz not null default now()
);
alter table public.person_details enable row level security;
create policy "own details or admin" on public.person_details
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
revoke insert, update, truncate on public.person_details from anon, authenticated;
revoke all on public.person_details from anon;

create or replace function public.update_my_details(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Please sign in'; end if;
  insert into public.person_details (id, id_name, gender, date_of_birth, phone, meal_pref, berth_pref)
  values (v_uid,
    left(btrim(coalesce(p->>'id_name', '')), 120),
    case when p->>'gender' in ('male', 'female', 'other') then p->>'gender' else '' end,
    public.try_date(p->>'date_of_birth'),
    left(btrim(coalesce(p->>'phone', '')), 30),
    left(coalesce(p->>'meal_pref', ''), 30),
    left(coalesce(p->>'berth_pref', ''), 30))
  on conflict (id) do update set
    id_name = excluded.id_name, gender = excluded.gender, date_of_birth = coalesce(excluded.date_of_birth, public.person_details.date_of_birth),
    phone = excluded.phone, meal_pref = excluded.meal_pref, berth_pref = excluded.berth_pref, updated_at = now();
end;
$$;

-- Prefill for colleagues being added as passengers: name as on ID, gender and age only (no phone / DOB).
create or replace function public.passenger_prefill(p_ids uuid[])
returns table (id uuid, id_name text, gender text, age int)
language sql stable security definer set search_path = '' as $$
  select pr.id,
         coalesce(nullif(d.id_name, ''), pr.full_name),
         coalesce(d.gender, ''),
         case when d.date_of_birth is not null then extract(year from age(d.date_of_birth))::int end
  from public.profiles pr
  left join public.person_details d on d.id = pr.id
  where pr.id = any(p_ids) and pr.active and (select auth.uid()) is not null;
$$;

create table if not exists public.trip_passengers (
  id          bigint generated always as identity primary key,
  trip_id     bigint not null references public.trips (id) on delete cascade,
  position    integer not null default 0,
  profile_id  uuid references public.profiles (id) on delete set null,
  full_name   text not null check (btrim(full_name) <> ''),
  gender      text not null default '' check (gender in ('', 'male', 'female', 'other')),
  age         integer check (age is null or age between 0 and 120),
  phone       text not null default '',
  meal_pref   text not null default '',
  berth_pref  text not null default '',
  is_guest    boolean not null default false
);
create index if not exists trip_passengers_trip_idx on public.trip_passengers (trip_id);
create index if not exists trip_passengers_profile_idx on public.trip_passengers (profile_id);
alter table public.trip_passengers enable row level security;
create policy "read passengers of visible trips" on public.trip_passengers
  for select to authenticated using (public.can_view_trip(trip_id));
revoke insert, update, truncate on public.trip_passengers from anon, authenticated;
revoke all on public.trip_passengers from anon;

-- Organiser records passenger details right after submitting (once per trip).
create or replace function public.add_trip_passengers(p_trip_id bigint, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_pax  jsonb;
  v_i    int := 0;
  v_age  int;
begin
  select * into v_trip from public.trips where id = p_trip_id;
  if not found then raise exception 'Trip not found'; end if;
  if v_trip.user_id <> (select auth.uid()) and not public.is_admin() then
    raise exception 'Only the organiser can add passengers';
  end if;
  if exists (select 1 from public.trip_passengers where trip_id = p_trip_id) then
    raise exception 'Passengers are already recorded for this trip';
  end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) = 0 then raise exception 'Add at least one passenger'; end if;
  if jsonb_array_length(p) > 21 then raise exception 'Too many passengers'; end if;
  for v_pax in select value from jsonb_array_elements(p) loop
    v_i := v_i + 1;
    if btrim(coalesce(v_pax->>'full_name', '')) = '' then raise exception 'Passenger %: name is required', v_i; end if;
    begin
      v_age := nullif(v_pax->>'age', '')::int;
    exception when others then
      raise exception 'Passenger %: invalid age', v_i;
    end;
    insert into public.trip_passengers (trip_id, position, profile_id, full_name, gender, age, phone, meal_pref, berth_pref, is_guest)
    values (p_trip_id, v_i,
      case when (v_pax->>'profile_id') is not null and exists (select 1 from public.profiles where id::text = v_pax->>'profile_id')
           then (v_pax->>'profile_id')::uuid end,
      left(btrim(v_pax->>'full_name'), 120),
      case when v_pax->>'gender' in ('male', 'female', 'other') then v_pax->>'gender' else '' end,
      case when v_age between 0 and 120 then v_age end,
      left(btrim(coalesce(v_pax->>'phone', '')), 30),
      left(coalesce(v_pax->>'meal_pref', ''), 30),
      left(coalesce(v_pax->>'berth_pref', ''), 30),
      (v_pax->>'profile_id') is null);
  end loop;
end;
$$;

-- Travel desk records what was actually paid (replaces the old traveller estimate).
create or replace function public.set_trip_cost(p_trip_id bigint, p_amount numeric) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the travel desk can record costs'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter a valid amount'; end if;
  update public.trips set total_estimate = p_amount, updated_at = now() where id = p_trip_id;
  if not found then raise exception 'Trip not found'; end if;
end;
$$;

revoke execute on function public.update_my_details(jsonb), public.passenger_prefill(uuid[]),
  public.add_trip_passengers(bigint, jsonb), public.set_trip_cost(bigint, numeric) from public, anon;
grant execute on function public.update_my_details(jsonb), public.passenger_prefill(uuid[]),
  public.add_trip_passengers(bigint, jsonb), public.set_trip_cost(bigint, numeric) to authenticated;
