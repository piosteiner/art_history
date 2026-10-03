// Light/dark: follows the system ("auto") unless the header toggle picked a theme; remembered per browser.
type Choice = 'auto' | 'light' | 'dark';
const KEY = 'arthistory:theme';
const ORDER: Choice[] = ['auto', 'light', 'dark'];
const LABEL: Record<Choice, string> = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };

const media = window.matchMedia('(prefers-color-scheme: dark)');

function stored(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

let choice = stored();

export const isDark = () => (choice === 'auto' ? media.matches : choice === 'dark');

function apply() {
  if (choice === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = choice;
}
apply();

/** A header button cycling Auto → Light → Dark; `onChange` re-renders the page so maps switch style too. */
export function mountThemeToggle(root: HTMLElement, onChange: () => void) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle';
  const label = () => {
    btn.textContent = LABEL[choice];
    btn.title = `Theme: ${choice} (click to change)`;
  };
  label();
  btn.addEventListener('click', () => {
    const wasDark = isDark();
    choice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    try {
      if (choice === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* no storage: the choice lasts for this page */
    }
    apply();
    label();
    if (isDark() !== wasDark) onChange();
  });
  media.addEventListener('change', () => choice === 'auto' && onChange());
  root.append(btn);
}
