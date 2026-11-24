-- =====================================================================
-- Migration 0012: থানার রিপোর্টে রুকন সংখ্যা থানা নিজে বসাবে (সিদ্ধান্ত ২৪ নভেম্বর ২০২৬)
--   * ওয়ার্ডের রুকন সংখ্যা থানার মোটে যোগ হবে না; কর্মী ও সহযোগী সদস্য আগের মতো যোগ হবে।
--   * একই নিয়ম বিভাগ ভিত্তিক রুকনে: মহিলা, শ্রম, উলামা, পেশাজীবী, যুব।
--   * ফিল্ডের opt এ "selfT" যোগ হয়; হিসাবের নিয়ম logic.js এ (aggregate/aggregatePeriod)।
--   বারবার চালালেও ক্ষতি নেই (আগে থেকে থাকলে আর যোগ হয় না)।
-- =====================================================================
update public.form_versions fv
   set fields = (
     select jsonb_agg(
              case when e->>'key' in ('f079','f084','f087','f090','f093','f096')
                        and coalesce(e->>'opt','') !~ '(^|,)\s*selfT'
                   then jsonb_set(e, '{opt}', to_jsonb(trim(both ',' from coalesce(e->>'opt','') || ',selfT')))
                   else e end
              order by t.ord)
       from jsonb_array_elements(fv.fields) with ordinality as t(e, ord))
 where fv.valid_from = '2026-01-01';

-- যাচাই: ৬টি ফিল্ডে selfT
select e->>'key' as key, e->>'opt' as opt
  from public.form_versions, jsonb_array_elements(fields) e
 where valid_from = '2026-01-01' and e->>'opt' ~ 'selfT'
 order by 1;
