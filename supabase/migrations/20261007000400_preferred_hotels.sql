-- Preferred / negotiated hotels per city, maintained by the travel desk and suggested to
-- travellers while they plan a hotel stay. Hotels are deactivated rather than deleted.

create table public.preferred_hotels (
  id                 bigint generated always as identity primary key,
  city               text not null check (city = lower(btrim(city)) and city <> ''),
  name               text not null check (btrim(name) <> ''),
  area               text not null default '',
  rate_per_night     numeric(10,2) not null check (rate_per_night >= 0),
  includes_breakfast boolean not null default false,
  contact            text not null default '',
  booking_url        text not null default '' check (booking_url = '' or booking_url ~* '^https?://'),
  notes              text not null default '',
  active             boolean not null default true,
  updated_at         timestamptz not null default now()
);
create index preferred_hotels_city_idx on public.preferred_hotels (city) where active;

alter table public.preferred_hotels enable row level security;
create policy "signed-in users read preferred hotels" on public.preferred_hotels
  for select to authenticated using (active or public.is_admin());
revoke insert, update, delete, truncate on public.preferred_hotels from anon, authenticated;
revoke all on public.preferred_hotels from anon;

-- Create (no id) or update (with id) a preferred hotel. Admin only.
create function public.upsert_preferred_hotel(p jsonb) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id   bigint := nullif(p->>'id', '')::bigint;
  v_city text := lower(btrim(coalesce(p->>'city', '')));
  v_name text := left(btrim(coalesce(p->>'name', '')), 150);
  v_rate numeric;
  v_url  text := btrim(coalesce(p->>'booking_url', ''));
begin
  if not public.is_admin() then raise exception 'Only the travel desk can edit preferred hotels'; end if;
  if v_city = '' then raise exception 'City is required'; end if;
  if v_name = '' then raise exception 'Hotel name is required'; end if;
  begin
    v_rate := (p->>'rate_per_night')::numeric;
  exception when others then
    raise exception 'Rate per night must be a number';
  end;
  if v_rate is null or v_rate < 0 then raise exception 'Rate per night must be a positive number'; end if;
  if v_url <> '' and v_url !~* '^https?://' then raise exception 'Booking link must start with http:// or https://'; end if;

  if v_id is null then
    insert into public.preferred_hotels (city, name, area, rate_per_night, includes_breakfast, contact, booking_url, notes, active)
    values (v_city, v_name, left(coalesce(p->>'area', ''), 150), v_rate,
            coalesce((p->>'includes_breakfast')::boolean, false), left(coalesce(p->>'contact', ''), 200),
            left(v_url, 500), left(coalesce(p->>'notes', ''), 500), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.preferred_hotels set
      city = v_city, name = v_name, area = left(coalesce(p->>'area', ''), 150), rate_per_night = v_rate,
      includes_breakfast = coalesce((p->>'includes_breakfast')::boolean, false),
      contact = left(coalesce(p->>'contact', ''), 200), booking_url = left(v_url, 500),
      notes = left(coalesce(p->>'notes', ''), 500), active = coalesce((p->>'active')::boolean, true),
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'Hotel not found'; end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.upsert_preferred_hotel(jsonb) from public, anon;
grant execute on function public.upsert_preferred_hotel(jsonb) to authenticated;
