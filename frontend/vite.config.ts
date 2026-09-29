/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// AI-NOTE: 개발 서버(5173)에서만 쓰는 프록시. /transport/history도 /transport 접두어로 함께 프록시된다 (근거: REQ-001 AC-3, run 20260929-frontend-ui)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/packages': 'http://localhost:8080',
      '/transport': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
