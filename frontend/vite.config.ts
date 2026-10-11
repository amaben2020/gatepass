import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser only ever talks to :5173, so the session cookie is same-origin: no CORS, no credentials flags.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
