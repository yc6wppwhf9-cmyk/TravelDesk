-- Human-readable names for travel classes / modes used in policy messages.
create or replace function public.pretty(p text) returns text
language sql immutable set search_path = '' as $$
  select case coalesce(p, '')
    when 'ac1' then 'First Class / 1AC'
    when 'ac2' then '2AC'
    when 'ac3' then '3AC'
    when 'chair_car' then 'Chair Car'
    when 'sleeper' then 'Sleeper / Second Class'
    when 'second_sitting' then 'Second Sitting'
    when 'public_transport' then 'Public Transport'
    when 'economy_cab' then 'Economy / Shared Cab'
    when 'ac_cab' then 'AC Cab'
    when 'own_vehicle' then 'Own Vehicle'
    else initcap(replace(coalesce(p, ''), '_', ' '))
  end;
$$;
revoke execute on function public.pretty(text) from public, anon, authenticated;
