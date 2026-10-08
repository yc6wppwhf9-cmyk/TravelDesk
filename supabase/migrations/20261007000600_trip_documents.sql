-- Ticket / voucher uploads. The travel desk (admins, incl. HR) uploads PDFs or images to a private
-- storage bucket under "<trip id>/..."; everyone who can see the trip can download them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-docs', 'trip-docs', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- "123/abc-ticket.pdf" -> 123 (null if the path doesn't start with a trip id)
create or replace function public.trip_id_from_path(p_name text) returns bigint
language plpgsql immutable set search_path = '' as $$
begin
  return nullif(split_part(p_name, '/', 1), '')::bigint;
exception when others then
  return null;
end;
$$;

create policy "trip members read trip documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'trip-docs' and public.can_view_trip(public.trip_id_from_path(name)));

create policy "travel desk uploads trip documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trip-docs' and public.is_admin()
              and exists (select 1 from public.trips t where t.id = public.trip_id_from_path(name)));

create policy "travel desk removes trip documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trip-docs' and public.is_admin());

create table public.trip_documents (
  id          bigint generated always as identity primary key,
  trip_id     bigint not null references public.trips (id) on delete cascade,
  path        text not null unique,
  file_name   text not null,
  kind        text not null default 'ticket' check (kind in ('ticket', 'hotel', 'visa', 'other')),
  size_bytes  bigint not null default 0,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index trip_documents_trip_idx on public.trip_documents (trip_id);
create index trip_documents_uploaded_by_idx on public.trip_documents (uploaded_by);

alter table public.trip_documents enable row level security;
create policy "read documents of visible trips" on public.trip_documents
  for select to authenticated using (public.can_view_trip(trip_id));
revoke insert, update, truncate on public.trip_documents from anon, authenticated;
revoke all on public.trip_documents from anon;

-- Record an uploaded file (after the storage upload succeeds). Admin only.
create or replace function public.add_trip_document(p_trip_id bigint, p_path text, p_file_name text, p_kind text, p_size bigint)
returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'Only the travel desk can upload documents'; end if;
  if not exists (select 1 from public.trips where id = p_trip_id) then raise exception 'Trip not found'; end if;
  if public.trip_id_from_path(p_path) is distinct from p_trip_id then raise exception 'File path does not belong to this trip'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'trip-docs' and name = p_path) then
    raise exception 'Uploaded file not found';
  end if;
  insert into public.trip_documents (trip_id, path, file_name, kind, size_bytes, uploaded_by)
  values (p_trip_id, p_path, left(coalesce(nullif(btrim(p_file_name), ''), 'document'), 200),
          case when p_kind in ('ticket', 'hotel', 'visa', 'other') then p_kind else 'other' end,
          greatest(coalesce(p_size, 0), 0), (select auth.uid()))
  returning id into v_id;
  insert into public.trip_events (trip_id, user_id, action, comment)
  values (p_trip_id, (select auth.uid()), 'document_added', left(coalesce(p_file_name, ''), 200));
  return v_id;
end;
$$;

-- Remove a document (soft delete: hidden from everyone, kept for audit). Returns the storage path so
-- the client can delete the file itself through the storage API. Admin only.
alter table public.trip_documents add column if not exists removed_at timestamptz;
create policy "hide removed documents" on public.trip_documents
  as restrictive for select to authenticated using (removed_at is null);

create or replace function public.remove_trip_document(p_id bigint) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_doc public.trip_documents;
begin
  if not public.is_admin() then raise exception 'Only the travel desk can remove documents'; end if;
  select * into v_doc from public.trip_documents where id = p_id and removed_at is null;
  if not found then raise exception 'Document not found'; end if;
  update public.trip_documents set removed_at = now() where id = p_id;
  insert into public.trip_events (trip_id, user_id, action, comment)
  values (v_doc.trip_id, (select auth.uid()), 'document_removed', v_doc.file_name);
  return v_doc.path;
end;
$$;

revoke execute on function public.trip_id_from_path(text) from public, anon;
grant execute on function public.trip_id_from_path(text) to authenticated;
revoke execute on function public.add_trip_document(bigint, text, text, text, bigint), public.remove_trip_document(bigint) from public, anon;
grant execute on function public.add_trip_document(bigint, text, text, text, bigint), public.remove_trip_document(bigint) to authenticated;
