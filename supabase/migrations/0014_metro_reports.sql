-- =====================================================================
-- Migration 0014: মহানগরের ষান্মাসিক/বার্ষিক রিপোর্ট (সিদ্ধান্ত ২৪–২৫ নভেম্বর ২০২৬)
--   * মহানগর মাসিক রিপোর্ট লেখে না; লেখে ষান্মাসিক-১ (H1: জানুয়ারি–জুন), ষান্মাসিক-২ (H2: জুলাই–ডিসেম্বর)
--     ও বার্ষিক (Y: জানুয়ারি–ডিসেম্বর)।
--   * data = মহানগরের নিজস্ব সংখ্যা (প্রতিটি সারিতে লেখা যায়)। সমন্বিত = নিজস্ব + থানাগুলোর জমা দেওয়া
--     মাসিক রিপোর্টের যোগফল (অ্যাপে হিসাব)। "চূড়ান্ত" করলে সেই মুহূর্তের সমন্বিত মোট extra.totals এ জমা থাকে।
--   * শুধু মহানগরের দায়িত্বশীল (সভাপতি/সেক্রেটারি/অ্যাডমিন) লেখে/চূড়ান্ত করে/আবার খোলে।
-- =====================================================================

create table if not exists public.metro_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  kind         text not null check (kind in ('H1','H2','Y')),
  year         int  not null check (year between 2020 and 2100),
  data         jsonb not null default '{}'::jsonb,
  extra        jsonb not null default '{}'::jsonb,
  status       text not null default 'draft' check (status in ('draft','final')),
  version      int  not null default 1,
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  finalized_by uuid,
  finalized_at timestamptz,
  unique (org_id, kind, year),
  check (pg_column_size(data) < 400000 and pg_column_size(extra) < 800000)
);
alter table public.metro_reports enable row level security;
drop policy if exists metro_reports_read on public.metro_reports;
create policy metro_reports_read on public.metro_reports for select to authenticated using (public.can_view_org(org_id));
revoke all on public.metro_reports from anon, authenticated;
grant select on public.metro_reports to authenticated;

create or replace function public.metro_check_(p_org uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.require_login();
begin
  if not exists (select 1 from public.orgs where id = p_org and level = 'M') then raise exception 'এটি মহানগর নয়'; end if;
  if not public.is_member_of(p_org) then raise exception 'অনুমতি নেই'; end if;
  return u;
end $$;
revoke all on function public.metro_check_(uuid) from public, anon, authenticated;

-- ---------- সংরক্ষণ (খসড়া) ----------
create or replace function public.save_metro_report(p_org uuid, p_kind text, p_year int, p_data jsonb, p_version int default null)
returns public.metro_reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.metro_check_(p_org); cur public.metro_reports; res public.metro_reports;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'তথ্য ঠিক নয়'; end if;
  if p_kind not in ('H1','H2','Y') then raise exception 'রিপোর্টের ধরন ঠিক নয়'; end if;
  select * into cur from public.metro_reports where org_id = p_org and kind = p_kind and year = p_year for update;
  if found then
    if cur.status = 'final' then raise exception 'রিপোর্টটি চূড়ান্ত করা আছে। বদলাতে আগে "আবার খুলুন" চাপুন।'; end if;
    if p_version is not null and p_version <> cur.version then
      raise exception 'অন্য কেউ এর মধ্যে রিপোর্টটি বদলেছেন। পাতা নতুন করে খুলে আবার চেষ্টা করুন।';
    end if;
    update public.metro_reports set data = p_data, version = version + 1, updated_by = u, updated_at = now()
     where id = cur.id returning * into res;
  else
    insert into public.metro_reports (org_id, kind, year, data, updated_by)
    values (p_org, p_kind, p_year, p_data, u) returning * into res;
  end if;
  return res;
end $$;
revoke all on function public.save_metro_report(uuid, text, int, jsonb, int) from public, anon;
grant execute on function public.save_metro_report(uuid, text, int, jsonb, int) to authenticated;

-- ---------- চূড়ান্ত করা (সমন্বিত মোট জমা থাকে) ----------
create or replace function public.finalize_metro_report(p_org uuid, p_kind text, p_year int, p_extra jsonb, p_version int default null)
returns public.metro_reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.metro_check_(p_org); cur public.metro_reports; res public.metro_reports;
begin
  if p_extra is null or jsonb_typeof(p_extra) <> 'object' then raise exception 'তথ্য ঠিক নয়'; end if;
  select * into cur from public.metro_reports where org_id = p_org and kind = p_kind and year = p_year for update;
  if not found then raise exception 'আগে রিপোর্টটি সংরক্ষণ করুন।'; end if;
  if cur.status = 'final' then raise exception 'রিপোর্টটি আগেই চূড়ান্ত করা হয়েছে।'; end if;
  if p_version is not null and p_version <> cur.version then
    raise exception 'অন্য কেউ এর মধ্যে রিপোর্টটি বদলেছেন। পাতা নতুন করে খুলে আবার চেষ্টা করুন।';
  end if;
  update public.metro_reports
     set status = 'final', extra = p_extra, version = version + 1, finalized_by = u, finalized_at = now()
   where id = cur.id returning * into res;
  return res;
end $$;
revoke all on function public.finalize_metro_report(uuid, text, int, jsonb, int) from public, anon;
grant execute on function public.finalize_metro_report(uuid, text, int, jsonb, int) to authenticated;

-- ---------- আবার খোলা ----------
create or replace function public.reopen_metro_report(p_org uuid, p_kind text, p_year int)
returns public.metro_reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.metro_check_(p_org); res public.metro_reports;
begin
  update public.metro_reports set status = 'draft', version = version + 1, updated_by = u, updated_at = now()
   where org_id = p_org and kind = p_kind and year = p_year and status = 'final' returning * into res;
  if res.id is null then raise exception 'চূড়ান্ত করা রিপোর্ট পাওয়া যায়নি।'; end if;
  return res;
end $$;
revoke all on function public.reopen_metro_report(uuid, text, int) from public, anon;
grant execute on function public.reopen_metro_report(uuid, text, int) to authenticated;
