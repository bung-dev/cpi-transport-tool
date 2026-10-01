import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// AI-NOTE: vitest globals를 켜지 않으므로 RTL의 자동 cleanup이 등록되지 않는다. 테스트 사이 DOM을 직접 비운다 (근거: REQ-010 AC-1, run 20260929-frontend-ui)
afterEach(() => cleanup());

// AI-NOTE: jsdom에는 scrollIntoView와 matchMedia가 없다. 결과로 스크롤하는 코드(REQ-105 AC-7)가 돌 수 있게 기본 대체를 두고, 테스트가 필요하면 vi.spyOn으로 덮어써 호출을 확인한다 (근거: REQ-105 AC-7, dev_todo 0-3절)
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
