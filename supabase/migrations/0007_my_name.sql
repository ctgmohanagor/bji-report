-- =====================================================================
-- Migration 0007: নিজের নাম বদলানো (PDF এ সভাপতির নাম বাংলায় দেখানোর জন্য)
--   Google থেকে আসা নাম প্রায়ই ইংরেজিতে থাকে; প্রত্যেকে শুধু নিজের নাম বদলাতে পারবেন।
-- =====================================================================
create or replace function public.set_my_name(p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_login(); n text := btrim(coalesce(p_name, ''));
begin
  if length(n) < 2 or length(n) > 80 then raise exception 'নাম ২ থেকে ৮০ অক্ষরের মধ্যে লিখুন'; end if;
  if n ~ '[<>]' then raise exception 'নামে < বা > চিহ্ন দেওয়া যাবে না'; end if;
  update public.profiles set full_name = n where user_id = u;
  if not found then raise exception 'প্রোফাইল পাওয়া যায়নি'; end if;
end $$;
revoke all on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;
