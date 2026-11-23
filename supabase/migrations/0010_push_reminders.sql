-- =====================================================================
-- Migration 0010: ফোনে রিমাইন্ডার (Web Push)
--   * push_subscriptions : কোন ব্যবহারকারীর কোন ফোনে নোটিফিকেশন যাবে (প্রত্যেকে শুধু নিজেরটা)
--   * push_queue         : পাঠানোর অপেক্ষায় থাকা নোটিফিকেশন (শুধু সার্ভার-ফাংশন পড়ে/পাঠায়)
--   * reminder_log       : কবে কে কাকে রিমাইন্ডার পাঠাল
--   নিয়ম (২৩ নভেম্বর ২০২৬): যারা আগের মাসের রিপোর্ট জমা দিয়ে ফেলেছে, তারা পাবে না।
--     ৫ তারিখ: থানার পক্ষ থেকে ওয়ার্ডগুলোকে; ১৫ তারিখ: মহানগরের পক্ষ থেকে থানাগুলোকে (সময়সূচি 0011 এ)।
--     উপরের স্তর যেকোনো সময় হাতেও পাঠাতে পারে (একই মাসের জন্য ৬ ঘণ্টায় একবার)।
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and length(endpoint) < 1000),
  p256dh      text not null check (length(p256dh) between 20 and 200),
  auth        text not null check (length(auth) between 8 and 100),
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

create table if not exists public.push_queue (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  body        text not null,
  url         text,
  kind        text not null,
  org_id      uuid references public.orgs(id),
  period      date,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  result      text
);
create index if not exists push_queue_unsent on public.push_queue (id) where sent_at is null;
alter table public.push_queue enable row level security;   -- কোনো policy নেই: শুধু সার্ভার (service role)
revoke all on public.push_queue from anon, authenticated;

create table if not exists public.reminder_log (
  id          bigserial primary key,
  parent_id   uuid not null references public.orgs(id),
  period      date not null,
  kind        text not null check (kind in ('auto','manual')),
  sender      uuid,
  org_count   int not null default 0,
  user_count  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.reminder_log enable row level security;
drop policy if exists reminder_log_read on public.reminder_log;
create policy reminder_log_read on public.reminder_log for select to authenticated using (public.can_view_org(parent_id));
revoke all on public.reminder_log from anon, authenticated;
grant select on public.reminder_log to authenticated;

-- ---------- নিজের ফোন যোগ/বাদ ----------
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login();
begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (u, p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = u;
end $$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------- মাসের বাংলা নাম ----------
create or replace function public.month_bn(p date) returns text
language sql immutable set search_path = public as $$
  select (array['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'])[extract(month from p)::int]
         || ' ' || translate(extract(year from p)::int::text, '0123456789', '০১২৩৪৫৬৭৮৯')
$$;

-- ---------- ভেতরের কাজ: জমা না দেওয়া অধীনস্থদের দায়িত্বশীলদের জন্য নোটিফিকেশন সারিতে রাখা ----------
create or replace function public.enqueue_reminders(p_parent uuid, p_period date, p_kind text, p_sender uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare pname text; n_org int := 0; n_user int := 0; k int; r record;
begin
  select name into pname from public.orgs where id = p_parent;
  for r in
    select o.id, o.name from public.orgs o
     where o.parent_id = p_parent and o.active
       and (o.start_month is null or o.start_month <= p_period)
       and not exists (select 1 from public.reports x where x.org_id = o.id and x.period = p_period
                         and x.status in ('submitted','accepted'))
  loop
    n_org := n_org + 1;
    insert into public.push_queue (user_id, title, body, url, kind, org_id, period)
    select m.user_id,
           'মাসিক রিপোর্ট জমা দিন',
           r.name || ': ' || public.month_bn(p_period) || ' এর রিপোর্ট এখনো জমা হয়নি। ' ||
             case when p_kind = 'manual' then pname || ' থেকে মনে করিয়ে দেওয়া হলো।' else 'অনুগ্রহ করে পূরণ করে জমা দিন।' end,
           'report.html?org=' || r.id || '#home', p_kind, r.id, p_period
      from public.memberships m
     where m.org_id = r.id and m.active and m.role in ('president','secretary');
    get diagnostics k = row_count;
    n_user := n_user + k;
  end loop;
  insert into public.reminder_log (parent_id, period, kind, sender, org_count, user_count)
  values (p_parent, p_period, p_kind, p_sender, n_org, n_user);
  return n_org;
end $$;
revoke all on function public.enqueue_reminders(uuid, date, text, uuid) from public, anon, authenticated;

-- ---------- হাতে পাঠানো: উপরের স্তরের দায়িত্বশীল ----------
create or replace function public.send_reminder(p_parent uuid, p_period date)
returns int
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); lim date := (date_trunc('month', now() at time zone 'Asia/Dhaka'))::date;
begin
  if not public.is_member_of(p_parent) then raise exception 'অনুমতি নেই'; end if;
  if p_period is null or extract(day from p_period) <> 1 or p_period > lim then raise exception 'মাস ঠিক নয়'; end if;
  if exists (select 1 from public.reminder_log where parent_id = p_parent and period = p_period and kind = 'manual'
              and created_at > now() - interval '6 hours') then
    raise exception 'এই মাসের রিমাইন্ডার গত ৬ ঘণ্টার মধ্যে একবার পাঠানো হয়েছে। পরে আবার চেষ্টা করুন।';
  end if;
  return public.enqueue_reminders(p_parent, p_period, 'manual', u);
end $$;
revoke all on function public.send_reminder(uuid, date) from public, anon;
grant execute on function public.send_reminder(uuid, date) to authenticated;

-- ---------- স্বয়ংক্রিয় (সময়সূচি থেকে): আগের মাসের রিপোর্টের জন্য ----------
--   p_level = 'W': সব থানার নিচের ওয়ার্ডগুলোকে;  'T': মহানগরের নিচের থানাগুলোকে
create or replace function public.run_monthly_reminders(p_level text)
returns int
language plpgsql security definer set search_path = public as $$
declare per date := (date_trunc('month', now() at time zone 'Asia/Dhaka') - interval '1 month')::date; p record; n int := 0;
begin
  if p_level not in ('W','T','U') then raise exception 'স্তর ঠিক নয়'; end if;
  for p in select distinct c.parent_id from public.orgs c where c.level = p_level and c.active and c.parent_id is not null loop
    n := n + public.enqueue_reminders(p.parent_id, per, 'auto', null);
  end loop;
  return n;
end $$;
revoke all on function public.run_monthly_reminders(text) from public, anon, authenticated;
