-- Distance-aware air eligibility and group-trip policy evaluation.

create or replace function public.place_key(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(coalesce(p, ''), '\s*\(.*\)\s*', ' ', 'g')));
$$;

-- Estimated rail/road journey time in hours between two known places (null if either is unknown):
-- straight-line distance x road_factor / average surface speed, both tunable in settings.
create or replace function public.surface_hours(p_from text, p_to text) returns numeric
language sql stable security definer set search_path = '' as $$
  select round((2 * 6371 * asin(sqrt(
            power(sin(radians(b.lat - a.lat) / 2), 2)
            + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lon - a.lon) / 2), 2)
         )) * s.road_factor / s.surface_speed_kmph)::numeric, 1)
  from public.places a, public.places b, public.settings s
  where a.name = public.place_key(p_from) and b.name = public.place_key(p_to);
$$;

-- Policy check for one band. Hotel caps are per room per night (cost / nights / rooms).
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
  v_est        numeric;
  v_nights     int;
  v_rooms      int;
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

    -- 5.1.1 Air only when the surface journey is above the threshold. A distance estimate
    -- between known cities wins over the traveller's own figure.
    if v_type = 'flight' and not v_intl then
      v_est := public.surface_hours(v_seg->>'from_loc', v_seg->>'to_loc');
      if v_est is not null and v_est <= s.air_min_surface_hours then
        v_violations := v_violations || jsonb_build_object('code', 'AIR_ELIGIBILITY', 'message',
          format('%s: %s → %s is about %s h by rail/road (estimated from distance); air travel is allowed only above %s h',
                 v_label, v_seg->>'from_loc', v_seg->>'to_loc', v_est, s.air_min_surface_hours));
      elsif v_est is null and v_hours is not null and v_hours <= s.air_min_surface_hours then
        v_violations := v_violations || jsonb_build_object('code', 'AIR_ELIGIBILITY', 'message',
          format('%s: air travel is allowed only when the rail/road journey exceeds %s hours (entered %s h)',
                 v_label, s.air_min_surface_hours, v_hours));
      end if;
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

    -- 6.2 Accommodation, per room per night
    if v_type = 'hotel' then
      if v_start is not null and v_start = v_end then
        v_violations := v_violations || jsonb_build_object('code', 'SINGLE_DAY_HOTEL', 'message',
          format('%s: no accommodation is provided for single-day travel', v_label));
      end if;
      v_nights := greatest(1, coalesce(
        public.try_date(v_seg->>'end_date') - public.try_date(v_seg->>'start_date'), 1));
      v_rooms := greatest(1, coalesce(nullif(v_seg->>'rooms', '')::int, 1));
      v_per_night := v_cost / v_nights / v_rooms;
      if v_intl then
        v_hotels := v_hotels || jsonb_build_object('item', v_i, 'city', v_seg->>'to_loc', 'rooms', v_rooms,
          'category', null, 'cap', null, 'nights', v_nights, 'per_night', round(v_per_night));
      else
        v_cat := public.city_category(v_seg->>'to_loc');
        v_cap := case v_cat when 'A' then p_policy.hotel_cap_a when 'B' then p_policy.hotel_cap_b
                 else p_policy.hotel_cap_c end;
        v_hotels := v_hotels || jsonb_build_object('item', v_i, 'city', v_seg->>'to_loc', 'rooms', v_rooms,
          'category', v_cat, 'cap', v_cap, 'nights', v_nights, 'per_night', round(v_per_night));
        if v_per_night > v_cap then
          v_violations := v_violations || jsonb_build_object('code', 'HOTEL_CAP', 'message',
            format('%s: %s/night per room in %s (category %s) exceeds the band %s cap of %s/night', v_label,
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

-- Evaluates a trip for the organiser plus everyone in p_trip->'traveller_ids'. Each band is
-- checked once; band-specific exceptions are prefixed with the travellers they apply to.
create or replace function public.evaluate_group(p_uid uuid, p_trip jsonb, p_segments jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids    uuid[];
  v_n      int;
  v_today  date := public.local_today();
  v_pol    public.policies;
  v_base   jsonb;
  v_r      jsonb;
  v_v      jsonb;
  v_viol   jsonb := '[]';
  v_seen   text[] := '{}';
  v_reason jsonb := '[]';
  v_names  text;
  rec      record;
begin
  begin
    select array_agg(distinct x) into v_ids from (
      select p_uid as x
      union all
      select e::uuid from jsonb_array_elements_text(coalesce(p_trip->'traveller_ids', '[]')) e
    ) q;
  exception when others then
    raise exception 'Invalid traveller list';
  end;
  select array_agg(id) into v_ids from public.profiles where id = any(v_ids);
  v_n := coalesce(cardinality(v_ids), 0);

  select p.* into v_pol from public.policies p join public.profiles u on u.grade = p.grade where u.id = p_uid;
  if v_pol.rank is null then raise exception 'No travel policy configured for your band'; end if;
  v_base := public.evaluate_trip(v_pol, p_trip, p_segments, v_today);

  for rec in
    select u.grade, string_agg(u.full_name, ', ' order by u.full_name) as names
    from public.profiles u
    where u.id = any(v_ids)
    group by u.grade
  loop
    select * into v_pol from public.policies where grade = rec.grade;
    if v_pol.rank is null then
      raise exception 'No travel policy configured for band % (%)', rec.grade, rec.names;
    end if;
    v_r := public.evaluate_trip(v_pol, p_trip, p_segments, v_today);
    for v_v in select value from jsonb_array_elements(v_r->'violations') loop
      if v_v->>'code' in ('AIR_ELIGIBILITY', 'SINGLE_DAY_HOTEL') or v_n = 1 then
        if not (v_v->>'message' = any(v_seen)) then
          v_seen := v_seen || (v_v->>'message');
          v_viol := v_viol || v_v;
        end if;
      else
        v_viol := v_viol || jsonb_build_object('code', v_v->>'code',
          'message', format('%s (%s): %s', rec.names, rec.grade, v_v->>'message'));
      end if;
    end loop;
  end loop;

  select string_agg(full_name, ', ' order by full_name) into v_names from public.profiles where id = any(v_ids);

  -- Rebuild approval reasons with the group-wide exception count.
  select coalesce(jsonb_agg(r), '[]') into v_reason
  from jsonb_array_elements(v_base->'reasons') r
  where r #>> '{}' not like '% policy exception(s)';
  if v_n > 1 then
    v_reason := v_reason || to_jsonb(format('Group trip: %s travellers (%s)', v_n, v_names));
  end if;
  if jsonb_array_length(v_viol) > 0 then
    v_reason := v_reason || to_jsonb(format('%s policy exception(s)', jsonb_array_length(v_viol)));
  end if;

  return v_base || jsonb_build_object(
    'violations', v_viol,
    'reasons', v_reason,
    'traveller_ids', to_jsonb(v_ids),
    'traveller_count', v_n,
    'traveller_names', v_names,
    'needs_justification', (v_base->>'short_notice')::boolean or jsonb_array_length(v_viol) > 0,
    'requires_approval', (v_base->>'requires_approval')::boolean or jsonb_array_length(v_viol) > 0
  );
end;
$$;

create or replace function public.check_trip(p_trip jsonb, p_segments jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Please sign in'; end if;
  return public.evaluate_group((select auth.uid()), p_trip, p_segments);
end;
$$;

create or replace function public.submit_trip(p_trip jsonb, p_segments jsonb) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_today   date := public.local_today();
  v_title   text := left(btrim(coalesce(p_trip->>'title', '')), 120);
  v_purpose text := left(btrim(coalesce(p_trip->>'purpose', '')), 1000);
  v_dest    text := left(btrim(coalesce(p_trip->>'destination', '')), 120);
  v_origin  text := left(btrim(coalesce(p_trip->>'origin', '')), 120);
  v_start   date := public.try_date(p_trip->>'start_date');
  v_end     date := public.try_date(p_trip->>'end_date');
  v_urgent  boolean;
  v_intl    boolean;
  v_ureason text := left(btrim(coalesce(p_trip->>'urgency_reason', '')), 1000);
  v_just    text := left(btrim(coalesce(p_trip->>'justification', '')), 1000);
  v_others  uuid[];
  v_bad     text;
  v_result  jsonb;
  v_id      bigint;
  v_seg     jsonb;
  v_i       int := 0;
  v_s_start date;
  v_s_end   date;
  v_cost    numeric;
  v_hours   numeric;
  v_rooms   int;
begin
  if v_uid is null then raise exception 'Please sign in'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and active) then
    raise exception 'Your account is inactive';
  end if;
  begin
    v_urgent := coalesce((p_trip->>'is_urgent')::boolean, false);
    v_intl := coalesce((p_trip->>'is_international')::boolean, false);
    select coalesce(array_agg(distinct e::uuid), '{}') into v_others
    from jsonb_array_elements_text(coalesce(p_trip->'traveller_ids', '[]')) e
    where e::uuid <> v_uid;
  exception when others then
    raise exception 'Invalid trip details';
  end;
  if cardinality(v_others) > 20 then raise exception 'A group trip can have at most 21 travellers'; end if;
  select string_agg(x::text, ', ') into v_bad
  from unnest(v_others) x
  where not exists (select 1 from public.profiles p where p.id = x and p.active);
  if v_bad is not null then raise exception 'Some co-travellers are not active employees'; end if;

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
      v_rooms := coalesce(nullif(v_seg->>'rooms', '')::int, 1);
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
    if v_seg->>'type' = 'hotel' and (v_rooms < 1 or v_rooms > 50) then
      raise exception 'Item %: rooms must be between 1 and 50', v_i;
    end if;
    if v_seg->>'type' = 'flight' and not v_intl and v_hours is null
       and public.surface_hours(v_seg->>'from_loc', v_seg->>'to_loc') is null then
      raise exception 'Item %: enter the rail/road journey time so air eligibility can be checked', v_i;
    end if;
    if v_s_end < v_s_start then raise exception 'Item %: end date is before start date', v_i; end if;
    if v_s_start < v_start or coalesce(v_s_end, v_s_start) > v_end then
      raise exception 'Item %: dates must fall within the trip dates', v_i;
    end if;
    if v_cost < 0 then raise exception 'Item %: cost cannot be negative', v_i; end if;
    if v_hours < 0 then raise exception 'Item %: journey time cannot be negative', v_i; end if;
  end loop;

  v_result := public.evaluate_group(v_uid, p_trip, p_segments);
  if (v_result->>'needs_justification')::boolean and v_just = '' then
    raise exception 'This trip is short-notice or outside policy. Please add a justification for special approval.';
  end if;

  insert into public.trips (user_id, title, purpose, destination, origin, start_date, end_date, is_urgent,
    is_international, urgency_reason, justification, total_estimate, violations, approval_reasons,
    requires_approval, status)
  values (v_uid, v_title, v_purpose, v_dest, v_origin, v_start, v_end, (v_result->>'urgent')::boolean, v_intl,
    v_ureason, v_just, (v_result->>'total')::numeric, v_result->'violations', v_result->'reasons',
    (v_result->>'requires_approval')::boolean,
    case when (v_result->>'requires_approval')::boolean then 'pending_approval' else 'approved' end::public.trip_status)
  returning id into v_id;

  insert into public.trip_travellers (trip_id, user_id)
  select v_id, x from unnest(array_append(v_others, v_uid)) x
  on conflict do nothing;

  insert into public.trip_segments (trip_id, position, type, from_loc, to_loc, start_date, end_date,
    travel_class, est_cost, duration_hours, city_category, rooms, notes)
  select v_id, s.ord - 1, s.value->>'type',
         left(coalesce(s.value->>'from_loc', ''), 120), left(coalesce(s.value->>'to_loc', ''), 120),
         (s.value->>'start_date')::date, public.try_date(nullif(s.value->>'end_date', '')),
         left(coalesce(s.value->>'travel_class', ''), 30),
         coalesce(nullif(s.value->>'est_cost', '')::numeric, 0),
         coalesce(nullif(s.value->>'duration_hours', '')::numeric,
                  case when s.value->>'type' = 'flight' then public.surface_hours(s.value->>'from_loc', s.value->>'to_loc') end),
         case when s.value->>'type' = 'hotel' and not v_intl then public.city_category(s.value->>'to_loc') end,
         case when s.value->>'type' = 'hotel' then coalesce(nullif(s.value->>'rooms', '')::int, 1) else 1 end,
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
    laundry_from_day           = coalesce((p->>'laundry_from_day')::int, laundry_from_day),
    surface_speed_kmph         = coalesce((p->>'surface_speed_kmph')::numeric, surface_speed_kmph),
    road_factor                = coalesce((p->>'road_factor')::numeric, road_factor)
  where id;
end;
$$;

-- Add or move a town on the map (admin). Used for distance estimates and nearest airports.
create or replace function public.upsert_place(p_name text, p_lat double precision, p_lon double precision, p_state text default '')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_name text := public.place_key(p_name);
begin
  if not public.is_admin() then raise exception 'Only admins can edit places'; end if;
  if v_name = '' then raise exception 'Place name is required'; end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Valid latitude and longitude are required';
  end if;
  insert into public.places (name, lat, lon, state) values (v_name, p_lat, p_lon, left(coalesce(p_state, ''), 60))
  on conflict (name) do update set lat = excluded.lat, lon = excluded.lon, state = excluded.state;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_admin(), public.is_manager_of(uuid), public.can_view_trip(bigint), public.can_approve_trip(bigint),
  public.is_trip_member(bigint), public.local_today(), public.city_category(text), public.surface_hours(text, text),
  public.check_trip(jsonb, jsonb), public.submit_trip(jsonb, jsonb),
  public.decide_trip(bigint, text, text), public.cancel_trip(bigint, text), public.book_trip(bigint, text, text),
  public.upsert_policy(jsonb), public.admin_update_profile(uuid, jsonb), public.update_settings(jsonb),
  public.upsert_city(text, text), public.upsert_preferred_hotel(jsonb),
  public.upsert_place(text, double precision, double precision, text)
  to authenticated;
