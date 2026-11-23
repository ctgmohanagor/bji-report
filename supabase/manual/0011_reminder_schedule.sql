-- =====================================================================
-- 0011: রিমাইন্ডারের সময়সূচি (শুধু Supabase এ; স্থানীয় পরীক্ষায় চলে না)
--   আগে Edge Function "send-push" বসাতে হবে।
--   সময় UTC তে: ০৪:০০ UTC = সকাল ১০টা (বাংলাদেশ)
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- আগের একই নামের সময়সূচি থাকলে মুছে নতুন করে
select cron.unschedule(jobname) from cron.job where jobname in ('bji-ward-reminder','bji-thana-reminder','bji-push-flush');

-- প্রতি মাসের ৫ তারিখ সকাল ১০টা: আগের মাসের রিপোর্ট জমা না দেওয়া ওয়ার্ডগুলোকে
select cron.schedule('bji-ward-reminder', '0 4 5 * *', $$select public.run_monthly_reminders('W')$$);
-- প্রতি মাসের ১৫ তারিখ সকাল ১০টা: আগের মাসের রিপোর্ট জমা না দেওয়া থানাগুলোকে
select cron.schedule('bji-thana-reminder', '0 4 15 * *', $$select public.run_monthly_reminders('T')$$);
-- প্রতি ৫ মিনিটে: সারিতে কিছু থাকলে send-push ডাকা
select cron.schedule('bji-push-flush', '*/5 * * * *', $$
  select net.http_post(url := 'https://__PROJECT_REF__.supabase.co/functions/v1/send-push',
                       body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)
   where exists (select 1 from public.push_queue where sent_at is null)
$$);
