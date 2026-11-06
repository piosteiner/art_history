// Light/dark for the admin: follows the system ("auto") unless the header toggle picked a theme; remembered per
// browser — as on the public site (frontend/src/theme.ts). Loaded in <head> without defer, so the chosen theme is set
// before the page is drawn (no flash of the other one); the toggle is wired once the page is there.
(function () {
  var KEY = 'arthistory-admin:theme';
  var ORDER = ['auto', 'light', 'dark'];
  var LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
  var choice = 'auto';
  try {
    var v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') choice = v;
  } catch (e) { /* no storage: auto */ }
  // The login and sign-up pages for the public site (owner 2026-11-06) follow the site's own choice, which the site
  // passes as ?theme=auto|light|dark (it lives in the site's storage, another origin) — kept for this tab, so the
  // way from "Log in" to "Create one" and back looks the same; the CMS's own choice is left as it is.
  if (/^\/(login|signup)\/?$/.test(location.pathname)) {
    try {
      var site = new URLSearchParams(location.search).get('theme');
      if (site === 'auto' || site === 'light' || site === 'dark') sessionStorage.setItem('arthistory-site:theme', site);
      else site = sessionStorage.getItem('arthistory-site:theme');
      if (site === 'auto' || site === 'light' || site === 'dark') choice = site;
    } catch (e) { /* no storage: the CMS's choice */ }
  }

  function apply() {
    if (choice === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', choice);
  }
  apply();

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;
    function label() {
      btn.textContent = LABEL[choice];
      btn.title = 'Theme: ' + choice + ' (click to change)';
    }
    label();
    btn.addEventListener('click', function () {
      choice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
      try {
        if (choice === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, choice);
      } catch (e) { /* the choice lasts for this page */ }
      apply();
      label();
    });
  });
})();
