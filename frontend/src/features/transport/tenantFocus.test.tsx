import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../App';
import type { Tenant, TransportResponse } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';

// REQ-310: 원본·대상 라디오를 방향키로 옮겨도 포커스가 새로 선택된 라디오에 남는다(직전 QA-083).
const qas: Tenant = { id: 'QAS', name: 'QAS', apiHost: 'localhost', source: 'env', createdAt: null };
const result: TransportResponse = { transportId: 't-focus', packageId: 'PkgTransportDemo', dryRun: true, deploy: false,
  startedAt: '2026-10-22T00:00:00Z', finishedAt: '2026-10-22T00:00:01Z', summary: { total: 0, succeeded: 0, failed: 0 }, results: [] };

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const routes: Parameters<typeof mockApi>[0] = {
    'GET /tenants': () => json({ store: 'OK', tenants: [...TENANTS_OK.tenants, qas] }),
    'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'POST /transport': () => json(result),
  };
  for (const id of ['DEV', 'PRD', 'QAS']) {
    routes[`GET /packages?tenantId=${id}`] = () => json(PACKAGES);
    for (const pkg of PACKAGES) routes[`GET /packages/${pkg.id}/artifacts?tenantId=${id}`] = () => json(ARTIFACTS);
  }
  const fn = mockApi(routes);
  render(<App />);
  return fn;
}
const group = (name: string) => within(screen.getByRole('radiogroup', { name }));
const radio = (name: string, tenant: string) => group(name).getByRole('radio', { name: tenant });
// 대기 없는 user-event: 동작·순서는 같고 Tab 수십 번을 도는 비용이 줄어 부하에서도 제한 시간 안에 끝난다.
const user = userEvent.setup({ delay: null });
const active = () => document.activeElement as HTMLElement;
const ready = async () => {
  await screen.findByLabelText('패키지 검색');
  await screen.findByRole('radiogroup', { name: '원본 테넌트' });
};
/** 키보드 Tab(또는 Shift+Tab)만으로 el에 닿는다. 닿지 못하면 실패한다. */
async function tabTo(el: HTMLElement, backward = false) {
  for (let i = 0; i < 80 && document.activeElement !== el; i++) {
    await user.keyboard(backward ? '{Shift>}{Tab}{/Shift}' : '{Tab}');
  }
  expect(active()).toBe(el);
}

for (const [key, name, order] of [
  ['원본', '원본 테넌트', ['DEV', 'PRD', 'QAS']],
  ['대상', '대상 테넌트', ['PRD', 'QAS', 'DEV']],
] as const) {
  it(`REQ-310 AC-1: ${key} 그룹은 Tab으로 들어가 ArrowDown·ArrowUp을 눌러도 포커스가 새로 선택된 라디오에 있다`, async () => {
    setup();
    await ready();
    const [first, second, third] = order;
    await tabTo(radio(name, first));
    for (const [keys, expected] of [['{ArrowDown}', second], ['{ArrowDown}', third], ['{ArrowUp}', second], ['{ArrowUp}', first]] as const) {
      await user.keyboard(keys);
      const now = radio(name, expected);
      await waitFor(() => expect(now).toBeChecked());
      expect(document.activeElement).toBe(radio(name, expected));
      expect(active().tagName).toBe('INPUT');
    }
  });
}

it('REQ-310 AC-2: 키보드만으로 원본·대상·패키지를 고르면 미리보기 실행 버튼이 활성이고 Enter로 시작된다', async () => {
  const fn = setup();
  await ready();
  // ① 원본 그룹에서 원본 선택(DEV → PRD)
  await tabTo(radio('원본 테넌트', 'DEV'));
  await user.keyboard('{ArrowDown}');
  expect(radio('원본 테넌트', 'PRD')).toBeChecked();
  expect(active()).toBe(radio('원본 테넌트', 'PRD'));
  // ② 대상 그룹에서 원본과 다른 대상 선택(PRD → QAS)
  await tabTo(radio('대상 테넌트', 'PRD'));
  await user.keyboard('{ArrowDown}');
  expect(radio('대상 테넌트', 'QAS')).toBeChecked();
  expect(active()).toBe(radio('대상 테넌트', 'QAS'));
  // Shift+Tab으로 원본 그룹으로 돌아갔다가 다시 Tab으로 대상 그룹에 온다
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(active()).toBe(radio('원본 테넌트', 'PRD'));
  await user.keyboard('{Tab}');
  expect(active()).toBe(radio('대상 테넌트', 'QAS'));
  // ③ 패키지 라디오: 방향키·Space
  const list = await screen.findByRole('list', { name: '패키지 목록' });
  const transportDemo = within(list).getByRole('radio', { name: /Transport Demo/ });
  const faultDemo = within(list).getByRole('radio', { name: /Fault Demo/ });
  // 선택이 없는 라디오 그룹에는 브라우저마다 Shift+Tab이 닿는 라디오가 다르므로 그룹 안의 어느 라디오든 닿으면 된다.
  for (let i = 0; i < 20 && !list.contains(document.activeElement); i++) await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(list.contains(document.activeElement)).toBe(true);
  await user.keyboard(' ');
  expect(active()).toBeChecked();
  for (let i = 0; i < 3 && !(transportDemo as HTMLInputElement).checked; i++) await user.keyboard('{ArrowUp}');
  expect(transportDemo).toBeChecked();
  expect(active()).toBe(transportDemo);
  await user.keyboard('{ArrowDown}');
  expect(faultDemo).toBeChecked();
  expect(active()).toBe(faultDemo);
  await user.keyboard('{ArrowUp}');
  expect(transportDemo).toBeChecked();
  await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
  // ④ 아티팩트는 기본값, 미리보기 실행 버튼이 활성이고 Tab으로 닿는다
  const run = screen.getByRole('button', { name: '미리보기 실행' });
  expect(run).toBeEnabled();
  await tabTo(run);
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: '이관 결과' });
  const posts = fn.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  const body = JSON.parse(posts[0][1]?.body as string);
  expect(body).toMatchObject({ sourceTenantId: 'PRD', targetTenantId: 'QAS', packageId: 'PkgTransportDemo', dryRun: true });
});

it('REQ-310 AC-2b: 패키지 선택 뒤 방향키로 원본을 바꾸면 선택이 비워지고 실행 버튼이 비활성이며 포커스는 새 원본 라디오다', async () => {
  setup();
  await ready();
  const list = await screen.findByRole('list', { name: '패키지 목록' });
  await tabTo(within(list).getByRole('radio', { name: /Transport Demo/ }));
  await user.keyboard(' ');
  await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
  expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
  await tabTo(radio('원본 테넌트', 'DEV'), true);
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(radio('원본 테넌트', 'PRD')).toBeChecked());
  expect(active()).toBe(radio('원본 테넌트', 'PRD'));
  const newList = await screen.findByRole('list', { name: '패키지 목록' });
  expect(within(newList).getAllByRole('radio').every(r => !(r as HTMLInputElement).checked)).toBe(true);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
  expect(active()).toBe(radio('원본 테넌트', 'PRD'));
});

it('REQ-310 AC-1: 처음 읽기와 대상 그룹 조작은 포커스를 원본 라디오로 가져가지 않는다', async () => {
  setup();
  await ready();
  expect(radio('원본 테넌트', 'DEV')).toBeChecked();
  expect(active()).toBe(document.body);
  // 다른 곳에 있던 포커스는 대상 그룹 조작 중에도 원본 라디오로 옮겨지지 않는다
  await tabTo(radio('대상 테넌트', 'PRD'));
  await user.keyboard('{ArrowDown}');
  expect(active()).toBe(radio('대상 테넌트', 'QAS'));
  expect(radio('원본 테넌트', 'DEV')).toBeChecked();
});

it('REQ-310 AC-3·AC-4: 방향키로 원본을 바꾸면 패키지 목록을 새 원본 기준으로 다시 읽는다 (AC-1·AC-2·AC-2b와 함께 이 파일이 확인한다)', async () => {
  const fn = setup();
  await ready();
  await waitFor(() => expect(fn.mock.calls.map(([url]) => url)).toContain('/packages?tenantId=DEV'));
  await tabTo(radio('원본 테넌트', 'DEV'));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(fn.mock.calls.map(([url]) => url)).toContain('/packages?tenantId=PRD'));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(fn.mock.calls.map(([url]) => url)).toContain('/packages?tenantId=QAS'));
  expect(active()).toBe(radio('원본 테넌트', 'QAS'));
  await screen.findByRole('list', { name: '패키지 목록' });
  expect(active()).toBe(radio('원본 테넌트', 'QAS'));
});
