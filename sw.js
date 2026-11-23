/* সার্ভিস-ওয়ার্কার: শুধু রিমাইন্ডার-নোটিফিকেশন দেখানো ও চাপলে অ্যাপ খোলা।
   কোনো ফাইল ক্যাশ করে না (নতুন সংস্করণ সাথে সাথে আসে)। */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'মাসিক রিপোর্ট', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', lang: 'bn',
    data: { url: d.url || './index.html' }, tag: 'bji-reminder', renotify: true
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) { list[i].navigate(url); return list[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
