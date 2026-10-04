// Privacy statement (Swiss FADP / nDSG Art. 19, Telecommunications Act Art. 45c). Keep it in step with reality:
// when a service, a stored value or the log retention changes, update this page and its date.
import { html, render } from '../html';

const UPDATED = '4 October 2026';
const CONTACT = 'info@piogino.ch';

export function privacy(main: HTMLElement) {
  document.title = 'Privacy · Art History';
  render(main, html`<article class="page prose-page">
    <h1>Privacy</h1>
    <p class="muted">Last updated ${UPDATED}</p>

    <h2>In short</h2>
    <p>No cookies, no analytics, no advertising, no accounts, no tracking. To show you this site, your browser
      connects to the services listed below, which therefore see your IP address. Nothing is used to identify or profile you.</p>

    <h2>Who is responsible</h2>
    <p>Pio Gino Steiner, Switzerland · <a href="mailto:${CONTACT}">${CONTACT}</a><br>
      Art History is a private, non-commercial hobby project.</p>

    <h2>What happens when you visit</h2>
    <div class="table-wrap"><table class="privacy-table">
      <thead><tr><th>What</th><th>Provider and location</th><th>What it receives</th></tr></thead>
      <tbody>
        <tr><td>The website itself</td>
          <td>GitHub Pages: GitHub, Inc., USA (<a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">privacy statement</a>)</td>
          <td>Your IP address, the page requested, browser details. GitHub logs these for operation and security.</td></tr>
        <tr><td>The content (artists, artworks …)</td>
          <td>Our own server <code>api.arthistory.piogino.ch</code> at Infomaniak, Switzerland</td>
          <td>Your IP address, time, the data requested, browser details, written to a server log for operation and
            security. The log is deleted after 14 days; it is not analysed or passed on.</td></tr>
        <tr><td>The map</td>
          <td>MapTiler AG, Switzerland (<a href="https://www.maptiler.com/privacy-policy/" target="_blank" rel="noopener">privacy policy</a>); map data © OpenStreetMap contributors</td>
          <td>Your IP address and the map area being shown. Loaded without cookies.</td></tr>
        <tr><td>Images</td>
          <td>Wikimedia Commons: Wikimedia Foundation, USA (<a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy" target="_blank" rel="noopener">privacy policy</a>)</td>
          <td>Your IP address and the image requested. Images are loaded directly from Wikimedia, without cookies.</td></tr>
      </tbody>
    </table></div>

    <h2>Stored in your browser</h2>
    <p>This site sets <strong>no cookies</strong>. It remembers a few of your own choices in your browser's local storage,
      so they are still there on your next visit:</p>
    <ul>
      <li><code>arthistory:theme</code>: light or dark mode, if you changed it</li>
      <li><code>arthistory:sort:…</code>: the sort order you picked for a list</li>
      <li><code>arthistory:explore</code>: your last view on the start page (selection and time window)</li>
    </ul>
    <p>These values stay on your device and are never sent to us. You can refuse or delete them at any time by clearing
      the site data in your browser's settings, or by using a private window; the site works the same without them.</p>

    <h2>Data abroad</h2>
    <p>GitHub and the Wikimedia Foundation are based in the USA, so your IP address and the request reach the USA when
      their services are used. GitHub states that it participates in the Swiss-U.S. Data Privacy Framework; for details see
      the privacy statements linked above. Our own server and MapTiler are in Switzerland.</p>

    <h2>Your rights</h2>
    <p>Under the Swiss Federal Act on Data Protection (FADP) you can ask what personal data about you is processed, and have
      it corrected or deleted. Write to <a href="mailto:${CONTACT}">${CONTACT}</a>. As we cannot tell who is behind an IP
      address and logs are deleted after 14 days, there is usually nothing we can link to you. You can also contact the
      Federal Data Protection and Information Commissioner (<a href="https://www.edoeb.admin.ch" target="_blank" rel="noopener">FDPIC</a>).</p>

    <h2>Editors</h2>
    <p>The editing area (<code>admin.arthistory.piogino.ch</code>) is only for invited editors. It uses a login cookie that
      is needed to stay signed in; visitors of this site never get it.</p>

    <h2>Changes</h2>
    <p>This statement is updated when the site changes; the date at the top shows the current version.</p>
  </article>`);
}
