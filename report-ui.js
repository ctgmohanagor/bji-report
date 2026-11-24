/* BJI Report — মাসিক রিপোর্টের পাতা (পুরনো Index.html এর ফর্ম, হোম, সমন্বিত রিপোর্ট)।
   সার্ভারের বদলে api.js (Supabase) ব্যবহার করে। */

var S = { token: '', me: null, tabs: [], tab: 0, patterns: {}, periods: {}, sessions: [], monthNames: [], currentMonth: '', year: '', mon: '', month: '', pk: '', pi: '', cur: null };
var STAT = { NONE: 'শুরু হয়নি', DRAFT: 'খসড়া', SUBMITTED: 'জমা দেওয়া', RETURNED: 'ফেরত', ACCEPTED: 'একসেপ্টেড' };
var BND = '০১২৩৪৫৬৭৮৯';

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function bn(x) { return String(x).replace(/\d/g, function (d) { return BND.charAt(d); }); }
function en(x) { return String(x).replace(/[০-৯]/g, function (d) { return BND.indexOf(d); }); }
function num(v) { var s = en(v || '').trim().replace(/,/g, ''); if (s === '') return 0; var n = parseFloat(s); return isNaN(n) ? 0 : n; }
function fmt(n) { return (n === null || n === undefined) ? '—' : bn(Math.round(n * 100) / 100); }
function chip(s) { return '<span class="chip ' + s + '">' + (STAT[s] || s) + '</span>'; }

function store(k, v) {
  try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { }
  return null;
}
var busyT;
function busy(on) { clearTimeout(busyT); if (on) busyT = setTimeout(function () { $('busy').style.display = 'flex'; }, 150); else $('busy').style.display = 'none'; }
function toast(msg, bad) {
  var t = $('toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, bad ? 5000 : 2200);
}

/* সার্ভারকে ডাকা। সেশন শেষ হলে লগইনে ফেরত যায়। */
function call(name) {
  var args = [].slice.call(arguments);
  busy(true);
  return new Promise(function (ok, no) {
    if (!API[name]) { no(new Error('এই সুবিধা এখনো চালু হয়নি।')); return; }
    Promise.resolve().then(function () { return API[name].apply(null, args.slice(2)); }).then(ok, no);
  }).then(function (v) { busy(false); return v; }, function (e) {
    busy(false);
    var m = (e && e.message) || String(e);
    if (m.indexOf('SESSION') >= 0) { location.href = 'index.html'; throw new Error('SESSION'); }
    throw new Error(m.replace(/^(Error|Exception):\s*/, ''));
  });
}
function fail(e) { if (e.message !== 'SESSION') toast(e.message, true); }

/* নিজস্ব ছোট পপআপ (ব্রাউজারের prompt/confirm এই পরিবেশে নির্ভরযোগ্য নয়) */
function modal(o) {
  return new Promise(function (res) {
    $('mbox').innerHTML = '<h2>' + esc(o.title) + '</h2>' + (o.text ? '<p>' + esc(o.text) + '</p>' : '') +
      (o.input ? '<textarea id="mi" placeholder="' + esc(o.placeholder || '') + '"></textarea>' : '') +
      (o.link ? '<a class="btn" id="mlk" target="_blank" href="' + esc(o.link.href) + '" download="' + esc(o.link.name) + '">' + esc(o.link.label) + '</a>' : '') +
      (o.noOk ? '' : '<button class="btn ' + (o.bad ? 'bad' : '') + '" id="mok">' + esc(o.ok || 'ঠিক আছে') + '</button>') +
      '<button class="btn sec" id="mno">' + (o.noOk ? 'বন্ধ করুন' : 'বাতিল') + '</button>';
    $('modal').style.display = 'flex';
    if ($('mok')) $('mok').onclick = function () { var v = o.input ? $('mi').value : true; $('modal').style.display = 'none'; res(v); };
    $('mno').onclick = function () { $('modal').style.display = 'none'; res(null); };
  });
}

/* PDF: ছাপার পাতা নতুন ট্যাবে খোলে; সেখান থেকে "প্রিন্ট / PDF সংরক্ষণ"।
   ট্যাবটা ক্লিকের সাথে সাথেই খোলা হয় (নইলে ব্রাউজার পপআপ আটকায়), তারপর লেখা বসে। */
function showPdf(promise) {
  var w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:sans-serif;padding:20px">PDF তৈরি হচ্ছে…</p>');
  promise.then(function (r) {
    var bar = '<div class="noprint" style="position:sticky;top:0;background:#1f6f5c;color:#fff;padding:10px;font-family:sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<button onclick="window.print()" style="font-size:16px;padding:8px 14px;border:0;border-radius:6px;background:#fff;color:#1f6f5c;font-weight:bold">প্রিন্ট / PDF হিসেবে সংরক্ষণ</button>' +
      '<span style="font-size:13px">প্রিন্টের পর্দায় "Save as PDF" ও কাগজ A4 বাছুন</span></div>';
    var html = r.html.replace('</style>', '@media print{.noprint{display:none!important}}</style>')
                     .replace(/<head>/, '<head><title>' + esc(r.filename) + '</title><meta name="viewport" content="width=device-width, initial-scale=1">')
                     .replace(/<body>/, '<body>' + bar);
    if (!w || w.closed) { toast('পপআপ আটকে গেছে। ব্রাউজারে এই সাইটের পপআপ চালু করুন।', true); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }).catch(function (e) { if (w && !w.closed) w.close(); fail(e); });
}
function downloadPdf(orgId) { showPdf(call('apiPdf', S.token, S.month, orgId)); }
function downloadPeriodPdf(orgId) { showPdf(call('apiPeriodPdf', S.token, S.year, S.pk, S.pk === 'Y' ? 1 : S.pi, orgId)); }

/* ================= লগইন ও হেডার মেনু ================= */
function setHeader() {
  if (!S.me) $('hd').style.display = 'none';
  if (S.me) { $('hname').textContent = S.me.name; $('hemail').textContent = S.email || ''; }
  menuOpen(false); setHH();
}
function menuOpen(on) { $('hdrop').style.display = on ? 'block' : 'none'; $('hmenu').setAttribute('aria-expanded', on ? 'true' : 'false'); }
$('hmenu').onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); menuOpen($('hdrop').style.display !== 'block'); };
document.addEventListener('click', function () { menuOpen(false); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menuOpen(false); });
$('hpf').onclick = function () { location.href = 'index.html'; };
$('hsw').onclick = function () { location.href = 'report.html'; };
$('hout').onclick = function () { menuOpen(false); API.logout(); };

function viewLogin(msg) {
  S.me = null; setHeader();
  $('app').innerHTML = '<div class="card"><h2>মাসিক রিপোর্ট</h2>' + (msg ? '<div class="note warn">' + esc(msg) + '</div>' : '') +
    '<label>ইউজারনেম</label><input id="u" autocapitalize="none" autocomplete="username" spellcheck="false">' +
    '<label>পাসওয়ার্ড</label><input id="p" type="password" autocomplete="current-password">' +
    '<button class="btn" id="go">লগইন</button><button class="lnk" id="fg" type="button">পাসওয়ার্ড ভুলে গেছেন?</button>' +
    '<div class="note warn" id="fgbox" style="display:none">পাসওয়ার্ড ভুলে গেলে আপনার ওয়ার্ড/থানার দায়িত্বশীলকে জানান। তিনি অ্যাডমিনের কাছ থেকে একটি সাময়িক পাসওয়ার্ড এনে দেবেন। সেটা দিয়ে লগইন করলে নিজের নতুন পাসওয়ার্ড দিতে বলা হবে।</div></div>';
  var go = function () {
    call('apiLogin', $('u').value, $('p').value).then(function (r) { S.token = r.token; store('tk', r.token); applyBoot(r.boot); afterBoot(); }).catch(fail);
  };
  $('go').onclick = go;
  $('fg').onclick = function () { $('fgbox').style.display = 'block'; };
  $('p').onkeydown = function (e) { if (e.key === 'Enter') go(); };
}

/* লগইনের উত্তরেই সব ডেটা আসে, তাই আলাদা করে আবার সার্ভারকে ডাকতে হয় না */
function applyBoot(b) {
  S.me = b.me; S.email = b.email; S.tabs = b.tabs; S.patterns = b.patterns; S.periods = b.periods;
  S.monthNames = b.monthNames; S.sessions = b.sessions; S.currentMonth = b.currentMonth;
  if (!S.year || S.sessions.indexOf(S.year) < 0) S.year = b.defaultSession;
  setHeader();
}
function afterBoot() { if (S.me.mustChange) viewPassword(true); else if (location.hash.indexOf('#opening') === 0) viewOpening(openingTarget()); else viewHome(); }
function openingTarget() { var m = /^#opening:(.+)$/.exec(location.hash); return m ? decodeURIComponent(m[1]) : S.me.orgId; }

function boot() {
  call('apiBootstrap', S.token).then(function (b) { applyBoot(b); afterBoot(); })
    .catch(fail);
}

function viewPassword(forced) {
  $('app').innerHTML = '<div class="card"><h2>পাসওয়ার্ড বদলান</h2>' +
    (forced ? '<div class="note warn">প্রথমবার ঢুকেছেন, তাই নিজের পাসওয়ার্ড দিন।</div>' : '') +
    '<label>বর্তমান পাসওয়ার্ড</label><input id="o" type="password"><label>নতুন পাসওয়ার্ড (অন্তত ৬ অক্ষর)</label><input id="n" type="password">' +
    '<label>নতুন পাসওয়ার্ড আবার</label><input id="n2" type="password"><button class="btn" id="sv">সংরক্ষণ</button>' +
    (forced ? '' : '<button class="btn sec" id="bk">Back</button>') + '</div>';
  if (!forced) $('bk').onclick = viewHome;
  $('sv').onclick = function () {
    if ($('n').value !== $('n2').value) return toast('দুই পাসওয়ার্ড মেলেনি', true);
    call('apiChangePassword', S.token, $('o').value, $('n').value).then(function () { S.me.mustChange = false; setHeader(); toast('পাসওয়ার্ড বদলেছে'); viewHome(); }).catch(fail);
  };
}

/* ================= প্রোফাইল ================= */
function viewProfile() {
  call('apiGetProfile', S.token).then(function (p) {
    $('app').innerHTML = '<div class="card"><h2>প্রোফাইল</h2>' +
      '<div class="note">সংগঠন: <b>' + esc(p.orgName) + '</b> · ইউজারনেম: <b>' + esc(p.username) + '</b></div>' +
      '<label>' + esc(p.leaderLabel) + 'র নাম (রিপোর্টের PDF-এ ছাপা হবে)</label><input id="ldr" maxlength="80" value="' + esc(p.leader) + '">' +
      '<button class="btn" id="psv">সংরক্ষণ</button><button class="btn sec" id="pbk">Back</button></div>';
    $('pbk').onclick = viewHome;
    $('psv').onclick = function () {
      call('apiSaveProfile', S.token, $('ldr').value).then(function () { toast('প্রোফাইল সংরক্ষিত'); viewHome(); }).catch(fail);
    };
  }).catch(fail);
}

/* ================= হোম ================= */
function monthOptions() {
  var o = '<option value=""' + (S.mon ? '' : ' selected') + '>নির্বাচন করুন</option>';
  S.monthNames.forEach(function (nm, i) {
    var mm = (i + 1 < 10 ? '0' : '') + (i + 1), future = (S.year + '-' + mm) > S.currentMonth;
    o += '<option value="' + mm + '"' + (S.mon === mm ? ' selected' : '') + (future ? ' disabled' : '') + '>' + esc(nm) + '</option>';
  });
  return o;
}

/* ত্রৈমাসিক / ষান্মাসিক / বাৎসরিক রিপোর্ট বাছাইয়ের ঘর (সেশন অনুযায়ী; মাস বাছা লাগে না) */
function periodCard() {
  return '<div class="card"><h2>সময়ভিত্তিক সমন্বিত রিপোর্ট</h2><small class="mut">সেশন ' + bn(S.year) + ' · একসেপ্টেড মাসিক রিপোর্টের যোগফল</small>' +
    '<div class="two"><div><label>ধরন</label><select id="pk"><option value="">নির্বাচন করুন</option>' +
    ['Q', 'H', 'Y'].map(function (k) { return '<option value="' + k + '"' + (S.pk === k ? ' selected' : '') + '>' + esc(S.periods[k].name) + '</option>'; }).join('') +
    '</select></div><div id="pibox"><label>সময়কাল</label><select id="pi"></select></div></div>' +
    '<button class="btn" id="pgo">রিপোর্ট দেখুন</button></div>';
}
function fillPeriod() {
  var k = S.pk;
  $('pibox').style.display = (k === 'Q' || k === 'H' || !k) ? 'block' : 'none';
  if (k === 'Y') S.pi = '1';
  $('pi').innerHTML = '<option value="">নির্বাচন করুন</option>' + (k && k !== 'Y' ? S.periods[k].parts.map(function (p) {
    return '<option value="' + p.idx + '"' + (String(S.pi) === String(p.idx) ? ' selected' : '') + '>' + esc(p.label) + '</option>';
  }).join('') : '');
}
function bindPeriod() {
  if (!$('pk')) return;          // মহানগরে সময়ভিত্তিক অংশ নেই
  fillPeriod();
  $('pk').onchange = function () { S.pk = this.value; S.pi = ''; fillPeriod(); };
  $('pi').onchange = function () { S.pi = this.value; };
  $('pgo').onclick = function () {
    if (!S.pk) return toast('ধরন নির্বাচন করুন', true);
    if (S.pk !== 'Y' && !S.pi) return toast('সময়কাল নির্বাচন করুন', true);
    viewPeriod(S.me.orgId);
  };
}

/* ---- পাতার কাঠামো: হোম/রিপোর্ট ট্যাবে নিচের মেনু; ফর্ম/সমন্বিত দেখার সময় উপরের সরু শিরোনাম ---- */
function chrome(mode) {
  var work = mode === 'work';
  $('hd').style.display = work && S.me ? 'flex' : 'none';
  if (window.BJI_NAV) { if (work) BJI_NAV.show(false); else BJI_NAV.render(S.view === 'reports' ? 'rep' : 'home', S.me && S.me.orgId); }
  if (work) setHH();
}
var CHILDS = { M: 'থানা', T: 'ওয়ার্ড', W: 'ইউনিট' };
function roleLabel() {
  var me = S.me, r = me.role;
  if (r === 'admin') return 'অ্যাডমিন';
  if (r === 'secretary') return 'সেক্রেটারি';
  if (me.level === 'T' || me.level === 'M') return 'আমীর/সভাপতি';
  return me.gender === 'F' ? 'সভানেত্রী' : 'সভাপতি';
}
function orgTitle() {
  var me = S.me, g = (me.level === 'W' || me.level === 'U') && single(me.gender) ? ' (' + (me.gender === 'F' ? 'মহিলা' : 'পুরুষ') + ')' : '';
  return (me.orgName || me.name) + g + (me.parentName ? ' - ' + me.parentName : '');
}
function kidCounts(h) {
  var c = { ACCEPTED: 0, SUBMITTED: 0, OTHER: 0 };
  h.children.forEach(function (k) { if (k.status === 'ACCEPTED') c.ACCEPTED++; else if (k.status === 'SUBMITTED') c.SUBMITTED++; else c.OTHER++; });
  return c;
}
function heroHtml(h) {
  var me = S.me, html = '<section class="hero"><div class="hbar"><div class="logo" aria-hidden="true">' +
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg></div>' +
    '<div class="htx"><b>মাসিক রিপোর্ট</b><span>' + esc(h.monthLabel) + '</span></div></div>' +
    '<p class="hi">আসসালামু আলাইকুম</p><h1 class="hname">' + esc(orgTitle()) + '</h1>' +
    '<p class="hrole">' + esc(roleLabel()) + (me.userName ? ' - ' + esc(me.userName) : '') + '</p>';
  if ((me.level === 'T' || me.level === 'M') && h.children.length) {
    var c = kidCounts(h);
    html += '<div class="stats"><div><b>' + bn(c.ACCEPTED) + '</b><span>একসেপ্টেড</span></div><div><b>' + bn(c.SUBMITTED) + '</b><span>রিভিউ বাকি</span></div>' +
      '<div><b>' + bn(c.OTHER) + '</b><span>জমা দেয়নি</span></div></div>';
  }
  return html + '</section>';
}
function monthCardHtml(h) {
  var lvl = S.me.level;
  // মহানগর মাসিক রিপোর্ট লেখে না (ষান্মাসিক/বার্ষিক আলাদা, তৈরি হচ্ছে); এ মাসে শুধু থানাগুলোর সমন্বিত রিপোর্ট
  if (lvl === 'M') return '<section class="card mc"><div class="hrow"><span class="mlab">' + esc(h.monthLabel) + ': থানাগুলোর রিপোর্ট</span></div>' +
    '<div class="mbtns"><button class="btn" id="tot">সমন্বিত রিপোর্ট</button></div>' +
    '<small class="mut" style="display:block;margin-top:8px">মহানগরের ষান্মাসিক ও বার্ষিক রিপোর্ট শীঘ্রই এখানে আসবে।</small></section>';
  var html = '<section class="card mc"><div class="hrow"><span class="mlab">' + esc(h.monthLabel) + ' এর রিপোর্ট</span>' + chip(h.status) + '</div>';
  if (h.status === 'RETURNED' && h.comment) html += '<div class="note bad"><b>ফেরত পাঠানোর কারণ:</b> ' + esc(h.comment) + '</div>';
  if (h.pending.length && h.canEdit) html += '<div class="note warn"><b>রিভিউ বাকি:</b> এদের রিপোর্ট একসেপ্ট বা ফেরত না দেওয়া পর্যন্ত ' + esc(h.submitLabel) + ' যাবে না — ' + esc(h.pending.join(', ')) + '</div>';
  else if (h.notIncluded.length && h.canEdit && h.status !== 'NONE') html += '<div class="note warn">এদের রিপোর্ট একসেপ্ট হয়নি, তাই এদের তথ্য আপনার মোটে ঢুকবে না: ' + esc(h.notIncluded.join(', ')) + '</div>';
  // পাশাপাশি দুই বোতাম: রিপোর্ট লিখুন/দেখুন · সমন্বিত রিপোর্ট; PDF থাকলে নিচে
  var main = h.canEdit ? 'রিপোর্ট লিখুন' : 'রিপোর্ট দেখুন';
  html += '<div class="mbtns"><button class="btn" id="open">' + main + '</button>';
  if (lvl === 'W' || lvl === 'T' || lvl === 'M') html += '<button class="btn sec" id="tot">সমন্বিত রিপোর্ট</button>';
  html += '</div>';
  if (h.canPdf) html += '<button class="btn sec" id="pdf" style="width:100%;margin-top:8px">PDF</button>';
  return html + '</section>';
}
function kidsHtml(h) {
  if (!h.children.length) return '';
  var c = kidCounts(h), nm = CHILDS[S.me.level] || 'অধীনস্থ';
  return '<section class="card"><div class="hrow" style="justify-content:space-between"><h2>' + nm + 'গুলোর অবস্থা</h2><small class="mut">' +
    bn(h.children.length) + 'টির ' + bn(c.ACCEPTED) + 'টি একসেপ্টেড</small></div>' + h.children.map(function (k) {
      var act = k.status === 'SUBMITTED' ? '<button class="btn" data-k="' + k.orgId + '">রিভিউ</button>'
        : (k.status !== 'NONE' ? '<button class="btn sec" data-k="' + k.orgId + '">দেখুন</button>' : '');
      return '<div class="row"><div class="nm">' + esc(String(k.name).split(' / ').pop()) + '</div>' + (k.status === 'SUBMITTED' ? '' : chip(k.status)) + act + '</div>';
    }).join('') + '</section>';
}
/* থানা/মহানগর: জমা না দেওয়া অধীনস্থদের রিমাইন্ডার */
function remindHtml(h) {
  var lvl = S.me.level;
  if (lvl !== 'T' && lvl !== 'M') return '';
  var left = h.children.filter(function (k) { return k.status !== 'SUBMITTED' && k.status !== 'ACCEPTED'; }).length;
  if (!left) return '';
  var nm = CHILDS[lvl];
  return '<section class="card rem"><div class="hrow"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>' +
    '<span>' + bn(left) + 'টি ' + nm + ' এখনো ' + esc(h.monthLabel) + ' এর রিপোর্ট জমা দেয়নি।</span></div>' +
    '<small class="mut" id="remlast">' + (lvl === 'T' ? 'প্রতি মাসের ৫ তারিখে' : 'প্রতি মাসের ১৫ তারিখে') + ' আগের মাসের জন্য স্বয়ংক্রিয় রিমাইন্ডার যায়।</small>' +
    '<button class="btn sec big" id="remind">বাকি ' + bn(left) + 'টি ' + nm + 'কে মনে করিয়ে দিন</button></section>';
}
function fillLastReminder() {
  if (!$('remlast') || !API.apiLastReminder) return;
  API.apiLastReminder(S.month).then(function (r) {
    if (!r || !$('remlast')) return;
    var d = new Date(r.created_at);
    $('remlast').textContent = 'শেষ রিমাইন্ডার: ' + bn(d.getDate()) + ' ' + S.monthNames[d.getMonth()] + ', ' + (r.kind === 'auto' ? 'স্বয়ংক্রিয়' : 'হাতে পাঠানো') + ' (' + bn(r.org_count) + 'টি ' + CHILDS[S.me.level] + ')';
  }).catch(function () { });
}
function reportsTop() {
  return '<div class="card"><h2>রিপোর্ট</h2><small class="mut">যেকোনো মাসের রিপোর্ট লিখতে বা দেখতে মাস বাছুন</small><div class="two"><div><label for="yr">সেশন</label><select id="yr">' +
    S.sessions.map(function (y) { return '<option value="' + y + '"' + (y === S.year ? ' selected' : '') + '>' + bn(y) + '</option>'; }).join('') +
    '</select></div><div><label for="mn">মাস</label><select id="mn">' + monthOptions() + '</select></div></div></div>';
}
function bindReportsTop() {
  if (!$('yr')) return;
  $('yr').onchange = function () { S.year = this.value; if (S.mon && S.year + '-' + S.mon > S.currentMonth) S.mon = ''; viewHome(); };
  $('mn').onchange = function () { S.mon = this.value; viewHome(); };
  bindPeriod();
}
function viewHome() {
  chrome('home');
  if (S.view !== 'reports') { S.year = S.currentMonth.substr(0, 4); S.mon = S.currentMonth.substr(5, 2); }
  S.month = S.mon ? S.year + '-' + S.mon : '';
  if (!S.month) {
    $('app').innerHTML = reportsTop() + periodCard();
    bindReportsTop();
    return;
  }
  call('apiHome', S.token, S.month).then(function (h) { showHome(h); }).catch(fail);
}

/* জমা/একসেপ্ট/ফেরতের উত্তরেই নতুন হোম-ডেটা আসে, তাই আলাদা সার্ভার-ডাক ছাড়াই পাতা আঁকা হয় */
function showHome(h) {
  S.home = h; chrome('home');
  var lvl = S.me.level;
  $('app').innerHTML = S.view === 'reports'
    ? reportsTop() + monthCardHtml(h) + kidsHtml(h) + remindHtml(h) + periodCard()
    : heroHtml(h) + monthCardHtml(h) + kidsHtml(h) + remindHtml(h);
  window.scrollTo(0, 0);
  bindReportsTop();
  if ($('open')) $('open').onclick = function () { viewForm(S.me.orgId); };
  if ($('pdf')) $('pdf').onclick = function () { downloadPdf(S.me.orgId); };
  if ($('tot')) $('tot').onclick = function () { viewTotals(S.me.orgId); };
  [].forEach.call(document.querySelectorAll('[data-k]'), function (b) { b.onclick = function () { viewForm(b.getAttribute('data-k')); }; });
  [].forEach.call(document.querySelectorAll('[data-o]'), function (b) { b.onclick = function () { viewOpening(b.getAttribute('data-o')); }; });
  if ($('remind')) $('remind').onclick = function () {
    var btn = this;
    modal({ title: 'রিমাইন্ডার পাঠাবেন?', text: 'যারা ' + h.monthLabel + ' এর রিপোর্ট এখনো জমা দেয়নি, শুধু তাদের সভাপতি ও সেক্রেটারির ফোনে নোটিফিকেশন যাবে (যারা নোটিফিকেশন চালু করেছেন)।', ok: 'পাঠান' }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      call('apiRemind', S.token, S.month).then(function (r) { toast(bn(r.orgs) + 'টি ' + CHILDS[S.me.level] + 'কে রিমাইন্ডার পাঠানো হয়েছে'); fillLastReminder(); })
        .catch(function (e) { btn.disabled = false; fail(e); });
    });
  };
  fillLastReminder();
  if (window.BJI_PUSH) BJI_PUSH.resync(API.sb);
}
/* ================= শুরুর সংখ্যা ================= */
function openingScope(f, lvl) {
  var whole = /rootprev|selfT/.test(f.opt || '');
  if (f.pattern === 'FX') return '';
  if (lvl === 'T') return whole ? 'পুরো থানা, ওয়ার্ডসহ' : (f.enter.indexOf('W') >= 0 ? 'শুধু থানার নিজের অংশ' : '');
  if (lvl === 'W') return whole ? 'পুরো ওয়ার্ড, ইউনিটসহ' : (f.enter.indexOf('U') >= 0 ? 'শুধু ওয়ার্ডের নিজের অংশ' : '');
  if (lvl === 'M') return 'শুধু থানার বাইরের অংশ';
  return '';
}
function viewOpening(orgId) {
  chrome('work');
  call('apiOpening', S.token, orgId).then(function (o) {
    var edit = o.canEdit, fixedOnly = edit && o.locked;
    var html = '<div class="card"><h2>শুরুর সংখ্যা: ' + esc(o.orgName) + '</h2>' +
      '<p class="subtle">অ্যাপে প্রথম মাসিক রিপোর্ট লেখার আগের মাসের শেষে যে সংখ্যা ছিল তা লিখুন। এই সংখ্যাই প্রথম রিপোর্টের "বিগত সংখ্যা" হবে; এরপর প্রতি মাসে শুধু বৃদ্ধি/ঘাটতি লিখলেই হবে।</p>';
    if (o.locked) html += '<div class="note warn"><b>🔒 আটকানো:</b> এই সংগঠনের মাসিক রিপোর্ট একসেপ্ট হয়ে গেছে, তাই শুরুর সংখ্যা আর বদলানো যায় না।' +
      (edit ? ' বদলাতে উপরের স্তরকে "খুলে দিন" বলুন। শুধু মোট জনসংখ্যা বদলানো যায়।' : (o.canUnlock ? ' নিচের "খুলে দিন" চাপলে আবার লেখা যাবে।' : '')) + '</div>';
    else if (o.hasAccepted) html += '<div class="note warn">খুলে দেওয়া হয়েছে। এখন ঠিক করলে পার্থক্যটুকু পরের মাসের রিপোর্টের "বিগত সংখ্যা" তে যোগ হবে।</div>';
    if (!edit && !o.canUnlock) html += '<div class="note warn">এটি শুধু দেখার জন্য।</div>';
    html += '</div>';
    var sec = null, lastSub = null, body = '';
    o.fields.forEach(function (f) {
      if (f.section !== sec) { if (sec !== null) body += '</div>'; sec = f.section; lastSub = null; body += '<div class="card"><h2>' + esc(f.section) + '</h2>'; }
      var ro = !edit || (fixedOnly && f.pattern !== 'FX'), v = o.data[f.key];
      var sc = openingScope(f, o.level);
      if (f.sub && f.sub !== lastSub) body += '<p class="mut" style="margin:12px 0 2px;font-weight:600">' + esc(f.sub) + '</p>';
      lastSub = f.sub;
      body += '<div class="row oprow"><label class="nm" for="op_' + f.key + '">' + esc(ctxLabel(f, o.gender)) +
        (sc ? ' <small class="mut">(' + sc + ')</small>' : '') + '</label>' +
        '<input id="op_' + f.key + '" data-op="' + f.key + '" inputmode="decimal" style="max-width:110px;text-align:right"' + (ro ? ' readonly' : '') +
        ' value="' + (typeof v === 'number' ? bn(v) : '') + '" placeholder="০"></div>';
    });
    if (sec !== null) body += '</div>';
    html += (o.fields.length ? body : '<div class="card"><p>এই স্তরে শুরুর সংখ্যার কোনো ঘর নেই।</p></div>') +
      '<div class="bar"><button class="btn sec" id="bk">← Back</button>' +
      (o.canUnlock ? '<button class="btn" id="unl">খুলে দিন</button>' : '') +
      (edit && o.fields.length ? '<button class="btn" id="osv">সংরক্ষণ</button>' : '') + '</div>';
    $('app').innerHTML = html;
    window.scrollTo(0, 0);
    $('bk').onclick = function () {
      if (/^#opening:/.test(location.hash)) { location.href = 'index.html#org'; return; }
      if (location.hash === '#opening') history.replaceState(null, '', '#home');
      viewHome();
    };
    // আটকানো ঘরে চাপলে কেন লেখা যাচ্ছে না তা বলা (ফোনে কিবোর্ড আসে না বলে)
    [].forEach.call(document.querySelectorAll('input[data-op][readonly]'), function (i) {
      i.onclick = function () {
        toast(!edit ? 'এটি শুধু দেখার জন্য।' : 'শুরুর সংখ্যা আটকানো আছে। বদলাতে উপরের স্তরকে "খুলে দিন" বলুন।', true);
      };
    });
    if ($('osv')) $('osv').onclick = function () {
      var d = {}, bad = '';
      [].forEach.call(document.querySelectorAll('input[data-op]'), function (i) {
        var t = en(i.value).trim().replace(/,/g, '');
        if (t === '') return;
        var n = Number(t);
        if (!isFinite(n) || n < 0) { bad = bad || i.id; return; }
        d[i.getAttribute('data-op')] = n;
      });
      if (bad) { toast('সংখ্যা ঠিক নয়', true); $(bad).focus(); return; }
      call('apiSaveOpening', S.token, o.orgId, d).then(function () { toast('শুরুর সংখ্যা সংরক্ষিত হয়েছে'); viewOpening(o.orgId); }).catch(fail);
    };
    if ($('unl')) $('unl').onclick = function () {
      modal({ title: 'শুরুর সংখ্যা খুলে দেবেন?', text: o.orgName + ' আবার শুরুর সংখ্যা ঠিক করতে পারবে। পরের রিপোর্ট একসেপ্ট হলে আবার আটকে যাবে।', ok: 'খুলে দিন' }).then(function (ok) {
        if (!ok) return;
        call('apiUnlockOpening', S.token, o.orgId).then(function () { toast('খুলে দেওয়া হয়েছে'); viewOpening(o.orgId); }).catch(fail);
      });
    };
  }).catch(fail);
}
window.addEventListener('hashchange', function () {
  if (!S.me) return;
  if (location.hash.indexOf('#opening') === 0) { viewOpening(openingTarget()); return; }
  S.view = location.hash === '#reports' ? 'reports' : 'home';
  viewHome();
});

/* ================= রিপোর্টের ফর্ম ================= */
/* কলামের নাম: ফিল্ডে নিজস্ব নাম থাকলে সেটা (সার্ভারের colLabel_ এর মতোই) */
function colLabel(f, c) {
  if (c.slot !== undefined && f.labels && f.labels[c.slot]) return f.labels[c.slot] + (c.sfx ? ' — ' + c.sfx : '');
  return c.label;
}

/* ---- প্রসঙ্গ (লিঙ্গ) অনুযায়ী দেখানো ----
   পুরুষ/মহিলা রিপোর্টে অপ্রযোজ্য ঘর DOM-এ আসেই না (blur/opacity/disabled নয়); থানা (B) সবটা দেখে।
   সিদ্ধান্ত আসে ফিল্ডের নিজস্ব ডেটা থেকে (PATTERNS.gender)—কোনো ফিল্ড-আইডি বা আলাদা CSS হাতে লেখা নেই। */
function single(g) { return g === 'M' || g === 'F'; }
/* একক-লিঙ্গ রিপোর্টে লেবেল থেকে "(পুরুষ)", "(মহিলা)", "(পুরুষ/মহিলা)", " — পুরুষ" বাদ */
function ctxClean(t, g) {
  t = String(t == null ? '' : t);
  if (!single(g)) return t;
  return t.replace(/\s*[—-]\s*(পুরুষ|মহিলা)\s*$/, '').replace(/\s*\((পুরুষ\/মহিলা|মহিলা\/পুরুষ|পু\/ম|পুরুষ|মহিলা)\)/g, '').replace(/\s{2,}/g, ' ').trim();
}
/* ফিল্ডের বিবরণ: opt "gsfx" থাকলে একক-লিঙ্গ রিপোর্টে "পেশাজীবী পুরুষ"/"পেশাজীবী মহিলা" (Logic.gs ctxLabel_ এর সমান) */
function ctxLabel(f, g) { var t = ctxClean(f.label, g); if (single(g) && /gsfx/.test(f.opt || '')) t += ' ' + (g === 'M' ? 'পুরুষ' : 'মহিলা'); return t; }
function isAutoInc(f) { return /autoinc:/.test(f.opt || ''); }
function colAllowed(p, c, g) { var cg = p.gender && p.gender[c.k]; return !(cg && g !== 'B' && cg !== g); }
/* এই ফিল্ডের জন্য যে ঘরগুলো দেখানো হবে (প্রসঙ্গে প্রযোজ্য ঘর), লেবেলসহ */
function visCols(f, g) {
  var p = S.patterns[f.pattern];
  var cs = p.cols.filter(function (c) { return colAllowed(p, c, g) && !(f.hide && f.hide.indexOf(c.k) >= 0); });
  if (single(g) && (f.pattern === 'M3' || f.pattern === 'PM')) {      // শ্রোতার লিঙ্গ = রিপোর্টের লিঙ্গ: একটাই ঘর, নাম "সংখ্যা"
    cs = cs.filter(function (c) { return !c.calc; }).map(function (c) { return { k: c.k, label: 'সংখ্যা' }; });
  }
  return cs.map(function (c) { return { k: c.k, calc: c.calc, slot: c.slot, sfx: c.sfx, label: ctxClean(colLabel(f, c), g) }; });
}

function cellHtml(f, p, c, rep) {
  var d = (rep.data && rep.data[f.key]) || {}, der = (rep.derived && rep.derived[f.key]) || {}, id = f.key + '.' + c.k;
  var lab = c.label ? '<span class="cl">' + esc(c.label) + '</span>' : '<span class="cl"></span>';
  var isInput = p.inputs.indexOf(c.k) >= 0 && !(c.k === 'inc' && isAutoInc(f)) && !f.ro;   // f.ro = নিচের স্তরের যোগফল (শুধু পড়া)
  if (isInput && rep.editable) {
    var val = d[c.k] === undefined ? '' : bn(d[c.k]);
    return '<div class="col">' + lab + '<input inputmode="decimal" data-f="' + f.key + '" data-c="' + c.k + '" value="' + esc(val) + '"></div>';
  }
  var v = der[c.k], shown = c.k === 'rate' ? (v === null || v === undefined ? '—' : fmt(v) + '%') : fmt(v);
  return '<div class="col">' + lab + '<div class="ro" data-calc="' + id + '">' + shown + '</div></div>';
}

/* ফিল্ডের ভেতরের ঘরের ছক: n টি ঘর → n কলাম (CSS .nN) */
function gridHtml(f, rep) {
  var p = S.patterns[f.pattern], g = rep.gender, cols = visCols(f, g);
  if (p.grid) {      // গণসংযোগের ছক: প্রতি লিঙ্গের জন্য আলাদা সারি, প্রতি সারিতে গ্রুপের ৪টি কলাম
    var rows = '';
    ['M', 'F'].forEach(function (x) {
      var rc = cols.filter(function (c) { return p.gender[c.k] === x; });
      if (!rc.length) return;
      var cells = rc.map(function (c) {
        var base = f.labels && f.labels[c.slot] ? f.labels[c.slot] : p.cols.filter(function (q) { return q.k === c.k; })[0].label.replace(/\s*—\s*(পুরুষ|মহিলা)\s*$/, '');
        return cellHtml(f, p, { k: c.k, label: base }, rep);
      }).join('');
      rows += (single(g) ? '' : '<div class="gl">' + (x === 'M' ? 'পুরুষ' : 'মহিলা') + '</div>') + '<div class="grid n' + rc.length + '">' + cells + '</div>';
    });
    return rows;
  }
  if (p.text) {
    var d = (rep.data && rep.data[f.key]) || {};
    return '<div class="grid n1" style="max-width:none">' + (rep.editable
      ? '<textarea data-f="' + f.key + '" data-c="txt">' + esc(d.txt || '') + '</textarea>'
      : '<div class="ro" style="text-align:left">' + esc(d.txt || '—') + '</div>') + '</div>';
  }
  return '<div class="grid n' + Math.min(cols.length, 8) + '">' + cols.map(function (c) { return cellHtml(f, p, c, rep); }).join('') + '</div>';
}

function fieldHtml(f, rep, inGroup) {
  var d = (rep.data && rep.data[f.key]) || {}, lbl = '';
  if (f.lbl) {   // "অন্যান্য" সারি: ব্যবহারকারী নিজে নাম লেখে
    lbl = rep.editable
      ? '<input class="lbin" data-f="' + f.key + '" data-c="lbl" maxlength="100" placeholder="কীসের তথ্য, নাম লিখুন" value="' + esc(d.lbl || '') + '">'
      : (d.lbl ? '<div class="fnote">নাম: ' + esc(d.lbl) + '</div>' : '');
  }
  var note = f.note ? '<div class="fnote">' + esc(f.note) + '</div>' : '';
  return '<div class="fld" data-fld="' + f.key + '"><div class="lb">' + esc(ctxLabel(f, rep.gender)) + '</div>' + note + lbl + gridHtml(f, rep) + '</div>';
}

/* skipSection: ট্যাবের নামের সাথে হুবহু মিললে আলাদা শিরোনাম দেখানো হয় না (দ্বিগুণ হয়ে যেত)।
   grp: একই grp-এর ফিল্ডগুলো প্রথমটির জায়গায় এক সারিতে পাশাপাশি বসে (বাকিগুলো নিজের জায়গা থেকে সরে যায়)। */
function sectionsHtml(fields, rep, skipSection) {
  var html = '', sec = null, sub = null, members = {}, done = {};
  fields.forEach(function (f) { if (f.grp) (members[f.grp] = members[f.grp] || []).push(f); });
  fields.forEach(function (f) {
    if (done[f.key]) return;
    if (f.section !== sec) { if (f.section !== skipSection) html += '<div class="sec">' + esc(f.section) + '</div>'; sec = f.section; sub = null; }
    if (f.sub !== sub) { if (f.sub) html += '<div class="sub">' + esc(f.sub) + '</div>'; sub = f.sub; }
    var m = f.grp && members[f.grp].length > 1 ? members[f.grp] : null;
    if (m) {
      m.forEach(function (x) { done[x.key] = 1; });
      var wide = m.some(function (x) { return visCols(x, rep.gender).length > 2; });
      html += '<div class="fgrp g' + m.length + (wide ? ' wide' : '') + '" style="--gn:' + m.length + '">' + m.map(function (x) { return fieldHtml(x, rep, true); }).join('') + '</div>';
    } else html += fieldHtml(f, rep);
  });
  return html;
}

/* ---- ৫ বিভাগের ট্যাব (শুধু তথ্য-লেখার ফর্মে) ----
   সব বিভাগের ঘর পাতায় থাকে, শুধু বাছাই-করাটা দেখায়; তাই "সংরক্ষণ/জমা" সব বিভাগের তথ্য একসাথে নেয়। */
function tabbedFormHtml(fields, rep) {
  var byTab = S.tabs.map(function () { return []; }), rest = [];
  fields.forEach(function (f) { if (f.tab >= 0 && f.tab < S.tabs.length) byTab[f.tab].push(f); else rest.push(f); });
  S.tabHas = byTab.map(function (x) { return x.length > 0; });
  if (!(S.tab >= 0 && S.tab < S.tabs.length)) S.tab = 0;
  var nav = '<div class="tabs" id="tabs" role="tablist" aria-label="রিপোর্টের বিভাগ">' + S.tabs.map(function (nm, i) {
    var on = i === S.tab;
    return '<button type="button" class="tab' + (on ? ' active' : '') + '" id="tab' + i + '" role="tab" aria-selected="' + on + '" aria-controls="panel' + i + '" tabindex="' + (on ? 0 : -1) + '">' + esc(nm) + '</button>';
  }).join('') + '</div>';
  var panels = S.tabs.map(function (nm, i) {
    return '<div class="card tabpanel" id="panel' + i + '" role="tabpanel" aria-labelledby="tab' + i + '"' + (i === S.tab ? '' : ' hidden') + '>' +
      (byTab[i].length ? sectionsHtml(byTab[i], rep, nm) : '<p class="mut">এই বিভাগের ঘর এখনও যোগ করা হয়নি।</p>') + '</div>';
  }).join('');
  var more = rest.length ? '<div class="card"><h2>অন্যান্য অংশ</h2>' + sectionsHtml(rest, rep) + '</div>' : '';
  return nav + panels + more;
}

/* স্টিকি হেডার + স্টিকি ট্যাব-বারের মোট উচ্চতা (কনটেন্ট যেন এর নিচে না লুকায়) */
function stickyH() { var h = $('hd'), t = $('tabs'); return (h && h.offsetHeight || 0) + (t && t.offsetHeight || 0); }
function setHH() { var h = $('hd'), r = document.documentElement; if (r && r.style) r.style.setProperty('--hh', ((h && h.offsetHeight) || 52) + 'px'); }

/* পরবর্তী ট্যাব যেখানে দেখানোর মতো ঘর আছে; না থাকলে -1 (তখন "জমা দিন") */
function nextTab(from) {
  for (var j = from + 1; j < S.tabs.length; j++) if (!S.tabHas || S.tabHas[j]) return j;
  return -1;
}
function syncBar() {
  var nx = $('nx'), sb = $('sb'); if (!nx || !sb) return;
  var more = nextTab(S.tab) >= 0;
  nx.style.display = more ? '' : 'none';
  sb.style.display = more ? 'none' : '';
}

function setTab(i, focus) {
  S.tab = i;
  S.tabs.forEach(function (nm, j) {
    var t = $('tab' + j), pn = $('panel' + j), on = j === i;
    t.className = 'tab' + (on ? ' active' : '');
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.setAttribute('tabindex', on ? '0' : '-1');
    pn.hidden = !on;
  });
  if (focus && $('tab' + i).focus) $('tab' + i).focus();
  var pn = $('panel' + i);
  if (pn && pn.getBoundingClientRect && window.scrollTo) window.scrollTo(0, Math.max(0, pn.getBoundingClientRect().top + (window.pageYOffset || 0) - stickyH() - 8));
  syncBar();
}

function bindTabs() {
  S.tabs.forEach(function (nm, i) {
    var t = $('tab' + i);
    t.onclick = function () { setTab(i); };
    t.onkeydown = function (e) {   // তীর-চিহ্ন/Home/End দিয়ে ট্যাব বদল
      var n = S.tabs.length, k = e && e.key, to = -1;
      if (k === 'ArrowRight') to = (i + 1) % n; else if (k === 'ArrowLeft') to = (i + n - 1) % n;
      else if (k === 'Home') to = 0; else if (k === 'End') to = n - 1;
      if (to >= 0) { if (e.preventDefault) e.preventDefault(); setTab(to, true); }
    };
  });
}

/* টাইপ করার সময় তাৎক্ষণিক হিসাব (শেষ হিসাব সার্ভারেই হয়) */
function recalc(fkey) {
  var f = S.cur.fields.filter(function (x) { return x.key === fkey; })[0], v = {};
  if (!f || isAutoInc(f)) return;       // স্বয়ংক্রিয় বৃদ্ধি: সার্ভারের হিসাব (apiPreview) বসায়
  [].forEach.call(document.querySelectorAll('[data-f="' + fkey + '"]'), function (i) { v[i.getAttribute('data-c')] = num(i.value); });
  var prev = (S.cur.prev && S.cur.prev[fkey]) || 0, set = function (c, x, pct) {
    var el = document.querySelector('[data-calc="' + fkey + '.' + c + '"]'); if (el) el.textContent = x === null ? '—' : fmt(x) + (pct ? '%' : '');
  };
  var n = function (k) { return v[k] || 0; };
  if (f.pattern === 'M3') set('tot', n('m') + n('f'));
  if (f.pattern === 'TB') { set('prev', prev); set('cur', prev + n('inc')); }
  if (f.pattern === 'CF') { set('prev', prev); set('cur', prev + n('inc') - n('dec')); set('rate', n('target') > 0 ? n('inc') / n('target') * 100 : null, true); }
  if (f.pattern === 'CFS') { var ic = n('up') + n('in'); set('prev', prev); set('inc', ic); set('cur', prev + ic - n('dec')); set('rate', n('target') > 0 ? ic / n('target') * 100 : null, true); }
  if (f.pattern === 'TBT' || f.pattern === 'YTD') { set('prev', prev); set('cur', prev + n('inc')); }
  if (f.pattern === 'CFN') { set('prev', prev); set('cur', prev + n('inc')); set('rate', n('target') > 0 ? n('inc') / n('target') * 100 : null, true); }
  if (f.pattern === 'CB') set('prev', prev);
  if (f.pattern === 'R4') set('tot', n('sm') + n('sf') + n('km') + n('kf'));
  if (f.pattern === 'CP') set('rate', n('target') > 0 ? (n('rm') + n('rf')) / n('target') * 100 : null, true);
  if (f.pattern === 'CP1') set('rate', n('target') > 0 ? n('r') / n('target') * 100 : null, true);
}

function collect() {
  var data = {};
  [].forEach.call(document.querySelectorAll('[data-f]'), function (i) {
    var k = i.getAttribute('data-f'); (data[k] = data[k] || {})[i.getAttribute('data-c')] = i.value;
  });
  return data;
}

/* স্বয়ংক্রিয় ঘরের মান পর্দায় বসানো (সংরক্ষণের উত্তর বা apiPreview থেকে) */
function applyVals(vals) {
  Object.keys(vals || {}).forEach(function (k) {
    Object.keys(vals[k]).forEach(function (c) {
      var el = document.querySelector('[data-calc="' + k + '.' + c + '"]'); if (!el) return;
      var v = vals[k][c]; el.textContent = c === 'rate' ? (v === null || v === undefined ? '—' : fmt(v) + '%') : fmt(v);
    });
  });
}
/* লেখার সময় স্বয়ংক্রিয় ঘরগুলোর মান: একটু থেমে নিঃশব্দে সার্ভার থেকে (কিছু লেখে না, অপেক্ষার পর্দা আসে না) */
var previewT, previewSeq = 0;
function schedulePreview() {
  clearTimeout(previewT);
  previewT = setTimeout(function () {
    if (!S.cur || !S.cur.editable) return;
    var seq = ++previewSeq;
    API.apiPreview(S.month, collect()).then(function (r) { if (seq === previewSeq && r) applyVals(r.vals); }, function () { });
  }, 700);
}
window.addEventListener('resize', setHH);

function viewForm(orgId) {
  chrome('work');
  call('apiGetReport', S.token, S.month, orgId).then(function (rep) {
    S.cur = rep; S.tab = 0;
    var html = '<div class="card"><div class="hrow"><h2>' + esc(rep.orgName) + '</h2>' + chip(rep.status) + '</div><p class="subtle">' + esc(rep.monthLabel) + '</p>';
    if (rep.status === 'RETURNED' && rep.comment) html += '<div class="note bad"><b>ফেরত পাঠানোর কারণ:</b> ' + esc(rep.comment) + '</div>';
    if (rep.excluded && rep.excluded.length) html += '<div class="note warn"><b>অন্তর্ভুক্ত হয়নি:</b> এদের রিপোর্ট একসেপ্ট হয়নি, তাই এদের তথ্য এই মোটে নেই — ' + esc(rep.excluded.join(', ')) + '</div>';
    if (!rep.editable && !rep.canReview) html += '<div class="note warn">এটি শুধু দেখার জন্য।</div>';
    if (rep.editable) html += '<div id="ophint"></div>';
    html += '</div>';
    if (!rep.fields.length) html += '<div class="card"><p>এই স্তরের জন্য কোনো ঘর নেই।</p></div>';
    else if (rep.editable) html += tabbedFormHtml(rep.fields, rep);      // তথ্য লেখার সময়ই ৫টি বিভাগের ট্যাব
    else html += '<div class="card">' + sectionsHtml(rep.fields, rep) + '</div>';   // দেখা/রিভিউ: সব একসাথে, ট্যাব নেই
    html += '<div class="bar"><button class="btn sec" id="bk">← Back</button>';
    if (rep.canPdf) html += '<button class="btn sec" id="pdf">PDF</button>';
    if (rep.orgId !== S.me.orgId) html += '<button class="btn sec" id="opn">শুরুর সংখ্যা</button>';
    if (rep.editable) html += '<button class="btn sec" id="sv">সংরক্ষণ</button><button class="btn" id="nx">পরবর্তী</button><button class="btn" id="sb">' + 'জমা দিন' + '</button>';
    if (rep.canReview) html += '<button class="btn bad" id="rt">ফেরত পাঠান</button><button class="btn" id="ac">একসেপ্ট করুন</button>';
    html += '</div>';
    $('app').innerHTML = html;
    window.scrollTo(0, 0);
    $('bk').onclick = viewHome;
    if ($('pdf')) $('pdf').onclick = function () { downloadPdf(rep.orgId); };
    if ($('opn')) $('opn').onclick = function () { viewOpening(rep.orgId); };
    // শুরুর সংখ্যা দেওয়া না থাকলে (আর আগে কোনো রিপোর্ট একসেপ্ট না হলে) ফর্মের উপরে ছোট একটা মনে করানো
    if (rep.editable && API.apiOpening) API.apiOpening(rep.orgId).then(function (o) {
      if (o.locked || o.filled || o.hasAccepted || !o.fields.length || !$('ophint')) return;
      $('ophint').innerHTML = '<div class="note warn">শুরুর সংখ্যা এখনো দেওয়া হয়নি, তাই "বিগত সংখ্যা" ০ থেকে শুরু হবে। <a class="lnk" href="#" id="opgo">শুরুর সংখ্যা দিন</a> (প্রোফাইলেও আছে)।</div>';
      $('opgo').onclick = function (e) { e.preventDefault(); viewOpening(rep.orgId); };
    }).catch(function () { });
    if (rep.editable) {
      bindTabs(); setHH(); syncBar();
      $('nx').onclick = function () { var j = nextTab(S.tab); if (j >= 0) setTab(j); };
      var needPreview = rep.fields.some(function (f) { return f.pattern === 'AUTO' || f.pattern === 'AUTO4' || isAutoInc(f); });
      [].forEach.call(document.querySelectorAll('input[data-f]'), function (i) {
        i.oninput = function () { recalc(i.getAttribute('data-f')); if (needPreview) schedulePreview(); };
      });
      $('sv').onclick = function () { call('apiSaveDraft', S.token, S.month, collect()).then(function (r) {
        applyVals(r.auto);
        toast('সংরক্ষিত হয়েছে');
      }).catch(fail); };
      $('sb').onclick = function () {
        var skip = (S.home && S.me.level !== 'U' && S.home.notIncluded.length) ? ' সতর্কতা: এদের তথ্য ঢুকবে না — ' + S.home.notIncluded.join(', ') + '।' : '';
        modal({ title: 'জমা দেবেন?', text: 'জমা দেওয়ার পর উপরের স্তর ফেরত না পাঠালে বদলানো যাবে না।' + skip, ok: 'হ্যাঁ' }).then(function (ok) {
          if (!ok) return;
          call('apiSubmit', S.token, S.month, collect())
            .then(function (r) { toast('সম্পন্ন'); showHome(r.home); }).catch(fail);
        });
      };
    }
    if (rep.canReview) {
      $('ac').onclick = function () { call('apiReview', S.token, S.month, rep.orgId, 'accept', '').then(function (r) { toast('একসেপ্ট করা হয়েছে'); showHome(r.home); }).catch(fail); };
      $('rt').onclick = function () {
        modal({ title: 'ফেরত পাঠান', text: 'কী সংশোধন করতে হবে লিখুন।', input: true, ok: 'ফেরত পাঠান', bad: true }).then(function (c) {
          if (c === null) return;
          call('apiReview', S.token, S.month, rep.orgId, 'return', c).then(function (r) { toast('ফেরত পাঠানো হয়েছে'); showHome(r.home); }).catch(fail);
        });
      };
    }
  }).catch(fail);
}

/* ================= সমন্বিত রিপোর্ট (মাসিক) ================= */
function viewTotals(orgId) {
  chrome('work');
  call('apiTotals', S.token, S.month, orgId).then(function (t) {
    var rep = { editable: false, data: {}, derived: t.values, gender: t.gender };
    var head = t.metro
      ? '<div class="card"><h2>সব থানার সমন্বিত রিপোর্ট</h2><small class="mut">' + esc(t.monthLabel) + ' · যোগ হয়েছে ' + bn(t.nodeCount) + 'টি থানার রিপোর্ট</small>' +
        (t.submittedOnly.length ? '<div class="note warn">জমা হয়েছে কিন্তু একসেপ্ট বাকি (তবু যোগ হয়েছে): ' + esc(t.submittedOnly.join(', ')) + '</div>' : '') +
        (t.missing.length ? '<details class="note warn"><summary>যাদের রিপোর্ট জমা হয়নি (' + bn(t.missing.length) + ')</summary><p style="margin:6px 0 0">' + esc(t.missing.join(', ')) + '</p></details>' : '') + '</div>'
      : '<div class="card"><h2>সমন্বিত রিপোর্ট: ' + esc(t.orgName) + '</h2><small class="mut">' + esc(t.monthLabel) +
        ' · যোগ হয়েছে ' + bn(t.nodeCount) + 'টি একসেপ্টেড রিপোর্ট (নিজেরটাসহ)</small></div>';
    $('app').innerHTML = head +
      '<div class="card">' + (t.fields.length ? sectionsHtml(t.fields, rep) : '<p>' + (t.metro ? 'এই মাসে কোনো থানার রিপোর্ট জমা হয়নি।' : 'এখনও কোনো একসেপ্টেড রিপোর্ট নেই।') + '</p>') + '</div>' +
      '<div class="bar"><button class="btn sec" id="bk">← Back</button>' + (t.metro && t.nodeCount ? '<button class="btn sec" id="mpdf">PDF</button>' : '') + '</div>';
    window.scrollTo(0, 0);
    $('bk').onclick = viewHome;
    if ($('mpdf')) $('mpdf').onclick = function () { showPdf(call('apiMetroPdf', S.token, S.month)); };
  }).catch(fail);
}

/* ================= সমন্বিত রিপোর্ট (ত্রৈমাসিক / ষান্মাসিক / বাৎসরিক) ================= */
function viewPeriod(orgId) {
  chrome('work');
  call('apiPeriod', S.token, S.year, S.pk, S.pk === 'Y' ? 1 : S.pi, orgId).then(function (t) {
    var rep = { editable: false, data: {}, derived: t.values, gender: t.gender };
    var gaps = t.coverage.filter(function (c) { return c.missing.length; }), gapN = 0;
    gaps.forEach(function (c) { gapN += c.missing.length; });
    var html = '<div class="card"><h2>' + esc(t.kindName) + ' সমন্বিত রিপোর্ট: ' + esc(t.orgName) + '</h2><small class="mut">' + esc(t.periodLabel) +
      ' · যোগ হয়েছে ' + bn(t.nodeCount) + (t.metro ? 'টি থানার মাসিক রিপোর্ট (জমা ও একসেপ্টেড)' : 'টি একসেপ্টেড মাসিক রিপোর্ট') + '</small>';
    if (t.partial) html += '<div class="note warn">এই সময়কাল এখনও শেষ হয়নি। এখন পর্যন্ত একসেপ্টেড রিপোর্টের যোগফল দেখানো হচ্ছে।</div>';
    if (gaps.length) html += '<details class="note warn"><summary>যাদের মাসিক তথ্য অন্তর্ভুক্ত হয়নি (' + bn(gapN) + ')</summary>' +
      gaps.map(function (c) { return '<p style="margin:6px 0 0"><b>' + esc(c.label) + ':</b> ' + esc(c.missing.join(', ')) + '</p>'; }).join('') + '</details>';
    html += '</div><div class="card">' + (t.fields.length ? sectionsHtml(t.fields, rep) : '<p>এই সময়কালে কোনো একসেপ্টেড রিপোর্ট নেই।</p>') + '</div>' +
      '<div class="bar"><button class="btn sec" id="bk">← Back</button><button class="btn sec" id="pdf">PDF</button></div>';
    $('app').innerHTML = html;
    window.scrollTo(0, 0);
    $('bk').onclick = viewHome;
    $('pdf').onclick = function () { downloadPeriodPdf(orgId); };
  }).catch(fail);
}

/* শুরু: Google লগইন (সংগঠন পাতা) থেকে আসে; কোন সংগঠনের রিপোর্ট তা ?org= দিয়ে */
function pickOrg(list) {
  $('hd').style.display = 'none';
  $('app').innerHTML = '<div class="card"><h2>কোন সংগঠনের রিপোর্ট?</h2>' + (list.length ? list.map(function (o) {
    return '<div class="row"><div class="nm">' + esc(o.name) + '</div><a class="btn" href="report.html?org=' + encodeURIComponent(o.id) + '">খুলুন</a></div>';
  }).join('') : '<p>আপনি এখনো কোনো সংগঠনের দায়িত্বে নেই।</p>') + '<p><a class="lnk" href="index.html">← সংগঠন পাতা</a></p></div>';
}
function start() {
  var want = new URLSearchParams(location.search).get('org');
  busy(true);
  API.init(want).then(function (r) {
    busy(false);
    var ids = r.mine.map(function (o) { return o.id; });
    if (!want && window.BJI_NAV && ids.indexOf(BJI_NAV.org()) >= 0) want = BJI_NAV.org();
    if (!want && r.mine.length === 1) want = r.mine[0].id;
    if (!want || ids.indexOf(want) < 0) { pickOrg(r.mine); return; }
    API.use(want);
    if (window.BJI_NAV) BJI_NAV.setOrg(want);
    S.view = location.hash === '#reports' ? 'reports' : 'home';
    return API.apiBootstrap().then(function (b) { applyBoot(b); afterBoot(); });
  }).catch(function (e) {
    busy(false);
    if (String(e && e.message).indexOf('SESSION') >= 0) { location.href = 'index.html'; return; }
    $('app').innerHTML = '<div class="card"><div class="note bad">' + esc(e.message || e) + '</div><button class="btn" onclick="location.reload()">আবার চেষ্টা করুন</button></div>';
  });
}
start();
