create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'error')),
  raw_llm_response jsonb,
  parsed_expenses jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index tickets_user_id_idx on public.tickets(user_id);
create index tickets_created_at_idx on public.tickets(created_at desc);
create unique index tickets_user_id_storage_path_idx on public.tickets(user_id, storage_path);

grant select, insert, update, delete on public.tickets to authenticated;

alter table public.tickets enable row level security;

drop policy if exists tickets_select_own on public.tickets;
drop policy if exists tickets_insert_own on public.tickets;
drop policy if exists tickets_update_own on public.tickets;
drop policy if exists tickets_delete_own on public.tickets;

create policy tickets_select_own on public.tickets
  for select to authenticated
  using (user_id = auth.uid());

create policy tickets_insert_own on public.tickets
  for insert to authenticated
  with check (user_id = auth.uid());

create policy tickets_update_own on public.tickets
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy tickets_delete_own on public.tickets
  for delete to authenticated
  using (user_id = auth.uid());

comment on table public.tickets is 'Tracks receipt image processing jobs and the extracted draft expenses returned by the LLM pipeline.';
comment on column public.tickets.storage_path is 'Relative path of the uploaded ticket image inside the private Storage bucket.';
comment on column public.tickets.raw_llm_response is 'Full raw JSON response returned by the receipt-processing LLM call.';
comment on column public.tickets.parsed_expenses is 'Normalized array of suggested expense rows extracted from the receipt.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tickets',
  'tickets',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tickets_objects_select_own on storage.objects;
drop policy if exists tickets_objects_insert_own on storage.objects;
drop policy if exists tickets_objects_update_own on storage.objects;
drop policy if exists tickets_objects_delete_own on storage.objects;

create policy tickets_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tickets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy tickets_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tickets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy tickets_objects_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tickets'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'tickets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy tickets_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tickets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );