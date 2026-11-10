import { defineConfig, loadEnv, type Plugin } from 'vite';

/** The Content-Security-Policy as a meta tag in the built pages (2026-11-10) — GitHub Pages sends no headers of
 * ours. Scripts only from the site (no inline scripts anywhere); inline styles allowed (style attributes in the
 * templates); data from the API and the CMS host of this build (production or the test environment) and the two map
 * services; images from anywhere on https (museum and Wikimedia pictures). Not in `npm run dev` (Vite's own scripts).
 * A meta tag cannot set frame-ancestors. Add a new outside service here, or the browser blocks it. */
function csp(env: Record<string, string>): Plugin {
  const origin = (u: string | undefined, fallback: string) => new URL(u || fallback).origin;
  const api = origin(env.VITE_API_BASE, 'https://api.arthistory.piogino.ch');
  const admin = origin(env.VITE_ADMIN_BASE, 'https://admin.arthistory.piogino.ch');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${admin} https://api.maptiler.com https://tiles.openfreemap.org`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`),
  };
}

export default defineConfig(({ mode }) => {
  // The API only sends CORS headers for https://arthistory.piogino.ch, so in development
  // requests go to /v1 on the Vite server, which forwards them (src/api.ts picks the base URL).
  // API_TARGET (environment or .env.local) points it elsewhere, e.g. the backend's dev server:
  //   API_TARGET=http://localhost:3011 npm run dev   (also for `npm test`; not VITE_-prefixed: never in the bundle)
  const env = loadEnv(mode, '.', '');
  const target = env.API_TARGET || 'https://api.arthistory.piogino.ch';
  return {
    plugins: [csp(env)],   // loadEnv with the prefix '' includes the environment (VITE_API_BASE of the test build)
    // MapLibre alone is ~1 MB minified: its own chunk (src/map.ts, loaded only by pages with a map).
    build: { chunkSizeWarningLimit: 1500 },
    server: {
      proxy: { '/v1': { target, changeOrigin: true } },
    },
  };
});
