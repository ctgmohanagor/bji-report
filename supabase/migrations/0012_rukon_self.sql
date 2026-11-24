-- =====================================================================
-- Migration 0012: থানার রিপোর্টে রুকন সংখ্যা থানা নিজে বসাবে (সিদ্ধান্ত ২৪ নভেম্বর ২০২৬)
--   * ওয়ার্ডের রুকন সংখ্যা থানার মোটে যোগ হবে না; কর্মী ও সহযোগী সদস্য আগের মতো যোগ হবে।
--   * একই নিয়ম বিভাগ ভিত্তিক রুকনে: মহিলা, শ্রম, উলামা, পেশাজীবী, যুব।
--   * ফিল্ডের opt এ "selfT" যোগ হয়; হিসাবের নিয়ম logic.js এ (aggregate/aggregatePeriod)।
--   * "মোট জনশক্তি সংখ্যা" (f010): থানা/মহানগরে পুরুষ/মহিলা ভাগ মহিলা বিভাগের সারি দিয়ে (srcT)
--     মহিলা রুকন = f084, পুরুষ = f079 − f084; মহিলা কর্মী = f085, পুরুষ = f080 − f085।
--   বারবার চালালেও ক্ষতি নেই (আগে থেকে থাকলে আর যোগ হয় না)।
-- =====================================================================
update public.form_versions fv
   set fields = (
     select jsonb_agg(
              case when e->>'key' in ('f079','f084','f087','f090','f093','f096')
                        and coalesce(e->>'opt','') !~ '(^|,)\s*selfT'
                   then jsonb_set(e, '{opt}', to_jsonb(trim(both ',' from coalesce(e->>'opt','') || ',selfT')))
                   when e->>'key' = 'f010'
                   then jsonb_set(e, '{srcT}', to_jsonb('sm=f079.cur-f084.cur;sf=f084.cur;km=f080.cur-f085.cur;kf=f085.cur'::text))
                   else e end
              order by t.ord)
       from jsonb_array_elements(fv.fields) with ordinality as t(e, ord))
 where fv.valid_from = '2026-01-01';

-- যাচাই: ৬টি ফিল্ডে selfT, আর f010 এ srcT (মোট ৭ সারি)
select e->>'key' as key, coalesce(e->>'srcT', e->>'opt') as rule
  from public.form_versions, jsonb_array_elements(fields) e
 where valid_from = '2026-01-01' and (e->>'opt' ~ 'selfT' or e ? 'srcT')
 order by 1;
