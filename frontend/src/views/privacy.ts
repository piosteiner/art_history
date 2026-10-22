// Privacy statement (Swiss FADP / nDSG Art. 19, Telecommunications Act Art. 45c). Keep it in step with reality:
// when a service, a stored value or the log retention changes, update this page and its date.
import { html, render } from '../html';

const UPDATED = '21 October 2026';
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
          <td>Mostly Wikimedia Commons: Wikimedia Foundation, USA (<a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy" target="_blank" rel="noopener">privacy policy</a>).
            For some works, the open-access image server of the museum or collection that holds them (e.g. The Metropolitan
            Museum of Art, the Art Institute of Chicago or the Cleveland Museum of Art, USA; the Rijksmuseum, Netherlands;
            SMK, Denmark)</td>
          <td>Your IP address and the image requested. Images from Wikimedia are loaded directly from its servers, without
            cookies; each image names its source. Images from a museum's own server are shown through this site's API,
            which fetched them once and keeps a smaller copy — your browser doesn't contact that server. Only when you open
            such an image full size is it loaded from the museum's server, without cookies; a server that doesn't allow
            this anonymous loading gets the request once more as an ordinary one — still without telling it which page you
            came from; it could then read cookies it set itself on an earlier visit of yours to its own site.</td></tr>
      </tbody>
    </table></div>

    <h2>Short links to a view</h2>
    <p>When your selection on the start page gets long (many artists, works …), the site stores that selection on our
      server and shows a short address instead, such as <code>/?v=cec0c2f5</code>, so it can be bookmarked and shared.
      What is stored is only the selection itself: the chosen entries and the time window, under a code derived from
      them (the same selection always gets the same code). Nothing about you is stored with it. To limit how many links
      can be created, your IP address is kept in the server's memory for at most 10 minutes, and the request appears in
      the server log described above. Short links are kept so that they keep working; a selection names only public
      entries of this site.</p>
    <h2>Stored in your browser</h2>
    <p>This site sets <strong>no cookies</strong>. It remembers a few of your own choices in your browser's local storage,
      so they are still there on your next visit:</p>
    <ul>
      <li><code>arthistory:theme</code>: light or dark mode, if you changed it</li>
      <li><code>arthistory:sort:…</code>: the sort order you picked for a list</li>
      <li><code>arthistory:explore</code>: your last view on the start page (selection and time window)</li>
    </ul>
    <p>These values stay on your device and are never sent to us (a long selection is sent only to make a short link, as
      described above). You can refuse or delete them at any time by clearing
      the site data in your browser's settings, or by using a private window; the site works the same without them.</p>

    <h2>Data abroad</h2>
    <p>GitHub, the Wikimedia Foundation and some of the museums whose image servers are used are based in the USA, so your
      IP address and the request reach the USA when their services are used. GitHub states that it participates in the Swiss-U.S. Data Privacy Framework; for details see
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
