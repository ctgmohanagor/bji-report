-- =====================================================================
-- Migration 0009: উপরের স্তরের নাম (PDF এর "থানা/বিভাগ" ঘরের জন্য)
--   ওয়ার্ড/ইউনিট তার উপরের সংগঠনের সারি দেখতে পায় না (RLS); শুধু নামটা এখান থেকে পায়।
-- =====================================================================
create or replace function public.parent_name(p_org uuid)
returns text
language sql stable security definer set search_path = public as $$
  select p.name from public.orgs o join public.orgs p on p.id = o.parent_id
   where o.id = p_org and public.can_view_org(p_org)
$$;
revoke all on function public.parent_name(uuid) from public, anon;
grant execute on function public.parent_name(uuid) to authenticated;
