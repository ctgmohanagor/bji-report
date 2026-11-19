-- =====================================================================
-- Migration 0005: রিপোর্ট জমার নিয়ম ও হিসাবের সংরক্ষণ
--   * reports.extra: জমার সময়ের "বিগত" (prev), "বর্তমান" (cur) ও যাদের তথ্য ঢোকেনি (excluded)
--   * জমার আগে: আগের মাসের রিপোর্ট ঝুলে থাকলে আটকায়; নিচের স্তরের রিপোর্ট রিভিউ-বাকি থাকলে আটকায়
--   * জমা বা একসেপ্টের পর extra বদলানো যায় না
-- =====================================================================

alter table public.reports add column if not exists extra jsonb;

-- জমা/একসেপ্ট হওয়া রিপোর্টের extra আর বদলানো যায় না
create or replace function public.reports_guard_extra() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status in ('submitted','accepted') and new.status = old.status
     and new.extra is distinct from old.extra then
    raise exception 'জমা বা একসেপ্ট হওয়া রিপোর্টের হিসাব বদলানো যায় না';
  end if;
  return new;
end $$;
revoke all on function public.reports_guard_extra() from public, anon, authenticated;
drop trigger if exists reports_guard_extra on public.reports;
create trigger reports_guard_extra before update on public.reports
  for each row execute function public.reports_guard_extra();

drop function if exists public.submit_report(uuid, int);

create or replace function public.submit_report(p_report uuid, p_expected_version int default null,
                                                p_extra jsonb default null)
returns public.reports
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); r public.reports; has_parent boolean; who text; pm date;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or not public.is_member_of(r.org_id) then raise exception 'অনুমতি নেই'; end if;
  if r.status not in ('draft','returned') then raise exception 'রিপোর্টটি আগেই জমা হয়েছে'; end if;
  if p_expected_version is not null and p_expected_version <> r.version then
    raise exception 'অন্য কেউ এর মধ্যে রিপোর্টটি বদলেছেন; পাতা নতুন করে খুলুন';
  end if;
  if p_extra is not null and jsonb_typeof(p_extra) <> 'object' then raise exception 'হিসাবের গঠন ভুল'; end if;
  if public.locked_by_parent(r.org_id, r.period) then
    raise exception 'আপনার উপরের স্তর এই মাসের রিপোর্ট ইতিমধ্যে জমা দিয়েছে, তাই এখন আর জমা দেওয়া যাবে না';
  end if;

  -- আগের মাসের রিপোর্ট জমা/ফেরত অবস্থায় ঝুলে থাকলে আগে সেটা শেষ করতে হবে
  select period into pm from public.reports
   where org_id = r.org_id and period < r.period and status in ('submitted','returned')
   order by period limit 1;
  if pm is not null then
    raise exception 'আগের মাসের (%) রিপোর্ট এখনও একসেপ্ট হয়নি। আগে সেটা শেষ করুন।', to_char(pm, 'YYYY-MM');
  end if;

  -- নিচের স্তরের কারো রিপোর্ট রিভিউ-বাকি থাকলে আটকায় (একসেপ্ট বা ফেরত দিতে হবে)
  select string_agg(o.name, ', ' order by o.code) into who
    from public.reports c join public.orgs o on o.id = c.org_id
   where o.parent_id = r.org_id and c.period = r.period and c.status = 'submitted';
  if who is not null then
    raise exception 'এই অধীনস্থদের রিপোর্ট রিভিউ বাকি আছে (আগে একসেপ্ট বা ফেরত দিন): %', who;
  end if;

  select parent_id is not null into has_parent from public.orgs where id = r.org_id;
  update public.reports set
     status = case when has_parent then 'submitted' else 'accepted' end,
     extra = coalesce(p_extra, extra),
     submitted_at = now(), submitted_by = u, return_note = null,
     reviewed_at = case when has_parent then null else now() end,
     reviewed_by = case when has_parent then null else u end,
     version = version + 1, updated_by = u
   where id = p_report returning * into r;
  insert into public.report_events (report_id, org_id, period, action, actor)
  values (r.id, r.org_id, r.period, 'submit', u);
  return r;
end $$;

revoke all on function public.submit_report(uuid, int, jsonb) from public, anon;
grant execute on function public.submit_report(uuid, int, jsonb) to authenticated;
