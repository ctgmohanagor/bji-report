-- =====================================================================
-- Migration 0004: ধরনের (পুরুষ/মহিলা) নিয়ম
--   * মহানগর ও থানা সবসময় দুটো মিলিয়ে ('B')
--   * ওয়ার্ড ও ইউনিট পুরুষ ('M') বা মহিলা ('F')
--   * ইউনিট তার ওয়ার্ডের ধরন নেয়
-- =====================================================================

-- আগে ভুল ধরনে তৈরি হওয়া থানা ঠিক করা
update public.orgs set gender = 'B' where level in ('M','T') and gender <> 'B';
update public.orgs u set gender = w.gender
  from public.orgs w
 where u.level = 'U' and w.id = u.parent_id and w.level = 'W' and u.gender <> w.gender;
update public.orgs set gender = 'M' where level in ('W','U') and gender = 'B';

alter table public.orgs add constraint orgs_gender_by_level
  check ((level in ('M','T') and gender = 'B') or (level in ('W','U') and gender in ('M','F')));

-- নতুন সংগঠন তৈরির সময় ধরন নিজে থেকে ঠিক করা
create or replace function public.orgs_fix_gender() returns trigger
language plpgsql set search_path = public as $$
declare pg text;
begin
  if new.level in ('M','T') then
    new.gender := 'B';
  elsif new.level = 'U' then
    select gender into pg from public.orgs where id = new.parent_id;
    if pg in ('M','F') then new.gender := pg; end if;   -- ওয়ার্ডের ধরন
    if new.gender not in ('M','F') then new.gender := 'M'; end if;
  elsif new.gender not in ('M','F') then
    raise exception 'ওয়ার্ড পুরুষ না মহিলা, তা বাছতে হবে';
  end if;
  return new;
end $$;
revoke all on function public.orgs_fix_gender() from public, anon, authenticated;
create trigger orgs_fix_gender before insert on public.orgs
  for each row execute function public.orgs_fix_gender();
