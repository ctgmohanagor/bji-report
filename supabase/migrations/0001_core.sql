-- =====================================================================
-- মাসিক রিপোর্ট সিস্টেম — মহানগর সংস্করণ
-- Migration 0001: মূল কাঠামো (সংগঠন, দায়িত্বশীল, নিমন্ত্রণ, রিপোর্ট, ইতিহাস, নিরাপত্তা)
--
-- নিরাপত্তার মূলনীতি:
--   * সব টেবিলে Row Level Security চালু।
--   * অ্যাপ (anon/authenticated) কোনো টেবিলে সরাসরি লিখতে পারে না;
--     সব পরিবর্তন নিচের নিয়ন্ত্রিত ফাংশন (RPC) দিয়ে, যেখানে প্রতিটি নিয়ম যাচাই হয়।
--   * পড়ার সীমা: নিজের সংগঠন ও তার অধীনস্থ; মহানগর শুধু থানা পর্যন্ত।
-- =====================================================================

create schema if not exists extensions;
create extension if not exists ltree    with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- ১. সংগঠন (মহানগর → থানা → ওয়ার্ড → ইউনিট)
-- ---------------------------------------------------------------------
create table public.orgs (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z0-9]{1,32}$'),
  name        text not null check (length(btrim(name)) between 1 and 120),
  level       text not null check (level in ('M','T','W','U')),
  gender      text not null default 'M' check (gender in ('M','F','B')),
  parent_id   uuid references public.orgs(id),
  path        extensions.ltree not null unique,
  active      boolean not null default true,
  start_month date,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  check ((level = 'M') = (parent_id is null))
);
create index orgs_path_gist on public.orgs using gist (path);
create index orgs_parent_idx on public.orgs (parent_id);
comment on table public.orgs is 'সংগঠনের গাছ। path = মহানগর.থানা.ওয়ার্ড.ইউনিট এর কোড।';

create or replace function public.level_rank(l text) returns int
language sql immutable set search_path = public as $$
  select case l when 'M' then 1 when 'T' then 2 when 'W' then 3 when 'U' then 4 end
$$;

-- path নিজে থেকে বসে; স্তরের ক্রম যাচাই হয়; কোড/অভিভাবক/স্তর পরে বদলানো যায় না
create or replace function public.orgs_before_write() returns trigger
language plpgsql set search_path = public, extensions as $$
declare p public.orgs;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code or new.parent_id is distinct from old.parent_id
       or new.level is distinct from old.level then
      raise exception 'সংগঠনের কোড, স্তর বা অভিভাবক বদলানো যায় না';
    end if;
    new.path := old.path;
    return new;
  end if;
  if new.parent_id is null then
    new.path := text2ltree(new.code);
  else
    select * into p from public.orgs where id = new.parent_id;
    if not found then raise exception 'অভিভাবক সংগঠন পাওয়া যায়নি'; end if;
    if not ((new.level = 'T' and p.level = 'M') or (new.level = 'W' and p.level = 'T')
            or (new.level = 'U' and p.level in ('W','T'))) then
      raise exception 'এই স্তরের সংগঠন এই অভিভাবকের অধীনে হতে পারে না';
    end if;
    new.path := p.path || text2ltree(new.code);
  end if;
  return new;
end $$;
create trigger orgs_before_write before insert or update on public.orgs
  for each row execute function public.orgs_before_write();

-- ---------------------------------------------------------------------
-- ২. ব্যবহারকারী প্রোফাইল ও দায়িত্ব
-- ---------------------------------------------------------------------
create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references public.orgs(id),
  role       text not null check (role in ('president','secretary','admin')),
  active     boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  created_by uuid,
  ended_by   uuid
);
-- একটি সংগঠনে একসাথে একজনই সভাপতি, একজনই সেক্রেটারি
create unique index memberships_one_per_role on public.memberships (org_id, role)
  where active and role in ('president','secretary');
create unique index memberships_no_dup on public.memberships (org_id, user_id, role) where active;
create index memberships_user_idx on public.memberships (user_id) where active;

-- অ্যাডমিন শুধু মহানগরে
create or replace function public.memberships_check() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'admin' and (select level from public.orgs where id = new.org_id) <> 'M' then
    raise exception 'অ্যাডমিন শুধু মহানগরে হতে পারে';
  end if;
  return new;
end $$;
create trigger memberships_check before insert or update on public.memberships
  for each row execute function public.memberships_check();

-- প্রথম অ্যাডমিনদের ইমেইল তালিকা: এই ইমেইলে প্রথম লগইন করলেই মহানগর অ্যাডমিন হবেন
create table public.admin_allowlist (
  email text primary key check (email = lower(email))
);

-- ---------------------------------------------------------------------
-- ৩. নিমন্ত্রণ ও যোগদানের অনুরোধ
-- ---------------------------------------------------------------------
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id),
  role        text not null check (role in ('president','secretary')),
  token_hash  text not null unique,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  used_by     uuid,
  revoked_at  timestamptz
);
create index invites_org_idx on public.invites (org_id);

create table public.join_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.orgs(id),
  role        text not null check (role in ('president','secretary')),
  note        text check (length(note) <= 500),
  status      text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at  timestamptz not null default now(),
  decided_by  uuid,
  decided_at  timestamptz
);
create unique index join_requests_one_pending on public.join_requests (user_id) where status = 'pending';

-- ---------------------------------------------------------------------
-- ৪. ফর্মের সংস্করণ ও রিপোর্ট
-- ---------------------------------------------------------------------
create table public.form_versions (
  id          serial primary key,
  label       text not null,
  valid_from  date not null unique,
  fields      jsonb not null,
  created_at  timestamptz not null default now()
);
comment on table public.form_versions is 'প্রতিটি রিপোর্ট জমার সময়ের ফর্ম-সংস্করণ মনে রাখে, যাতে পুরনো রিপোর্ট নিজের ফর্মে দেখায়।';

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id),
  period           date not null check (extract(day from period) = 1),
  form_version_id  int  not null references public.form_versions(id),
  status           text not null default 'draft'
                   check (status in ('draft','submitted','returned','accepted')),
  data             jsonb not null default '{}'::jsonb,
  totals           jsonb,
  version          int  not null default 1,
  return_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  submitted_at     timestamptz,
  submitted_by     uuid,
  reviewed_at      timestamptz,
  reviewed_by      uuid,
  unique (org_id, period)
);
create index reports_period_idx on public.reports (period, status);

-- রিপোর্টের অবস্থার নিয়ম ডেটাবেসেই বাঁধা
create or replace function public.reports_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.period <> old.period then
      raise exception 'রিপোর্টের সংগঠন বা মাস বদলানো যায় না';
    end if;
    if old.status = 'accepted' and new.status = 'accepted'
       and (new.data is distinct from old.data) then
      raise exception 'একসেপ্ট হওয়া রিপোর্ট বদলানো যায় না';
    end if;
    if not (
         (old.status = new.status)
      or (old.status in ('draft','returned') and new.status = 'submitted')
      or (old.status = 'draft'     and new.status = 'accepted')   -- মহানগরের নিজের রিপোর্ট (অভিভাবক নেই)
      or (old.status = 'returned'  and new.status = 'accepted')   -- একই
      or (old.status = 'submitted' and new.status in ('accepted','returned'))
      or (old.status = 'accepted'  and new.status = 'returned')   -- আবার খোলা
    ) then
      raise exception 'অবস্থা % থেকে % এ নেওয়া যায় না', old.status, new.status;
    end if;
    if old.status in ('submitted','accepted') and new.data is distinct from old.data then
      raise exception 'জমা বা একসেপ্ট হওয়া রিপোর্টের তথ্য বদলানো যায় না';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger reports_guard before update on public.reports
  for each row execute function public.reports_guard();

-- ---------------------------------------------------------------------
-- ৫. পরিবর্তনের ইতিহাস (মোছা বা বদলানো যায় না)
-- ---------------------------------------------------------------------
create table public.report_events (
  id         bigserial primary key,
  report_id  uuid not null references public.reports(id),
  org_id     uuid not null,
  period     date not null,
  action     text not null check (action in ('create','save','submit','accept','return','reopen')),
  actor      uuid,
  at         timestamptz not null default now(),
  changes    jsonb,
  note       text
);
create index report_events_report_idx on public.report_events (report_id, at);

create table public.admin_events (
  id       bigserial primary key,
  action   text not null,
  actor    uuid,
  at       timestamptz not null default now(),
  org_id   uuid,
  target   uuid,
  detail   jsonb
);

create or replace function public.block_change() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'ইতিহাস বদলানো বা মোছা যায় না';
end $$;
create trigger report_events_immutable before update or delete on public.report_events
  for each row execute function public.block_change();
create trigger admin_events_immutable before update or delete on public.admin_events
  for each row execute function public.block_change();

-- দুই jsonb এর শীর্ষ-স্তরের পার্থক্য: {key: {"from": .., "to": ..}}
create or replace function public.jsonb_diff(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', a->k, 'to', b->k)), '{}'::jsonb)
  from (select jsonb_object_keys(coalesce(a,'{}')) k
        union select jsonb_object_keys(coalesce(b,'{}'))) keys
  where (a->k) is distinct from (b->k)
$$;

-- ---------------------------------------------------------------------
-- ৬. প্রবেশাধিকারের সহায়ক ফাংশন
-- ---------------------------------------------------------------------
-- আমি কি এই সংগঠন দেখতে পারি? (নিজের ও অধীনস্থ; মহানগর শুধু থানা পর্যন্ত)
create or replace function public.can_view_org(target uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1
    from public.memberships m
    join public.orgs mo on mo.id = m.org_id
    join public.orgs t  on t.id  = target
    where m.user_id = auth.uid() and m.active
      and t.path <@ mo.path
      and (mo.level <> 'M' or t.level in ('M','T'))
  )
$$;

-- আমি কি এই সংগঠনের দায়িত্বশীল?
create or replace function public.is_member_of(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships
                 where user_id = auth.uid() and active and org_id = target)
$$;

-- আমি কি এই সংগঠন সামলাতে পারি? (অধীনস্থ এবং দেখতে পাই)
create or replace function public.can_manage_org(target uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.can_view_org(target) and exists (
    select 1
    from public.memberships m
    join public.orgs mo on mo.id = m.org_id
    join public.orgs t  on t.id  = target
    where m.user_id = auth.uid() and m.active
      and t.path <@ mo.path and t.id <> mo.id
  )
$$;

create or replace function public.is_metro_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m join public.orgs o on o.id = m.org_id
                 where m.user_id = auth.uid() and m.active and m.role = 'admin' and o.level = 'M')
$$;

-- অভিভাবকের এই মাসের রিপোর্ট জমা/একসেপ্ট হয়ে গেলে নিচের স্তরের রিপোর্ট আটকে যায়
create or replace function public.locked_by_parent(p_org uuid, p_period date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orgs o
    join public.reports r on r.org_id = o.parent_id and r.period = p_period
    where o.id = p_org and r.status in ('submitted','accepted')
  )
$$;

create or replace function public.require_login() returns uuid
language plpgsql stable set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'লগইন প্রয়োজন'; end if;
  return u;
end $$;

-- ---------------------------------------------------------------------
-- ৭. নতুন ব্যবহারকারী: প্রোফাইল তৈরি ও প্রথম অ্যাডমিন বসানো
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare metro uuid;
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (user_id) do nothing;

  if exists (select 1 from public.admin_allowlist where email = lower(new.email)) then
    select id into metro from public.orgs where level = 'M' limit 1;
    if metro is not null then
      insert into public.memberships (user_id, org_id, role) values (new.id, metro, 'admin')
      on conflict do nothing;
      insert into public.admin_events (action, actor, org_id, target, detail)
      values ('bootstrap_admin', new.id, metro, new.id, jsonb_build_object('email', lower(new.email)));
    end if;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- ৮. সংগঠন ব্যবস্থাপনার ফাংশন
-- ---------------------------------------------------------------------
create or replace function public.create_org(p_parent uuid, p_name text, p_level text,
                                             p_gender text default null, p_start_month date default null)
returns public.orgs
language plpgsql security definer set search_path = public, extensions as $$
declare
  u uuid := public.require_login();
  par public.orgs; n int; new_code text; prefix text; rec public.orgs;
begin
  select * into par from public.orgs where id = p_parent;
  if not found then raise exception 'অভিভাবক সংগঠন পাওয়া যায়নি'; end if;
  -- অভিভাবক বা তার উপরের কোনো স্তরের দায়িত্বশীল হতে হবে; মহানগর শুধু থানা যোগ করতে পারে
  if not exists (
    select 1 from public.memberships m join public.orgs mo on mo.id = m.org_id
    where m.user_id = u and m.active and par.path <@ mo.path
      and (mo.level <> 'M' or p_level = 'T')) then
    raise exception 'এই সংগঠনের অধীনে নতুন সংগঠন যোগ করার অনুমতি নেই';
  end if;
  prefix := case p_level when 'T' then 't' when 'W' then par.code || 'w' when 'U' then par.code || 'u' end;
  if prefix is null then raise exception 'স্তর ভুল'; end if;
  select coalesce(max((regexp_match(code, '^' || prefix || '(\d+)$'))[1]::int), 0) + 1 into n
    from public.orgs where parent_id = p_parent;
  new_code := prefix || case when p_level = 'U' then n::text else lpad(n::text, 2, '0') end;
  insert into public.orgs (code, name, level, gender, parent_id, start_month, created_by)
  values (new_code, btrim(p_name), p_level, coalesce(p_gender, par.gender, 'M'), p_parent, p_start_month, u)
  returning * into rec;
  insert into public.admin_events (action, actor, org_id, target, detail)
  values ('create_org', u, p_parent, rec.id, jsonb_build_object('code', rec.code, 'name', rec.name));
  return rec;
end $$;

create or replace function public.update_org(p_org uuid, p_name text default null, p_active boolean default null)
returns public.orgs
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); rec public.orgs;
begin
  if not public.can_manage_org(p_org) then raise exception 'অনুমতি নেই'; end if;
  update public.orgs set name = coalesce(nullif(btrim(p_name), ''), name),
                         active = coalesce(p_active, active)
  where id = p_org returning * into rec;
  insert into public.admin_events (action, actor, org_id, target, detail)
  values ('update_org', u, p_org, p_org, jsonb_build_object('name', p_name, 'active', p_active));
  return rec;
end $$;

-- ---------------------------------------------------------------------
-- ৯. নিমন্ত্রণ, যোগদান ও দায়িত্ব থেকে সরানো
-- ---------------------------------------------------------------------
create or replace function public.create_invite(p_org uuid, p_role text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := public.require_login(); tok text;
begin
  if p_role not in ('president','secretary') then raise exception 'পদ ভুল'; end if;
  if not (public.can_manage_org(p_org)
          or (public.is_metro_admin() and (select level from public.orgs where id = p_org) = 'M')) then
    raise exception 'এই সংগঠনে নিমন্ত্রণ পাঠানোর অনুমতি নেই';
  end if;
  if not (select active from public.orgs where id = p_org) then raise exception 'সংগঠনটি নিষ্ক্রিয়'; end if;
  -- একই সংগঠন+পদের আগের অব্যবহৃত নিমন্ত্রণ বাতিল
  update public.invites set revoked_at = now()
   where org_id = p_org and role = p_role and used_at is null and revoked_at is null;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.invites (org_id, role, token_hash, created_by)
  values (p_org, p_role, encode(extensions.digest(tok, 'sha256'), 'hex'), u);
  insert into public.admin_events (action, actor, org_id, detail)
  values ('create_invite', u, p_org, jsonb_build_object('role', p_role));
  return tok;   -- আসল টোকেন একবারই ফেরত আসে; ডেটাবেসে শুধু তার hash থাকে
end $$;

create or replace function public.revoke_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); o uuid;
begin
  select org_id into o from public.invites where id = p_invite;
  if o is null or not (public.can_manage_org(o)
       or (public.is_metro_admin() and (select level from public.orgs where id = o) = 'M')) then
    raise exception 'অনুমতি নেই';
  end if;
  update public.invites set revoked_at = now() where id = p_invite and used_at is null;
end $$;

-- পুরনো দায়িত্বশীল (একই পদে) সরিয়ে নতুনজনকে বসায়
create or replace function public._assign_role(p_user uuid, p_org uuid, p_role text, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.memberships set active = false, ended_at = now(), ended_by = p_actor
   where org_id = p_org and role = p_role and active and user_id <> p_user;
  insert into public.memberships (user_id, org_id, role, created_by)
  values (p_user, p_org, p_role, p_actor)
  on conflict do nothing;
end $$;
revoke all on function public._assign_role(uuid, uuid, text, uuid) from public;

create or replace function public.accept_invite(p_token text) returns public.orgs
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := public.require_login(); inv public.invites; rec public.orgs;
begin
  select * into inv from public.invites
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;
  if not found or inv.revoked_at is not null then raise exception 'নিমন্ত্রণ-লিংকটি সঠিক নয় বা বাতিল হয়েছে'; end if;
  if inv.used_at is not null then raise exception 'এই নিমন্ত্রণ-লিংক আগেই ব্যবহার হয়েছে'; end if;
  if inv.expires_at < now() then raise exception 'নিমন্ত্রণ-লিংকের মেয়াদ শেষ'; end if;
  perform public._assign_role(u, inv.org_id, inv.role, inv.created_by);
  update public.invites set used_at = now(), used_by = u where id = inv.id;
  insert into public.admin_events (action, actor, org_id, target, detail)
  values ('accept_invite', u, inv.org_id, u, jsonb_build_object('role', inv.role));
  select * into rec from public.orgs where id = inv.org_id;
  return rec;
end $$;

create or replace function public.request_join(p_org_code text, p_role text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); o uuid; rid uuid;
begin
  if p_role not in ('president','secretary') then raise exception 'পদ ভুল'; end if;
  select id into o from public.orgs where code = lower(btrim(p_org_code)) and active and level <> 'M';
  if o is null then raise exception 'এই কোডের কোনো সংগঠন নেই'; end if;
  if exists (select 1 from public.join_requests where user_id = u and status = 'pending') then
    raise exception 'আপনার একটি অনুরোধ আগে থেকেই অপেক্ষায় আছে';
  end if;
  insert into public.join_requests (user_id, org_id, role, note) values (u, o, p_role, p_note)
  returning id into rid;
  return rid;
end $$;

create or replace function public.decide_join(p_request uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); r public.join_requests;
begin
  select * into r from public.join_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'অনুরোধটি পাওয়া যায়নি বা আগেই নিষ্পত্তি হয়েছে'; end if;
  if not public.can_manage_org(r.org_id) then raise exception 'অনুমতি নেই'; end if;
  if p_approve then perform public._assign_role(r.user_id, r.org_id, r.role, u); end if;
  update public.join_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = u, decided_at = now() where id = p_request;
  insert into public.admin_events (action, actor, org_id, target, detail)
  values (case when p_approve then 'approve_join' else 'reject_join' end, u, r.org_id, r.user_id,
          jsonb_build_object('role', r.role));
end $$;

create or replace function public.remove_member(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); m public.memberships;
begin
  select * into m from public.memberships where id = p_membership and active;
  if not found then raise exception 'দায়িত্ব পাওয়া যায়নি'; end if;
  if m.role = 'admin' then
    if not public.is_metro_admin() or m.user_id = u then raise exception 'অনুমতি নেই'; end if;
  elsif not (public.can_manage_org(m.org_id)
             or (public.is_metro_admin() and (select level from public.orgs where id = m.org_id) = 'M')) then
    raise exception 'অনুমতি নেই';
  end if;
  update public.memberships set active = false, ended_at = now(), ended_by = u where id = p_membership;
  insert into public.admin_events (action, actor, org_id, target, detail)
  values ('remove_member', u, m.org_id, m.user_id, jsonb_build_object('role', m.role));
end $$;

-- ---------------------------------------------------------------------
-- ১০. রিপোর্টের ফাংশন: সংরক্ষণ, জমা, একসেপ্ট/ফেরত, আবার খোলা
-- ---------------------------------------------------------------------
create or replace function public.save_report(p_org uuid, p_period date, p_data jsonb,
                                              p_expected_version int default null)
returns public.reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); r public.reports; fv int; per date := date_trunc('month', p_period)::date;
begin
  if not public.is_member_of(p_org) then raise exception 'শুধু নিজের সংগঠনের রিপোর্ট লেখা যায়'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'তথ্যের গঠন ভুল'; end if;
  if public.locked_by_parent(p_org, per) then raise exception 'উপরের স্তর এই মাসের রিপোর্ট জমা দিয়ে ফেলেছে; এখন বদলানো যাবে না'; end if;

  select * into r from public.reports where org_id = p_org and period = per for update;
  if not found then
    select id into fv from public.form_versions where valid_from <= per order by valid_from desc limit 1;
    if fv is null then raise exception 'এই মাসের জন্য কোনো ফর্ম-সংস্করণ নেই'; end if;
    insert into public.reports (org_id, period, form_version_id, data, updated_by)
    values (p_org, per, fv, p_data, u) returning * into r;
    insert into public.report_events (report_id, org_id, period, action, actor, changes)
    values (r.id, p_org, per, 'create', u, public.jsonb_diff('{}', p_data));
    return r;
  end if;

  if r.status not in ('draft','returned') then raise exception 'জমা বা একসেপ্ট হওয়া রিপোর্ট বদলানো যায় না'; end if;
  if p_expected_version is not null and p_expected_version <> r.version then
    raise exception 'অন্য কেউ এর মধ্যে রিপোর্টটি বদলেছেন; পাতা নতুন করে খুলুন';
  end if;
  insert into public.report_events (report_id, org_id, period, action, actor, changes)
  values (r.id, p_org, per, 'save', u, public.jsonb_diff(r.data, p_data));
  update public.reports set data = p_data, version = version + 1, updated_by = u
   where id = r.id returning * into r;
  return r;
end $$;

create or replace function public.submit_report(p_report uuid, p_expected_version int default null)
returns public.reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); r public.reports; has_parent boolean;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or not public.is_member_of(r.org_id) then raise exception 'অনুমতি নেই'; end if;
  if r.status not in ('draft','returned') then raise exception 'রিপোর্টটি আগেই জমা হয়েছে'; end if;
  if p_expected_version is not null and p_expected_version <> r.version then
    raise exception 'অন্য কেউ এর মধ্যে রিপোর্টটি বদলেছেন; পাতা নতুন করে খুলুন';
  end if;
  if public.locked_by_parent(r.org_id, r.period) then raise exception 'উপরের স্তর এই মাসের রিপোর্ট জমা দিয়ে ফেলেছে'; end if;
  select parent_id is not null into has_parent from public.orgs where id = r.org_id;

  update public.reports set
     status = case when has_parent then 'submitted' else 'accepted' end,
     submitted_at = now(), submitted_by = u, return_note = null,
     reviewed_at = case when has_parent then null else now() end,
     reviewed_by = case when has_parent then null else u end,
     version = version + 1, updated_by = u
   where id = p_report returning * into r;
  insert into public.report_events (report_id, org_id, period, action, actor)
  values (r.id, r.org_id, r.period, 'submit', u);
  return r;
end $$;

create or replace function public.review_report(p_report uuid, p_accept boolean, p_note text default null)
returns public.reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); r public.reports; par uuid;
begin
  select * into r from public.reports where id = p_report for update;
  -- দেখার অধিকার না থাকলে রিপোর্টের অস্তিত্বও জানানো হয় না
  if not found or not public.can_view_org(r.org_id) then raise exception 'রিপোর্ট পাওয়া যায়নি'; end if;
  select parent_id into par from public.orgs where id = r.org_id;
  if par is null or not public.is_member_of(par) then
    raise exception 'শুধু সরাসরি উপরের স্তর একসেপ্ট বা ফেরত দিতে পারে';
  end if;
  if r.status <> 'submitted' then raise exception 'শুধু জমা হওয়া রিপোর্ট একসেপ্ট বা ফেরত দেওয়া যায়'; end if;
  if not p_accept and coalesce(btrim(p_note), '') = '' then raise exception 'ফেরত দেওয়ার কারণ লিখুন'; end if;
  if exists (select 1 from public.reports where org_id = par and period = r.period and status in ('submitted','accepted')) then
    raise exception 'নিজের এই মাসের রিপোর্ট জমা দেওয়ার পর নিচের রিপোর্ট বদলানো যায় না';
  end if;
  update public.reports set status = case when p_accept then 'accepted' else 'returned' end,
         reviewed_at = now(), reviewed_by = u,
         return_note = case when p_accept then null else btrim(p_note) end,
         version = version + 1
   where id = p_report returning * into r;
  insert into public.report_events (report_id, org_id, period, action, actor, note)
  values (r.id, r.org_id, r.period, case when p_accept then 'accept' else 'return' end, u, p_note);
  return r;
end $$;

-- একসেপ্ট হওয়া রিপোর্ট আবার খোলা: সরাসরি উপরের স্তর (নিজের রিপোর্ট জমার আগে) বা মহানগর অ্যাডমিন
create or replace function public.reopen_report(p_report uuid, p_note text) returns public.reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); r public.reports; par uuid; ok boolean;
begin
  select * into r from public.reports where id = p_report for update;
  -- দেখার অধিকার না থাকলে রিপোর্টের অস্তিত্বও জানানো হয় না
  if not found or not public.can_view_org(r.org_id) then raise exception 'রিপোর্ট পাওয়া যায়নি'; end if;
  if r.status <> 'accepted' then raise exception 'শুধু একসেপ্ট হওয়া রিপোর্ট আবার খোলা যায়'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'আবার খোলার কারণ লিখুন'; end if;
  select parent_id into par from public.orgs where id = r.org_id;
  ok := (par is not null and public.is_member_of(par)
         and not exists (select 1 from public.reports where org_id = par and period = r.period
                         and status in ('submitted','accepted')))
        or (public.is_metro_admin() and public.can_view_org(r.org_id)
            and not public.locked_by_parent(r.org_id, r.period));
  if not ok then raise exception 'অনুমতি নেই'; end if;
  update public.reports set status = 'returned', return_note = btrim(p_note),
         reviewed_at = now(), reviewed_by = u, version = version + 1
   where id = p_report returning * into r;
  insert into public.report_events (report_id, org_id, period, action, actor, note)
  values (r.id, r.org_id, r.period, 'reopen', u, p_note);
  return r;
end $$;

-- ---------------------------------------------------------------------
-- ১১. Row Level Security: কে কী পড়তে পারে
-- ---------------------------------------------------------------------
alter table public.orgs            enable row level security;
alter table public.profiles        enable row level security;
alter table public.memberships     enable row level security;
alter table public.admin_allowlist enable row level security;
alter table public.invites         enable row level security;
alter table public.join_requests   enable row level security;
alter table public.form_versions   enable row level security;
alter table public.reports         enable row level security;
alter table public.report_events   enable row level security;
alter table public.admin_events    enable row level security;

create policy orgs_read on public.orgs for select to authenticated
  using (public.can_view_org(id));

create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.memberships m where m.user_id = profiles.user_id and m.active
      and public.can_view_org(m.org_id)));

create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.can_view_org(org_id));

create policy invites_read on public.invites for select to authenticated
  using (public.can_manage_org(org_id)
         or (public.is_metro_admin() and (select level from public.orgs where id = org_id) = 'M'));

create policy join_requests_read on public.join_requests for select to authenticated
  using (user_id = auth.uid() or public.can_manage_org(org_id));

create policy form_versions_read on public.form_versions for select to authenticated
  using (true);

-- খসড়া শুধু নিজের সংগঠন দেখে; জমা হলে উপরের স্তরও দেখে
create policy reports_read on public.reports for select to authenticated
  using (public.can_view_org(org_id) and (status <> 'draft' or public.is_member_of(org_id)));

create policy report_events_read on public.report_events for select to authenticated
  using (exists (select 1 from public.reports r where r.id = report_events.report_id));

create policy admin_events_read on public.admin_events for select to authenticated
  using (public.is_metro_admin() or (org_id is not null and public.can_manage_org(org_id))
         or (org_id is not null and public.is_member_of(org_id)));

-- admin_allowlist: কোনো policy নেই, অর্থাৎ অ্যাপ থেকে পড়া/লেখা পুরো বন্ধ

-- ---------------------------------------------------------------------
-- ১২. অনুমতি (grant): টেবিলে সরাসরি লেখা বন্ধ, শুধু ফাংশন চালানো যাবে
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.orgs, public.profiles, public.memberships,
                public.join_requests, public.form_versions, public.reports,
                public.report_events, public.admin_events to authenticated;
-- নিমন্ত্রণ: টোকেনের hash ছাড়া বাকি কলাম
grant select (id, org_id, role, created_by, created_at, expires_at, used_at, used_by, revoked_at)
  on public.invites to authenticated;

grant execute on function
  public.can_view_org(uuid), public.is_member_of(uuid), public.can_manage_org(uuid),
  public.is_metro_admin(), public.locked_by_parent(uuid, date),
  public.create_org(uuid, text, text, text, date), public.update_org(uuid, text, boolean),
  public.create_invite(uuid, text), public.revoke_invite(uuid), public.accept_invite(text),
  public.request_join(text, text, text), public.decide_join(uuid, boolean), public.remove_member(uuid),
  public.save_report(uuid, date, jsonb, int), public.submit_report(uuid, int),
  public.review_report(uuid, boolean, text), public.reopen_report(uuid, text)
to authenticated;

-- ভবিষ্যতে তৈরি টেবিল/ফাংশনে নিজে থেকে অনুমতি না যায়
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
