import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The API only sends CORS headers for https://arthistory.piogino.ch, so in development
  // requests go to /v1 on the Vite server, which forwards them (src/api.ts picks the base URL).
  // API_TARGET (environment or .env.local) points it elsewhere, e.g. the backend's dev server:
  //   API_TARGET=http://localhost:3005 npm run dev   (also for `npm test`; not VITE_-prefixed: never in the bundle)
  const target = loadEnv(mode, '.', '').API_TARGET || 'https://api.arthistory.piogino.ch';
  return {
    // MapLibre alone is ~1 MB minified: its own chunk (src/map.ts, loaded only by pages with a map).
    build: { chunkSizeWarningLimit: 1500 },
    server: {
      proxy: { '/v1': { target, changeOrigin: true } },
    },
  };
});
