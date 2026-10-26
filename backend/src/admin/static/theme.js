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
