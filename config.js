// কোন ডেটাবেসে যুক্ত হবে। এখন: staging (পরীক্ষা)।
// publishable key প্রকাশ্য চাবি; আসল সুরক্ষা ডেটাবেসের নিয়ম (RLS) থেকে আসে।
window.BJI_CONFIG = {
  env: 'staging',
  supabaseUrl: 'https://eulieycutgrhifqlnglr.supabase.co',
  supabaseKey: 'sb_publishable_UWaOz95iBLJAnApNTaZIqw_J40_23Bq',
  // ফোনে নোটিফিকেশনের প্রকাশ্য চাবি (VAPID public key; গোপন নয়)। ফাঁকা থাকলে নোটিফিকেশন বন্ধ দেখায়।
  vapidPublicKey: 'BChPsH3YPpEZ3s3H2wrAL8dMe5VhBLbslx8d8nh-jQYGizDsvf7U8YaPJtrcfZomzT-NnQHPqjrbPhEdQkREhnk'
};
