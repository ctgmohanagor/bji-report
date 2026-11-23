/* পুরনো সিস্টেমের Logic.gs হুবহু (হিসাবের নিয়ম)। Apps Script নির্ভরতা নেই, তাই ব্রাউজারেও চলে।
   উৎস: report_system_v9/Logic.gs — এখানে বদলালে পরীক্ষাগুলোও মিলিয়ে নিতে হবে। */
/* =====================================================================
   Logic.gs — খাঁটি লজিক (Google সার্ভিস ছাড়া, তাই আলাদাভাবে পরীক্ষা করা যায়)
   • সংখ্যার ধরন (PATTERNS) ও যোগফল
   • ইনপুট যাচাই (পুরুষ/মহিলা ঘর আটকানো)
   • "বিগত → বর্তমান" হিসাব
   • কে কী দেখতে পারবে
   • জমা/একসেপ্টের শর্ত
   ===================================================================== */

var STATUS = { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', RETURNED: 'RETURNED', ACCEPTED: 'ACCEPTED' };
var LEVEL_OF = { unit: 'U', ward: 'W', thana: 'T' };
var BN_DIGITS = '০১২৩৪৫৬৭৮৯';
var MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট',
                 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

/* ---------- সংখ্যার ধরন ----------
   inputs : ব্যবহারকারী যে ঘরগুলোতে লেখে
   gender : কোন ঘর কোন লিঙ্গের (m=পুরুষ, f=মহিলা)
   carry  : "বিগত → বর্তমান" হিসাব লাগে কিনা
   cols   : পর্দায় দেখানোর ঘর (calc=নিজে হিসাব হয়)                               */
var PATTERNS = {
  N:    { inputs: ['v'], cols: [{ k: 'v', label: 'সংখ্যা', slot: 0 }] },
  TK:   { inputs: ['v'], cols: [{ k: 'v', label: 'টাকা' }] },
  PM:   { inputs: ['m', 'f'], gender: { m: 'M', f: 'F' },
          cols: [{ k: 'm', label: 'পুরুষ' }, { k: 'f', label: 'মহিলা' }] },
  M3:   { inputs: ['m', 'f'], gender: { m: 'M', f: 'F' },
          cols: [{ k: 'tot', label: 'মোট', calc: 1 }, { k: 'm', label: 'পুরুষ' }, { k: 'f', label: 'মহিলা' }] },
  TB:   { inputs: ['inc'], carry: 1,
          cols: [{ k: 'prev', label: 'বিগত মোট', calc: 1 }, { k: 'inc', label: 'বৃদ্ধি' },
                 { k: 'cur', label: 'বর্তমান মোট', calc: 1 }] },
  CF:   { inputs: ['inc', 'dec', 'target'], carry: 1,
          cols: [{ k: 'prev', label: 'বিগত', calc: 1 }, { k: 'inc', label: 'বৃদ্ধি' }, { k: 'dec', label: 'ঘাটতি' },
                 { k: 'cur', label: 'বর্তমান', calc: 1 }, { k: 'target', label: 'টার্গেট' },
                 { k: 'rate', label: 'হার %', calc: 1 }] },
  ATT1: { inputs: ['count', 'target', 'avg'],
          cols: [{ k: 'count', label: 'মোট সংখ্যা' }, { k: 'target', label: 'টার্গেট' },
                 { k: 'avg', label: 'গড় উপস্থিতি' }] },
  TXT:  { inputs: ['txt'], text: 1, cols: [{ k: 'txt', label: 'লেখা' }] },

  /* ---- সংখ্যার একাধিক আলাদা ঘর (প্রতিটির নাম ফিল্ডের নিজের `cols` থেকে আসে) ---- */
  N2:   { inputs: ['c1', 'c2'], sum: 1,
          cols: [{ k: 'c1', label: 'সংখ্যা ১', slot: 0 }, { k: 'c2', label: 'সংখ্যা ২', slot: 1 }] },
  N3:   { inputs: ['c1', 'c2', 'c3'], sum: 1,
          cols: [{ k: 'c1', label: 'সংখ্যা ১', slot: 0 }, { k: 'c2', label: 'সংখ্যা ২', slot: 1 }, { k: 'c3', label: 'সংখ্যা ৩', slot: 2 }] },
  N4:   { inputs: ['c1', 'c2', 'c3', 'c4'], sum: 1,
          cols: [{ k: 'c1', label: 'মোট গ্রুপ সংখ্যা', slot: 0 }, { k: 'c2', label: 'মোট অংশগ্রহণকারী সংখ্যা', slot: 1 },
                 { k: 'c3', label: 'কতজনের নিকট দাওয়াত পৌঁছানো', slot: 2 }, { k: 'c4', label: 'কতজন সহযোগী সদস্য', slot: 3 }] },
  /* গণসংযোগের ছক: ৪টি কলাম × (পুরুষ | মহিলা) */
  GX:   gridPattern_(['a', 'b', 'c', 'd'], ['মোট গ্রুপ সংখ্যা', 'মোট অংশগ্রহণকারী সংখ্যা', 'কতজনের নিকট দাওয়াত পৌঁছানো', 'কতজন সহযোগী সদস্য']),
  GX2:  gridPattern_(['a', 'b'], ['সদস্য/সদস্যা', 'সাথী/অগ্রসর কর্মী + কর্মী']),
  /* জনশক্তি: সদস্য/কর্মী × পুরুষ/মহিলা */
  R4:   { inputs: ['sm', 'sf', 'km', 'kf'], gender: { sm: 'M', sf: 'F', km: 'M', kf: 'F' }, sum: 1,
          cols: [{ k: 'sm', label: 'সদস্য — পুরুষ' }, { k: 'sf', label: 'সদস্য — মহিলা' },
                 { k: 'km', label: 'কর্মী — পুরুষ' }, { k: 'kf', label: 'কর্মী — মহিলা' }, { k: 'tot', label: 'মোট', calc: 1 }] },
  /* সভা: সংখ্যা (পু/ম) + টার্গেট + গড় উপস্থিতি (পু/ম) */
  ATT:  { inputs: ['cm', 'cf', 'target', 'am', 'af'], gender: { cm: 'M', cf: 'F', am: 'M', af: 'F' },
          cols: [{ k: 'cm', label: 'মোট সংখ্যা — পুরুষ' }, { k: 'cf', label: 'মোট সংখ্যা — মহিলা' }, { k: 'target', label: 'টার্গেট' },
                 { k: 'am', label: 'গড় উপস্থিতি — পুরুষ' }, { k: 'af', label: 'গড় উপস্থিতি — মহিলা' }] },
  /* শ্রেণী-পেশা: দাওয়াত পৌঁছানো, সহযোগী সদস্য, টার্গেট, হার */
  CP:   { inputs: ['rm', 'rf', 'sm', 'sf', 'target'], gender: { rm: 'M', rf: 'F', sm: 'M', sf: 'F' }, sum: 1,
          cols: [{ k: 'rm', label: 'কতজনের মাঝে দাওয়াত পৌঁছানো হয়েছে — পুরুষ' }, { k: 'rf', label: 'কতজনের মাঝে দাওয়াত পৌঁছানো হয়েছে — মহিলা' },
                 { k: 'sm', label: 'কতজন সহযোগী সদস্য হয়েছেন — পুরুষ' }, { k: 'sf', label: 'কতজন সহযোগী সদস্য হয়েছেন — মহিলা' },
                 { k: 'target', label: 'টার্গেট' }, { k: 'rate', label: 'হার %', calc: 1 }] },
  CP1:  { inputs: ['r', 's', 'target'], sum: 1,
          cols: [{ k: 'r', label: 'কতজনের মাঝে দাওয়াত পৌঁছানো হয়েছে' }, { k: 's', label: 'কতজন সহযোগী সদস্য হয়েছেন' }, { k: 'target', label: 'টার্গেট' },
                 { k: 'rate', label: 'হার %', calc: 1 }] },
  /* বিগত → বর্তমান: ঘাটতি নেই / শুধু বর্তমান লেখা / ফিক্সড */
  /* CF + বৃদ্ধি দুই ভাগে (মানোন্নয়ন / আগত); ওয়ার্ডে opt "cfs:WM" দিয়ে CF ফিল্ড এই রূপে আসে */
  CFS:  { inputs: ['up', 'in', 'dec', 'target'], carry: 1,
          cols: [{ k: 'prev', label: 'বিগত', calc: 1 }, { k: 'up', label: 'বৃদ্ধি — মানোন্নয়ন' }, { k: 'in', label: 'বৃদ্ধি — আগত' },
                 { k: 'inc', label: 'মোট বৃদ্ধি', calc: 1 }, { k: 'dec', label: 'ঘাটতি' },
                 { k: 'cur', label: 'বর্তমান', calc: 1 }, { k: 'target', label: 'টার্গেট' }, { k: 'rate', label: 'হার %', calc: 1 }] },
  N5:   { inputs: ['c1', 'c2', 'c3', 'c4', 'c5'], sum: 1,
          cols: [{ k: 'c1', label: 'সংখ্যা ১', slot: 0 }, { k: 'c2', label: 'সংখ্যা ২', slot: 1 }, { k: 'c3', label: 'সংখ্যা ৩', slot: 2 },
                 { k: 'c4', label: 'সংখ্যা ৪', slot: 3 }, { k: 'c5', label: 'সংখ্যা ৫', slot: 4 }] },
  CFN:  { inputs: ['inc', 'target'], carry: 1,
          cols: [{ k: 'prev', label: 'বিগত', calc: 1 }, { k: 'inc', label: 'বৃদ্ধি' }, { k: 'cur', label: 'বর্তমান', calc: 1 },
                 { k: 'target', label: 'টার্গেট' }, { k: 'rate', label: 'হার %', calc: 1 }] },
  CB:   { inputs: ['cur'], carry: 1, state: ['cur'],
          cols: [{ k: 'prev', label: 'বিগত', calc: 1 }, { k: 'cur', label: 'বর্তমান' }] },
  FX:   { inputs: [], carry: 1, cols: [{ k: 'v', label: '', calc: 1 }] },
  /* ---- v8: প্রশিক্ষণ / সমাজসেবা / রাষ্ট্রীয় সংস্কার অংশের ধরন ---- */
  /* পাঠচক্র: মোট গ্রুপ (পু/ম), মোট অধিবেশন (পু/ম), গড় উপস্থিতি (পু/ম) */
  ATT2: { inputs: ['gm', 'gf', 'sm', 'sf', 'am', 'af'], gender: { gm: 'M', gf: 'F', sm: 'M', sf: 'F', am: 'M', af: 'F' },
          cols: [{ k: 'gm', label: 'মোট গ্রুপ — পুরুষ' }, { k: 'gf', label: 'মোট গ্রুপ — মহিলা' },
                 { k: 'sm', label: 'মোট অধিবেশন — পুরুষ' }, { k: 'sf', label: 'মোট অধিবেশন — মহিলা' },
                 { k: 'am', label: 'গড় উপস্থিতি — পুরুষ' }, { k: 'af', label: 'গড় উপস্থিতি — মহিলা' }] },
  TT:   { inputs: ['v', 'target'], sum: 1, cols: [{ k: 'v', label: 'সংখ্যা' }, { k: 'target', label: 'টার্গেট' }] },
  PCT:  { inputs: ['v'], sum: 1, pct: 1, cols: [{ k: 'v', label: 'শতাংশ (%)' }] },
  /* নির্বাচন: মোট সংখ্যা, মোট প্রার্থী, নির্বাচিত (মেয়র / কাউন্সিলর-মেম্বার), দ্বিতীয় অবস্থান */
  ELEC: { inputs: ['n', 'cand', 'mayor', 'mem', 'sec'], sum: 1,
          cols: [{ k: 'n', label: 'মোট সংখ্যা' }, { k: 'cand', label: 'মোট প্রার্থী' }, { k: 'mayor', label: 'নির্বাচিত — মেয়র' },
                 { k: 'mem', label: 'নির্বাচিত — কাউন্সিলর/মেম্বার' }, { k: 'sec', label: 'দ্বিতীয় অবস্থান' }] },
  /* সংখ্যা + বৃদ্ধি + টার্গেট (বিগত থেকে বর্তমান) */
  TBT:  { inputs: ['inc', 'target'], carry: 1,
          cols: [{ k: 'prev', label: 'বিগত', calc: 1 }, { k: 'inc', label: 'বৃদ্ধি' }, { k: 'cur', label: 'মোট সংখ্যা', calc: 1 },
                 { k: 'target', label: 'টার্গেট' }] },
  /* এ বছরের জমা: জানুয়ারি থেকে যোগ হয়; বছর বদলালে শূন্য থেকে শুরু (lookupPrev_) */
  YTD:  { inputs: ['inc', 'target'], carry: 1, ytd: 1,
          cols: [{ k: 'prev', label: 'এ বছরের বিগত', calc: 1 }, { k: 'inc', label: 'এ মাসে' }, { k: 'cur', label: 'এ বছরের মোট', calc: 1 },
                 { k: 'target', label: 'টার্গেট' }] },
  /* এক ঘরে ৩টি সংখ্যা (জনসভা/সমাবেশ/মিছিল) + প্রতিটির গড় উপস্থিতি; নামগুলো ফিল্ডের cols ("|" দিয়ে) */
  ATTX3: { inputs: ['c1', 'c2', 'c3', 'a1', 'a2', 'a3'],
          cols: [{ k: 'c1', label: 'সংখ্যা ১', slot: 0, sfx: 'সংখ্যা' }, { k: 'c2', label: 'সংখ্যা ২', slot: 1, sfx: 'সংখ্যা' }, { k: 'c3', label: 'সংখ্যা ৩', slot: 2, sfx: 'সংখ্যা' },
                 { k: 'a1', label: 'গড় ১', slot: 0, sfx: 'গড় উপস্থিতি' }, { k: 'a2', label: 'গড় ২', slot: 1, sfx: 'গড় উপস্থিতি' }, { k: 'a3', label: 'গড় ৩', slot: 2, sfx: 'গড় উপস্থিতি' }] },
  /* অন্য ঘর থেকে নিজে হিসাব (ফিল্ডের `src` এ সূত্র) */
  AUTO: { inputs: [], cols: [{ k: 'v', label: 'স্বয়ংক্রিয়', calc: 1 }] },
  /* স্বয়ংক্রিয় জনশক্তি-ছক (সদস্য/কর্মী × পুরুষ/মহিলা): src এ "sm=f079.cur@M;sf=f079.cur@F;km=f080.cur@M;kf=f080.cur@F" */
  AUTO4: { inputs: [], gender: { sm: 'M', sf: 'F', km: 'M', kf: 'F' }, auto: 1,
           cols: [{ k: 'sm', label: 'সদস্য — পুরুষ', calc: 1 }, { k: 'sf', label: 'সদস্য — মহিলা', calc: 1 },
                  { k: 'km', label: 'কর্মী — পুরুষ', calc: 1 }, { k: 'kf', label: 'কর্মী — মহিলা', calc: 1 }, { k: 'tot', label: 'মোট', calc: 1 }] }
};

/* স্বয়ংক্রিয় (ইনপুটহীন, অন্য ঘর থেকে হিসাব) ফিল্ড কিনা */
function isAuto_(f) { return f.pattern === 'AUTO' || f.pattern === 'AUTO4'; }

/* ছক: keys = কলাম-গ্রুপ, প্রতিটি গ্রুপে পুরুষ ও মহিলার ঘর। গ্রুপের নাম ফিল্ডের `cols` থেকে বদলানো যায়। */
function gridPattern_(keys, labels) {
  var inputs = [], gender = {}, cols = [];
  keys.forEach(function (k, i) {
    inputs.push(k + '_m', k + '_f');
    gender[k + '_m'] = 'M'; gender[k + '_f'] = 'F';
    cols.push({ k: k + '_m', label: labels[i] + ' — পুরুষ', slot: i, sfx: 'পুরুষ' });
    cols.push({ k: k + '_f', label: labels[i] + ' — মহিলা', slot: i, sfx: 'মহিলা' });
  });
  return { inputs: inputs, gender: gender, sum: 1, grid: keys, cols: cols };
}

/* কলামের নাম: ফিল্ডে নিজস্ব নাম দেওয়া থাকলে সেটা (পুরুষ/মহিলা যোগ করে), নইলে ধরনের ডিফল্ট */
function colLabel_(f, c) {
  if (c.slot !== undefined && f && f.labels && f.labels[c.slot]) return f.labels[c.slot] + (c.sfx ? ' — ' + c.sfx : '');
  return c.label;
}

/* ---------- রিপোর্টের ৫টি বিভাগ (ফর্মের ট্যাব) ----------
   ফিল্ডের `section` এর শুরু দেখে বিভাগ ঠিক হয় (ফাঁকা জায়গা বাদ দিয়ে মিলানো হয়)।
   কোনো বিভাগে না পড়লে (যেমন বাইতুলমাল, সমাপ্তি) -1 : ট্যাবের নিচে আলাদা দেখায়। */
var TABS = [
  { name: 'দাওয়াত ও তাবলীগ', match: ['দাওয়াতওতাবলীগ', 'ক)', 'খ)', 'গ)', 'ঘ)'] },
  { name: 'সংগঠন', match: ['সংগঠন'] },
  { name: 'প্রশিক্ষণ', match: ['প্রশিক্ষণ'] },
  { name: 'সমাজ সংস্কার ও সমাজ সেবা', match: ['সমাজসংস্কার', 'সমাজসেবা'] },
  { name: 'রাষ্ট্রীয় সংস্কার ও সংশোধন', match: ['রাষ্ট্রীয়'] }
];

function tabOfSection(section) {
  var s = String(section || '').replace(/\s+/g, '');
  for (var i = 0; i < TABS.length; i++)
    for (var j = 0; j < TABS[i].match.length; j++)
      if (s.indexOf(TABS[i].match[j]) === 0) return i;
  return -1;
}

function tabNames() { return TABS.map(function (t) { return t.name; }); }

/* ---------- ছোট সহায়ক ---------- */
function round2_(x) { return Math.round(x * 100) / 100; }

function bn(x) {
  return String(x).replace(/\d/g, function (d) { return BN_DIGITS.charAt(d); });
}

function en(x) {
  return String(x).replace(/[০-৯]/g, function (d) { return String(BN_DIGITS.indexOf(d)); });
}

/* বাংলা বা ইংরেজি অঙ্ক দুটোই চলে। ফাঁকা হলে null, ভুল হলে NaN। */
function parseNum(v) {
  if (v === null || v === undefined) return null;
  var s = en(v).trim().replace(/,/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}

function isValidMonth(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)); }

function monthLabel(m) {
  var p = String(m).split('-');
  return MONTHS_BN[parseInt(p[1], 10) - 1] + ' ' + bn(p[0]);
}

/* current থেকে পিছনের দিকে n মাস (সবচেয়ে নতুন আগে) */
function recentMonths(current, n) {
  var y = parseInt(current.split('-')[0], 10), mo = parseInt(current.split('-')[1], 10), out = [];
  for (var i = 0; i < n; i++) {
    out.push(y + '-' + (mo < 10 ? '0' + mo : mo));
    mo--;
    if (mo === 0) { mo = 12; y--; }
  }
  return out;
}

/* ---------- সেশন (বছর) ও সময়কাল (ত্রৈমাসিক/ষান্মাসিক/বাৎসরিক) ----------
   সেশন = জানুয়ারি–ডিসেম্বর (ক্যালেন্ডার বছর)।
   ত্রৈমাসিক: ১ম=জানু–মার্চ, ২য়=এপ্রিল–জুন, ৩য়=জুলাই–সেপ্টেম্বর, ৪র্থ=অক্টোবর–ডিসেম্বর
   ষান্মাসিক: ১ম=জানু–জুন, ২য়=জুলাই–ডিসেম্বর ; বাৎসরিক: পুরো সেশন                          */
var PERIOD_KINDS = {
  Q: { name: 'ত্রৈমাসিক', size: 3, count: 4, ord: ['১ম', '২য়', '৩য়', '৪র্থ'] },
  H: { name: 'ষান্মাসিক', size: 6, count: 2, ord: ['১ম', '২য়'] },
  Y: { name: 'বাৎসরিক', size: 12, count: 1, ord: [''] }
};

function pad2_(n) { return n < 10 ? '0' + n : String(n); }

/* "2026,2027" → ['2026','2027']; বর্তমান বছর তালিকায় না থাকলে নিজে যোগ হয় */
function sessionList(csv, currentYear) {
  var seen = {}, out = [];
  String(csv || '').split(',').concat([String(currentYear || '')]).forEach(function (x) {
    var y = parseInt(en(x).trim(), 10);
    if (y >= 2000 && y <= 2100 && !seen[y]) { seen[y] = 1; out.push(String(y)); }
  });
  return out.sort();
}

/* ফেরত: ওই সময়কালের মাসগুলো ['2026-01','2026-02','2026-03']; ভুল ইনপুটে খালি তালিকা */
function periodMonths(year, kind, idx) {
  var k = PERIOD_KINDS[kind], y = parseInt(year, 10), i = parseInt(idx, 10), out = [];
  if (isNaN(i)) i = 1;                  // বাৎসরিকে নম্বর লাগে না
  if (!k || !(y >= 2000 && y <= 2100) || i < 1 || i > k.count) return out;
  for (var m = (i - 1) * k.size + 1; m <= i * k.size; m++) out.push(y + '-' + pad2_(m));
  return out;
}

function periodLabel(year, kind, idx) {
  var ms = periodMonths(year, kind, idx), k = PERIOD_KINDS[kind];
  if (!ms.length) return '';
  var a = parseInt(ms[0].split('-')[1], 10), b = parseInt(ms[ms.length - 1].split('-')[1], 10);
  var i = parseInt(idx, 10);
  if (isNaN(i)) i = 1;
  return (k.ord[i - 1] ? k.ord[i - 1] + ' ' : '') + k.name + ' (' + MONTHS_BN[a - 1] + ' – ' + MONTHS_BN[b - 1] + ') ' + bn(year);
}

/* পর্দার ড্রপডাউনের জন্য: { Q:[{idx,label}], H:[...], Y:[...] } (লেবেলে বছর নেই, বছর আলাদা ড্রপডাউনে) */
function periodOptions() {
  var out = {};
  Object.keys(PERIOD_KINDS).forEach(function (kind) {
    var k = PERIOD_KINDS[kind];
    out[kind] = { name: k.name, parts: [] };
    for (var i = 1; i <= k.count; i++) {
      var ms = periodMonths(2000, kind, i);
      var a = parseInt(ms[0].split('-')[1], 10), b = parseInt(ms[ms.length - 1].split('-')[1], 10);
      out[kind].parts.push({ idx: i, label: (k.ord[i - 1] ? k.ord[i - 1] + ' ' : '') + k.name + ' (' + MONTHS_BN[a - 1] + ' – ' + MONTHS_BN[b - 1] + ')' });
    }
  });
  return out;
}

/* gender (M/F/B) দিলে "শুধু পুরুষ/মহিলা রিপোর্টের অংশ" ঘরগুলোও ছাঁটা হয়। থানা (B) দুটোই দেখে। */
function fieldsForLevel(fields, level, gender) {
  return fields.filter(function (f) {
    if (f.enter.indexOf(level) < 0) return false;
    // gw: ওয়ার্ডে কোন লিঙ্গের ফর্মে ঘরটি আছে ('M', 'F', 'MF', '' = কোনোটিতে নয়)। থাকলে ওয়ার্ডে only এর বদলে এটাই চলে।
    if (level === 'W' && typeof f.gw === 'string') return !!gender && (gender === 'B' ? f.gw !== '' : f.gw.indexOf(gender) >= 0);
    if (gender && f.only && gender !== 'B' && f.only !== gender) return false;
    return true;
  }).map(function (f) {
    // opt "hideU:c1/c2" = ইউনিটে এই ঘরগুলো নেই; "lblF:নাম" = মহিলা রিপোর্টে বিবরণ আলাদা
    var hm = new RegExp('hide[' + level + '*]:([A-Za-z0-9/]+)').exec(f.opt || ''), lm = /lblF:([^,]+)/.exec(f.opt || ''), um = new RegExp('lbl' + level + ':([^,]+)').exec(f.opt || '');
    if ((hm || (lm && gender === 'F') || um) && !isAuto_(f)) {
      var h = {}; Object.keys(f).forEach(function (k) { h[k] = f[k]; });
      if (hm) h.hide = hm[1].split('/');
      if (um) h.label = um[1];
      else if (lm && gender === 'F') h.label = lm[1];
      f = h;
    }
    // opt "cfs:WM" : এই স্তর+লিঙ্গে CF ফিল্ডের বৃদ্ধি দুই ভাগে (মানোন্নয়ন/আগত)
    var cm = /cfs:([UWT])([MFB]*)/.exec(f.opt || '');
    if (cm && cm[1] === level && f.pattern === 'CF' && (!cm[2] || cm[2].indexOf(gender) >= 0)) { var cc = {}; Object.keys(f).forEach(function (k) { cc[k] = f[k]; }); cc.pattern = 'CFS'; f = cc; }
    // opt "inputat:W" : এই স্তরে ফিল্ডটি স্বয়ংক্রিয় নয়, সংখ্যা লেখার ঘর (N); অন্য স্তরে স্বয়ংক্রিয়ই থাকে
    var m = /inputat:([UWT]+)/.exec(f.opt || '');
    if (m && m[1].indexOf(level) >= 0 && isAuto_(f)) { var c = {}; Object.keys(f).forEach(function (k) { c[k] = f[k]; }); c.pattern = 'N'; c.src = ''; return c; }
    return f;
  });
}

/* প্রসঙ্গ (লিঙ্গ) অনুযায়ী লেবেল: একক-লিঙ্গ রিপোর্টে "(পুরুষ)", "(মহিলা)", "(পুরুষ/মহিলা)", " — পুরুষ" বাদ।
   opt "gsfx" থাকলে বাদ দেওয়ার পর লিঙ্গের নাম জোড়া হয় (যেমন "পেশাজীবী পুরুষ" / "পেশাজীবী মহিলা")। Index.html এর ctxClean/ctxLabel এর সাথে হুবহু মিল রাখুন। */
function ctxClean_(t, g) {
  t = String(t === null || t === undefined ? '' : t);
  if (g !== 'M' && g !== 'F') return t;
  return t.replace(/\s*[—-]\s*(পুরুষ|মহিলা)\s*$/, '').replace(/\s*\((পুরুষ\/মহিলা|মহিলা\/পুরুষ|পু\/ম|পুরুষ|মহিলা)\)/g, '').replace(/\s{2,}/g, ' ').trim();
}
function ctxLabel_(f, g) {
  var t = ctxClean_(f.label, g);
  if ((g === 'M' || g === 'F') && /gsfx/.test(f.opt || '')) t += ' ' + (g === 'M' ? 'পুরুষ' : 'মহিলা');
  return t;
}

/* ---------- ইনপুট যাচাই ---------- */
function cleanFieldInput(field, raw, gender) {
  var p = PATTERNS[field.pattern], out = {};
  if (field.lbl && raw.lbl !== undefined && raw.lbl !== null) {          // "অন্যান্য" সারি: ব্যবহারকারী নিজে নাম লেখে
    var lt = String(raw.lbl).trim();
    if (lt.length > 100) throw new Error('"' + field.label + '": নাম অনেক বড় (১০০ অক্ষরের বেশি)');
    if (lt) out.lbl = lt;
  }
  p.inputs.forEach(function (c) {
    if (field.hide && field.hide.indexOf(c) >= 0) return;     // এই স্তরে ঘরটি দেখানোই হয় না
    if (c === 'inc' && autoIncSrc_(field)) return;           // স্বয়ংক্রিয় বৃদ্ধি: ব্যবহারকারীর পাঠানো মান অগ্রাহ্য
    if (raw[c] === undefined || raw[c] === null) return;
    if (p.text) {
      var t = String(raw[c]).trim();
      if (t.length > 1000) throw new Error('"' + field.label + '": লেখা অনেক বড় (১০০০ অক্ষরের বেশি)');
      if (t) out[c] = t;
      return;
    }
    var n = parseNum(raw[c]);
    if (n === null) return;
    var g = p.gender && p.gender[c];
    var allowed = !g || gender === 'B' || gender === g;
    if (!allowed) throw new Error('"' + field.label + '": এই অ্যাকাউন্টে এই ঘরে লেখা যাবে না');
    if (p.pct && n > 100) throw new Error('"' + field.label + '": শতাংশ ১০০ এর বেশি হতে পারে না');
    if (isNaN(n) || n > 1e12) throw new Error('"' + field.label + '": সংখ্যাটি ঠিক নয়');
    out[c] = n;
  });
  return out;
}

/* input = { fieldKey: { col: value } } ; ফেরত: পরিষ্কার করা ডেটা। এই স্তরের নয় এমন ঘরে লিখলে এরর। */
function validateData(fields, level, gender, input) {
  var byKey = {}, out = {};
  fields.forEach(function (f) { byKey[f.key] = f; });
  Object.keys(input || {}).forEach(function (key) {
    var f = byKey[key], cols = input[key] || {};
    if (!f || f.enter.indexOf(level) < 0) {
      var hasVal = Object.keys(cols).some(function (c) { return String(cols[c]).trim() !== ''; });
      if (hasVal) throw new Error('এই অ্যাকাউন্টে "' + (f ? f.label : key) + '" লেখার অনুমতি নেই');
      return;
    }
    var clean = cleanFieldInput(f, cols, gender);
    if (Object.keys(clean).length) out[key] = clean;
  });
  return out;
}

/* ---------- যোগফলের ভিত্তি ----------
   প্রতিটি স্তরের মোট = (নিজের লেখা) + (নিচের সব একসেপ্টেড স্তরের লেখা)।
   তাই সব কিছুই "উপাদানের যোগ"; শেষে finalize দিয়ে দেখানোর মান বানানো হয়। */
function ownValues(field, d, prev) {
  d = d || {};
  var g = function (k) { return d[k] || 0; }, p = PATTERNS[field.pattern];
  switch (field.pattern) {
    case 'N': case 'TK': return { v: g('v') };
    case 'PM': case 'M3': return { m: g('m'), f: g('f') };
    case 'TB': return { prev: prev || 0, inc: g('inc') };
    case 'CF': case 'CFS':   // CFS: বৃদ্ধি = মানোন্নয়ন + আগত (থানার যোগফলে CF হিসেবেই যোগ হয়)
      // ওয়ার্ডের কাঁচা তথ্যে inc থাকে না (মানোন্নয়ন+আগত); থানার জমা-মোটে inc আগেই যোগফল, তাই দুবার যোগ নয়
      return { prev: prev || 0, inc: d.inc !== undefined ? g('inc') : g('up') + g('in'), up: g('up'), in: g('in'), dec: g('dec'), target: g('target') };
    case 'CFN': case 'TBT': case 'YTD': return { prev: prev || 0, inc: g('inc'), target: g('target') };
    case 'ATT2': return { gm: g('gm'), gf: g('gf'), sm: g('sm'), sf: g('sf'), wm: g('sm') * g('am'), wf: g('sf') * g('af') };
    case 'ATTX3': return { c1: g('c1'), c2: g('c2'), c3: g('c3'), w1: g('c1') * g('a1'), w2: g('c2') * g('a2'), w3: g('c3') * g('a3') };
    case 'CB': return { prev: prev || 0, cur: d.cur !== undefined ? d.cur : (prev || 0) };   // না লিখলে আগের সংখ্যাই থাকে
    case 'FX': return { prev: prev || 0 };
    case 'ATT1': return { count: g('count'), target: g('target'), wavg: g('count') * g('avg') };
    case 'ATT': return { cm: g('cm'), cf: g('cf'), target: g('target'), wm: g('cm') * g('am'), wf: g('cf') * g('af') };
    default:
      if (p && p.sum) { var o = {}; p.inputs.forEach(function (k) { o[k] = g(k); }); return o; }
      return {};
  }
}

function finalizeValues(field, c) {
  c = c || {};
  var z = function (k) { return c[k] || 0; }, p = PATTERNS[field.pattern];
  switch (field.pattern) {
    case 'N': case 'TK': return { v: round2_(z('v')) };
    case 'PM': return { m: round2_(z('m')), f: round2_(z('f')) };
    case 'M3': return { tot: round2_(z('m') + z('f')), m: round2_(z('m')), f: round2_(z('f')) };
    case 'TB': return { prev: round2_(z('prev')), inc: round2_(z('inc')), cur: round2_(z('prev') + z('inc')) };
    case 'CF': case 'CFS':
      return { prev: round2_(z('prev')), inc: round2_(z('inc')), up: round2_(z('up')), in: round2_(z('in')), dec: round2_(z('dec')),
               cur: round2_(z('prev') + z('inc') - z('dec')), target: round2_(z('target')),
               rate: z('target') > 0 ? round2_(z('inc') / z('target') * 100) : null };
    case 'TBT': case 'YTD':
      return { prev: round2_(z('prev')), inc: round2_(z('inc')), cur: round2_(z('prev') + z('inc')), target: round2_(z('target')) };
    case 'ATT2':
      return { gm: round2_(z('gm')), gf: round2_(z('gf')), sm: round2_(z('sm')), sf: round2_(z('sf')),
               am: z('sm') > 0 ? round2_(z('wm') / z('sm')) : 0, af: z('sf') > 0 ? round2_(z('wf') / z('sf')) : 0 };
    case 'ATTX3':
      return { c1: round2_(z('c1')), c2: round2_(z('c2')), c3: round2_(z('c3')),
               a1: z('c1') > 0 ? round2_(z('w1') / z('c1')) : 0, a2: z('c2') > 0 ? round2_(z('w2') / z('c2')) : 0, a3: z('c3') > 0 ? round2_(z('w3') / z('c3')) : 0 };
    case 'CFN':
      return { prev: round2_(z('prev')), inc: round2_(z('inc')), cur: round2_(z('prev') + z('inc')), target: round2_(z('target')),
               rate: z('target') > 0 ? round2_(z('inc') / z('target') * 100) : null };
    case 'CB': return { prev: round2_(z('prev')), cur: round2_(z('cur')) };
    case 'FX': return { v: round2_(z('prev')), prev: round2_(z('prev')), cur: round2_(z('prev')) };
    case 'ATT1':
      // গড় উপস্থিতি = ওজনযুক্ত গড় (সভার সংখ্যা দিয়ে ওজন)। সিদ্ধান্ত বদলালে শুধু এখানে বদলাবে।
      return { count: round2_(z('count')), target: round2_(z('target')),
               avg: z('count') > 0 ? round2_(z('wavg') / z('count')) : 0 };
    case 'ATT':
      return { cm: round2_(z('cm')), cf: round2_(z('cf')), tot: round2_(z('cm') + z('cf')), target: round2_(z('target')),
               am: z('cm') > 0 ? round2_(z('wm') / z('cm')) : 0, af: z('cf') > 0 ? round2_(z('wf') / z('cf')) : 0 };
    case 'R4':
      return { sm: round2_(z('sm')), sf: round2_(z('sf')), km: round2_(z('km')), kf: round2_(z('kf')),
               tot: round2_(z('sm') + z('sf') + z('km') + z('kf')) };
    case 'CP':   // হার = (দাওয়াত পৌঁছানো) ÷ টার্গেট
      return { rm: round2_(z('rm')), rf: round2_(z('rf')), sm: round2_(z('sm')), sf: round2_(z('sf')), target: round2_(z('target')),
               rate: z('target') > 0 ? round2_((z('rm') + z('rf')) / z('target') * 100) : null };
    case 'CP1':
      return { r: round2_(z('r')), s: round2_(z('s')), target: round2_(z('target')),
               rate: z('target') > 0 ? round2_(z('r') / z('target') * 100) : null };
    default:
      if (p && p.sum) {
        var o = {};
        p.inputs.forEach(function (k) { o[k] = round2_(z(k)); });
        (p.grid || []).forEach(function (k) { o[k] = round2_(z(k + '_m') + z(k + '_f')); });   // গ্রুপের মোট (পুরুষ+মহিলা)
        return o;
      }
      return {};
  }
}

/* "AUTO" ফিল্ড: অন্য ফিল্ডের ঘরের যোগফল। src = "f008.tot+f016.c" (ফিল্ড.কলাম)।
   "f153.v@F" = শুধু মহিলা সংগঠনগুলোর (node.gender = F) যোগফল; @M = পুরুষ। উৎস কোনোটাই না থাকলে কিছু দেখায় না।
   একাধিক ঘরের আউটপুট (AUTO4): "sm=f079.cur@M;sf=f079.cur@F;…" ; AUTO4 এর tot = চার ঘরের যোগ। */
function autoTerms_(src) {
  var outs = [];
  String(src || '').split(';').forEach(function (part) {
    part = part.trim(); if (!part) return;
    var eq = part.indexOf('='), col = eq > 0 ? part.slice(0, eq).trim() : 'v', expr = eq > 0 ? part.slice(eq + 1) : part;
    outs.push({ col: col, terms: expr.split('+').map(function (t) { return t.trim(); }).filter(Boolean) });
  });
  return outs;
}

function applyAuto(fields, out, gout) {
  fields.forEach(function (f) {
    if (!isAuto_(f) || !f.src) return;
    var res = {}, any = false;
    autoTerms_(f.src).forEach(function (o) {
      var sum = 0, found = false;
      o.terms.forEach(function (t) {
        var at = t.split('@'), q = at[0].split('.'), src = out;
        if (at[1]) src = (gout && gout[at[1]]) || {};
        var ob = q[0] ? src[q[0]] : null;
        if (ob && ob[q[1]] !== undefined && ob[q[1]] !== null) { sum += ob[q[1]]; found = true; }
      });
      if (found) { res[o.col] = round2_(sum); any = true; }
    });
    if (!any) return;
    if (f.pattern === 'AUTO4') {
      ['sm', 'sf', 'km', 'kf'].forEach(function (k) { if (res[k] === undefined) res[k] = 0; });
      res.tot = round2_(res.sm + res.sf + res.km + res.kf);
    }
    out[f.key] = res;
  });
  return out;
}

/* AUTO সূত্রে "@M/@F" থাকলে সেই ফিল্ডগুলো লিঙ্গ ধরে আলাদা করে যোগ করা: { M:{key:{..}}, F:{..} }
   প্রতিটি লিঙ্গের নোডগুলোর মধ্যে সবচেয়ে উপরের স্তরকে (থানার নিচে ওয়ার্ড, ওয়ার্ডের রিপোর্টে ওয়ার্ড নিজে) root ধরা হয়,
   যাতে "rootprev" ফিল্ডের বিগত সংখ্যা ওই লিঙ্গের অংশের জন্য বাদ না পড়ে। */
function genderOut_(fields, nodes, fn) {
  var need = {}, any = false;
  fields.forEach(function (f) {
    if (!isAuto_(f) || !f.src) return;
    autoTerms_(f.src).forEach(function (o) {
      o.terms.forEach(function (t) {
        var at = t.split('@');
        if (at[1]) { need[at[0].split('.')[0]] = 1; any = true; }
      });
    });
  });
  if (!any) return null;
  var sub = fields.filter(function (f) { return need[f.key]; }), g = {}, rank = { U: 1, W: 2, T: 3 };
  ['M', 'F'].forEach(function (x) {
    var ns = nodes.filter(function (n) { return n.gender === x; }), top = 0;
    ns.forEach(function (n) { top = Math.max(top, rank[n.level] || 0); });
    ns = ns.map(function (n) {
      var c = {}; Object.keys(n).forEach(function (k) { c[k] = n[k]; });
      c.root = (rank[n.level] || 0) === top; return c;
    });
    g[x] = fn(sub, ns);
  });
  return g;
}

/* ---------- বৃদ্ধি স্বয়ংক্রিয় (opt: autoinc:f009.m+f013.m+…) ----------
   যেমন "মোট সহযোগী সদস্য (পুরুষ)" এর বৃদ্ধি = দাওয়াত অংশের পুরুষ-সহযোগী সদস্যদের যোগফল। ব্যবহারকারী এই ঘরে লেখে না। */
function autoIncSrc_(f) { var m = /autoinc:([\w.+]+)/.exec((f && f.opt) || ''); return m ? m[1] : ''; }

function withAutoInc_(fields, data) {
  var auto = fields.filter(function (f) { return autoIncSrc_(f); });
  if (!auto.length) return data || {};
  var out = {}, d = data || {};
  Object.keys(d).forEach(function (k) { out[k] = d[k]; });
  auto.forEach(function (f) {
    var sum = 0;
    autoIncSrc_(f).split('+').forEach(function (t) {
      var q = t.split('.'), o = d[q[0]];
      if (o && typeof o[q[1]] === 'number') sum += o[q[1]];
    });
    var c = {}; Object.keys(out[f.key] || {}).forEach(function (k) { c[k] = out[f.key][k]; });
    c.inc = sum; out[f.key] = c;
  });
  return out;
}

function prepNodes_(fields, nodes) {
  if (!fields.some(function (f) { return autoIncSrc_(f); })) return nodes;
  return nodes.map(function (n) {
    var c = {}; Object.keys(n).forEach(function (k) { c[k] = n[k]; });
    c.data = withAutoInc_(fields, n.data); return c;
  });
}

/* সংরক্ষণের সময় এই অ্যাকাউন্টের প্রসঙ্গে যে ঘরগুলো নেই (লিঙ্গ/স্তরের কারণে বাদ), তাদের আগের সংরক্ষিত মান অক্ষত রাখা */
function mergeKeepOmitted(existingV, clean, fields) {
  var inCtx = {}, out = {};
  fields.forEach(function (f) { inCtx[f.key] = 1; });
  Object.keys(existingV || {}).forEach(function (k) { if (!inCtx[k]) out[k] = existingV[k]; });
  Object.keys(clean || {}).forEach(function (k) { out[k] = clean[k]; });
  return out;
}

/* "into:fXXX" : এই ফিল্ডের যোগফল অন্য ফিল্ডে (একই ধরন) ঢোকে। যেমন ওয়ার্ড টিম বৈঠক থানার রিপোর্টে পৌরসভা/ওয়ার্ড বৈঠকে যোগ হয়। */
function mergeInto_(fields, sums) {
  fields.forEach(function (f) {
    var m = /into:(\w+)/.exec(f.opt || '');
    if (!m || !sums[f.key]) return;
    var target = fields.filter(function (x) { return x.key === m[1] && x.pattern === f.pattern; })[0];
    if (!target) return;
    var t = sums[m[1]] = sums[m[1]] || {};
    Object.keys(sums[f.key]).forEach(function (k) { t[k] = (t[k] || 0) + sums[f.key][k]; });
  });
}

/* nodes = [{ level:'U'|'W'|'T', data:{key:{col:val}}, prev:{key:number} }] */
function aggregate(fields, nodes) {
  nodes = prepNodes_(fields, nodes);
  var sums = {}, out = {};
  fields.forEach(function (f) {
    if (f.pattern === 'TXT' || isAuto_(f)) return;
    var acc = {}, any = false, rootPrev = /rootprev/.test(f.opt || '');
    nodes.forEach(function (n) {
      if (f.enter.indexOf(n.level) < 0) return;
      any = true;
      var comp = ownValues(f, (n.data || {})[f.key], (n.prev || {})[f.key]);
      Object.keys(comp).forEach(function (k) {
        // rootprev: "বিগত" শুধু যে স্তরের রিপোর্ট তার নিজের; নিচের স্তরের বিগত যোগ হয় না (বৃদ্ধি/ঘাটতি যোগ হয়)
        if (rootPrev && k === 'prev' && !n.root) return;
        acc[k] = (acc[k] || 0) + comp[k];
      });
    });
    if (any) sums[f.key] = acc;
  });
  mergeInto_(fields, sums);
  fields.forEach(function (f) { if (sums[f.key]) out[f.key] = finalizeValues(f, sums[f.key]); });
  return applyAuto(fields, out, genderOut_(fields, nodes, aggregate));
}

/* ---------- একাধিক মাসের যোগফল (ত্রৈমাসিক/ষান্মাসিক/বাৎসরিক) ----------
   nodes = [{ orgId, month, level, data, prev }]  (প্রতিটি একসেপ্টেড মাসিক রিপোর্ট একটি node)
   নিয়ম:
   • সাধারণ সংখ্যা (N, TK, PM, M3), বৃদ্ধি/ঘাটতি/টার্গেট, সভার সংখ্যা: সব মাসের যোগফল
   • "বিগত": প্রতিটি সংগঠনের সময়কালের সবচেয়ে আগের রিপোর্টের "বিগত" (শুরুর অবস্থা), তারপর সব সংগঠনের যোগ
   • "বর্তমান": বিগত + মোট বৃদ্ধি − মোট ঘাটতি (= সময়কালের শেষের অবস্থা)
   • গড় উপস্থিতি: সভার সংখ্যা দিয়ে ওজনযুক্ত গড় (মাসিকের মতোই)
   • লেখা (TXT) যোগ হয় না                                                                  */
function aggregatePeriod(fields, nodes) {
  nodes = prepNodes_(fields, nodes);
  var sums = {}, out = {};
  var sorted = nodes.slice().sort(function (a, b) { return a.month < b.month ? -1 : (a.month > b.month ? 1 : 0); });
  fields.forEach(function (f) {
    if (f.pattern === 'TXT' || isAuto_(f)) return;
    var p = PATTERNS[f.pattern], acc = {}, any = false, started = {}, stock = !!p.carry, state = {}, rootPrev = /rootprev/.test(f.opt || '');
    sorted.forEach(function (n) {
      if (f.enter.indexOf(n.level) < 0) return;
      any = true;
      var comp = ownValues(f, (n.data || {})[f.key], (n.prev || {})[f.key]);
      Object.keys(comp).forEach(function (k) {
        if (stock && k === 'prev') {
          if (rootPrev && !n.root) return;
          if (!started[n.orgId]) acc.prev = (acc.prev || 0) + comp.prev;
          return;
        }
        if (p.state && p.state.indexOf(k) >= 0) { (state[k] = state[k] || {})[n.orgId] = comp[k]; return; }   // অবস্থা: সবচেয়ে নতুন মাসের মান
        acc[k] = (acc[k] || 0) + comp[k];
      });
      started[n.orgId] = 1;
    });
    Object.keys(state).forEach(function (k) {
      acc[k] = 0;
      Object.keys(state[k]).forEach(function (org) { acc[k] += state[k][org]; });
    });
    if (any) sums[f.key] = acc;
  });
  mergeInto_(fields, sums);
  fields.forEach(function (f) { if (sums[f.key]) out[f.key] = finalizeValues(f, sums[f.key]); });
  return applyAuto(fields, out, genderOut_(fields, nodes, aggregatePeriod));
}

/* জমা দেওয়ার সময় "বিগত" ও "বর্তমান" জমিয়ে রাখা হয় (পরের মাসের বিগত এখান থেকেই আসে) */
function carryOf(fields, data, prev) {
  var o = { prev: {}, cur: {} };
  data = withAutoInc_(fields, data);
  fields.forEach(function (f) {
    var p = PATTERNS[f.pattern];
    if (!p.carry) return;
    var v = ownValues(f, (data || {})[f.key], (prev || {})[f.key]), fin = finalizeValues(f, v);
    o.prev[f.key] = round2_(v.prev);
    o.cur[f.key] = fin.cur;
  });
  return o;
}

/* ---------- কে কী দেখতে পারবে ---------- */
function ancestorChain(orgId, parentOf) {
  var chain = [], seen = {}, cur = parentOf(orgId);
  while (cur && !seen[cur]) { chain.push(cur); seen[cur] = 1; cur = parentOf(cur); }
  return chain;
}

/* নিজেরটা সবসময়। উপরের স্তর: সরাসরি অভিভাবক সবসময়; তার উপরের স্তর শুধু allDescendants চালু থাকলে। */
function canViewOrg(viewerOrgId, targetOrgId, chain, allDescendants) {
  if (viewerOrgId === targetOrgId) return true;
  var idx = chain.indexOf(viewerOrgId);
  if (idx < 0) return false;
  return idx === 0 || !!allDescendants;
}

function isEditableStatus(status) {
  return !status || status === STATUS.DRAFT || status === STATUS.RETURNED;
}

/* জমা দেওয়ার আগে নিচের স্তর দেখা।
   kids = [{id, name, status}] ; mode: '0' কোনো বাধা নেই, '1' (ডিফল্ট) শুধু রিভিউ-বাকি (SUBMITTED) থাকলে বাধা,
   '2' সবার একসেপ্টেড হওয়া চাই।
   • pending     : জমা দিয়েছে কিন্তু এখনও একসেপ্ট/ফেরত হয়নি (এদের সিদ্ধান্ত না দিয়ে উপরের স্তর জমা দিতে পারে না)
   • notIncluded : একসেপ্টেড নয় এমন সবাই, অর্থাৎ যাদের তথ্য মোটে ঢুকবে না (রিপোর্ট দেয়নি / ফেরত / খসড়া) */
function childGate(mode, kids) {
  var pending = kids.filter(function (k) { return k.status === STATUS.SUBMITTED; });
  var notIncluded = kids.filter(function (k) { return k.status !== STATUS.ACCEPTED; });
  var blocked = (mode === '2' && notIncluded.length > 0) || (mode !== '0' && mode !== '2' && pending.length > 0);
  return { pending: pending, notIncluded: notIncluded, blocked: blocked, mode: mode };
}

function nextOrgId(orgs, type) {
  var prefix = { unit: 'U', ward: 'W', thana: 'T' }[type];
  var max = 0;
  orgs.forEach(function (o) {
    if (String(o.id).charAt(0) === prefix) max = Math.max(max, parseInt(String(o.id).slice(1), 10) || 0);
  });
  var n = max + 1;
  return prefix + (n < 10 ? '0' + n : String(n));
}


/* ---------- PDF এর HTML ---------- */
function htmlEsc_(x) {
  return String(x === null || x === undefined ? '' : x).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* PDF-এ ০ ফাঁকা দেখানো (Config PDF_SHOW_ZERO=1 দিলে ০ দেখায়) */
var PDF_SHOW_ZERO_ = false;
function setPdfShowZero_(v) { PDF_SHOW_ZERO_ = (String(v) === '1'); }
function pdfNum_(n) {
  if (n === null || n === undefined) return '—';
  if (n === 0 && !PDF_SHOW_ZERO_) return '';
  return bn(round2_(n));
}

/* লিঙ্গ অনুযায়ী যে ঘরগুলো দেখানো হবে (পুরুষ ওয়ার্ডের রিপোর্টে মহিলা ঘর থাকে না; থানায় দুটোই) */
function visibleCols_(pattern, gender) {
  var p = PATTERNS[pattern];
  return p.cols.filter(function (c) {
    var g = p.gender && p.gender[c.k];
    return !(g && gender !== 'B' && gender !== g);
  });
}

/* ---------- উপ-অংশের ক্রমিক নাম্বার (দেখানোর জন্য) ----------
   Excel/থানার মাস্টার নম্বরে ফাঁক থাকতে পারে (যেমন ইউনিটে ১, ৩, ৫)। যে রিপোর্টে যে উপ-অংশগুলো আসলে আছে, সেগুলোকে ১, ২, ৩… এভাবে সাজিয়ে দেখানো হয়।
   শুধু শিরোনামের লেখা বদলায়; ফিল্ডের key, ক্রম বা ডেটা বদলায় না। বিভাগ (section) ও মূল-লেখা ("খ) … — ") আলাদা ধরে গোনা হয়।
   fields = ওই রিপোর্টে দেখানো ফিল্ডের তালিকা (ক্রমে)। ফেরত: শিরোনাম বদলানো (প্রয়োজনে) নতুন কপি। */
var BN_DIGITS_ = '০১২৩৪৫৬৭৮৯';
function bnNum_(n) { return String(n).replace(/\d/g, function (d) { return BN_DIGITS_.charAt(+d); }); }
function renumberSubs_(fields) {
  var re = /^(.*?)([০-৯]+)(\.\s*)(.*)$/, seq = {}, byNum = {}, map = {};
  (fields || []).forEach(function (f) {
    var sub = String(f.sub || ''), m = re.exec(sub);
    if (!m || m[1].length > 40) return;
    var mk = f.section + '|' + sub;
    if (map[mk] !== undefined) return;
    var gk = f.section + '|' + m[1], nk = gk + '|' + m[2];       // একই মূল নম্বরের উপ-অংশ (যেমন "৪. নির্বাচন" ও "৪. নির্বাচন — প্রস্তুতি") একই নতুন নম্বর পায়
    if (byNum[nk] === undefined) { seq[gk] = (seq[gk] || 0) + 1; byNum[nk] = seq[gk]; }
    map[mk] = m[1] + bnNum_(byNum[nk]) + m[3] + m[4];
  });
  return (fields || []).map(function (f) {
    var nv = map[f.section + '|' + String(f.sub || '')];
    if (nv === undefined || nv === f.sub) return f;
    var c = {}; Object.keys(f).forEach(function (k) { c[k] = f[k]; }); c.sub = nv; return c;
  });
}

/* ---------- PDF ফন্ট, A4 ও স্বাক্ষর/তারিখ (দুই ধরনের PDF-ই এটা ব্যবহার করে) ----------
   font = { kind: 'sans'|'serif'|'vrinda', web: true/false }। Noto ফন্ট Google Fonts থেকে আনার চেষ্টা হয়;
   না এলে (বা web=false হলে) তালিকার পরের ফন্ট — Vrinda/Nirmala UI — ব্যবহার হয়। */
function pdfFontCss_(font) {
  font = font || {};
  var k = font.kind === 'serif' || font.kind === 'vrinda' ? font.kind : 'sans';
  var first = k === 'serif' ? '"Noto Serif Bengali"' : (k === 'vrinda' ? '"Vrinda"' : '"Noto Sans Bengali"');
  var family = first + ',"Noto Sans Bengali","Noto Serif Bengali","Vrinda","Nirmala UI","Kalpurush",Arial,sans-serif';
  var imp = (font.web !== false && k !== 'vrinda')
    ? '@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;700&family=Noto+Serif+Bengali:wght@400;700&display=swap");' : '';
  return { imp: imp, family: family, page: '@page{size:A4;margin:12mm 10mm}' };
}
/* নিচের স্বাক্ষর ও তারিখের অংশ। leader = প্রোফাইলের নাম (ফাঁকা হলে শুধু ডটের লাইন) */
function pdfSignHtml_(o) {
  if (o.sign === false) return '';
  var who = o.leaderLabel || 'আমীর/সভাপতি';
  return '<table class="plain sign" style="margin-top:26px;page-break-inside:avoid"><tr>' +
    '<td style="width:50%">তারিখ : ............................</td>' +
    '<td class="rt">স্বাক্ষর : ............................<br>' + (o.leader ? htmlEsc_(o.leader) + '<br>' : '') + htmlEsc_(who) + '</td></tr></table>';
}

/* o = { levelLabel, orgName, parentName, monthLabel, gender, fields, values, texts, excluded:[নাম] } */
function buildReportHtml(o) {
  var fc = pdfFontCss_(o.font);
  var h = '<html><head><meta charset="utf-8"><style>' + fc.imp + fc.page +
    'body{font-family:' + fc.family + ';font-size:11px;color:#000}' +
    'table.plain{width:100%;border-collapse:collapse}table.plain td{border:0;font-size:11px;padding:2px 0}table.plain td.rt{text-align:right}' +
    'h1,h2,h3,h4,p{margin:3px 0}h1,h2{text-align:center}h3{font-size:14px;margin-top:12px}h4{font-size:12px;margin-top:8px}' +
    'table{border-collapse:collapse;width:100%;margin:3px 0}td,th{border:1px solid #000;padding:3px 5px;text-align:center;font-size:11px}' +
    'th{background:#eee}td.l{text-align:left}.note{margin-top:10px;font-size:11px}' +
    '</style></head><body>';
  h += '<h2>বিসমিল্লাহির রাহমানির রাহীম</h2><h1>' + htmlEsc_(o.levelLabel) + ' সংগঠনের রিপোর্ট</h1><h2>' + htmlEsc_(o.periodKind || 'মাসিক') + '</h2>';
  h += '<p><b>' + htmlEsc_(o.periodTitle || 'মাস ও সন') + ':</b> ' + htmlEsc_(o.monthLabel) + '</p>';
  h += '<p><b>' + htmlEsc_(({ 'ওয়ার্ড': 'ওয়ার্ডের', 'ইউনিট': 'ইউনিটের', 'থানা': 'থানার' })[o.levelLabel] || o.levelLabel) + ' নাম:</b> ' + htmlEsc_(o.orgName) +
    (o.parentName ? ' &nbsp;&nbsp; <b>অধীনে:</b> ' + htmlEsc_(o.parentName) : '') + '</p>';
  h += '<p><b>' + htmlEsc_(o.leaderLabel || 'আমীর/সভাপতি') + 'র নাম:</b> ' + (o.leader ? htmlEsc_(o.leader) : '........................................') + '</p>';

  var lastSec = null, lastSub = null, lastGroup = null, open = false;
  var closeTable = function () { if (open) { h += '</table>'; open = false; } };
  renumberSubs_((o.fields || []).filter(function (f) { return f.pattern === 'TXT' || (o.values || {})[f.key]; })).forEach(function (f) {
    var isText = f.pattern === 'TXT';
    if (!isText && !(o.values || {})[f.key]) return;
    if (f.section !== lastSec) { closeTable(); h += '<h3>' + htmlEsc_(f.section) + '</h3>'; lastSec = f.section; lastSub = null; lastGroup = null; }
    if (f.sub !== lastSub) { closeTable(); if (f.sub) h += '<h4>' + htmlEsc_(f.sub) + '</h4>'; lastSub = f.sub; lastGroup = null; }
    if (isText) {
      closeTable(); lastGroup = null;
      h += '<p><b>' + htmlEsc_(f.label) + ':</b> ' + htmlEsc_((o.texts || {})[f.key] || '') + '</p>';
      return;
    }
    var cols = visibleCols_(f.pattern, o.gender), group = f.section + '|' + f.sub + '|' + f.pattern + '|' + (f.labels || []).join(',');
    if (group !== lastGroup) {
      closeTable();
      h += '<table><tr><th>বিবরণ</th>' + cols.map(function (c) { return '<th>' + htmlEsc_(colLabel_(f, c)) + '</th>'; }).join('') + '</tr>';
      open = true; lastGroup = group;
    }
    var v = o.values[f.key];
    h += '<tr><td class="l">' + htmlEsc_(ctxLabel_(f, o.gender)) + '</td>' + cols.map(function (c) {
      return '<td>' + (c.k === 'rate' ? (v[c.k] === null || v[c.k] === undefined ? '—' : (pdfNum_(v[c.k]) ? pdfNum_(v[c.k]) + '%' : '')) : pdfNum_(v[c.k])) + '</td>';
    }).join('') + '</tr>';
  });
  closeTable();
  h += pdfSignHtml_(o);
  // বাদ-পড়া ইউনিট/ওয়ার্ডের তালিকা PDF-এ আর ছাপা হয় না (ওয়েব পাতায় দেখানো হয়)
  return h + '</body></html>';
}
