import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest globals를 켜지 않으므로 RTL의 자동 cleanup이 등록되지 않는다. 테스트 사이 DOM을 직접 비운다
afterEach(() => cleanup());
// S2: 화면 위치가 URL 해시라 테스트 사이에 주소가 남지 않게 되돌린다(REQ-410).
afterEach(() => window.history.replaceState(null, '', '/'));

// jsdom에는 scrollIntoView와 matchMedia가 없다. 결과로 스크롤하는 코드(REQ-105 AC-7)가 돌 수 있게 기본 대체를 두고, 테스트가 필요하면 vi.spyOn으로 덮어써 호출을 확인한다
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
