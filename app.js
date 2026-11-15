/* BJI Report — অ্যাডমিন ও দায়িত্বশীল পাতা (পরীক্ষামূলক)
 * নিরাপত্তা: সব অনুমতি ডেটাবেসে (RLS + ফাংশন) যাচাই হয়; এখানের অনুমতি-হিসাব শুধু
 * কোন বোতাম দেখাবে তা ঠিক করে। */
(function () {
  'use strict';

  const $app = document.getElementById('app');
  const $msg = document.getElementById('msg');
  const $user = document.getElementById('userBox');

  if (!window.supabase || !window.BJI_CONFIG) {
    $app.innerHTML = '<div class="card">প্রয়োজনীয় ফাইল লোড হয়নি। ইন্টারনেট সংযোগ দেখে পাতা রিফ্রেশ করুন।</div>';
    return;
  }
  const CFG = window.BJI_CONFIG;
  if (CFG.env !== 'live') document.getElementById('envNote').textContent = 'পরীক্ষামূলক সংস্করণ (staging)';
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);

  const LEVEL = { M: 'মহানগর', T: 'থানা', W: 'ওয়ার্ড', U: 'ইউনিট' };
  const CHILD = { M: 'T', T: 'W', W: 'U' };
  const ROLE = { admin: 'অ্যাডমিন', president: 'সভাপতি', secretary: 'সেক্রেটারি' };
  const GENDER = { M: 'পুরুষ', F: 'মহিলা', B: '' };
  const BASE_URL = location.origin + location.pathname;
  const INVITE_KEY = 'bji_invite_token';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bnNum = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
  const fmtDate = (iso) => { const d = new Date(iso); return bnNum(d.getDate()) + '/' + bnNum(d.getMonth() + 1) + '/' + bnNum(d.getFullYear()); };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function showMsg(text, kind) {
    $msg.innerHTML = text ? `<div class="msg ${kind || 'warn'}">${esc(text)}</div>` : '';
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const errText = (e) => (e && (e.message || e.error_description)) || String(e);

  // ---- নিমন্ত্রণ-টোকেন: URL থেকে নিয়ে ফোনে রাখা, URL পরিষ্কার করা ----
  (function captureInvite() {
    const p = new URLSearchParams(location.search);
    const t = p.get('invite');
    if (t && /^[0-9a-f]{48}$/.test(t)) store.set(INVITE_KEY, t);
    if (p.has('invite')) history.replaceState(null, '', BASE_URL);
  })();

  // ---- অবস্থা ----
  let S = null;       // লোড করা তথ্য
  const ui = { open: new Set(), form: null, link: null };   // খোলা সংগঠন, খোলা ফর্ম, সদ্য বানানো লিংক

  // ---- লগইন/লগআউট ----
  async function login() {
    showMsg('');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: BASE_URL, queryParams: { prompt: 'select_account' } }
    });
    if (error) showMsg('লগইন শুরু করা যায়নি: ' + errText(error), 'err');
  }
  function resetLogin() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    location.replace(BASE_URL);
  }
  async function logout() {
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    resetLogin();
  }

  // ---- তথ্য আনা ----
  async function loadAll(user) {
    const nowIso = new Date().toISOString();
    const [mem, orgs, inv, jr, myReq] = await Promise.all([
      sb.from('memberships').select('id,role,org_id,user_id').eq('active', true),
      sb.from('orgs').select('id,code,name,level,gender,parent_id,path,active').order('path'),
      sb.from('invites').select('id,org_id,role,created_at,expires_at').is('used_at', null).is('revoked_at', null).gt('expires_at', nowIso),
      sb.rpc('list_join_requests'),
      sb.from('join_requests').select('id,role,status,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(3)
    ]);
    for (const r of [mem, orgs, inv, myReq]) if (r.error) throw r.error;

    const orgById = new Map(orgs.data.map((o) => [o.id, o]));
    const ids = [...new Set(mem.data.map((m) => m.user_id))];
    const prof = ids.length ? await sb.from('profiles').select('user_id,email,full_name').in('user_id', ids) : { data: [] };
    if (prof.error) throw prof.error;

    const mine = mem.data.filter((m) => m.user_id === user.id && orgById.has(m.org_id))
      .map((m) => ({ ...m, org: orgById.get(m.org_id) }));
    return {
      user, orgs: orgs.data, orgById, mine,
      members: mem.data,
      profiles: new Map(prof.data.map((p) => [p.user_id, p])),
      invites: inv.data,
      joinReqs: jr.error ? null : jr.data,      // null = 0003 migration চালানো হয়নি
      myReqs: myReq.data
    };
  }

  // ---- কোন বোতাম দেখাবে (ডেটাবেসের নিয়মের প্রতিচ্ছবি) ----
  const under = (o, base) => o.path === base.path || o.path.startsWith(base.path + '.');
  const isMetroAdmin = () => S.mine.some((m) => m.role === 'admin' && m.org.level === 'M');
  const canManage = (o) => S.mine.some((m) => o.id !== m.org.id && under(o, m.org));
  const canInvite = (o) => o.active && (canManage(o) || (o.level === 'M' && isMetroAdmin()));
  const canAddChild = (o) => o.active && !!CHILD[o.level] &&
    S.mine.some((m) => under(o, m.org) && (m.org.level !== 'M' || o.level === 'M'));

  // ---- আঁকা ----
  function personLabel(uid) {
    const p = S.profiles.get(uid);
    if (!p) return 'অজানা ব্যবহারকারী';
    return (p.full_name ? esc(p.full_name) + ' · ' : '') + `<span class="muted">${esc(p.email)}</span>`;
  }

  function orgHtml(o, kids) {
    const members = S.members.filter((m) => m.org_id === o.id);
    const invites = S.invites.filter((i) => i.org_id === o.id);
    const inviteOK = canInvite(o);
    const roles = o.level === 'M' ? ['admin', 'president', 'secretary'] : ['president', 'secretary'];

    const memRows = roles.map((role) => {
      const ms = members.filter((m) => m.role === role);
      if (role === 'admin') {
        return ms.map((m) => `<div class="row"><span>${ROLE.admin}: ${personLabel(m.user_id)}</span></div>`).join('');
      }
      if (!ms.length) {
        return `<div class="row"><span>${ROLE[role]}: <span class="muted">খালি</span></span>
          ${inviteOK ? `<button class="small" data-act="invite" data-org="${o.id}" data-role="${role}">নিমন্ত্রণ</button>` : ''}</div>`;
      }
      return ms.map((m) => `<div class="row"><span>${ROLE[role]}: ${personLabel(m.user_id)}</span>
          ${inviteOK && m.user_id !== S.user.id ? `<span><button class="small" data-act="invite" data-org="${o.id}" data-role="${role}" title="নতুন জনকে নিমন্ত্রণ দিলে ইনি সরে যাবেন">বদল</button>
          <button class="small danger" data-act="remove" data-mem="${m.id}">সরান</button></span>` : ''}</div>`).join('');
    }).join('');

    const invRows = inviteOK && invites.length ? `<div class="muted" style="margin-top:8px">অপেক্ষমাণ নিমন্ত্রণ:</div>` + invites.map((i) =>
      `<div class="row"><span>${ROLE[i.role]} · মেয়াদ ${fmtDate(i.expires_at)} পর্যন্ত</span>
       <button class="small" data-act="revoke" data-inv="${i.id}">বাতিল</button></div>`).join('') : '';

    const link = ui.link && ui.link.org === o.id ? `<div class="linkbox">
        <b>${ROLE[ui.link.role]} এর নিমন্ত্রণ-লিংক</b> (একবার ব্যবহারযোগ্য, ৭ দিন মেয়াদ। লিংকটি আর দেখানো হবে না, এখনই পাঠান):<br>
        <span>${esc(ui.link.url)}</span>
        <div class="actions">
          <a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(ui.link.text)}">WhatsApp এ পাঠান</a>
          <button data-act="copy">কপি করুন</button>
          <button data-act="closeLink">বন্ধ</button>
        </div></div>` : '';

    const childLv = CHILD[o.level];
    const addForm = ui.form && ui.form.org === o.id ? `<div class="inline-form">
        <label for="newName">নতুন ${LEVEL[childLv]} এর নাম</label>
        <input id="newName" maxlength="120" placeholder="যেমন: ${childLv === 'T' ? 'ডবলমুরিং থানা' : childLv === 'W' ? 'ওয়ার্ড ২৮' : 'ইউনিট ১'}">
        <label for="newGender">ধরন</label>
        <select id="newGender"><option value="M" ${o.gender !== 'F' ? 'selected' : ''}>পুরুষ</option><option value="F" ${o.gender === 'F' ? 'selected' : ''}>মহিলা</option></select>
        <div class="actions"><button class="primary" data-act="createOrg" data-org="${o.id}" data-level="${childLv}">যোগ করুন</button>
        <button data-act="cancelForm">বাতিল</button></div></div>` : '';

    const addBtn = canAddChild(o) && !(ui.form && ui.form.org === o.id)
      ? `<button class="small" data-act="openForm" data-org="${o.id}">+ নতুন ${LEVEL[childLv]}</button>` : '';

    const open = ui.open.has(o.id) ? 'open' : '';
    const g = GENDER[o.gender] ? `<span class="tag ${o.gender === 'F' ? 'f' : ''}">${GENDER[o.gender]}</span>` : '';
    return `<details class="org" ${open} data-org="${o.id}">
      <summary><span><span class="nm">${esc(o.name)}</span> ${g}${o.active ? '' : ' <span class="tag">নিষ্ক্রিয়</span>'}<br>
        <code>${esc(o.code)} · ${LEVEL[o.level]}</code></span><span class="muted">${kids.length ? bnNum(kids.length) + 'টি অধীনে' : ''}</span></summary>
      <div class="org-body">${memRows}${invRows}${link}${addForm}
        ${addBtn ? `<div class="actions">${addBtn}</div>` : ''}
        ${kids.length ? `<div class="children">${kids.map((k) => k.html).join('')}</div>` : ''}
      </div></details>`;
  }

  function treeHtml() {
    const kidsOf = new Map();
    for (const o of S.orgs) {
      const key = o.parent_id && S.orgById.has(o.parent_id) ? o.parent_id : 'root';
      if (!kidsOf.has(key)) kidsOf.set(key, []);
      kidsOf.get(key).push(o);
    }
    const build = (o) => ({ html: orgHtml(o, (kidsOf.get(o.id) || []).map(build)) });
    return (kidsOf.get('root') || []).map(build).map((x) => x.html).join('');
  }

  function joinRequestsHtml() {
    if (S.joinReqs === null) return `<div class="msg warn">যোগদান-অনুরোধের তালিকা দেখাতে ডেটাবেসে "0003" ফাইলটি চালাতে হবে।</div>`;
    if (!S.joinReqs.length) return '';
    return `<div class="card"><h2>অপেক্ষমাণ যোগদান-অনুরোধ</h2>` + S.joinReqs.map((r) => `
      <div class="row"><span>${esc(r.full_name || '')} <span class="muted">${esc(r.email || '')}</span><br>
        ${esc(r.org_name)} <code>${esc(r.org_code)}</code> · ${ROLE[r.role]}${r.note ? `<br><span class="muted">"${esc(r.note)}"</span>` : ''}</span>
        <span><button class="small primary" data-act="approve" data-req="${r.id}">অনুমোদন</button>
        <button class="small danger" data-act="reject" data-req="${r.id}">বাতিল</button></span></div>`).join('') + `</div>`;
  }

  function noRoleHtml() {
    const pending = S.myReqs.find((r) => r.status === 'pending');
    const last = S.myReqs[0];
    return `<div class="card"><h2>আপনি এখনো কোনো সংগঠনের দায়িত্বে নেই</h2>
      <p class="muted">উপরের স্তরের দায়িত্বশীলের কাছ থেকে নিমন্ত্রণ-লিংক নিন। লিংক না পেলে বা মেয়াদ শেষ হলে নিচে অনুরোধ পাঠান।</p>
      ${pending ? `<div class="msg ok">আপনার অনুরোধ (${ROLE[pending.role]}) ${fmtDate(pending.created_at)} থেকে অনুমোদনের অপেক্ষায় আছে।</div>`
        : `${last && last.status === 'rejected' ? `<div class="msg warn">আপনার আগের অনুরোধটি গৃহীত হয়নি।</div>` : ''}
        <label for="jrCode">আপনার সংগঠনের কোড (উপরের স্তর থেকে জেনে নিন)</label>
        <input id="jrCode" placeholder="যেমন: t05w03u2" autocapitalize="off" autocomplete="off">
        <label for="jrRole">পদ</label>
        <select id="jrRole"><option value="president">সভাপতি</option><option value="secretary">সেক্রেটারি</option></select>
        <label for="jrNote">ছোট পরিচয় (ঐচ্ছিক)</label>
        <input id="jrNote" maxlength="200" placeholder="নাম, ফোন ইত্যাদি">
        <div class="actions"><button class="primary" data-act="requestJoin">অনুরোধ পাঠান</button></div>`}
    </div>`;
  }

  function draw() {
    $user.innerHTML = `<button class="small" data-act="logout">লগআউট</button>`;
    if (!S.mine.length) { $app.innerHTML = noRoleHtml(); return; }
    const mineHtml = S.mine.map((m) => `<div class="row"><span>${LEVEL[m.org.level]}: ${esc(m.org.name)} <code>${esc(m.org.code)}</code></span><b>${ROLE[m.role]}</b></div>`).join('');
    $app.innerHTML = `
      <div class="card"><h2>${esc(S.user.user_metadata?.full_name || S.user.email)}</h2>${mineHtml}</div>
      ${joinRequestsHtml()}
      <div class="card"><h2>সংগঠন</h2>
        <p class="muted" style="margin-top:0">নামে চাপলে খুলবে। দায়িত্বশীল খালি থাকলে "নিমন্ত্রণ" চাপুন।</p>
        ${treeHtml()}</div>`;
  }

  function drawLoggedOut() {
    $user.innerHTML = '';
    const hasInvite = !!store.get(INVITE_KEY);
    $app.innerHTML = `<div class="card">
      ${hasInvite ? '<div class="msg ok">আপনি একটি নিমন্ত্রণ-লিংক খুলেছেন। যোগ দিতে নিজের Gmail দিয়ে লগইন করুন।</div>' : '<p style="margin-top:0">নিজের Gmail দিয়ে ঢুকুন।</p>'}
      <button class="primary full" data-act="login">Google দিয়ে লগইন</button>
      <p class="muted" style="margin-bottom:0">Google যদি বলে "Google hasn't verified this app", তাহলে <b>Continue</b> চাপুন। অ্যাপটি এখন পরীক্ষামূলক অবস্থায় আছে।</p></div>`;
  }

  // ---- মূল চক্র: সারিবদ্ধ, watchdog সহ ----
  let busy = false, again = false;
  async function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    const watchdog = setTimeout(showStuck, 15000);
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { S = null; drawLoggedOut(); return; }
      const token = store.get(INVITE_KEY);
      if (token) {
        store.del(INVITE_KEY);
        const { data, error } = await sb.rpc('accept_invite', { p_token: token });
        if (error) showMsg('নিমন্ত্রণ গ্রহণ করা যায়নি: ' + errText(error), 'err');
        else showMsg(`স্বাগতম! আপনি এখন ${data.name} (${LEVEL[data.level]}) এর দায়িত্বে যুক্ত হয়েছেন।`, 'ok');
      }
      S = await loadAll(session.user);
      for (const m of S.mine) ui.open.add(m.org.id);
      draw();
    } catch (e) {
      showMsg('তথ্য আনতে সমস্যা হয়েছে: ' + errText(e), 'err');
      showStuck();
    } finally {
      clearTimeout(watchdog);
      busy = false;
      if (again) { again = false; refresh(); }
    }
  }
  function showStuck() {
    $app.innerHTML = `<div class="card">
      <p style="margin-top:0">পাতা লোড হতে সমস্যা হচ্ছে। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।</p>
      <button class="primary full" data-act="reload">আবার চেষ্টা করুন</button>
      <p class="muted" style="margin-bottom:6px">তবুও না হলে:</p>
      <button data-act="resetLogin">লগইন মুছে নতুন করে ঢুকুন</button></div>`;
  }

  // ---- কাজ (বোতাম) ----
  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { showMsg(errText(e), 'err'); }
    finally { if (btn) btn.disabled = false; }
  }
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; };

  const actions = {
    login: () => login(),
    logout: () => logout(),
    reload: () => location.reload(),
    resetLogin: () => resetLogin(),
    openForm: (b) => { ui.form = { org: b.dataset.org }; draw(); document.getElementById('newName')?.focus(); },
    cancelForm: () => { ui.form = null; draw(); },
    closeLink: () => { ui.link = null; draw(); },
    copy: async (b) => {
      try { await navigator.clipboard.writeText(ui.link.url); b.textContent = 'কপি হয়েছে ✓'; }
      catch (e) { showMsg('কপি করা যায়নি; লিংকটি চেপে ধরে নিজে কপি করুন।'); }
    },
    createOrg: (b) => run(b, async () => {
      const name = document.getElementById('newName').value.trim();
      const gender = document.getElementById('newGender').value;
      if (!name) { showMsg('নাম লিখুন।'); return; }
      const o = await rpc('create_org', { p_parent: b.dataset.org, p_name: name, p_level: b.dataset.level, p_gender: gender, p_start_month: null });
      ui.form = null; ui.open.add(b.dataset.org); ui.open.add(o.id);
      showMsg(`"${o.name}" যোগ হয়েছে (কোড ${o.code})। এখন এর দায়িত্বশীলদের নিমন্ত্রণ পাঠান।`, 'ok');
      await refresh();
    }),
    invite: (b) => run(b, async () => {
      const org = S.orgById.get(b.dataset.org), role = b.dataset.role;
      const token = await rpc('create_invite', { p_org: org.id, p_role: role });
      const url = BASE_URL + '?invite=' + token;
      ui.link = { org: org.id, role, url,
        text: `আসসালামু আলাইকুম। BJI Report এ "${org.name}" এর ${ROLE[role]} হিসেবে যোগ দিতে এই লিংকে চাপুন এবং নিজের Gmail দিয়ে লগইন করুন:\n${url}\n(লিংকটি একবার ব্যবহারযোগ্য, ৭ দিনের মধ্যে ব্যবহার করুন)` };
      ui.open.add(org.id);
      await refresh();
    }),
    revoke: (b) => run(b, async () => { await rpc('revoke_invite', { p_invite: b.dataset.inv }); await refresh(); }),
    remove: (b) => run(b, async () => {
      if (!window.confirm('এই দায়িত্বশীলকে সরাবেন? সাথে সাথে তাঁর প্রবেশ বন্ধ হয়ে যাবে।')) return;
      await rpc('remove_member', { p_membership: b.dataset.mem }); showMsg('সরানো হয়েছে।', 'ok'); await refresh();
    }),
    approve: (b) => run(b, async () => { await rpc('decide_join', { p_request: b.dataset.req, p_approve: true }); showMsg('অনুমোদন দেওয়া হয়েছে।', 'ok'); await refresh(); }),
    reject: (b) => run(b, async () => { await rpc('decide_join', { p_request: b.dataset.req, p_approve: false }); await refresh(); }),
    requestJoin: (b) => run(b, async () => {
      const code = document.getElementById('jrCode').value.trim().toLowerCase();
      if (!/^[a-z0-9]{2,32}$/.test(code)) { showMsg('সঠিক কোড লিখুন (যেমন t05w03u2)।'); return; }
      await rpc('request_join', { p_org_code: code, p_role: document.getElementById('jrRole').value,
        p_note: document.getElementById('jrNote').value.trim() || null });
      showMsg('অনুরোধ পাঠানো হয়েছে। উপরের স্তর অনুমোদন দিলে আপনি সংগঠন দেখতে পাবেন।', 'ok');
      await refresh();
    })
  };

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || !actions[b.dataset.act]) return;
    if (b.tagName === 'A') return;          // WhatsApp লিংক নিজে খুলবে
    ev.preventDefault();
    actions[b.dataset.act](b);
  });
  // খোলা/বন্ধ সংগঠন মনে রাখা
  document.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (d.matches && d.matches('details.org')) d.open ? ui.open.add(d.dataset.org) : ui.open.delete(d.dataset.org);
  }, true);

  // গুরুত্বপূর্ণ: এই callback এর ভেতরে সরাসরি Supabase ডাকা যাবে না (লক আটকে যায়)
  sb.auth.onAuthStateChange((event) => {
    if (event === 'TOKEN_REFRESHED') return;   // শুধু নবায়নে নতুন করে আঁকার দরকার নেই
    setTimeout(refresh, 0);
  });
})();
