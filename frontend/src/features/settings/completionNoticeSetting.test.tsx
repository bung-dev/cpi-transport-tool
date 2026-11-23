import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { baseRoutes, navLink, renderAt } from '../../test/appRoutes';
import { browserStore, installNotification } from '../../test/noticeFakes';

// 20261122-completion-notice S2: REQ-1103 완료 알림 설정(브라우저 알림 켬).
// 화면 계약(이 테스트가 정함):
// - 설정 탭에 region "완료 알림"(제목 heading "완료 알림") 안에 switch "브라우저 알림"(기본 꺼짐).
//   스위치의 설명(aria-describedby)은 "이관이 끝났을 때 이 탭을 보고 있지 않으면 브라우저 알림을 띄웁니다. 이 브라우저에만 저장됩니다".
//   동시 처리 "저장" 버튼과 따로, 바꾸는 즉시 이 브라우저에 저장한다(PUT /settings를 부르지 않는다).
// - 켬: Notification.permission이 'default'면 Notification.requestPermission()을 부른다. 'granted'면 켜진 채 저장한다.
// - 차단(허락 'denied'이거나 거부, 또는 저장값은 켜짐인데 지금 허락이 'granted'가 아님): 스위치 꺼짐 +
//   role=alert "브라우저에서 알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용한 뒤 다시 켜세요".
// - 미지원(window.Notification 없음): 스위치 비활성 + 글자 "이 브라우저는 알림을 지원하지 않습니다".
// - 저장소를 읽거나 쓸 수 없으면 꺼짐으로 보고 오류 없이 동작한다.
const BLOCKED = '브라우저에서 알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용한 뒤 다시 켜세요';
const UNSUPPORTED = '이 브라우저는 알림을 지원하지 않습니다';
const DESCRIPTION = '이관이 끝났을 때 이 탭을 보고 있지 않으면 브라우저 알림을 띄웁니다. 이 브라우저에만 저장됩니다';

beforeEach(() => browserStore().clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  browserStore().clear();
});

function setup() {
  const fn = mockApi(baseRoutes({
    'GET /settings': () => json({ previewConcurrency: 4, transportConcurrency: 4 }),
    'PUT /settings': (init) => json(JSON.parse(String(init?.body))),
  }));
  const view = renderAt('#/settings');
  return { fn, view };
}
const group = () => screen.findByRole('region', { name: '완료 알림' });
const toggle = async () => within(await group()).getByRole('switch', { name: '브라우저 알림' });
const puts = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.filter(([u, init]) => u === '/settings' && init?.method === 'PUT');

describe('REQ-1103 완료 알림 설정', () => {
  it('REQ-1103: 설정 탭에 "완료 알림" 묶음과 꺼진 "브라우저 알림" 스위치, 설명이 보인다', async () => {
    installNotification('default');
    setup();
    const region = await group();
    expect(within(region).getByRole('heading', { name: '완료 알림' })).toBeInTheDocument();
    const sw = await toggle();
    expect(sw).not.toBeChecked();
    expect(sw).toBeEnabled();
    expect(sw).toHaveAccessibleDescription(DESCRIPTION);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('REQ-1103: 켜면 허락을 묻고 granted면 켜진 채 저장한다. 다른 화면에 갔다 오거나 새로고침해도 켜짐이고, 동시 처리 저장(PUT)은 부르지 않는다', async () => {
    const N = installNotification('default', 'granted');
    const { fn, view } = setup();
    await userEvent.click(await toggle());
    await waitFor(async () => expect(await toggle()).toBeChecked());
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(puts(fn)).toHaveLength(0);

    await userEvent.click(navLink('대시보드'));
    await userEvent.click(navLink('설정'));
    expect(await toggle()).toBeChecked();

    view.unmount();
    renderAt('#/settings');
    expect(await toggle()).toBeChecked();
    // 이미 granted면 다시 묻지 않는다.
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('REQ-1103: 켠 뒤 끄면 꺼짐으로 남는다(새로고침 뒤에도)', async () => {
    installNotification('granted');
    const { view } = setup();
    await userEvent.click(await toggle());
    await waitFor(async () => expect(await toggle()).toBeChecked());
    await userEvent.click(await toggle());
    expect(await toggle()).not.toBeChecked();
    view.unmount();
    renderAt('#/settings');
    expect(await toggle()).not.toBeChecked();
  });

  it('REQ-1103 실패: 허락을 물었는데 거부하면 스위치가 꺼짐으로 돌아가고 차단 안내가 보인다', async () => {
    const N = installNotification('default', 'denied');
    const { view } = setup();
    await userEvent.click(await toggle());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(BLOCKED);
    expect(await toggle()).not.toBeChecked();
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    view.unmount();
    renderAt('#/settings');
    expect(await toggle()).not.toBeChecked();
  });

  it('REQ-1103 실패: 허락이 이미 denied면 묻지 않고 꺼짐으로 돌아가며 차단 안내가 보인다', async () => {
    const N = installNotification('denied');
    setup();
    await userEvent.click(await toggle());
    expect(await screen.findByRole('alert')).toHaveTextContent(BLOCKED);
    expect(await toggle()).not.toBeChecked();
    expect(N.requestPermission).not.toHaveBeenCalled();
  });

  it('REQ-1103 실패: 브라우저가 알림을 지원하지 않으면 스위치가 비활성이고 미지원 안내가 보인다', async () => {
    expect('Notification' in window).toBe(false);
    setup();
    const sw = await toggle();
    expect(sw).toBeDisabled();
    expect(sw).not.toBeChecked();
    expect(within(await group()).getByText(UNSUPPORTED)).toBeInTheDocument();
  });

  it('REQ-1103 실패: 저장값은 켜짐인데 나중에 브라우저에서 막았으면 꺼짐으로 보이고 차단 안내가 보인다', async () => {
    const N = installNotification('granted');
    const { view } = setup();
    await userEvent.click(await toggle());
    await waitFor(async () => expect(await toggle()).toBeChecked());
    view.unmount();
    N.permission = 'denied';
    renderAt('#/settings');
    const sw = await toggle();
    expect(sw).not.toBeChecked();
    expect(await screen.findByRole('alert')).toHaveTextContent(BLOCKED);
  });

  it('REQ-1103 실패: 저장소를 읽을 수 없으면 꺼짐으로 보고 오류가 없다', async () => {
    installNotification('granted');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    setup();
    expect(await toggle()).not.toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('REQ-1103 실패: 저장소에 쓸 수 없으면 켜도 꺼짐으로 보고 오류가 없다', async () => {
    installNotification('granted');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const { view } = setup();
    await userEvent.click(await toggle());
    await new Promise((r) => setTimeout(r, 100));
    expect(await toggle()).not.toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();
    renderAt('#/settings');
    expect(await toggle()).not.toBeChecked();
  });
});
