/* নিচের স্থায়ী মেনু: হোম · রিপোর্ট · সংগঠন · প্রোফাইল (দুই পাতাতেই একই)।
   কোন সংগঠনের রিপোর্ট খোলা, তা ফোনে মনে রাখা হয় (bji_org), যাতে সংগঠন/প্রোফাইল পাতা থেকে ফিরে একই জায়গায় আসা যায়। */
(function () {
  'use strict';
  var KEY = 'bji_org';
  function get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function set(id) { try { if (id) localStorage.setItem(KEY, id); } catch (e) { } }

  var css = '.bnav{position:fixed;left:0;right:0;bottom:0;z-index:7;background:var(--card,#fff);border-top:1px solid var(--line,#d9e0e5);' +
    'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:4px 4px max(6px,env(safe-area-inset-bottom))}' +
    '.bnav a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:52px;text-decoration:none;' +
    'color:var(--mut,var(--muted,#5b6862));font-size:12.5px;-webkit-tap-highlight-color:transparent}' +
    '.bnav a.on{color:var(--pri,var(--accent,#1f6f5c));font-weight:700}' +
    '.bnav a:focus-visible{outline:2px solid var(--pri,var(--accent,#1f6f5c));outline-offset:-4px;border-radius:10px}' +
    'body.hasnav main{padding-bottom:100px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    rep: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    org: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'
  };
  function item(key, href, label, active) {
    return '<a href="' + href + '"' + (active === key ? ' class="on" aria-current="page"' : '') + '>' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICON[key] + '</svg>' + label + '</a>';
  }
  /* active: 'home' | 'rep' | 'org' | 'me' ; orgId না দিলে মনে রাখা সংগঠন */
  function render(active, orgId) {
    if (orgId) set(orgId);
    var o = orgId || get(), q = o ? '?org=' + encodeURIComponent(o) : '';
    var nav = document.getElementById('bnav');
    if (!nav) { nav = document.createElement('nav'); nav.id = 'bnav'; nav.className = 'bnav'; nav.setAttribute('aria-label', 'প্রধান মেনু'); document.body.appendChild(nav); }
    nav.innerHTML = item('home', 'report.html' + q + '#home', 'হোম', active) + item('rep', 'report.html' + q + '#reports', 'রিপোর্ট', active) +
      item('org', 'index.html#org', 'সংগঠন', active) + item('me', 'index.html#profile', 'প্রোফাইল', active);
    show(true);
  }
  function show(on) {
    var nav = document.getElementById('bnav');
    if (nav) nav.style.display = on ? 'grid' : 'none';
    document.body.classList.toggle('hasnav', !!on);
  }
  window.BJI_NAV = { render: render, show: show, org: get, setOrg: set };
})();
