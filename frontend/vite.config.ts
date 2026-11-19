/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// AI-NOTE: 개발 서버(5173)에서만 쓰는 프록시. 화면이 부르는 API 경로를 모두 넣는다. 빠지면 GET은 index.html(200),
// POST·DELETE는 빈 404가 돌아와 "알 수 없는 오류"가 뜬다. src/test/devProxy.test.ts가 client.ts와 맞는지 검사한다 (근거: fix/no-tenant-start)
const BACKEND = 'http://localhost:8080';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/packages': BACKEND,
      '/transport': BACKEND,
      '/tenants': BACKEND,
      '/templates': BACKEND,
      '/dashboard': BACKEND,
      '/audit': BACKEND,
      '/settings': BACKEND,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // AI-NOTE: 기본 워커 수로는 효율 코어가 많은 저전력 PC에서 CPU가 모자라 findBy 1초·테스트 5초 제한을 넘겼다.
    // 논리 코어 수의 절반으로 묶는다. 제한 시간 값은 바꾸지 않는다 (근거: fix/flaky-tests 사람 결정 2026-11-10, D-025 대체)
    maxWorkers: '50%',
  },
});
