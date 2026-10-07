-- TravelDesk schema
-- Employees plan itineraries, the travel policy is evaluated server-side,
-- urgent / out-of-policy trips go to the traveller's manager for approval,
-- and admins (the travel desk) see and book everything.
--
-- All writes go through SECURITY DEFINER functions so the policy rules cannot
-- be bypassed from the browser. Tables are read-only to clients, filtered by RLS.

-- ---------------------------------------------------------------- types
create type public.app_role as enum ('employee', 'manager', 'admin');
create type public.trip_status as enum ('pending_approval', 'approved', 'rejected', 'booked', 'cancelled');

-- ---------------------------------------------------------------- tables
create table public.settings (
  id                   boolean primary key default true check (id),
  company_name         text not null default 'Our Company',
  currency             text not null default 'INR',
  timezone             text not null default 'Asia/Kolkata',
  allowed_email_domain text not null default ''   -- e.g. 'company.com'; empty = any domain may sign up
);
insert into public.settings default values;

create table public.policies (
  grade               text primary key,
  label               text not null,
  flight_class        text not null default 'economy'
                      check (flight_class in ('economy', 'premium_economy', 'business', 'first')),
  train_class         text not null default 'ac3'
                      check (train_class in ('sleeper', 'ac3', 'ac2', 'ac1')),
  hotel_max_per_night numeric(12,2) not null default 0 check (hotel_max_per_night >= 0),
  daily_allowance     numeric(12,2) not null default 0 check (daily_allowance >= 0),
  max_trip_budget     numeric(12,2) not null default 0 check (max_trip_budget >= 0),
  advance_days        integer not null default 7 check (advance_days >= 0)
);
insert into public.policies values
  ('G1', 'Associate',         'economy',  'ac3', 3000,  1000, 40000,  14),
  ('G2', 'Manager',           'economy',  'ac2', 5000,  1500, 75000,  10),
  ('G3', 'Senior Leadership', 'business', 'ac1', 10000, 3000, 200000, 7);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  email      text not null,
  role       public.app_role not null default 'employee',
  grade      text not null default 'G1' references public.policies (grade) on update cascade,
  department text not null default '',
  manager_id uuid references public.profiles (id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profiles_not_own_manager check (manager_id is distinct from id)
);
create index profiles_manager_idx on public.profiles (manager_id);

create table public.trips (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  title             text not null,
  purpose           text not null,
  destination       text not null,
  start_date        date not null,
  end_date          date not null,
  is_urgent         boolean not null default false,
  urgency_reason    text not null default '',
  justification     text not null default '',
  total_estimate    numeric(12,2) not null default 0,
  violations        jsonb not null default '[]',
  approval_reasons  jsonb not null default '[]',
  requires_approval boolean not null default false,
  status            public.trip_status not null,
  approver_id       uuid references public.profiles (id) on delete set null,
  approval_comment  text not null default '',
  decided_at        timestamptz,
  booking_ref       text not null default '',
  admin_note        text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint trips_dates check (end_date >= start_date)
);
create index trips_user_idx on public.trips (user_id);
create index trips_status_idx on public.trips (status);
create index trips_approver_idx on public.trips (approver_id);

create table public.trip_segments (
  id           bigint generated always as identity primary key,
  trip_id      bigint not null references public.trips (id) on delete cascade,
  position     integer not null,
  type         text not null check (type in ('flight', 'train', 'hotel', 'cab', 'bus', 'other')),
  from_loc     text not null default '',
  to_loc       text not null default '',
  start_date   date not null,
  end_date     date,
  travel_class text not null default '',
  est_cost     numeric(12,2) not null default 0 check (est_cost >= 0),
  notes        text not null default ''
);
create index trip_segments_trip_idx on public.trip_segments (trip_id);

create table public.trip_events (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references public.trips (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  action     text not null,
  comment    text not null default '',
  created_at timestamptz not null default now()
);
create index trip_events_trip_idx on public.trip_events (trip_id);
create index trip_events_user_idx on public.trip_events (user_id);

-- ---------------------------------------------------------------- helpers
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and active
  );
$$;

create function public.is_manager_of(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = p_user and manager_id = (select auth.uid())
  );
$$;

create function public.can_view_trip(p_trip bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip
      and (t.user_id = (select auth.uid()) or public.is_manager_of(t.user_id) or public.is_admin())
  );
$$;

-- Who approves a trip: the traveller's active manager; admins cover travellers with none.
create function public.can_approve_trip(p_trip bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.trips t
    join public.profiles u on u.id = t.user_id
    left join public.profiles m on m.id = u.manager_id and m.active
    where t.id = p_trip
      and t.user_id <> (select auth.uid())
      and (m.id = (select auth.uid()) or (m.id is null and public.is_admin()))
  );
$$;

create function public.local_today() returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone (select timezone from public.settings))::date;
$$;

create function public.try_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then
  return null;
end;
$$;

create function public.pretty(p text) returns text
language sql immutable set search_path = '' as $$
  select initcap(replace(coalesce(p, ''), '_', ' '));
$$;

-- ---------------------------------------------------------------- policy engine
create function public.evaluate_trip(
  p_policy public.policies, p_trip jsonb, p_segments jsonb, p_today date
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  flight_rank constant jsonb := '{"economy":1,"premium_economy":2,"business":3,"first":4}';
  train_rank  constant jsonb := '{"sleeper":1,"ac3":2,"ac2":3,"ac1":4}';
  v_violations jsonb := '[]';
  v_reasons    jsonb := '[]';
  v_total      numeric := 0;
  v_seg        jsonb;
  v_i          int := 0;
  v_cost       numeric;
  v_nights     int;
  v_per_night  numeric;
  v_label      text;
  v_start      date := public.try_date(p_trip->>'start_date');
  v_end        date := public.try_date(p_trip->>'end_date');
  v_flagged    boolean := coalesce((p_trip->>'is_urgent')::boolean, false);
  v_days_until int;
  v_short      boolean := false;
  v_trip_days  int := 1;
begin
  for v_seg in select value from jsonb_array_elements(coalesce(p_segments, '[]')) loop
    v_i := v_i + 1;
    v_cost := coalesce(nullif(v_seg->>'est_cost', '')::numeric, 0);
    v_total := v_total + v_cost;
    v_label := format('Item %s (%s)', v_i, v_seg->>'type');

    if v_seg->>'type' = 'flight' and coalesce(v_seg->>'travel_class', '') <> ''
       and coalesce((flight_rank->>(v_seg->>'travel_class'))::int, 1)
           > coalesce((flight_rank->>p_policy.flight_class)::int, 1) then
      v_violations := v_violations || jsonb_build_object('code', 'FLIGHT_CLASS', 'message',
        format('%s: %s exceeds allowed %s class', v_label,
               public.pretty(v_seg->>'travel_class'), public.pretty(p_policy.flight_class)));
    end if;

    if v_seg->>'type' = 'train' and coalesce(v_seg->>'travel_class', '') <> ''
       and coalesce((train_rank->>(v_seg->>'travel_class'))::int, 1)
           > coalesce((train_rank->>p_policy.train_class)::int, 1) then
      v_violations := v_violations || jsonb_build_object('code', 'TRAIN_CLASS', 'message',
        format('%s: %s exceeds allowed %s class', v_label,
               upper(v_seg->>'travel_class'), upper(p_policy.train_class)));
    end if;

    if v_seg->>'type' = 'hotel' and p_policy.hotel_max_per_night > 0 then
      v_nights := greatest(1, coalesce(
        public.try_date(v_seg->>'end_date') - public.try_date(v_seg->>'start_date'), 1));
      v_per_night := v_cost / v_nights;
      if v_per_night > p_policy.hotel_max_per_night then
        v_violations := v_violations || jsonb_build_object('code', 'HOTEL_RATE', 'message',
          format('%s: %s/night exceeds cap of %s/night', v_label,
                 round(v_per_night), round(p_policy.hotel_max_per_night)));
      end if;
    end if;
  end loop;

  if v_start is not null and v_end is not null then
    v_trip_days := greatest(1, v_end - v_start + 1);
  end if;

  if p_policy.max_trip_budget > 0 and v_total > p_policy.max_trip_budget then
    v_violations := v_violations || jsonb_build_object('code', 'TRIP_BUDGET', 'message',
      format('Estimated total %s exceeds trip budget of %s', round(v_total), round(p_policy.max_trip_budget)));
  end if;

  if v_start is not null then
    v_days_until := v_start - p_today;
    v_short := v_days_until < p_policy.advance_days;
  end if;

  if v_flagged then
    v_reasons := v_reasons || to_jsonb('Marked as urgent by traveller'::text);
  end if;
  if v_short then
    v_reasons := v_reasons || to_jsonb(format(
      'Booked %s day(s) before travel; policy requires %s days notice', v_days_until, p_policy.advance_days));
  end if;
  if jsonb_array_length(v_violations) > 0 then
    v_reasons := v_reasons || to_jsonb(format('%s policy violation(s)', jsonb_array_length(v_violations)));
  end if;

  return jsonb_build_object(
    'total', v_total,
    'trip_days', v_trip_days,
    'allowance', p_policy.daily_allowance * v_trip_days,
    'days_until_travel', v_days_until,
    'urgent', v_flagged or v_short,
    'violations', v_violations,
    'reasons', v_reasons,
    'requires_approval', v_flagged or v_short or jsonb_array_length(v_violations) > 0
  );
end;
$$;

create function public.my_policy() returns public.policies
language sql stable security definer set search_path = '' as $$
  select p.* from public.policies p
  join public.profiles u on u.grade = p.grade
  where u.id = (select auth.uid());
$$;

-- Live preview while the traveller builds the itinerary.
create function public.check_trip(p_trip jsonb, p_segments jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_policy public.policies := public.my_policy();
begin
  if v_policy.grade is null then raise exception 'No travel policy configured for your grade'; end if;
  return public.evaluate_trip(v_policy, p_trip, p_segments, public.local_today());
end;
$$;

-- ---------------------------------------------------------------- trip workflow
create function public.submit_trip(p_trip jsonb, p_segments jsonb) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_policy  public.policies := public.my_policy();
  v_today   date := public.local_today();
  v_title   text := left(btrim(coalesce(p_trip->>'title', '')), 120);
  v_purpose text := left(btrim(coalesce(p_trip->>'purpose', '')), 1000);
  v_dest    text := left(btrim(coalesce(p_trip->>'destination', '')), 120);
  v_start   date := public.try_date(p_trip->>'start_date');
  v_end     date := public.try_date(p_trip->>'end_date');
  v_urgent  boolean := coalesce((p_trip->>'is_urgent')::boolean, false);
  v_ureason text := left(btrim(coalesce(p_trip->>'urgency_reason', '')), 1000);
  v_just    text := left(btrim(coalesce(p_trip->>'justification', '')), 1000);
  v_result  jsonb;
  v_id      bigint;
  v_seg     jsonb;
  v_i       int := 0;
  v_s_start date;
  v_s_end   date;
  v_cost    numeric;
begin
  if v_uid is null then raise exception 'Please sign in'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and active) then
    raise exception 'Your account is inactive';
  end if;
  if v_policy.grade is null then raise exception 'No travel policy configured for your grade'; end if;
  if v_title = '' then raise exception 'Title is required'; end if;
  if v_purpose = '' then raise exception 'Purpose of travel is required'; end if;
  if v_dest = '' then raise exception 'Destination is required'; end if;
  if v_start is null or v_end is null then raise exception 'Valid start and end dates are required'; end if;
  if v_end < v_start then raise exception 'End date is before start date'; end if;
  if v_start < v_today then raise exception 'Trip cannot start in the past'; end if;
  if v_urgent and v_ureason = '' then raise exception 'Please explain why this trip is urgent'; end if;
  if jsonb_typeof(p_segments) <> 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception 'Add at least one itinerary item';
  end if;
  if jsonb_array_length(p_segments) > 50 then raise exception 'Too many itinerary items'; end if;

  for v_seg in select value from jsonb_array_elements(p_segments) loop
    v_i := v_i + 1;
    v_s_start := public.try_date(v_seg->>'start_date');
    v_s_end := public.try_date(nullif(v_seg->>'end_date', ''));
    begin
      v_cost := coalesce(nullif(v_seg->>'est_cost', '')::numeric, 0);
    exception when others then
      raise exception 'Item %: invalid cost', v_i;
    end;
    if coalesce(v_seg->>'type', '') not in ('flight', 'train', 'hotel', 'cab', 'bus', 'other') then
      raise exception 'Item %: invalid type', v_i;
    end if;
    if v_s_start is null then raise exception 'Item %: date is required', v_i; end if;
    if nullif(v_seg->>'end_date', '') is not null and v_s_end is null then
      raise exception 'Item %: invalid end date', v_i;
    end if;
    if v_seg->>'type' = 'hotel' and v_s_end is null then
      raise exception 'Item %: hotel needs a check-out date', v_i;
    end if;
    if v_s_end < v_s_start then raise exception 'Item %: end date is before start date', v_i; end if;
    if v_s_start < v_start or coalesce(v_s_end, v_s_start) > v_end then
      raise exception 'Item %: dates must fall within the trip dates', v_i;
    end if;
    if v_cost < 0 then raise exception 'Item %: cost cannot be negative', v_i; end if;
  end loop;

  v_result := public.evaluate_trip(v_policy, p_trip, p_segments, v_today);
  if jsonb_array_length(v_result->'violations') > 0 and v_just = '' then
    raise exception 'This trip is outside policy. Please add a justification.';
  end if;

  insert into public.trips (user_id, title, purpose, destination, start_date, end_date, is_urgent,
    urgency_reason, justification, total_estimate, violations, approval_reasons, requires_approval, status)
  values (v_uid, v_title, v_purpose, v_dest, v_start, v_end, (v_result->>'urgent')::boolean,
    v_ureason, v_just, (v_result->>'total')::numeric, v_result->'violations', v_result->'reasons',
    (v_result->>'requires_approval')::boolean,
    case when (v_result->>'requires_approval')::boolean then 'pending_approval' else 'approved' end::public.trip_status)
  returning id into v_id;

  insert into public.trip_segments (trip_id, position, type, from_loc, to_loc, start_date, end_date,
    travel_class, est_cost, notes)
  select v_id, s.ord - 1, s.value->>'type',
         left(coalesce(s.value->>'from_loc', ''), 120), left(coalesce(s.value->>'to_loc', ''), 120),
         (s.value->>'start_date')::date, public.try_date(nullif(s.value->>'end_date', '')),
         left(coalesce(s.value->>'travel_class', ''), 30),
         coalesce(nullif(s.value->>'est_cost', '')::numeric, 0),
         left(coalesce(s.value->>'notes', ''), 500)
  from jsonb_array_elements(p_segments) with ordinality as s(value, ord);

  insert into public.trip_events (trip_id, user_id, action, comment)
  values (v_id, v_uid, 'submitted',
          coalesce((select string_agg(r, '; ') from jsonb_array_elements_text(v_result->'reasons') r), ''));

  if not (v_result->>'requires_approval')::boolean then
    insert into public.trip_events (trip_id, user_id, action, comment)
    values (v_id, null, 'auto_approved', 'Within policy and planned with enough notice');
  end if;

  return v_id;
end;
$$;

create function public.decide_trip(p_trip_id bigint, p_decision text, p_comment text default '')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_status  public.trip_status;
  v_comment text := left(btrim(coalesce(p_comment, '')), 1000);
  v_new     public.trip_status;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject'; end if;
  select status into v_status from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip not found'; end if;
  if not public.can_approve_trip(p_trip_id) then raise exception 'You are not the approver for this trip'; end if;
  if v_status <> 'pending_approval' then raise exception 'This trip is no longer awaiting approval'; end if;
  if p_decision = 'reject' and v_comment = '' then raise exception 'Please give a reason for rejecting'; end if;

  v_new := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  update public.trips
     set status = v_new, approver_id = v_uid, approval_comment = v_comment,
         decided_at = now(), updated_at = now()
   where id = p_trip_id;
  insert into public.trip_events (trip_id, user_id, action, comment) values (p_trip_id, v_uid, v_new::text, v_comment);
end;
$$;

create function public.cancel_trip(p_trip_id bigint, p_comment text default '') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_trip public.trips;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip not found'; end if;
  if not (
    (v_trip.user_id = v_uid and v_trip.status in ('pending_approval', 'approved'))
    or (public.is_admin() and v_trip.status in ('pending_approval', 'approved', 'booked'))
  ) then
    raise exception 'This trip cannot be cancelled';
  end if;
  update public.trips set status = 'cancelled', updated_at = now() where id = p_trip_id;
  insert into public.trip_events (trip_id, user_id, action, comment)
  values (p_trip_id, v_uid, 'cancelled', left(btrim(coalesce(p_comment, '')), 1000));
end;
$$;

create function public.book_trip(p_trip_id bigint, p_booking_ref text, p_note text default '') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status public.trip_status;
  v_ref    text := left(btrim(coalesce(p_booking_ref, '')), 120);
  v_note   text := left(btrim(coalesce(p_note, '')), 1000);
begin
  if not public.is_admin() then raise exception 'Only the travel desk can book trips'; end if;
  select status into v_status from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip not found'; end if;
  if v_status <> 'approved' then raise exception 'Only approved trips can be marked as booked'; end if;
  if v_ref = '' then raise exception 'Booking reference is required'; end if;
  update public.trips set status = 'booked', booking_ref = v_ref, admin_note = v_note, updated_at = now()
   where id = p_trip_id;
  insert into public.trip_events (trip_id, user_id, action, comment)
  values (p_trip_id, v_uid, 'booked', 'Ref ' || v_ref || case when v_note <> '' then ' — ' || v_note else '' end);
end;
$$;

-- ---------------------------------------------------------------- admin functions
create function public.upsert_policy(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_grade text := left(btrim(coalesce(p->>'grade', '')), 20);
begin
  if not public.is_admin() then raise exception 'Only admins can edit travel policy'; end if;
  if v_grade = '' then raise exception 'Grade is required'; end if;
  insert into public.policies (grade, label, flight_class, train_class, hotel_max_per_night,
    daily_allowance, max_trip_budget, advance_days)
  values (v_grade, coalesce(nullif(btrim(p->>'label'), ''), v_grade),
    coalesce(p->>'flight_class', 'economy'), coalesce(p->>'train_class', 'ac3'),
    coalesce((p->>'hotel_max_per_night')::numeric, 0), coalesce((p->>'daily_allowance')::numeric, 0),
    coalesce((p->>'max_trip_budget')::numeric, 0), coalesce((p->>'advance_days')::int, 7))
  on conflict (grade) do update set
    label = excluded.label, flight_class = excluded.flight_class, train_class = excluded.train_class,
    hotel_max_per_night = excluded.hotel_max_per_night, daily_allowance = excluded.daily_allowance,
    max_trip_budget = excluded.max_trip_budget, advance_days = excluded.advance_days;
end;
$$;

create function public.admin_update_profile(p_id uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_manager uuid := nullif(p->>'manager_id', '')::uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can edit users'; end if;
  if p_id = (select auth.uid()) and (coalesce(p->>'role', 'admin') <> 'admin' or not coalesce((p->>'active')::boolean, true)) then
    raise exception 'You cannot remove your own admin access';
  end if;
  if v_manager = p_id then raise exception 'A user cannot be their own manager'; end if;
  -- prevent reporting cycles (A -> B -> A)
  if v_manager is not null and exists (
    with recursive chain as (
      select id, manager_id from public.profiles where id = v_manager
      union
      select pr.id, pr.manager_id from public.profiles pr join chain c on pr.id = c.manager_id
    ) select 1 from chain where id = p_id
  ) then
    raise exception 'That manager reports (directly or indirectly) to this user';
  end if;
  update public.profiles set
    full_name  = coalesce(nullif(btrim(p->>'full_name'), ''), full_name),
    role       = coalesce(p->>'role', role::text)::public.app_role,
    grade      = coalesce(p->>'grade', grade),
    department = coalesce(p->>'department', department),
    manager_id = v_manager,
    active     = coalesce((p->>'active')::boolean, active)
  where id = p_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

create function public.update_settings(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change settings'; end if;
  if p ? 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names where name = p->>'timezone') then
    raise exception 'Unknown timezone %', p->>'timezone';
  end if;
  update public.settings set
    company_name         = coalesce(nullif(btrim(p->>'company_name'), ''), company_name),
    currency             = coalesce(nullif(btrim(p->>'currency'), ''), currency),
    timezone             = coalesce(nullif(btrim(p->>'timezone'), ''), timezone),
    allowed_email_domain = lower(coalesce(btrim(p->>'allowed_email_domain'), allowed_email_domain))
  where id;
end;
$$;

-- ---------------------------------------------------------------- new user signup
-- Creates a profile for every Supabase Auth user. The very first user becomes admin
-- so the company can bootstrap the portal; everyone after that starts as an employee.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_domain text := (select allowed_email_domain from public.settings);
  v_grade  text := coalesce((select grade from public.policies order by grade limit 1), 'G1');
begin
  if v_domain <> '' and lower(split_part(new.email, '@', 2)) <> v_domain then
    raise exception 'Only % email addresses can sign up', v_domain;
  end if;
  insert into public.profiles (id, email, full_name, role, grade)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'admin') then 'employee' else 'admin' end::public.app_role,
    v_grade
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- view
create view public.trips_view with (security_invoker = true) as
select t.*,
       u.full_name  as traveller_name,
       u.email      as traveller_email,
       u.department as department,
       u.grade      as grade,
       u.manager_id as manager_id,
       m.full_name  as manager_name,
       a.full_name  as approver_name
from public.trips t
join public.profiles u on u.id = t.user_id
left join public.profiles m on m.id = u.manager_id
left join public.profiles a on a.id = t.approver_id;

-- ---------------------------------------------------------------- row level security
alter table public.settings      enable row level security;
alter table public.policies      enable row level security;
alter table public.profiles      enable row level security;
alter table public.trips         enable row level security;
alter table public.trip_segments enable row level security;
alter table public.trip_events   enable row level security;

create policy "signed-in users read settings" on public.settings
  for select to authenticated using (true);
create policy "signed-in users read policies" on public.policies
  for select to authenticated using (true);
-- Company directory: names / departments are visible to colleagues (needed for manager & approver names).
create policy "signed-in users read profiles" on public.profiles
  for select to authenticated using (true);
create policy "travellers, their managers and admins read trips" on public.trips
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_manager_of(user_id) or public.is_admin());
create policy "read segments of visible trips" on public.trip_segments
  for select to authenticated using (public.can_view_trip(trip_id));
create policy "read events of visible trips" on public.trip_events
  for select to authenticated using (public.can_view_trip(trip_id));

-- Clients never write tables directly; all changes go through the functions above.
revoke insert, update, delete, truncate on
  public.settings, public.policies, public.profiles, public.trips, public.trip_segments, public.trip_events
  from anon, authenticated;
revoke all on
  public.settings, public.policies, public.profiles, public.trips, public.trip_segments, public.trip_events,
  public.trips_view
  from anon;

-- ---------------------------------------------------------------- function privileges
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_admin(), public.is_manager_of(uuid), public.can_view_trip(bigint), public.can_approve_trip(bigint),
  public.local_today(), public.check_trip(jsonb, jsonb), public.submit_trip(jsonb, jsonb),
  public.decide_trip(bigint, text, text), public.cancel_trip(bigint, text), public.book_trip(bigint, text, text),
  public.upsert_policy(jsonb), public.admin_update_profile(uuid, jsonb), public.update_settings(jsonb)
  to authenticated;
