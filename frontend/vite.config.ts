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
    // AI-NOTE: 기본 워커 수(논리 코어-1)는 저전력 노트북(성능 코어 2 + 효율 코어 10)에서 CPU를 모자라게 해 findBy 1초·테스트 5초 제한을 넘겼다.
    // 코어 수의 절반으로 묶는다. 전체 실행도 약 60초에서 34초로 줄었다. 제한 시간 값은 바꾸지 않는다 (근거: fix/flaky-tests 사람 결정 2026-11-10, D-025 대체)
    maxWorkers: '50%',
  },
});
