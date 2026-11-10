import base from '@testing-library/user-event';

// AI-NOTE: user-event의 직접 호출(userEvent.click 등)은 기본 delay 0이라 동작 사이마다 setTimeout을 기다린다.
// Windows에서는 이 대기가 타이머 주기(약 15ms)로 늘어나 클릭 하나에 약 50ms가 들고(대기 없음은 약 15ms), 병렬 전체 실행에서
// 긴 흐름 테스트가 5초 제한을 넘었다. 같은 API를 같은 방식(호출마다 새 인스턴스)으로 부르되 대기만 없앤다.
// 제한 시간 값은 바꾸지 않는다. 워커 수는 vite.config.ts에서 따로 묶었다 (근거: fix/flaky-tests)
const NO_WAIT = { delay: null } as const;

type Setup = NonNullable<Parameters<typeof base.setup>[0]>;
/** 호출마다 새 인스턴스. clear·tab은 직접 호출 API가 옵션을 받지 않아 setup으로 만든다(클립보드 쓰기는 직접 호출과 같이 끈다). */
const fresh = () => base.setup({ ...NO_WAIT, writeToClipboard: false });

export const userEvent = {
  setup: (options: Setup = {}) => base.setup({ ...NO_WAIT, ...options }),
  click: (element: Element, options: Parameters<typeof base.click>[1] = {}) => base.click(element, { ...NO_WAIT, ...options }),
  keyboard: (text: string, options: Parameters<typeof base.keyboard>[1] = {}) => base.keyboard(text, { ...NO_WAIT, ...options }),
  type: (element: Element, text: string, options: Parameters<typeof base.type>[2] = {}) => base.type(element, text, { ...NO_WAIT, ...options }),
  paste: (data: Parameters<typeof base.paste>[0], options: Parameters<typeof base.paste>[1] = {}) => base.paste(data, { ...NO_WAIT, ...options }),
  upload: (element: HTMLElement, files: Parameters<typeof base.upload>[1], options: Parameters<typeof base.upload>[2] = {}) =>
    base.upload(element, files, { ...NO_WAIT, ...options }),
  clear: (element: Element) => fresh().clear(element),
  tab: (options: Parameters<typeof base.tab>[0] = {}) => fresh().tab(options),
};
export default userEvent;
