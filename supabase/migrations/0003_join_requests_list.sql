-- =====================================================================
-- Migration 0003: অপেক্ষমাণ যোগদান-অনুরোধের তালিকা
-- অনুমোদনকারী (উপরের স্তর) অনুরোধকারীর নাম ও ইমেইল দেখতে পান,
-- কিন্তু শুধু নিজের অধীনের সংগঠনের অনুরোধ।
-- =====================================================================

create or replace function public.list_join_requests()
returns table (
  id uuid, org_id uuid, org_code text, org_name text, org_level text,
  role text, note text, created_at timestamptz, email text, full_name text
)
language sql stable security definer set search_path = public as $$
  select jr.id, o.id, o.code, o.name, o.level, jr.role, jr.note, jr.created_at,
         p.email, p.full_name
  from public.join_requests jr
  join public.orgs o on o.id = jr.org_id
  left join public.profiles p on p.user_id = jr.user_id
  where jr.status = 'pending' and public.can_manage_org(jr.org_id)
  order by jr.created_at
$$;

revoke all on function public.list_join_requests() from public, anon;
grant execute on function public.list_join_requests() to authenticated;
