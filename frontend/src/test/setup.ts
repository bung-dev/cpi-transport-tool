import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// AI-NOTE: vitest globals를 켜지 않으므로 RTL의 자동 cleanup이 등록되지 않는다. 테스트 사이 DOM을 직접 비운다.
afterEach(() => cleanup());
