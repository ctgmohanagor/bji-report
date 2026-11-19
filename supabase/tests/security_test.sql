-- নিরাপত্তা ও কাজের ধারার স্বয়ংক্রিয় পরীক্ষা (স্থানীয় ডেটাবেসে চালানোর জন্য)
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

create schema test;
create table test.vars (k text primary key, v text);
create function test.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function test.expect_error(q text, pattern text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then raise notice 'PASS: % (%)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % — ভিন্ন ত্রুটি: %', label, sqlerrm;
  end;
  raise exception 'FAIL: % — ত্রুটি হওয়ার কথা ছিল', label;
end $$;
create function test.v(key text) returns text language sql stable as $$ select v from test.vars where k = key $$;
create function test.org(c text) returns uuid language sql stable security definer as $$ select id from public.orgs where code = c $$;
create function test.rep(c text, p date) returns uuid language sql stable security definer as $$
  select r.id from public.reports r join public.orgs o on o.id = r.org_id where o.code = c and r.period = p $$;
grant usage on schema test to authenticated;
grant all on test.vars to authenticated;
grant execute on all functions in schema test to authenticated;

-- ব্যবহারকারী (প্রথমটি অ্যাডমিন তালিকায় আছে)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'CTGDoctorsThana1941@gmail.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'thana1@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'thana2@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'ward1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'ward2@example.com'),
  ('00000000-0000-0000-0000-0000000000d1', 'unit1@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'outsider@example.com');

select test.ok((select count(*) = 1 from public.memberships m join public.orgs o on o.id = m.org_id
                where m.user_id = '00000000-0000-0000-0000-0000000000a1' and m.role = 'admin' and o.code = 'm'),
               'অ্যাডমিন-তালিকার ইমেইলে প্রথম লগইনে নিজে থেকে মহানগর অ্যাডমিন');
select test.ok((select count(*) = 0 from public.memberships where user_id = '00000000-0000-0000-0000-0000000000e1'),
               'তালিকার বাইরের ব্যবহারকারী কোনো দায়িত্ব পান না');

-- ===== অ্যাডমিন: দুটি থানা যোগ ও নিমন্ত্রণ =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select test.ok((public.create_org(test.org('m'), 'প্রথম থানা', 'T')).code = 't01', 'মহানগর থানা যোগ করে (কোড t01)');
select test.ok((public.create_org(test.org('m'), 'দ্বিতীয় থানা', 'T')).code = 't02', 'দ্বিতীয় থানা t02');
select test.expect_error($$select public.create_org(test.org('t01'), 'ওয়ার্ড', 'W')$$, 'অনুমতি নেই', 'মহানগর থানার নিচে ওয়ার্ড বানাতে পারে না');
select test.expect_error($$select public.create_org(test.org('m'), 'ওয়ার্ড', 'W')$$, 'অনুমতি নেই', 'মহানগরের সরাসরি অধীনে ওয়ার্ড হয় না');
insert into test.vars values ('inv_t01', public.create_invite(test.org('t01'), 'president'));
insert into test.vars values ('inv_t02', public.create_invite(test.org('t02'), 'president'));
reset role;

-- থানা ১ ও ২ এর সভাপতি নিমন্ত্রণ গ্রহণ
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select test.ok((public.accept_invite(test.v('inv_t01'))).code = 't01', 'থানা ১ সভাপতি নিমন্ত্রণে যোগ দিলেন');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
set role authenticated;
select test.expect_error($$select public.accept_invite(test.v('inv_t01'))$$, 'আগেই ব্যবহার', 'একই নিমন্ত্রণ-লিংক দ্বিতীয়বার কাজ করে না');
select test.expect_error($$select public.accept_invite('ভুল-টোকেন')$$, 'সঠিক নয়', 'ভুল টোকেন প্রত্যাখ্যাত');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
set role authenticated;
select public.accept_invite(test.v('inv_t02'));
select test.expect_error($$select public.create_org(test.org('t02'), 'x', 'W')$$, 'পুরুষ না মহিলা', 'ধরন ছাড়া ওয়ার্ড তৈরি হয় না');
select public.create_org(test.org('t02'), 'থানা ২ এর ওয়ার্ড', 'W', 'M');
insert into test.vars values ('inv_t02w01', public.create_invite(test.org('t02w01'), 'president'));
reset role;

-- থানা ১: ওয়ার্ড বানায় ও নিমন্ত্রণ
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select test.ok((public.create_org(test.org('t01'), 'ওয়ার্ড ১', 'W', 'M')).code = 't01w01', 'থানা ওয়ার্ড যোগ করে (t01w01)');
insert into test.vars values ('inv_w', public.create_invite(test.org('t01w01'), 'president'));
select test.expect_error($$select public.create_invite(test.org('t02'), 'president')$$, 'অনুমতি নেই', 'থানা ১ থানা ২ তে নিমন্ত্রণ পাঠাতে পারে না');
select test.expect_error($$select public.create_invite(test.org('t01'), 'secretary')$$, 'অনুমতি নেই', 'নিজের সংগঠনে নিজে নিমন্ত্রণ নয় (উপরের স্তরের কাজ)');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
select public.accept_invite(test.v('inv_w'));
select test.ok((public.create_org(test.org('t01w01'), 'ইউনিট ১', 'U')).code = 't01w01u1', 'ওয়ার্ড ইউনিট যোগ করে (t01w01u1)');
insert into test.vars values ('inv_u', public.create_invite(test.org('t01w01u1'), 'president'));
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select public.accept_invite(test.v('inv_u'));
reset role;

-- ===== দেখার সীমা =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select test.ok((select array_agg(code order by code) from public.orgs) = array['m','t01','t02'], 'মহানগর দেখে শুধু নিজেকে ও থানাগুলো');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select test.ok((select array_agg(code order by code) from public.orgs) = array['t01','t01w01','t01w01u1'], 'থানা ১ দেখে নিজেকে ও নিজের ওয়ার্ড-ইউনিট');
select test.ok((select count(*) from public.orgs where code like 't02%') = 0, 'থানা ১ থানা ২ এর কিছুই দেখে না');
select test.ok((select count(*) from public.memberships where org_id = test.org('t02')) = 0, 'থানা ১ থানা ২ এর দায়িত্বশীলদের দেখে না');
select test.ok((select count(*) from public.profiles where email = 'thana2@example.com') = 0, 'থানা ১ থানা ২ এর প্রোফাইল দেখে না');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select test.ok((select array_agg(code) from public.orgs) = array['t01w01u1'], 'ইউনিট দেখে শুধু নিজেকে');
select test.expect_error($$select token_hash from public.invites$$, 'permission denied', 'নিমন্ত্রণের টোকেন-hash পড়া যায় না');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
set role authenticated;
select test.ok((select count(*) from public.orgs) = 0, 'দায়িত্বহীন ব্যবহারকারী কিছুই দেখে না');
select test.expect_error($$select * from public.admin_allowlist$$, 'permission denied', 'অ্যাডমিন-তালিকা অ্যাপ থেকে পড়া যায় না');
reset role;

-- ===== রিপোর্টের ধারা =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select public.save_report(test.org('t01w01u1'), '2026-11-15', '{"f001":{"cur":5}}');
select test.ok((select status from public.reports) = 'draft', 'ইউনিট খসড়া সংরক্ষণ করল (মাস ১ তারিখে বসে)');
select test.expect_error($$select public.save_report(test.org('t01w01'), '2026-11-01', '{}')$$, 'নিজের সংগঠনের', 'ইউনিট ওয়ার্ডের রিপোর্ট লিখতে পারে না');
select test.expect_error($$insert into public.reports (org_id, period, form_version_id) values (test.org('t01w01u1'), '2026-10-01', 1)$$, 'permission denied', 'টেবিলে সরাসরি লেখা বন্ধ');
select test.expect_error($$update public.reports set status = 'accepted'$$, 'permission denied', 'সরাসরি অবস্থা বদলানো বন্ধ');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
select test.ok((select count(*) from public.reports) = 0, 'ইউনিটের খসড়া ওয়ার্ড দেখে না');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select public.save_report(test.org('t01w01u1'), '2026-11-01', '{"f001":{"cur":7}}', 1);
select test.expect_error($$select public.save_report(test.org('t01w01u1'), '2026-11-01', '{"f001":{"cur":8}}', 1)$$, 'অন্য কেউ', 'পুরনো সংস্করণ থেকে সংরক্ষণ আটকায় (দুজনের একসাথে লেখা)');
select public.submit_report(test.rep('t01w01u1', '2026-11-01'));
select test.expect_error($$select public.save_report(test.org('t01w01u1'), '2026-11-01', '{}')$$, 'বদলানো যায় না', 'জমার পর ইউনিট বদলাতে পারে না');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select test.ok((select count(*) from public.reports) = 0, 'মহানগর ইউনিটের রিপোর্ট দেখে না');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
set role authenticated;
select test.ok((select count(*) from public.reports) = 0, 'থানা ২ থানা ১ এর ইউনিটের রিপোর্ট দেখে না');
select test.ok((select count(*) from public.report_events) = 0, 'থানা ২ থানা ১ এর ইতিহাস দেখে না');
select test.expect_error($$select public.review_report(test.rep('t01w01u1','2026-11-01'), true)$$, 'পাওয়া যায়নি', 'অন্য থানা একসেপ্ট করতে পারে না, রিপোর্টের অস্তিত্বও জানে না');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select test.ok((select count(*) from public.reports) = 1, 'থানা ১ জমা হওয়া ইউনিট রিপোর্ট দেখে');
select test.expect_error($$select public.review_report(test.rep('t01w01u1','2026-11-01'), true)$$, 'সরাসরি উপরের', 'থানা ইউনিটকে সরাসরি একসেপ্ট করে না (ওয়ার্ডের কাজ)');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
select test.expect_error($$select public.review_report(test.rep('t01w01u1','2026-11-01'), false, ' ')$$, 'কারণ', 'ফেরতে কারণ বাধ্যতামূলক');
select public.review_report(test.rep('t01w01u1','2026-11-01'), false, 'সংখ্যা মিলছে না');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select test.ok((select status = 'returned' and return_note = 'সংখ্যা মিলছে না' from public.reports), 'ইউনিট ফেরতের কারণ দেখে');
select public.save_report(test.org('t01w01u1'), '2026-11-01', '{"f001":{"cur":9}}');
select public.submit_report(test.rep('t01w01u1','2026-11-01'));
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
select public.review_report(test.rep('t01w01u1','2026-11-01'), true);
select public.save_report(test.org('t01w01'), '2026-11-01', '{"f002":{"cur":3}}');
select public.submit_report(test.rep('t01w01','2026-11-01'));
select test.expect_error($$select public.reopen_report(test.rep('t01w01u1','2026-11-01'), 'ভুল')$$, 'অনুমতি নেই', 'নিজের রিপোর্ট জমার পর নিচেরটা আবার খোলা যায় না');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select test.expect_error($$select public.save_report(test.org('t01w01u1'), '2026-11-01', '{}')$$, 'বদলানো', 'ওয়ার্ড জমা দেওয়ার পর ইউনিট আটকে যায়');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select public.review_report(test.rep('t01w01','2026-11-01'), true);
select public.save_report(test.org('t01'), '2026-11-01', '{"f003":{"cur":1}}');
select public.submit_report(test.rep('t01','2026-11-01'));
select test.ok((select status from public.reports where org_id = test.org('t01')) = 'submitted', 'থানার রিপোর্ট এখন নিজে থেকে চূড়ান্ত হয় না, মহানগরে জমা থাকে');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select test.ok((select count(*) from public.reports) = 1, 'মহানগর শুধু থানার রিপোর্ট দেখে');
select public.review_report(test.rep('t01','2026-11-01'), true);
select public.reopen_report(test.rep('t01','2026-11-01'), 'সংশোধন দরকার');
select test.ok((select status from public.reports where org_id = test.org('t01')) = 'returned', 'মহানগর অ্যাডমিন থানার একসেপ্টেড রিপোর্ট আবার খুলতে পারে');
select test.expect_error($$select public.reopen_report(test.rep('t01w01','2026-11-01'), 'x')$$, 'পাওয়া যায়নি', 'মহানগর ওয়ার্ডের রিপোর্ট খুঁজেও পায় না');
select public.save_report(test.org('m'), '2026-11-01', '{"f009":{"cur":2}}');
select test.ok((public.submit_report(test.rep('m','2026-11-01'))).status = 'accepted', 'মহানগরের নিজের রিপোর্ট জমাতেই চূড়ান্ত');
reset role;

-- ===== ইতিহাস অপরিবর্তনীয় =====
select test.ok((select count(*) from public.report_events where org_id = test.org('t01w01u1')) >= 6, 'ইউনিট রিপোর্টের প্রতিটি ধাপ ইতিহাসে লেখা');
select test.ok((select changes ? 'f001' from public.report_events where org_id = test.org('t01w01u1') and action = 'save' order by id limit 1), 'ইতিহাসে কোন ঘর বদলেছে তা থাকে');
select test.expect_error($$update public.report_events set note = 'x'$$, 'ইতিহাস', 'ইতিহাস বদলানো যায় না (ডেটাবেস মালিকের জন্যও)');
select test.expect_error($$delete from public.report_events$$, 'ইতিহাস', 'ইতিহাস মোছা যায় না');
select test.expect_error($$update public.reports set data = '{}' where org_id = test.org('t01w01u1')$$, 'বদলানো যায় না', 'একসেপ্টেড রিপোর্টের তথ্য ডেটাবেস-স্তরেও বদলানো যায় না');

-- ===== যোগদানের অনুরোধ ও সরানো =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
set role authenticated;
insert into test.vars select 'req', public.request_join('T01W01U1', 'secretary', 'আমি সেক্রেটারি')::text;
select test.expect_error($$select public.request_join('t01w01u1', 'president')$$, 'অপেক্ষায় আছে', 'একসাথে একটির বেশি অপেক্ষমাণ অনুরোধ নয়');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
set role authenticated;
select test.expect_error($$select public.decide_join(test.v('req')::uuid, true)$$, 'অনুমতি নেই', 'অন্য থানা অনুরোধ অনুমোদন করতে পারে না');
select test.ok((select count(*) from public.list_join_requests()) = 0, 'অন্য থানা অনুরোধের তালিকাও দেখে না');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
select test.ok((select email from public.list_join_requests()) = 'outsider@example.com', 'ওয়ার্ড অনুরোধকারীর ইমেইল দেখে');
select public.decide_join(test.v('req')::uuid, true);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
set role authenticated;
select test.ok((select array_agg(code) from public.orgs) = array['t01w01u1'], 'অনুমোদনের পর সেক্রেটারি নিজের ইউনিট দেখেন');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
insert into test.vars select 'mem', id::text from public.memberships where org_id = test.org('t01w01u1') and role = 'president' and active;
select public.remove_member(test.v('mem')::uuid);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select test.ok((select count(*) from public.orgs) = 0 and (select count(*) from public.reports) = 0, 'সরানোর সাথে সাথে প্রবেশ বন্ধ');
select test.expect_error($$select public.save_report(test.org('t01w01u1'), '2026-12-01', '{}')$$, 'নিজের সংগঠনের', 'সরানো ব্যক্তি লিখতেও পারেন না');
reset role;

-- ===== নিমন্ত্রণের মেয়াদ ও দায়িত্ব বদল =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
insert into test.vars values ('inv_old', public.create_invite(test.org('t01w01u1'), 'president'));
reset role;
update public.invites set expires_at = now() - interval '1 minute' where used_at is null and revoked_at is null;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select test.expect_error($$select public.accept_invite(test.v('inv_old'))$$, 'মেয়াদ', 'মেয়াদোত্তীর্ণ নিমন্ত্রণ কাজ করে না');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
insert into test.vars values ('inv_new', public.create_invite(test.org('t01w01u1'), 'secretary'));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select public.accept_invite(test.v('inv_new'));
reset role;
select test.ok((select count(*) from public.memberships where org_id = test.org('t01w01u1') and role = 'secretary' and active) = 1
               and (select user_id from public.memberships where org_id = test.org('t01w01u1') and role = 'secretary' and active) = '00000000-0000-0000-0000-0000000000d1',
               'নতুন সেক্রেটারি বসলে আগের জন নিজে থেকে সরে যান');
select test.ok((select count(*) from public.admin_events) >= 10, 'ব্যবস্থাপনার প্রতিটি কাজ লগে লেখা');

-- ===== ধরনের নিয়ম (0004) =====
select test.ok((select gender from public.orgs where code = 't01') = 'B', 'থানা সবসময় পুরুষ+মহিলা');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select test.ok((public.create_org(test.org('t01'), 'মহিলা ওয়ার্ড', 'W', 'F')).gender = 'F', 'মহিলা ওয়ার্ড তৈরি');
select test.ok((public.create_org(test.org('t01w02'), 'ইউনিট', 'U', 'M')).gender = 'F', 'মহিলা ওয়ার্ডের ইউনিট নিজে থেকে মহিলা');
reset role;
-- ===== জমার নিয়ম (0005) =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select public.save_report(test.org('t01w01u1'), '2026-12-01', '{"f001":{"inc":2}}');
select public.submit_report(test.rep('t01w01u1','2026-12-01'), null, '{"prev":{"f001":9},"cur":{"f001":11},"excluded":[]}');
select test.ok((select (extra->'cur'->>'f001')::int from public.reports where id = test.rep('t01w01u1','2026-12-01')) = 11, 'জমার সময়ের হিসাব (বর্তমান) সংরক্ষিত');
select public.save_report(test.org('t01w01u1'), '2027-01-01', '{}');
select test.expect_error($$select public.submit_report(test.rep('t01w01u1','2027-01-01'))$$, 'আগের মাসের', 'আগের মাস একসেপ্ট না হলে পরের মাস জমা হয় না');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
select public.save_report(test.org('t01w01'), '2026-12-01', '{}');
select test.expect_error($$select public.submit_report(test.rep('t01w01','2026-12-01'))$$, 'রিভিউ বাকি', 'নিচের স্তরের রিভিউ বাকি থাকলে জমা হয় না');
select public.review_report(test.rep('t01w01u1','2026-12-01'), true);
select test.ok((public.submit_report(test.rep('t01w01','2026-12-01'))).status = 'submitted', 'রিভিউ শেষে জমা হয়');
reset role;
select test.expect_error($$update public.reports set extra = '{}' where id = test.rep('t01w01u1','2026-12-01')$$, 'হিসাব বদলানো', 'একসেপ্টেড রিপোর্টের হিসাব বদলানো যায় না');
\echo 'সব পরীক্ষা শেষ'
