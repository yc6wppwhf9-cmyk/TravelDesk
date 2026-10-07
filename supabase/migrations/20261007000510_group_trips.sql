-- Group trips: one booking covers several employees, approved once by the organiser's manager;
-- each traveller's band is still checked. Adds trips.origin and per-room hotel pricing.

alter table public.trips add column if not exists origin text not null default '';
alter table public.trip_segments
  add column if not exists rooms integer not null default 1 check (rooms between 1 and 50);

create table if not exists public.trip_travellers (
  trip_id bigint not null references public.trips (id) on delete cascade,
  user_id uuid   not null references public.profiles (id) on delete cascade,
  primary key (trip_id, user_id)
);
create index if not exists trip_travellers_user_idx on public.trip_travellers (user_id);
alter table public.trip_travellers enable row level security;
revoke insert, update, delete, truncate on public.trip_travellers from anon, authenticated;
revoke all on public.trip_travellers from anon;

-- Existing trips: the organiser is the only traveller.
insert into public.trip_travellers (trip_id, user_id)
select id, user_id from public.trips
on conflict do nothing;

-- Is the caller a traveller on this trip, or the manager of one?
create or replace function public.is_trip_member(p_trip bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_travellers tt
    where tt.trip_id = p_trip
      and (tt.user_id = (select auth.uid()) or public.is_manager_of(tt.user_id))
  );
$$;

create policy "co-travellers and their managers read trips" on public.trips
  for select to authenticated using (public.is_trip_member(id));

create or replace function public.can_view_trip(p_trip bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip
      and (t.user_id = (select auth.uid()) or public.is_manager_of(t.user_id) or public.is_admin()
           or public.is_trip_member(t.id))
  );
$$;

create policy "read travellers of visible trips" on public.trip_travellers
  for select to authenticated using (public.can_view_trip(trip_id));

-- The organiser's manager approves once for the whole group; a traveller never approves.
create or replace function public.can_approve_trip(p_trip bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.trips t
    join public.profiles u on u.id = t.user_id
    left join public.profiles m on m.id = u.manager_id and m.active
    where t.id = p_trip
      and t.user_id <> (select auth.uid())
      and not exists (select 1 from public.trip_travellers tt where tt.trip_id = t.id and tt.user_id = (select auth.uid()))
      and (m.id = (select auth.uid()) or (m.id is null and public.is_admin()))
  );
$$;

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
       t.is_international,
       t.origin,
       coalesce(g.ids, array[t.user_id]) as traveller_ids,
       coalesce(g.names, u.full_name)    as traveller_names,
       coalesce(g.n, 1)                  as traveller_count
from public.trips t
join public.profiles u on u.id = t.user_id
left join public.profiles m on m.id = u.manager_id
left join public.profiles a on a.id = t.approver_id
left join lateral (
  select array_agg(tt.user_id order by p.full_name) as ids,
         string_agg(p.full_name, ', ' order by p.full_name) as names,
         count(*)::int as n
  from public.trip_travellers tt join public.profiles p on p.id = tt.user_id
  where tt.trip_id = t.id
) g on true;

grant execute on function public.is_trip_member(bigint) to authenticated;
