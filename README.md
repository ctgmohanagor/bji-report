# BJI Report

চট্টগ্রাম মহানগরীর মাসিক রিপোর্ট সিস্টেম (পরীক্ষামূলক)।

- ওয়েব পাতা: `index.html`, `app.js`, `style.css`, `config.js` → GitHub Pages
- ডেটাবেস: Supabase (PostgreSQL)। `supabase/migrations/` এর ফাইলগুলো ক্রমানুসারে SQL Editor এ চালাতে হয়,
  আগে staging, তারপর live।
- `0002_seed.sql` (মহানগর সংগঠন ও অ্যাডমিনদের ইমেইল) ইচ্ছাকৃতভাবে এই প্রকাশ্য রিপোজিটরিতে রাখা হয়নি।
- নিরাপত্তা-পরীক্ষা: `supabase/tests/run_local.sh` (স্থানীয় PostgreSQL 16 লাগে)।

`config.js` এর চাবিটি Supabase এর প্রকাশ্য (publishable) চাবি। আসল সুরক্ষা আসে ডেটাবেসের
Row Level Security ও নিয়ন্ত্রিত ফাংশন থেকে। গোপন চাবি (service_role) কখনো এখানে রাখা যাবে না।
