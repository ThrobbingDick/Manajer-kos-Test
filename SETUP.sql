-- ═══════════════════════════════════════════════════════════════
-- KosManager Pro v3 - Supabase Schema Setup
-- AMAN dijalankan berkali-kali (pakai DROP IF EXISTS)
-- ═══════════════════════════════════════════════════════════════

-- 1. Tabel data utama
create table if not exists km_data (
  id          bigserial primary key,
  user_id     uuid references auth.users not null,
  key         text not null,
  value       jsonb not null default '[]',
  updated_at  timestamptz default now(),
  constraint  km_data_user_key unique(user_id, key)
);
alter table km_data enable row level security;

drop policy if exists "Users manage own data" on km_data;
create policy "Users manage own data" on km_data for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Auto-update timestamp
create or replace function update_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists km_data_updated_at on km_data;
create trigger km_data_updated_at before update on km_data
  for each row execute function update_updated_at();

-- 3. Storage bucket untuk foto kamar
insert into storage.buckets (id, name, public)
  values ('km-photos', 'km-photos', true)
  on conflict (id) do nothing;

drop policy if exists "Authenticated users upload photos" on storage.objects;
create policy "Authenticated users upload photos" on storage.objects
  for insert with check (bucket_id = 'km-photos' and auth.role() = 'authenticated');

drop policy if exists "Public read photos" on storage.objects;
create policy "Public read photos" on storage.objects
  for select using (bucket_id = 'km-photos');

drop policy if exists "Users delete own photos" on storage.objects;
create policy "Users delete own photos" on storage.objects
  for delete using (bucket_id = 'km-photos' and auth.uid() is not null);
