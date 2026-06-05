-- DonatBoss (Supabase) - Schema + RLS + trigger role otomatis
-- Jalankan di Supabase SQL Editor (Project kamu).

-- 0) Extensions
create extension if not exists pgcrypto;

-- 1) TABLES (nama kolom mengikuti app.js: camelCase)

create table if not exists public.investors (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  "persenBagi" numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'mandiri' check (type in ('mandiri','investasi')),
  "investorId" uuid null references public.investors(id) on delete set null,
  workers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  email text,
  role text not null default 'none' check (role in ('owner','worker','investor','none')),
  display_name text,
  "branchId" uuid null references public.branches(id) on delete set null,
  "investorId" uuid null references public.investors(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('owner','worker','investor')),
  "displayName" text,
  "branchId" uuid null references public.branches(id) on delete set null,
  "investorId" uuid null references public.investors(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users on delete set null
);

create table if not exists public."bahanPokok" (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  satuan text not null,
  harga numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public."topingTambahan" (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  gram numeric not null default 0,
  "hargaBahan" numeric not null default 0,
  "hargaJual" numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public."menuVarian" (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  tipe text not null check (tipe in ('satuan','paket','toping')),
  "isiBox" int null,
  "hargaJual" numeric not null default 0,
  "resepBahanPokok" jsonb not null default '[]'::jsonb,
  "resepToping" jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  "branchId" uuid not null references public.branches(id) on delete cascade,
  date date not null,
  ts text,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  "totalHPP" numeric not null default 0,
  edited boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public."pengeluaranLapak" (
  id uuid primary key default gen_random_uuid(),
  "branchId" uuid not null references public.branches(id) on delete cascade,
  "branchName" text,
  date date not null,
  ts text,
  keterangan text not null,
  jumlah numeric not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public."pengeluaranOwner" (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  ts text,
  keterangan text not null,
  jumlah numeric not null default 0,
  kategori text not null default 'lainnya',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public."setoranHarian" (
  id uuid primary key default gen_random_uuid(),
  "branchId" uuid not null references public.branches(id) on delete cascade,
  "branchName" text,
  date date not null,
  ts text,
  status text not null default 'menunggu' check (status in ('belum','menunggu','selesai')),
  omzet numeric not null default 0,
  pengeluaran numeric not null default 0,
  "konfirmasiTs" text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique ("branchId", date)
);

create table if not exists public."setoranBulanan" (
  id uuid primary key default gen_random_uuid(),
  "branchId" uuid not null references public.branches(id) on delete cascade,
  "investorId" uuid not null references public.investors(id) on delete cascade,
  bulan text not null,
  omzet numeric not null default 0,
  modal numeric not null default 0,
  "pLapak" numeric not null default 0,
  "pOwner" numeric not null default 0,
  laba numeric not null default 0,
  "bagianInvestor" numeric not null default 0,
  persen numeric not null default 0,
  status text not null default 'menunggu' check (status in ('menunggu','selesai')),
  ts text,
  "konfirmasiTs" text,
  "confirmedBy" text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique ("branchId", bulan, "investorId")
);

create table if not exists public."editLog" (
  id uuid primary key default gen_random_uuid(),
  ts text,
  "txId" uuid not null references public.transactions(id) on delete cascade,
  "branchId" uuid not null references public.branches(id) on delete cascade,
  "branchName" text,
  alasan text not null,
  "before" jsonb not null default '[]'::jsonb,
  "after" jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- 2) HELPER FUNCTIONS for RLS
create or replace function public.current_role()
returns text
language sql
stable
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

create or replace function public.current_branch_id()
returns uuid
language sql
stable
as $$
  select "branchId" from public.profiles where user_id = auth.uid();
$$;

create or replace function public.current_investor_id()
returns uuid
language sql
stable
as $$
  select "investorId" from public.profiles where user_id = auth.uid();
$$;

-- 3) RLS
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.branches enable row level security;
alter table public.investors enable row level security;
alter table public."bahanPokok" enable row level security;
alter table public."topingTambahan" enable row level security;
alter table public."menuVarian" enable row level security;
alter table public.transactions enable row level security;
alter table public."pengeluaranLapak" enable row level security;
alter table public."pengeluaranOwner" enable row level security;
alter table public."setoranHarian" enable row level security;
alter table public."setoranBulanan" enable row level security;
alter table public."editLog" enable row level security;

-- profiles
drop policy if exists "profiles_select_own_or_owner" on public.profiles;
create policy "profiles_select_own_or_owner"
on public.profiles
for select
using (auth.uid() IS NOT NULL);

drop policy if exists "profiles_update_own_or_owner" on public.profiles;
create policy "profiles_update_own_or_owner"
on public.profiles
for update
using (user_id = auth.uid() or public.current_role() = 'owner')
with check (user_id = auth.uid() or public.current_role() = 'owner');

-- invites (owner only)
drop policy if exists "invites_owner_all" on public.invites;
create policy "invites_owner_all"
on public.invites
for all
using (public.current_role() = 'owner')
with check (public.current_role() = 'owner');

-- master data & branches (read for any role except none; write owner)
drop policy if exists "read_any_authed_branches" on public.branches;
create policy "read_any_authed_branches"
on public.branches for select
using (public.current_role() <> 'none');

drop policy if exists "write_owner_branches" on public.branches;
create policy "write_owner_branches"
on public.branches for insert
with check (public.current_role() = 'owner');
drop policy if exists "update_owner_branches" on public.branches;
create policy "update_owner_branches"
on public.branches for update
using (public.current_role() = 'owner')
with check (public.current_role() = 'owner');
drop policy if exists "delete_owner_branches" on public.branches;
create policy "delete_owner_branches"
on public.branches for delete
using (public.current_role() = 'owner');

drop policy if exists "investors_read_owner_or_self" on public.investors;
create policy "investors_read_owner_or_self"
on public.investors for select
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'investor' and id = public.current_investor_id())
  or public.current_role() = 'worker'
);

drop policy if exists "investors_write_owner" on public.investors;
create policy "investors_write_owner"
on public.investors for all
using (public.current_role() = 'owner')
with check (public.current_role() = 'owner');

-- bahanPokok/topingTambahan/menuVarian (DIUBAH MENJADI MANUAL MENGHINDARI ERROR HURUF BESAR KECIL)
DROP POLICY IF EXISTS "read_any_authed_bahanPokok" ON public."bahanPokok";
CREATE POLICY "read_any_authed_bahanPokok" ON public."bahanPokok" FOR SELECT USING (public.current_role() <> 'none');
DROP POLICY IF EXISTS "write_owner_bahanPokok" ON public."bahanPokok";
CREATE POLICY "write_owner_bahanPokok" ON public."bahanPokok" FOR ALL USING (public.current_role() = 'owner') WITH CHECK (public.current_role() = 'owner');

DROP POLICY IF EXISTS "read_any_authed_topingTambahan" ON public."topingTambahan";
CREATE POLICY "read_any_authed_topingTambahan" ON public."topingTambahan" FOR SELECT USING (public.current_role() <> 'none');
DROP POLICY IF EXISTS "write_owner_topingTambahan" ON public."topingTambahan";
CREATE POLICY "write_owner_topingTambahan" ON public."topingTambahan" FOR ALL USING (public.current_role() = 'owner') WITH CHECK (public.current_role() = 'owner');

DROP POLICY IF EXISTS "read_any_authed_menuVarian" ON public."menuVarian";
CREATE POLICY "read_any_authed_menuVarian" ON public."menuVarian" FOR SELECT USING (public.current_role() <> 'none');
DROP POLICY IF EXISTS "write_owner_menuVarian" ON public."menuVarian";
CREATE POLICY "write_owner_menuVarian" ON public."menuVarian" FOR ALL USING (public.current_role() = 'owner') WITH CHECK (public.current_role() = 'owner');


-- transactions
drop policy if exists "transactions_select" on public.transactions;
create policy "transactions_select"
on public.transactions for select
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
  or (
    public.current_role() = 'investor'
    and exists (
      select 1 from public.branches b
      where b.id = public.transactions."branchId"
        and b."investorId" = public.current_investor_id()
    )
  )
);

drop policy if exists "transactions_insert" on public.transactions;
create policy "transactions_insert"
on public.transactions for insert
with check (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

drop policy if exists "transactions_update" on public.transactions;
create policy "transactions_update"
on public.transactions for update
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
)
with check (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

drop policy if exists "transactions_delete" on public.transactions;
create policy "transactions_delete"
on public.transactions for delete
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

-- pengeluaranLapak
drop policy if exists "pengeluaranLapak_select" on public."pengeluaranLapak";
create policy "pengeluaranLapak_select"
on public."pengeluaranLapak" for select
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
  or (
    public.current_role() = 'investor'
    and exists (
      select 1 from public.branches b
      where b.id = public."pengeluaranLapak"."branchId"
        and b."investorId" = public.current_investor_id()
    )
  )
);

drop policy if exists "pengeluaranLapak_write" on public."pengeluaranLapak";
create policy "pengeluaranLapak_write"
on public."pengeluaranLapak" for all
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
)
with check (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

-- pengeluaranOwner (owner only)
drop policy if exists "pengeluaranOwner_owner_all" on public."pengeluaranOwner";
create policy "pengeluaranOwner_owner_all"
on public."pengeluaranOwner" for all
using (public.current_role() = 'owner')
with check (public.current_role() = 'owner');

-- setoranHarian
drop policy if exists "setoranHarian_select" on public."setoranHarian";
create policy "setoranHarian_select"
on public."setoranHarian" for select
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

drop policy if exists "setoranHarian_insert_worker" on public."setoranHarian";
create policy "setoranHarian_insert_worker"
on public."setoranHarian" for insert
with check (public.current_role() = 'worker' and "branchId" = public.current_branch_id());

drop policy if exists "setoranHarian_update_owner_or_worker" on public."setoranHarian";
create policy "setoranHarian_update_owner_or_worker"
on public."setoranHarian" for update
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
)
with check (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

-- setoranBulanan
drop policy if exists "setoranBulanan_select" on public."setoranBulanan";
create policy "setoranBulanan_select"
on public."setoranBulanan" for select
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'investor' and "investorId" = public.current_investor_id())
);

drop policy if exists "setoranBulanan_insert_owner" on public."setoranBulanan";
create policy "setoranBulanan_insert_owner"
on public."setoranBulanan" for insert
with check (public.current_role() = 'owner');

drop policy if exists "setoranBulanan_update_owner_or_investor" on public."setoranBulanan";
create policy "setoranBulanan_update_owner_or_investor"
on public."setoranBulanan" for update
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'investor' and "investorId" = public.current_investor_id())
)
with check (
  public.current_role() = 'owner'
  or (public.current_role() = 'investor' and "investorId" = public.current_investor_id())
);

-- editLog
drop policy if exists "editLog_select_owner_or_branch" on public."editLog";
create policy "editLog_select_owner_or_branch"
on public."editLog" for select
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

drop policy if exists "editLog_write_owner_or_branch" on public."editLog";
create policy "editLog_write_owner_or_branch"
on public."editLog" for all
using (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
)
with check (
  public.current_role() = 'owner'
  or (public.current_role() = 'worker' and "branchId" = public.current_branch_id())
);

-- 4) Trigger: assign role saat user pertama kali dibuat
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare inv public.invites%rowtype;
begin
  select * into inv from public.invites where lower(email) = lower(new.email) limit 1;

  if not found then
    if not exists (select 1 from public.profiles where role = 'owner') then
      insert into public.profiles (user_id, email, role, display_name)
      values (new.id, lower(new.email), 'owner', split_part(new.email, '@', 1));
    else
      insert into public.profiles (user_id, email, role, display_name)
      values (new.id, lower(new.email), 'none', split_part(new.email, '@', 1));
    end if;
  else
    insert into public.profiles (user_id, email, role, display_name, "branchId", "investorId")
    values (
      new.id,
      lower(new.email),
      inv.role,
      coalesce(inv."displayName", split_part(new.email, '@', 1)),
      inv."branchId",
      inv."investorId"
    );

    delete from public.invites where id = inv.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5) Fungsi Tambahan: Buat dan Hapus Akun dari Aplikasi
CREATE OR REPLACE FUNCTION public.buat_akun_otomatis(
  p_email text, p_password text, p_role text, p_display_name text, p_branch_id uuid, p_investor_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.invites WHERE LOWER(email) = LOWER(p_email);
  INSERT INTO public.invites (email, role, "displayName", "branchId", "investorId")
  VALUES (LOWER(p_email), p_role, p_display_name, p_branch_id, p_investor_id);
  
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', LOWER(p_email), crypt(p_password, gen_salt('bf', 10)), '{"provider":"email","providers":["email"]}', '{}', now(), now());
END;
$$;

CREATE OR REPLACE FUNCTION public.hapus_akun_langsung(target_user_id uuid, target_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM auth.users WHERE id = target_user_id;
  DELETE FROM public.invites WHERE LOWER(email) = LOWER(target_email);
END;
$$;

-- 6) Realtime (optional tapi disarankan)
-- Supabase Realtime membaca perubahan via publication 'supabase_realtime'.
-- Jika perintah di bawah error (hak akses), aktifkan Realtime untuk tabel-tabel ini via Dashboard.
alter publication supabase_realtime add table
  public.branches,
  public.investors,
  public."bahanPokok",
  public."topingTambahan",
  public."menuVarian",
  public.transactions,
  public."pengeluaranLapak",
  public."pengeluaranOwner",
  public."setoranHarian",
  public."setoranBulanan",
  public."editLog";
