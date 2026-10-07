-- Policy V5 engine and admin functions (replaces the placeholder engine from the first migration).

create or replace function public.city_category(p_city text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select category from public.cities
      where name = lower(btrim(regexp_replace(coalesce(p_city, ''), '\s*\(.*\)\s*', ' ', 'g')))),
    'C');
$$;

-- Evaluates a (draft) trip for the traveller's band. Returns violations, approval reasons
-- and entitlements. Segment types: flight, train, hotel, cab, bus, other.
-- Cab travel_class: economy_cab | ac_cab | own_vehicle.
create or replace function public.evaluate_trip(
  p_policy public.policies, p_trip jsonb, p_segments jsonb, p_today date
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  rail_rank constant jsonb := '{"second_sitting":1,"sleeper":1,"chair_car":2,"ac3":2,"ac2":3,"ac1":4}';
  road_rank constant jsonb := '{"public_transport":1,"economy_cab":2,"ac_cab":3}';
  s            public.settings;
  v_violations jsonb := '[]';
  v_reasons    jsonb := '[]';
  v_hotels     jsonb := '[]';
  v_total      numeric := 0;
  v_seg        jsonb;
  v_type       text;
  v_class      text;
  v_i          int := 0;
  v_cost       numeric;
  v_hours      numeric;
  v_nights     int;
  v_per_night  numeric;
  v_cat        text;
  v_cap        numeric;
  v_label      text;
  v_start      date := public.try_date(p_trip->>'start_date');
  v_end        date := public.try_date(p_trip->>'end_date');
  v_flagged    boolean := coalesce((p_trip->>'is_urgent')::boolean, false);
  v_intl       boolean := coalesce((p_trip->>'is_international')::boolean, false);
  v_advance    int;
  v_days_until int;
  v_short      boolean := false;
  v_trip_days  int := 1;
  v_laundry    numeric := 0;
begin
  select * into s from public.settings limit 1;
  v_advance := case when v_intl then s.international_advance_days else s.domestic_advance_days end;

  if v_start is not null and v_end is not null and v_end >= v_start then
    v_trip_days := v_end - v_start + 1;
  end if;

  for v_seg in select value from jsonb_array_elements(coalesce(p_segments, '[]')) loop
    v_i := v_i + 1;
    v_type := v_seg->>'type';
    v_class := coalesce(v_seg->>'travel_class', '');
    v_cost := coalesce(nullif(v_seg->>'est_cost', '')::numeric, 0);
    v_hours := nullif(v_seg->>'duration_hours', '')::numeric;
    v_total := v_total + v_cost;
    v_label := format('Item %s (%s)', v_i, public.pretty(v_type));

    -- 5.1.1 Air only when the surface (rail/road) journey is above the threshold
    if v_type = 'flight' and not v_intl and v_hours is not null
       and v_hours <= s.air_min_surface_hours then
      v_violations := v_violations || jsonb_build_object('code', 'AIR_ELIGIBILITY', 'message',
        format('%s: air travel is allowed only when the rail/road journey exceeds %s hours (entered %s h)',
               v_label, s.air_min_surface_hours, v_hours));
    end if;

    -- 5.1.2 Rail entitlement
    if v_type = 'train' and v_class <> ''
       and coalesce((rail_rank->>v_class)::int, 1) > coalesce((rail_rank->>p_policy.rail_max_class)::int, 1) then
      v_violations := v_violations || jsonb_build_object('code', 'RAIL_CLASS', 'message',
        format('%s: %s is above your entitlement (up to %s for band %s)', v_label,
               public.pretty(v_class), public.pretty(p_policy.rail_max_class), p_policy.grade));
    end if;

    -- 5.1.2 Road entitlement
    if v_type = 'cab' and v_class = 'own_vehicle' then
      if not p_policy.own_vehicle_allowed then
        v_violations := v_violations || jsonb_build_object('code', 'OWN_VEHICLE', 'message',
          format('%s: own vehicle is not part of band %s entitlement', v_label, p_policy.grade));
      end if;
    elsif v_type = 'cab' and coalesce((road_rank->>coalesce(nullif(v_class, ''), 'economy_cab'))::int, 2)
          > coalesce((road_rank->>p_policy.road_max_mode)::int, 1) then
      v_violations := v_violations || jsonb_build_object('code', 'ROAD_MODE', 'message',
        format('%s: %s is above your entitlement (%s for band %s)', v_label,
               public.pretty(coalesce(nullif(v_class, ''), 'cab')), public.pretty(p_policy.road_max_mode),
               p_policy.grade));
    end if;

    -- 6.2 Accommodation
    if v_type = 'hotel' then
      if v_start is not null and v_start = v_end then
        v_violations := v_violations || jsonb_build_object('code', 'SINGLE_DAY_HOTEL', 'message',
          format('%s: no accommodation is provided for single-day travel', v_label));
      end if;
      v_nights := greatest(1, coalesce(
        public.try_date(v_seg->>'end_date') - public.try_date(v_seg->>'start_date'), 1));
      v_per_night := v_cost / v_nights;
      if v_intl then
        -- 5.3 foreign hotel caps are agreed with the manager and travel desk
        v_hotels := v_hotels || jsonb_build_object('item', v_i, 'city', v_seg->>'to_loc',
          'category', null, 'cap', null, 'nights', v_nights, 'per_night', round(v_per_night));
      else
        v_cat := public.city_category(v_seg->>'to_loc');
        v_cap := case v_cat when 'A' then p_policy.hotel_cap_a when 'B' then p_policy.hotel_cap_b
                 else p_policy.hotel_cap_c end;
        v_hotels := v_hotels || jsonb_build_object('item', v_i, 'city', v_seg->>'to_loc',
          'category', v_cat, 'cap', v_cap, 'nights', v_nights, 'per_night', round(v_per_night));
        if v_per_night > v_cap then
          v_violations := v_violations || jsonb_build_object('code', 'HOTEL_CAP', 'message',
            format('%s: %s/night in %s (category %s) exceeds the band %s cap of %s/night', v_label,
                   round(v_per_night), coalesce(nullif(v_seg->>'to_loc', ''), 'city'), v_cat,
                   p_policy.grade, round(v_cap)));
        end if;
      end if;
    end if;
  end loop;

  if v_start is not null then
    v_days_until := v_start - p_today;
    v_short := v_days_until < v_advance;
  end if;

  if v_trip_days >= s.laundry_from_day then
    v_laundry := s.laundry_per_day * (v_trip_days - s.laundry_from_day + 1);
  end if;

  if s.require_approval_all then
    v_reasons := v_reasons || to_jsonb('All travel requires Reporting Manager approval'::text);
  end if;
  if v_intl then
    v_reasons := v_reasons || to_jsonb('Foreign travel requires Manager and Management approval'::text);
  end if;
  if v_flagged then
    v_reasons := v_reasons || to_jsonb('Marked as urgent by traveller'::text);
  end if;
  if v_short then
    v_reasons := v_reasons || to_jsonb(format(
      'Requested %s day(s) before travel; policy requires %s days notice — special approval needed',
      v_days_until, v_advance));
  end if;
  if jsonb_array_length(v_violations) > 0 then
    v_reasons := v_reasons || to_jsonb(format('%s policy exception(s)', jsonb_array_length(v_violations)));
  end if;

  return jsonb_build_object(
    'total', v_total,
    'trip_days', v_trip_days,
    'days_until_travel', v_days_until,
    'advance_days_required', v_advance,
    'short_notice', v_short,
    'urgent', v_flagged or v_short,
    'international', v_intl,
    'violations', v_violations,
    'reasons', v_reasons,
    'hotels', v_hotels,
    'meal_cap_per_day', p_policy.meal_cap_per_day,
    'meal_budget', p_policy.meal_cap_per_day * v_trip_days,
    'laundry_allowance', v_laundry,
    'needs_justification', v_short or jsonb_array_length(v_violations) > 0,
    'requires_approval', s.require_approval_all or v_intl or v_flagged or v_short
                         or jsonb_array_length(v_violations) > 0
  );
end;
$$;

create or replace function public.check_trip(p_trip jsonb, p_segments jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_policy public.policies := public.my_policy();
begin
  if v_policy.rank is null then raise exception 'No travel policy configured for your band'; end if;
  return public.evaluate_trip(v_policy, p_trip, p_segments, public.local_today());
end;
$$;

create or replace function public.submit_trip(p_trip jsonb, p_segments jsonb) returns bigint
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
  v_urgent  boolean;
  v_intl    boolean;
  v_ureason text := left(btrim(coalesce(p_trip->>'urgency_reason', '')), 1000);
  v_just    text := left(btrim(coalesce(p_trip->>'justification', '')), 1000);
  v_result  jsonb;
  v_id      bigint;
  v_seg     jsonb;
  v_i       int := 0;
  v_s_start date;
  v_s_end   date;
  v_cost    numeric;
  v_hours   numeric;
begin
  if v_uid is null then raise exception 'Please sign in'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and active) then
    raise exception 'Your account is inactive';
  end if;
  if v_policy.rank is null then raise exception 'No travel policy configured for your band'; end if;
  begin
    v_urgent := coalesce((p_trip->>'is_urgent')::boolean, false);
    v_intl := coalesce((p_trip->>'is_international')::boolean, false);
  exception when others then
    raise exception 'Invalid trip flags';
  end;
  if v_title = '' then raise exception 'Title is required'; end if;
  if v_purpose = '' then raise exception 'Purpose of travel is required'; end if;
  if v_dest = '' then raise exception 'Destination is required'; end if;
  if v_start is null or v_end is null then raise exception 'Valid start and end dates are required'; end if;
  if v_end < v_start then raise exception 'End date is before start date'; end if;
  if v_start < v_today then raise exception 'Trip cannot start in the past'; end if;
  if v_urgent and v_ureason = '' then raise exception 'Please explain why this trip is urgent'; end if;
  if jsonb_typeof(p_segments) is distinct from 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception 'Add at least one itinerary item';
  end if;
  if jsonb_array_length(p_segments) > 50 then raise exception 'Too many itinerary items'; end if;

  for v_seg in select value from jsonb_array_elements(p_segments) loop
    v_i := v_i + 1;
    v_s_start := public.try_date(v_seg->>'start_date');
    v_s_end := public.try_date(nullif(v_seg->>'end_date', ''));
    begin
      v_cost := coalesce(nullif(v_seg->>'est_cost', '')::numeric, 0);
      v_hours := nullif(v_seg->>'duration_hours', '')::numeric;
    exception when others then
      raise exception 'Item %: invalid number', v_i;
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
    if v_seg->>'type' = 'hotel' and btrim(coalesce(v_seg->>'to_loc', '')) = '' then
      raise exception 'Item %: hotel needs a city', v_i;
    end if;
    if v_seg->>'type' = 'flight' and not v_intl and v_hours is null then
      raise exception 'Item %: enter the rail/road journey time so air eligibility can be checked', v_i;
    end if;
    if v_s_end < v_s_start then raise exception 'Item %: end date is before start date', v_i; end if;
    if v_s_start < v_start or coalesce(v_s_end, v_s_start) > v_end then
      raise exception 'Item %: dates must fall within the trip dates', v_i;
    end if;
    if v_cost < 0 then raise exception 'Item %: cost cannot be negative', v_i; end if;
    if v_hours < 0 then raise exception 'Item %: journey time cannot be negative', v_i; end if;
  end loop;

  v_result := public.evaluate_trip(v_policy, p_trip, p_segments, v_today);
  if (v_result->>'needs_justification')::boolean and v_just = '' then
    raise exception 'This trip is short-notice or outside policy. Please add a justification for special approval.';
  end if;

  insert into public.trips (user_id, title, purpose, destination, start_date, end_date, is_urgent,
    is_international, urgency_reason, justification, total_estimate, violations, approval_reasons,
    requires_approval, status)
  values (v_uid, v_title, v_purpose, v_dest, v_start, v_end, (v_result->>'urgent')::boolean, v_intl,
    v_ureason, v_just, (v_result->>'total')::numeric, v_result->'violations', v_result->'reasons',
    (v_result->>'requires_approval')::boolean,
    case when (v_result->>'requires_approval')::boolean then 'pending_approval' else 'approved' end::public.trip_status)
  returning id into v_id;

  insert into public.trip_segments (trip_id, position, type, from_loc, to_loc, start_date, end_date,
    travel_class, est_cost, duration_hours, city_category, notes)
  select v_id, s.ord - 1, s.value->>'type',
         left(coalesce(s.value->>'from_loc', ''), 120), left(coalesce(s.value->>'to_loc', ''), 120),
         (s.value->>'start_date')::date, public.try_date(nullif(s.value->>'end_date', '')),
         left(coalesce(s.value->>'travel_class', ''), 30),
         coalesce(nullif(s.value->>'est_cost', '')::numeric, 0),
         nullif(s.value->>'duration_hours', '')::numeric,
         case when s.value->>'type' = 'hotel' and not v_intl then public.city_category(s.value->>'to_loc') end,
         left(coalesce(s.value->>'notes', ''), 500)
  from jsonb_array_elements(p_segments) with ordinality as s(value, ord);

  insert into public.trip_events (trip_id, user_id, action, comment)
  values (v_id, v_uid, 'submitted',
          coalesce((select string_agg(r, '; ') from jsonb_array_elements_text(v_result->'reasons') r), ''));

  if not (v_result->>'requires_approval')::boolean then
    insert into public.trip_events (trip_id, user_id, action, comment)
    values (v_id, null, 'auto_approved', 'Within policy and requested with enough notice');
  end if;

  return v_id;
end;
$$;

create or replace function public.upsert_policy(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_grade text := upper(left(btrim(coalesce(p->>'grade', '')), 20));
begin
  if not public.is_admin() then raise exception 'Only admins can edit travel policy'; end if;
  if v_grade = '' then raise exception 'Band is required'; end if;
  insert into public.policies (grade, rank, label, rail_max_class, road_max_mode, own_vehicle_allowed,
    hotel_cap_a, hotel_cap_b, hotel_cap_c, meal_cap_per_day, notes)
  values (v_grade,
    coalesce((p->>'rank')::int, (select coalesce(max(rank), -1) + 1 from public.policies)),
    coalesce(nullif(btrim(p->>'label'), ''), v_grade),
    coalesce(p->>'rail_max_class', 'sleeper'), coalesce(p->>'road_max_mode', 'public_transport'),
    coalesce((p->>'own_vehicle_allowed')::boolean, false),
    coalesce((p->>'hotel_cap_a')::numeric, 0), coalesce((p->>'hotel_cap_b')::numeric, 0),
    coalesce((p->>'hotel_cap_c')::numeric, 0), coalesce((p->>'meal_cap_per_day')::numeric, 0),
    left(coalesce(p->>'notes', ''), 500))
  on conflict (grade) do update set
    label = excluded.label, rail_max_class = excluded.rail_max_class, road_max_mode = excluded.road_max_mode,
    own_vehicle_allowed = excluded.own_vehicle_allowed, hotel_cap_a = excluded.hotel_cap_a,
    hotel_cap_b = excluded.hotel_cap_b, hotel_cap_c = excluded.hotel_cap_c,
    meal_cap_per_day = excluded.meal_cap_per_day, notes = excluded.notes,
    rank = coalesce(public.policies.rank, excluded.rank);
end;
$$;

create or replace function public.update_settings(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change settings'; end if;
  if p ? 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names where name = p->>'timezone') then
    raise exception 'Unknown timezone %', p->>'timezone';
  end if;
  update public.settings set
    company_name               = coalesce(nullif(btrim(p->>'company_name'), ''), company_name),
    currency                   = coalesce(nullif(btrim(p->>'currency'), ''), currency),
    timezone                   = coalesce(nullif(btrim(p->>'timezone'), ''), timezone),
    allowed_email_domain       = lower(coalesce(btrim(p->>'allowed_email_domain'), allowed_email_domain)),
    domestic_advance_days      = coalesce((p->>'domestic_advance_days')::int, domestic_advance_days),
    international_advance_days = coalesce((p->>'international_advance_days')::int, international_advance_days),
    air_min_surface_hours      = coalesce((p->>'air_min_surface_hours')::numeric, air_min_surface_hours),
    require_approval_all       = coalesce((p->>'require_approval_all')::boolean, require_approval_all),
    laundry_per_day            = coalesce((p->>'laundry_per_day')::numeric, laundry_per_day),
    laundry_from_day           = coalesce((p->>'laundry_from_day')::int, laundry_from_day)
  where id;
end;
$$;

create or replace function public.upsert_city(p_name text, p_category text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_name text := lower(btrim(coalesce(p_name, '')));
begin
  if not public.is_admin() then raise exception 'Only admins can edit city categories'; end if;
  if v_name = '' then raise exception 'City name is required'; end if;
  if p_category = 'C' then
    delete from public.cities where name = v_name;   -- C is the default for any unlisted city
  elsif p_category in ('A', 'B') then
    insert into public.cities (name, category) values (v_name, p_category)
    on conflict (name) do update set category = excluded.category;
  else
    raise exception 'Category must be A, B or C';
  end if;
end;
$$;

-- New signups start in the lowest band until an admin assigns theirs; the very first user is admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_domain text := (select allowed_email_domain from public.settings);
  v_grade  text := coalesce((select grade from public.policies where rank is not null order by rank limit 1), 'L0');
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

-- Assigning a legacy (unranked) grade is not allowed.
create or replace function public.admin_update_profile(p_id uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_manager uuid := nullif(p->>'manager_id', '')::uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can edit users'; end if;
  if p_id = (select auth.uid()) and (coalesce(p->>'role', 'admin') <> 'admin' or not coalesce((p->>'active')::boolean, true)) then
    raise exception 'You cannot remove your own admin access';
  end if;
  if p ? 'grade' and not exists (select 1 from public.policies where grade = p->>'grade' and rank is not null) then
    raise exception 'Unknown band %', p->>'grade';
  end if;
  if v_manager = p_id then raise exception 'A user cannot be their own manager'; end if;
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

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_admin(), public.is_manager_of(uuid), public.can_view_trip(bigint), public.can_approve_trip(bigint),
  public.local_today(), public.city_category(text), public.check_trip(jsonb, jsonb), public.submit_trip(jsonb, jsonb),
  public.decide_trip(bigint, text, text), public.cancel_trip(bigint, text), public.book_trip(bigint, text, text),
  public.upsert_policy(jsonb), public.admin_update_profile(uuid, jsonb), public.update_settings(jsonb),
  public.upsert_city(text, text)
  to authenticated;
