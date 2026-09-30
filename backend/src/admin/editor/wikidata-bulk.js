// Wikidata review (src/admin/wikidata-ui.js): "set all open suggestions" buttons. A suggestion counts as open while
// its "decide later" option is still available; "link" only applies where one of our entries is the target.
export function initWikidataBulk() {
  document.querySelectorAll('[data-wd-set]').forEach((button) => {
    button.addEventListener('click', () => {
      const want = button.dataset.wdSet;
      const groups = new Set([...document.querySelectorAll('.wd-form input[type=radio][name^="rel."]')].map((r) => r.name));
      for (const name of groups) {
        const option = document.querySelector(`.wd-form input[type=radio][name="${name}"][value="${want}"]`);
        if (option) option.checked = true;
      }
    });
  });
}
