/* BJI Report — রিপোর্টের "সার্ভার" স্তর (ব্রাউজারে চলে)
 * পুরনো Apps Script এর apiHome / apiGetReport / apiSaveDraft / apiPreview / apiSubmit / apiReview /
 * apiTotals / apiPeriod এর একই আকারের উত্তর দেয়, কিন্তু তথ্য আসে Supabase থেকে।
 * হিসাব (Logic.js) পুরনো সিস্টেমের হুবহু।
 * নিরাপত্তা: কে কী দেখবে/লিখবে তা ডেটাবেসের RLS ও ফাংশনেই যাচাই হয়; এখানের যাচাই শুধু সুবিধার জন্য। */
(function () {
  'use strict';
  var CFG = window.BJI_CONFIG;
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  var TYPE = { U: 'unit', W: 'ward', T: 'thana', M: 'metro' };
  var DBSTAT = { draft: 'DRAFT', submitted: 'SUBMITTED', returned: 'RETURNED', accepted: 'ACCEPTED' };
  var STRICT_CHILDREN = '1';

  var A = { user: null, me: null, orgs: [], byId: {}, versions: [] };

  function check(res) { if (res.error) throw new Error(res.error.message); return res.data; }
  function per(month) { return month + '-01'; }
  function monthOf(period) { return String(period).substr(0, 7); }
  function currentMonth() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    var y = p.filter(function (x) { return x.type === 'year'; })[0].value, m = p.filter(function (x) { return x.type === 'month'; })[0].value;
    return y + '-' + m;
  }
  function checkMonth(month) {
    if (!isValidMonth(month)) throw new Error('মাসের তথ্য ঠিক নয়।');
    if (month > currentMonth()) throw new Error('ভবিষ্যতের মাসের রিপোর্ট দেওয়া যাবে না।');
  }
  function orgLabel(o) {
    if (o.level === 'U' && o.parent_id && A.byId[o.parent_id] && A.byId[o.parent_id].level === 'W') return A.byId[o.parent_id].name + ' / ' + o.name;
    return o.name;
  }
  function startOk(o, month) { return !o.start_month || String(o.start_month).substr(0, 7) <= month; }
  function childOrgs(parentId, month) {
    return A.orgs.filter(function (o) { return o.parent_id === parentId && o.active && startOk(o, month); });
  }

  /* ---- ফর্ম-সংস্করণ: মাসের জন্য সর্বশেষ প্রযোজ্যটি ---- */
  function allFields(month) {
    var v = A.versions.filter(function (x) { return monthOf(x.valid_from) <= month; })
      .sort(function (a, b) { return a.valid_from < b.valid_from ? 1 : -1; })[0];
    if (!v) return [];
    return v.fields.filter(function (f) { return PATTERNS[f.pattern]; })
      .map(function (f) { var c = Object.assign({}, f); c.tab = tabOfSection(f.section); return c; });
  }

  /* ---- রিপোর্ট আনা ---- */
  function norm(r) {
    var x = r.extra || {};
    return { id: r.id, org_id: r.org_id, month: monthOf(r.period), status: DBSTAT[r.status], version: r.version,
             comment: r.return_note || '', submitted_at: r.submitted_at || '', parent_id: (A.byId[r.org_id] || {}).parent_id || '',
             d: { v: r.data || {}, prev: x.prev, cur: x.cur, excluded: x.excluded || [], totals: x.totals || null } };
  }
  var COLS = 'id,org_id,period,status,data,extra,version,return_note,submitted_at';
  async function monthReports(month) {
    var rows = check(await sb.from('reports').select(COLS).eq('period', per(month)));
    var out = {};
    rows.forEach(function (r) { var n = norm(r); out[n.org_id] = n; });
    return out;
  }
  async function findReport(month, orgId) {
    var rows = check(await sb.from('reports').select(COLS).eq('period', per(month)).eq('org_id', orgId));
    return rows.length ? norm(rows[0]) : null;
  }

  /* ---- শুরুর সংখ্যা (0013) ---- */
  var OPEN = {};
  async function getOpening(orgId, fresh) {
    if (!fresh && OPEN[orgId]) return OPEN[orgId];
    var r = await sb.from('opening_numbers').select('data,base,locked,unlocked_by').eq('org_id', orgId).limit(1);
    var row = r.error ? null : (r.data[0] || null);     // 0013 না চালানো থাকলে চুপচাপ (সব ০)
    OPEN[orgId] = { data: (row && row.data) || {}, base: row ? row.base : null, locked: !!(row && row.locked),
                    unlocked: !!(row && row.unlocked_by), exists: !!row };
    return OPEN[orgId];
  }
  function openingFields(fields) {   // শুরুর সংখ্যার পাতায় যে ঘরগুলো: স্থায়ী (carry), বছর-ভিত্তিক ছাড়া
    return fields.filter(function (f) { var p = PATTERNS[f.pattern]; return p && p.carry && !p.ytd && !isAuto_(f); });
  }

  /* "বিগত": আগের একসেপ্টেড মাসের "বর্তমান"; না থাকলে শুরুর সংখ্যা।
     শুরুর সংখ্যা পরে ঠিক করা হলে (খুলে দিয়ে) পার্থক্যটুকু (data − base) যোগ হয়; জনসংখ্যা (FX) সবসময় শুরুর সংখ্যা থেকে। */
  async function lookupPrev(orgId, month, fields) {
    var rows = check(await sb.from('reports').select('period,extra').eq('org_id', orgId).eq('status', 'accepted')
      .lt('period', per(month)).order('period', { ascending: false }).limit(1));
    var frozen = rows.length ? ((rows[0].extra || {}).cur || {}) : {};
    var lastYear = rows.length ? String(rows[0].period).substr(0, 4) : '';
    var op = await getOpening(orgId), od = op.data || {}, ob = op.base || null;
    var prev = {};
    fields.forEach(function (f) {
      if (!PATTERNS[f.pattern].carry) return;
      var o = typeof od[f.key] === 'number' ? od[f.key] : 0;
      if (f.pattern === 'FX') { prev[f.key] = o; return; }
      var useFrozen = frozen[f.key] !== undefined;
      if (useFrozen && PATTERNS[f.pattern].ytd && lastYear !== String(month).substr(0, 4)) { prev[f.key] = 0; return; }
      if (!useFrozen) { prev[f.key] = PATTERNS[f.pattern].ytd ? 0 : o; return; }
      var adj = (ob && !PATTERNS[f.pattern].ytd) ? o - (typeof ob[f.key] === 'number' ? ob[f.key] : 0) : 0;
      prev[f.key] = frozen[f.key] + adj;
    });
    return prev;
  }

  /* কোনো স্তরের মোটের জন্য: নিজের রিপোর্ট + নিচের সব একসেপ্টেড রিপোর্ট (পুরনো collectNodes_) */
  async function collectNodes(month, rootId, previewOwn, reps) {
    reps = reps || await monthReports(month);
    var fieldsAll = allFields(month), nodes = [], root = A.byId[rootId], rr = reps[rootId];
    var ownOk = rr && root && (rr.status === STATUS.ACCEPTED || previewOwn === true ||
                               (previewOwn === 'submitted' && rr.status === STATUS.SUBMITTED));
    if (ownOk) {
      var frozen = (rr.status === STATUS.ACCEPTED || rr.status === STATUS.SUBMITTED) && rr.d.prev;
      nodes.push({ orgId: rootId, level: root.level, gender: root.gender, data: rr.d.v, root: true,
                   prev: frozen ? rr.d.prev : await lookupPrev(rootId, month, fieldsForLevel(fieldsAll, root.level, root.gender)) });
    }
    var queue = [rootId], seen = {};
    while (queue.length) {
      var id = queue.shift();
      if (seen[id]) continue;
      seen[id] = 1;
      A.orgs.filter(function (o) { return o.parent_id === id; }).forEach(function (o) {
        var r = reps[o.id];
        if (!r || r.status !== STATUS.ACCEPTED) return;
        nodes.push({ orgId: o.id, level: o.level, gender: o.gender, data: r.d.v, prev: r.d.prev || {} });
        queue.push(o.id);
      });
    }
    return nodes;
  }

  /* ===== মহানগরের সমন্বিত হিসাব =====
     মহানগর থানার নিচে দেখে না। তাই প্রতিটি থানার জমার সময়ের মোট (extra.totals) যোগ হয়।
     থানার মোটকে "নোড" ধরে পুরনো যোগফলের নিয়মেই হিসাব (গড় = ওজনযুক্ত, বিগত/বর্তমান ঠিক থাকে)।
     সিদ্ধান্ত (২৩ নভেম্বর ২০২৬): জমা হওয়া (একসেপ্ট না হলেও) সব থানার সংখ্যা গণ্য। */
  var METRO_COUNTS = [STATUS.SUBMITTED, STATUS.ACCEPTED];
  function metroFields(fields) {   // সব স্তরের ঘর নেওয়া হয়; into/autoinc আগেই থানার মোটে হিসাব হয়ে আছে
    return fields.map(function (f) {
      var c = {}; Object.keys(f).forEach(function (k) { c[k] = f[k]; });
      c.enter = f.enter + 'X';
      c.opt = String(f.opt || '').split(',').filter(function (o) { return o && !/^\s*(into|autoinc):/.test(o); }).join(',');
      return c;
    });
  }
  function thanaTotalsOf(rep, fields, org) {
    if (rep.d.totals) return rep.d.totals;
    // পুরনো রিপোর্ট (মোট সংরক্ষণের আগে জমা): থানার নিজের অংশটুকুই
    return aggregate(fields, [{ orgId: org.id, level: org.level, gender: org.gender, data: rep.d.v, prev: rep.d.prev || {}, root: true }]);
  }
  function metroItems(month, reps, metro) {
    var fields = allFields(month), got = [], missing = [];
    childOrgs(metro.id, month).forEach(function (o) {
      var r = reps[o.id];
      if (r && METRO_COUNTS.indexOf(r.status) >= 0) got.push({ org: o, month: month, status: r.status, totals: thanaTotalsOf(r, fields, o) });
      else missing.push(orgLabel(o));
    });
    return { items: got, missing: missing };
  }
  function metroValues(fields, items, period) {
    var fx = metroFields(fields), carry = {};
    fields.forEach(function (f) { if (PATTERNS[f.pattern] && PATTERNS[f.pattern].carry) carry[f.key] = 1; });
    var nodes = items.map(function (t) {
      var prev = {};
      Object.keys(carry).forEach(function (k) { if (t.totals[k] && typeof t.totals[k].prev === 'number') prev[k] = t.totals[k].prev; });
      return { orgId: t.org.id, month: t.month, level: 'X', gender: 'B', root: true, data: t.totals, prev: prev };
    });
    var out = period ? aggregatePeriod(fx, nodes) : aggregate(fx, nodes);
    // স্বয়ংক্রিয় ঘর (পুরুষ/মহিলা ভাগসহ): থানার হিসাব করা মানই যোগ। অবস্থা-ধরনের (বর্তমান/বিগত) হলে প্রতিটি থানার শেষ মাসেরটা।
    var lastOf = {};
    items.forEach(function (t) { if (!lastOf[t.org.id] || t.month > lastOf[t.org.id].month) lastOf[t.org.id] = t; });
    fields.forEach(function (f) {
      if (!isAuto_(f)) return;
      var stock = /\.(cur|prev)/.test(f.src || ''), src = stock ? Object.keys(lastOf).map(function (k) { return lastOf[k]; }) : items;
      var acc = {}, any = false;
      src.forEach(function (t) {
        var v = t.totals[f.key]; if (!v) return;
        Object.keys(v).forEach(function (c) { if (typeof v[c] === 'number') { acc[c] = round2_((acc[c] || 0) + v[c]); any = true; } });
      });
      if (any) out[f.key] = acc; else delete out[f.key];
    });
    return out;
  }

  function kidStatuses(parentId, month, reps) {
    return childOrgs(parentId, month).map(function (o) {
      var r = reps[o.id];
      return { id: o.id, name: orgLabel(o), type: TYPE[o.level], gender: o.gender,
               status: r ? r.status : 'NONE', submittedAt: r ? String(r.submitted_at) : '' };
    });
  }

  function homeData(month, reps) {
    var me = A.me, mine = reps[me.id];
    var status = mine ? mine.status : 'NONE';
    var kids = kidStatuses(me.id, month, reps);
    var gate = childGate(STRICT_CHILDREN, kids);
    var editable = isEditableStatus(mine ? mine.status : '');
    return {
      month: month, monthLabel: monthLabel(month), orgId: me.id, orgName: orgLabel(me),
      status: status, comment: mine ? mine.comment : '',
      canEdit: editable, canSubmit: editable && !gate.blocked,
      canPdf: status === STATUS.SUBMITTED || status === STATUS.ACCEPTED,
      submitLabel: 'জমা দিন',
      pending: gate.pending.map(function (k) { return k.name; }),
      notIncluded: gate.notIncluded.map(function (k) { return k.name; }),
      children: kids.map(function (k) { return { orgId: k.id, name: k.name, type: k.type, gender: k.gender, status: k.status, submittedAt: k.submittedAt }; })
    };
  }

  var API = {
    sb: sb,

    /* লগইন ও কোন সংগঠনের রিপোর্ট, তা ঠিক করা */
    init: async function (orgId) {
      var s = (await sb.auth.getSession()).data.session;
      if (!s) throw new Error('SESSION');
      A.user = s.user;
      var res = await Promise.all([
        sb.from('memberships').select('org_id,role').eq('active', true).eq('user_id', s.user.id),
        sb.from('orgs').select('id,code,name,level,gender,parent_id,path,active,start_month').order('path'),
        sb.from('form_versions').select('id,valid_from,fields')
      ]);
      var mem = check(res[0]); A.mem = mem; A.orgs = check(res[1]); A.versions = check(res[2]);
      A.byId = {}; A.orgs.forEach(function (o) { A.byId[o.id] = o; });
      var mine = mem.map(function (m) { return A.byId[m.org_id]; }).filter(Boolean);
      return { mine: mine.map(function (o) { return { id: o.id, name: orgLabel(o), level: o.level }; }), picked: orgId };
    },
    use: function (orgId) {
      var o = A.byId[orgId];
      if (!o) throw new Error('এই সংগঠনটি পাওয়া যায়নি বা দেখার অনুমতি নেই।');
      A.me = o;
    },

    apiBootstrap: async function () {
      var cm = currentMonth(), sessions = sessionList('2026,2027', cm.split('-')[0]);
      var y = cm.split('-')[0];
      // হোম পাতার জন্য: আমার পদ, আমার নাম, উপরের সংগঠনের নাম
      var mm = (A.mem || []).filter(function (m) { return m.org_id === A.me.id; })[0], uname = '';
      try {
        var pr = check(await sb.from('profiles').select('full_name').in('user_id', [A.user.id]));
        uname = (pr[0] && pr[0].full_name) || '';
      } catch (e) { }
      uname = uname || (A.user.user_metadata && A.user.user_metadata.full_name) || A.user.email;
      var par = await API._parent(A.me);
      return { me: { orgId: A.me.id, name: orgLabel(A.me), type: TYPE[A.me.level], gender: A.me.gender, level: A.me.level, mustChange: false,
                     orgName: A.me.name, role: mm ? mm.role : '', userName: uname, parentName: par ? par.name : '' },
               tabs: tabNames(), patterns: PATTERNS, currentMonth: cm, monthNames: MONTHS_BN, sessions: sessions,
               defaultSession: sessions.indexOf(y) >= 0 ? y : sessions[0], periods: periodOptions(), email: A.user.email };
    },

    apiHome: async function (month) {
      checkMonth(month);
      return homeData(month, await monthReports(month));
    },

    apiGetReport: async function (month, orgId) {
      checkMonth(month);
      var org = A.byId[orgId];
      if (!org) throw new Error('এই ইউনিট/ওয়ার্ড পাওয়া যায়নি।');
      var reps = await monthReports(month), rep = reps[orgId] || null;
      var all = allFields(month), fields = fieldsForLevel(all, org.level, org.gender);
      var d = rep ? rep.d : { v: {} };
      var frozen = rep && (rep.status === STATUS.SUBMITTED || rep.status === STATUS.ACCEPTED) && d.prev;
      var prev = frozen ? d.prev : await lookupPrev(orgId, month, fields);
      var mine = A.me.id === orgId;
      var derived = aggregate(fields, [{ level: org.level, gender: org.gender, data: d.v, prev: prev, root: true }]);
      // থানার রিপোর্টে নিচের স্তরের লেখা কিন্তু থানার নিজের নয় এমন ঘর: একসেপ্টেড রিপোর্টের যোগফল (শুধু পড়া)
      if (org.level === 'T') {
        var ownKeys = {}; fields.forEach(function (f) { ownKeys[f.key] = 1; });
        var calc = all.filter(function (f) { return !ownKeys[f.key] && f.enter.indexOf('T') < 0; });
        var nodes = (await collectNodes(month, orgId, false, reps)).filter(function (nd) { return !nd.root; });
        var res = aggregate(calc, nodes), shown = {};
        calc.forEach(function (f) { if (res[f.key] && !/into:/.test(f.opt || '') && !isAuto_(f) && f.pattern !== 'TXT') shown[f.key] = res[f.key]; });
        fields = all.map(function (f) {
          if (ownKeys[f.key]) return fields.filter(function (x) { return x.key === f.key; })[0];
          if (shown[f.key]) { var c = Object.assign({}, f); c.ro = true; return c; }
          return null;
        }).filter(Boolean);
        Object.keys(shown).forEach(function (k) { derived[k] = shown[k]; });
      }
      var parentId = org.parent_id;
      return {
        month: month, monthLabel: monthLabel(month), orgId: orgId, orgName: orgLabel(org), gender: org.gender, level: org.level,
        status: rep ? rep.status : 'NONE', comment: rep ? rep.comment : '',
        editable: mine && isEditableStatus(rep ? rep.status : ''),
        canReview: !mine && !!rep && rep.status === STATUS.SUBMITTED && parentId === A.me.id,
        canPdf: !!rep && (rep.status === STATUS.SUBMITTED || rep.status === STATUS.ACCEPTED),
        excluded: (d.excluded || []).map(function (id) { var o = A.byId[id]; return o ? orgLabel(o) : 'অজানা'; }),
        fields: renumberSubs_(fields), data: d.v, prev: prev, derived: derived
      };
    },

    _save: async function (month, input) {
      var me = A.me, fields = fieldsForLevel(allFields(month), me.level, me.gender);
      var rep = await findReport(month, me.id);
      if (!isEditableStatus(rep ? rep.status : '')) throw new Error('এই রিপোর্ট এখন বদলানো যাবে না।');
      var clean = validateData(fields, me.level, me.gender, input);
      clean = mergeKeepOmitted(rep ? rep.d.v : {}, clean, fields);
      var row = check(await sb.rpc('save_report', { p_org: me.id, p_period: per(month), p_data: clean,
                                                    p_expected_version: rep ? rep.version : null }));
      return { row: row, clean: clean, fields: fields };
    },

    apiSaveDraft: async function (month, input) {
      checkMonth(month);
      var s = await API._save(month, input), auto = {};
      if (s.fields.some(function (f) { return isAuto_(f) || autoIncSrc_(f); })) {
        var dv = aggregate(s.fields, [{ orgId: A.me.id, level: A.me.level, gender: A.me.gender, root: true, data: s.clean,
                                        prev: await lookupPrev(A.me.id, month, s.fields) }]);
        s.fields.forEach(function (f) { if ((isAuto_(f) || autoIncSrc_(f)) && dv[f.key]) auto[f.key] = dv[f.key]; });
      }
      return { saved: true, auto: auto };
    },

    apiPreview: async function (month, input) {
      var me = A.me, fields = fieldsForLevel(allFields(month), me.level, me.gender);
      var clean = validateData(fields, me.level, me.gender, input);
      var dv = aggregate(fields, [{ orgId: me.id, level: me.level, gender: me.gender, root: true,
                                    data: mergeKeepOmitted({}, clean, fields), prev: await lookupPrev(me.id, month, fields) }]), vals = {};
      fields.forEach(function (f) { if ((isAuto_(f) || autoIncSrc_(f)) && dv[f.key]) vals[f.key] = dv[f.key]; });
      return { vals: vals };
    },

    apiSubmit: async function (month, input) {
      checkMonth(month);
      var me = A.me;
      var reps = await monthReports(month);
      var gate = childGate(STRICT_CHILDREN, kidStatuses(me.id, month, reps));
      if (gate.blocked) throw new Error('এই অধীনস্থদের রিপোর্ট রিভিউ বাকি আছে (আগে একসেপ্ট বা ফেরত দিন): ' + gate.pending.map(function (k) { return k.name; }).join(', '));
      var s = (input === undefined || input === null) ? null : await API._save(month, input);
      var fields = fieldsForLevel(allFields(month), me.level, me.gender);
      var rep = await findReport(month, me.id);
      if (!rep) throw new Error('আগে রিপোর্টটি সংরক্ষণ করুন।');
      var d = rep.d;
      var carry = carryOf(fields, d.v, await lookupPrev(me.id, month, fields));
      // rootprev: এই স্তরের "বিগত" পুরো মোটের শুরু, তাই "বর্তমান" = নিচের একসেপ্টেড স্তরসহ পুরো মোট
      var rootFields = fields.filter(function (f) { return /rootprev/.test(f.opt || ''); });
      if (rootFields.length) {
        var subs = (await collectNodes(month, me.id, false, reps)).filter(function (nd) { return !nd.root; });
        var tot = aggregate(rootFields, [{ orgId: me.id, level: me.level, gender: me.gender, root: true, data: d.v, prev: carry.prev }].concat(subs));
        rootFields.forEach(function (f) { if (tot[f.key]) carry.cur[f.key] = tot[f.key].cur; });
      }
      var extra = { prev: carry.prev, cur: carry.cur, excluded: gate.notIncluded.map(function (k) { return k.id; }) };
      if (me.level === 'W' || me.level === 'T') {
        // জমার মুহূর্তের মোট (নিজের + একসেপ্টেড অধীনস্থ)। উপরের স্তর নিচে দেখতে না পারলেও (যেমন মহানগর) এ থেকে PDF/মোট পায়।
        var fresh = await monthReports(month);
        extra.totals = aggregate(allFields(month), await collectNodes(month, me.id, true, fresh));
      }
      check(await sb.rpc('submit_report', { p_report: rep.id, p_expected_version: rep.version, p_extra: extra }));
      var after = await monthReports(month);
      return { status: (after[me.id] || {}).status, excluded: gate.notIncluded.map(function (k) { return k.name; }), home: homeData(month, after) };
    },

    apiReview: async function (month, orgId, decision, comment) {
      var rep = await findReport(month, orgId);
      if (!rep || rep.status !== STATUS.SUBMITTED) throw new Error('এই রিপোর্ট এখন রিভিউয়ের অবস্থায় নেই।');
      if (decision === 'return' && !String(comment || '').trim()) throw new Error('ফেরত পাঠালে কারণ লিখতে হবে।');
      check(await sb.rpc('review_report', { p_report: rep.id, p_accept: decision === 'accept',
                                            p_note: decision === 'accept' ? null : String(comment).trim().substr(0, 500) }));
      return { ok: true, home: homeData(month, await monthReports(month)) };
    },

    apiTotals: async function (month, orgId) {
      checkMonth(month);
      var org = A.byId[orgId || A.me.id];
      if (org.level === 'M') {
        var mi = metroItems(month, await monthReports(month), org), mf = allFields(month), mv = metroValues(mf, mi.items, false);
        return { month: month, monthLabel: monthLabel(month), orgName: orgLabel(org), nodeCount: mi.items.length, metro: true,
                 submittedOnly: mi.items.filter(function (t) { return t.status === STATUS.SUBMITTED; }).map(function (t) { return orgLabel(t.org); }),
                 missing: mi.missing, fields: renumberSubs_(mf.filter(function (f) { return mv[f.key]; })), values: mv, gender: 'B' };
      }
      var nodes = await collectNodes(month, org.id, A.me.id === org.id);
      var fields = allFields(month), res = aggregate(fields, nodes);
      return { month: month, monthLabel: monthLabel(month), orgName: orgLabel(org), nodeCount: nodes.length,
               fields: renumberSubs_(fields.filter(function (f) { return res[f.key]; })), values: res, gender: org.gender };
    },

    apiPeriod: async function (year, kind, idx, orgId) {
      var months = periodMonths(year, kind, idx), cur = currentMonth();
      if (!months.length) throw new Error('সময়কাল ঠিক নয়।');
      if (months[0] > cur) throw new Error('এই সময়কাল এখনও শুরু হয়নি।');
      var org = A.byId[orgId || A.me.id], nodes = [], coverage = [];
      if (org.level === 'M') {
        var all = [];
        for (var j = 0; j < months.length; j++) {
          if (months[j] > cur) continue;
          var mi = metroItems(months[j], await monthReports(months[j]), org);
          all = all.concat(mi.items);
          coverage.push({ month: months[j], label: monthLabel(months[j]), included: mi.items.length, missing: mi.missing });
        }
        var mf = allFields(months[months.length - 1]), mv = metroValues(mf, all, true);
        return { orgName: orgLabel(org), periodLabel: periodLabel(year, kind, idx), kindName: PERIOD_KINDS[kind].name,
                 months: months.map(monthLabel), nodeCount: all.length, partial: months[months.length - 1] > cur, metro: true,
                 fields: renumberSubs_(mf.filter(function (f) { return mv[f.key]; })), values: mv, gender: 'B', coverage: coverage };
      }
      for (var i = 0; i < months.length; i++) {
        var m = months[i];
        if (m > cur) continue;
        var ns = await collectNodes(m, org.id, 'submitted'), got = {};
        ns.forEach(function (n) { n.month = m; got[n.orgId] = 1; nodes.push(n); });
        var expected = [org].concat(A.orgs.filter(function (o) {
          return o.id !== org.id && o.active && startOk(o, m) && String(o.path).indexOf(org.path + '.') === 0;
        })).filter(function (o) { return startOk(o, m); });
        coverage.push({ month: m, label: monthLabel(m), included: ns.length,
                        missing: expected.filter(function (o) { return !got[o.id]; }).map(orgLabel) });
      }
      var fields = allFields(months[months.length - 1]), values = aggregatePeriod(fields, nodes);
      return { orgName: orgLabel(org), periodLabel: periodLabel(year, kind, idx), kindName: PERIOD_KINDS[kind].name,
               months: months.map(monthLabel), nodeCount: nodes.length, partial: months[months.length - 1] > cur,
               fields: renumberSubs_(fields.filter(function (f) { return values[f.key]; })), values: values,
               gender: org.gender, coverage: coverage };
    },

    /* PDF এর HTML (ছাপার জন্য)। থানা: ছাপা ফর্মের মতো (paperform.js); ওয়ার্ড/ইউনিট: সাধারণ তালিকা। */
    _leader: async function (org) {
      try { return await API._leader2(org); } catch (e) { return ''; }
    },
    _leader2: async function (org) {
      var m = check(await sb.from('memberships').select('user_id').eq('org_id', org.id).eq('role', 'president').eq('active', true));
      if (!m.length) return '';
      var p = check(await sb.from('profiles').select('full_name').in('user_id', [m[0].user_id]));
      return p.length ? (p[0].full_name || '') : '';
    },
    /* উপরের সংগঠন: নিজে দেখতে পেলে সেটা, নইলে শুধু নাম (0009 parent_name) */
    _parent: async function (org) {
      if (!org.parent_id) return null;
      if (A.byId[org.parent_id]) return A.byId[org.parent_id];
      try { var r = await sb.rpc('parent_name', { p_org: org.id }); return r.error || !r.data ? null : { name: r.data }; } catch (e) { return null; }
    },
    _leaderLabel: function (org) { return org.level === 'T' ? 'আমীর/সভাপতি' : (org.gender === 'F' ? 'সভানেত্রী' : 'সভাপতি'); },

    apiPdf: async function (month, orgId) {
      checkMonth(month);
      var org = A.byId[orgId || A.me.id];
      if (!org) throw new Error('পাওয়া যায়নি।');
      var reps = await monthReports(month), rep = reps[org.id];
      if (!rep || (rep.status !== STATUS.SUBMITTED && rep.status !== STATUS.ACCEPTED)) throw new Error('রিপোর্ট জমা দেওয়ার পর PDF পাওয়া যাবে।');
      var fields = allFields(month), d = rep.d, values;
      // মহানগর থানার নিচে দেখে না: থানার জমার সময়ের মোট ব্যবহার
      if (A.me.level === 'M' && org.id !== A.me.id && d.totals) values = d.totals;
      else values = aggregate(fields, await collectNodes(month, org.id, true, reps));
      var texts = {};
      fields.forEach(function (f) { if (f.pattern === 'TXT' && d.v[f.key] && d.v[f.key].txt) texts[f.key] = d.v[f.key].txt; });
      var parent = await API._parent(org);
      var excl = (d.excluded || []).map(function (id) { var o = A.byId[id]; return o ? orgLabel(o) : 'অজানা'; });
      var leader = await API._leader(org), font = { kind: 'sans', web: true };
      setPdfShowZero_('0');
      var html = org.level === 'W' ? buildWardPaperHtml({
        orgName: org.name, parentName: parent ? parent.name : '', female: org.gender === 'F', kind: 'মাসিক',
        monthName: MONTHS_BN[parseInt(month.split('-')[1], 10) - 1], year: bn(month.split('-')[0]),
        values: values, fontSize: org.gender === 'F' ? 10.5 : 10, pageBreaks: true, leader: leader, font: font, sign: true
      }) : org.level === 'T' ? buildPaperHtml({
        orgName: org.name, district: 'চট্টগ্রাম মহানগরী', kind: 'মাসিক',
        monthName: MONTHS_BN[parseInt(month.split('-')[1], 10) - 1], year: bn(month.split('-')[0]),
        values: values, coverage: excl.length ? [{ label: monthLabel(month), missing: excl }] : [],
        fontSize: 11, pageBreaks: true, leader: leader, leaderLabel: API._leaderLabel(org), font: font, sign: true
      }) : buildReportHtml({
        leader: leader, leaderLabel: API._leaderLabel(org), font: font, sign: true,
        levelLabel: { U: 'ইউনিট', W: 'ওয়ার্ড', T: 'থানা', M: 'মহানগর' }[org.level], orgName: orgLabel(org), parentName: parent ? parent.name : '',
        monthLabel: monthLabel(month), gender: org.gender,
        fields: fields.filter(function (f) { return f.enter.indexOf(org.level) >= 0 || org.level !== 'U'; }),
        values: values, texts: texts, excluded: excl
      });
      return { html: html, filename: 'report_' + org.code + '_' + month };
    },

    /* মহানগরের মাসিক সমন্বিত PDF (আপাতত থানার ছকে, শিরোনাম "মহানগরী") */
    apiMetroPdf: async function (month) {
      var t = await API.apiTotals(month, A.me.id), org = A.me;
      setPdfShowZero_('0');
      var cov = t.missing.length ? [{ label: monthLabel(month) + ' (জমা হয়নি)', missing: t.missing }] : [];
      if (t.submittedOnly.length) cov.push({ label: 'জমা হয়েছে, একসেপ্ট বাকি', missing: t.submittedOnly });
      var html = buildPaperHtml({
        title: 'মহানগরী সংগঠনের রিপোর্ট', orgLabel: 'মহানগরী', orgName: org.name, district: org.name, kind: 'মাসিক',
        monthName: MONTHS_BN[parseInt(month.split('-')[1], 10) - 1], year: bn(month.split('-')[0]),
        values: t.values, coverage: cov, fontSize: 11, pageBreaks: true,
        leader: await API._leader(org), leaderLabel: 'আমীর/সভাপতি', font: { kind: 'sans', web: true }, sign: true
      });
      return { html: html, filename: 'report_metro_' + month };
    },

    apiPeriodPdf: async function (year, kind, idx, orgId) {
      var r = await API.apiPeriod(year, kind, idx, orgId), org = A.byId[orgId || A.me.id];
      var months = periodMonths(year, kind, idx);
      var m1 = parseInt(months[0].split('-')[1], 10), m2 = parseInt(months[months.length - 1].split('-')[1], 10);
      var leader = await API._leader(org), font = { kind: 'sans', web: true }, parent = await API._parent(org);
      setPdfShowZero_('0');
      var pkind = kind === 'Y' ? 'বার্ষিক' : r.kindName, pmon = MONTHS_BN[m1 - 1] + ' – ' + MONTHS_BN[m2 - 1];
      var html = org.level === 'W' ? buildWardPaperHtml({
        orgName: org.name, parentName: parent ? parent.name : '', female: org.gender === 'F', kind: pkind,
        monthName: pmon, year: bn(year), values: r.values, fontSize: org.gender === 'F' ? 10.5 : 10, pageBreaks: true, leader: leader, font: font, sign: true
      }) : (org.level === 'T' || org.level === 'M') ? buildPaperHtml({
        title: org.level === 'M' ? 'মহানগরী সংগঠনের রিপোর্ট' : '', orgLabel: org.level === 'M' ? 'মহানগরী' : '',
        orgName: org.name, district: 'চট্টগ্রাম মহানগরী', kind: kind === 'Y' ? 'বার্ষিক' : r.kindName,
        monthName: MONTHS_BN[m1 - 1] + ' – ' + MONTHS_BN[m2 - 1], year: bn(year),
        values: r.values, coverage: r.coverage, fontSize: 9.5, pageBreaks: true,
        leader: leader, leaderLabel: API._leaderLabel(org), font: font, sign: true
      }) : buildReportHtml({
        leader: leader, leaderLabel: API._leaderLabel(org), font: font, sign: true,
        levelLabel: { U: 'ইউনিট', W: 'ওয়ার্ড', T: 'থানা', M: 'মহানগর' }[org.level], orgName: orgLabel(org), parentName: parent ? parent.name : '',
        monthLabel: r.periodLabel, periodKind: r.kindName, periodTitle: 'সময়কাল', gender: org.gender,
        fields: r.fields.filter(function (f) { return f.enter.indexOf(org.level) >= 0 || org.level !== 'U'; }),
        values: r.values, texts: {}, excluded: [], coverage: r.coverage
      });
      return { html: html, filename: 'report_' + org.code + '_' + year + '_' + kind + (kind === 'Y' ? '' : idx) };
    },

    /* শুরুর সংখ্যা: দেখা/লেখা (নিজের সংগঠন) ও খুলে দেওয়া (উপরের স্তর) */
    apiOpening: async function (orgId) {
      var org = A.byId[orgId || A.me.id];
      if (!org) throw new Error('এই সংগঠনটি পাওয়া যায়নি।');
      // মহানগর: থানার ছকের স্থায়ী ঘরগুলো (মহানগর লেখে শুধু থানার বাইরের অংশ)
      var fields = openingFields(org.level === 'M' ? fieldsForLevel(allFields(currentMonth()), 'T', 'B')
                                                   : fieldsForLevel(allFields(currentMonth()), org.level, org.gender));
      var op = await getOpening(org.id, true);
      var acc = check(await sb.from('reports').select('id').eq('org_id', org.id).eq('status', 'accepted').limit(1)).length > 0;
      var locked = op.locked || (acc && !op.unlocked);
      var mine = org.id === A.me.id;
      var upper = !mine && String(org.path).indexOf(A.me.path + '.') === 0;
      return { orgId: org.id, orgName: orgLabel(org), level: org.level, gender: org.gender, fields: renumberSubs_(fields),
               data: op.data, locked: locked, hasAccepted: acc, filled: Object.keys(op.data || {}).some(function (k) { return k !== 'f004'; }),
               canEdit: mine, canUnlock: upper && locked };
    },
    apiSaveOpening: async function (orgId, data) {
      var clean = {};
      Object.keys(data || {}).forEach(function (k) {
        var v = Number(data[k]);
        if (/^f\d{3}[a-z]?$/.test(k) && isFinite(v) && v >= 0) clean[k] = Math.round(v * 100) / 100;
      });
      check(await sb.rpc('save_opening', { p_org: orgId, p_data: clean }));
      delete OPEN[orgId];
      return { saved: true };
    },
    apiUnlockOpening: async function (orgId) {
      check(await sb.rpc('unlock_opening', { p_org: orgId }));
      delete OPEN[orgId];
      return { ok: true };
    },

    /* রিমাইন্ডার: জমা না দেওয়া অধীনস্থদের ফোনে (0010 send_reminder + Edge Function send-push) */
    apiRemind: async function (month) {
      checkMonth(month);
      var r = await sb.rpc('send_reminder', { p_parent: A.me.id, p_period: month + '-01' });
      if (r.error) throw new Error(r.error.message);
      try { await sb.functions.invoke('send-push', { body: {} }); } catch (e) { }   // না গেলেও সময়সূচি ৫ মিনিটে পাঠাবে
      return { orgs: r.data };
    },
    apiLastReminder: async function (month) {
      var r = await sb.from('reminder_log').select('kind,created_at,org_count').eq('parent_id', A.me.id).eq('period', month + '-01')
        .order('created_at', { ascending: false }).limit(1);
      if (r.error) return null;      // 0010 না চালানো থাকলে চুপচাপ
      return r.data[0] || null;
    },

    logout: async function () {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
      location.href = 'index.html';
    }
  };
  window.API = API;
})();
