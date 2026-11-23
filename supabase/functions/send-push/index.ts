// send-push: push_queue এ জমা থাকা রিমাইন্ডারগুলো ফোনে পাঠায় (Web Push)।
// Supabase ড্যাশবোর্ডে Edge Function হিসেবে বসাতে হবে, "Verify JWT" বন্ধ।
// এর কোনো ইনপুট নেই: যে-ই ডাকুক, শুধু সারিতে আগে থেকে থাকা নোটিফিকেশন যায় (সারিতে রাখা যায় শুধু ডেটাবেসের নিয়ম মেনে)।
// গোপন মান (Edge Function Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL ও সার্ভারের চাবি (SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY) Supabase নিজে দেয়।
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// সার্ভারের চাবি: নতুন ব্যবস্থায় SUPABASE_SECRET_KEYS (JSON), পুরনোতে SUPABASE_SERVICE_ROLE_KEY
function serverKey(): string {
  try {
    const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const k = j.default ?? Object.values(j)[0];
    if (typeof k === "string" && k) return k;
  } catch (_) { /* পুরনোটা দেখা হবে */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), {
  auth: { persistSession: false },
});
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:report.ctgmohanagor@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SITE = "https://ctgmohanagor.github.io/bji-report/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let sent = 0, failed = 0, gone = 0, done = 0;
  for (let round = 0; round < 10; round++) {
    const { data: rows, error } = await sb.from("push_queue")
      .select("id,user_id,title,body,url").is("sent_at", null).order("id").limit(100);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });
    if (!rows || !rows.length) break;
    const users = [...new Set(rows.map((r) => r.user_id))];
    const { data: subs } = await sb.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", users);
    for (const r of rows) {
      const mine = (subs ?? []).filter((s) => s.user_id === r.user_id);
      const payload = JSON.stringify({ title: r.title, body: r.body, url: SITE + (r.url ?? "report.html#home") });
      let ok = 0;
      for (const s of mine) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
          ok++; sent++;
          await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { gone++; await sb.from("push_subscriptions").delete().eq("id", s.id); }
          else failed++;
        }
      }
      await sb.from("push_queue").update({
        sent_at: new Date().toISOString(),
        result: mine.length ? `${ok}/${mine.length}` : "no-device",
      }).eq("id", r.id);
      done++;
    }
  }
  return new Response(JSON.stringify({ done, sent, failed, gone }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
