-- =====================================================================
-- Migration 0013: শুরুর সংখ্যা (সিদ্ধান্ত ২৪ নভেম্বর ২০২৬)
--   * স্থায়ী ঘরগুলোর (জনশক্তি, ইউনিট, মসজিদ, জনসংখ্যা …) শুরুর সংখ্যা প্রতিটি সংগঠন নিজে লেখে।
--   * সংগঠনের প্রথম মাসিক রিপোর্ট একসেপ্ট হলে আটকে যায়; উপরের স্তর "খুলে দিন" দিলে আবার লেখা যায়,
--     পরের রিপোর্ট একসেপ্ট হলে আবার আটকায়।
--   * "মোট জনসংখ্যা" (f004) আটকানো অবস্থাতেও বদলানো যায়।
--   * হিসাব (অ্যাপে): আগের একসেপ্টেড রিপোর্ট না থাকলে "বিগত" = শুরুর সংখ্যা।
--     খুলে দিয়ে পরে ঠিক করলে পার্থক্যটুকু (data − base) পরের মাসের "বিগত" তে যোগ হয়;
--     সেই রিপোর্ট একসেপ্ট হলে base = data (পার্থক্য একবারই যোগ হয়)।
-- =====================================================================

create table if not exists public.opening_numbers (
  org_id      uuid primary key references public.orgs(id),
  data        jsonb not null default '{}'::jsonb,
  base        jsonb,                         -- আটকানোর সময়ের সংখ্যা (পরে ঠিক করলে পার্থক্য বের করার জন্য)
  locked      boolean not null default false,
  unlocked_by uuid,
  unlocked_at timestamptz,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 20000)
);
alter table public.opening_numbers enable row level security;
drop policy if exists opening_read on public.opening_numbers;
create policy opening_read on public.opening_numbers for select to authenticated using (public.can_view_org(org_id));
revoke all on public.opening_numbers from anon, authenticated;
grant select on public.opening_numbers to authenticated;

-- এই সংগঠনের কোনো রিপোর্ট কি একসেপ্ট হয়েছে?
create or replace function public.has_accepted_report(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reports where org_id = p_org and status = 'accepted')
$$;

-- ---------- লেখা: নিজের সংগঠনের সভাপতি/সেক্রেটারি ----------
create or replace function public.save_opening(p_org uuid, p_data jsonb)
returns public.opening_numbers
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); cur public.opening_numbers; k text; v jsonb; res public.opening_numbers;
begin
  if not public.is_member_of(p_org) then raise exception 'অনুমতি নেই'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'তথ্য ঠিক নয়'; end if;
  for k, v in select * from jsonb_each(p_data) loop
    if k !~ '^f[0-9]{3}[a-z]?$' then raise exception 'ঘরের নাম ঠিক নয়: %', k; end if;
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 or (v::text)::numeric > 100000000 then
      raise exception 'সংখ্যা ঠিক নয়: %', k;
    end if;
  end loop;
  select * into cur from public.opening_numbers where org_id = p_org for update;
  if found then
    -- আগে খোলা থাকলেও প্রথম রিপোর্ট একসেপ্ট হয়ে গেলে আটকানো ধরা হয়
    if (cur.locked or (cur.unlocked_by is null and public.has_accepted_report(p_org)))
       and (p_data - 'f004') is distinct from (cur.data - 'f004') then
      raise exception 'শুরুর সংখ্যা আটকানো আছে। বদলাতে উপরের স্তরকে খুলে দিতে বলুন (শুধু জনসংখ্যা বদলানো যায়)।';
    end if;
    update public.opening_numbers set data = p_data, updated_by = u, updated_at = now()
     where org_id = p_org returning * into res;
  else
    if public.has_accepted_report(p_org) and (p_data - 'f004') <> '{}'::jsonb then
      raise exception 'এই সংগঠনের রিপোর্ট আগেই একসেপ্ট হয়েছে, তাই শুরুর সংখ্যা আর লাগে না। বদলাতে উপরের স্তরকে খুলে দিতে বলুন।';
    end if;
    insert into public.opening_numbers (org_id, data, updated_by) values (p_org, p_data, u) returning * into res;
  end if;
  return res;
end $$;
revoke all on function public.save_opening(uuid, jsonb) from public, anon;
grant execute on function public.save_opening(uuid, jsonb) to authenticated;

-- ---------- খুলে দেওয়া: উপরের স্তর (নিজের নয়) ----------
create or replace function public.unlock_opening(p_org uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login();
begin
  if not public.can_manage_org(p_org) then raise exception 'অনুমতি নেই'; end if;
  insert into public.opening_numbers (org_id, data, base, locked, unlocked_by, unlocked_at, updated_by)
  values (p_org, '{}'::jsonb, '{}'::jsonb, false, u, now(), u)
  on conflict (org_id) do update
    set locked = false, unlocked_by = u, unlocked_at = now(),
        base = coalesce(public.opening_numbers.base, public.opening_numbers.data);
end $$;
revoke all on function public.unlock_opening(uuid) from public, anon;
grant execute on function public.unlock_opening(uuid) to authenticated;

-- ---------- রিপোর্ট একসেপ্ট হলে আটকানো ----------
create or replace function public.lock_opening_on_accept() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    update public.opening_numbers
       set locked = true, base = data, unlocked_by = null, unlocked_at = null
     where org_id = new.org_id and (not locked or base is distinct from data);
  end if;
  return new;
end $$;
drop trigger if exists reports_lock_opening on public.reports;
create trigger reports_lock_opening after update of status on public.reports
  for each row execute function public.lock_opening_on_accept();
