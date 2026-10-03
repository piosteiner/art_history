import { defineConfig } from 'vite';

export default defineConfig({
  // The API only sends CORS headers for https://arthistory.piogino.ch, so in development
  // requests go to /v1 on the Vite server, which forwards them (src/api.ts picks the base URL).
  // MapLibre alone is ~1 MB minified; one cached bundle is fine for this site.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    proxy: { '/v1': { target: 'https://api.arthistory.piogino.ch', changeOrigin: true } },
  },
});
