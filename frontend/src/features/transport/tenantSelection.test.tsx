import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../App';
import { getArtifacts, getPackages } from '../../api/client';
import type { Tenant, TransportResponse } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { TestTenantProvider } from '../../test/tenantProvider';
import { RunPanel } from './RunPanel';

const extra: Tenant = { id: 'source /2', name: 'EXTRA', apiHost: 'api.localhost', source: 'registered', createdAt: null };
const result: TransportResponse = { transportId: 't-selection', packageId: 'PkgTransportDemo', dryRun: true, deploy: false,
  startedAt: '2026-10-07T00:00:00Z', finishedAt: '2026-10-07T00:00:01Z', summary: { total: 0, succeeded: 0, failed: 0 }, results: [] };
afterEach(() => vi.unstubAllGlobals());
function setup(tenants = [...TENANTS_OK.tenants, extra]) {
  const fn = mockApi({
    'GET /tenants': () => json({ store: 'OK', tenants }),
    'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /packages?tenantId=source%20%2F2': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=source%20%2F2': () => json(ARTIFACTS),
    'POST /transport': init => json({ ...result, dryRun: JSON.parse(init?.body as string).dryRun }),
  });
  render(<App />);
  return fn;
}
const group = (name: string) => within(screen.getByRole('radiogroup', { name }));
const pickPackage = async () => {
  await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
  await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
};

it('REQ-308 AC-5·AC-7: 기본 DEV와 PRD, fieldset legend와 정확한 테넌트 이름, 실행 위 카드', async () => {
  setup();
  await screen.findByLabelText('패키지 검색');
  for (const [name, selected] of [['원본 테넌트', 'DEV'], ['대상 테넌트', 'PRD']] as const) {
    const fieldset = screen.getByRole('radiogroup', { name });
    expect(fieldset.tagName).toBe('FIELDSET');
    expect(fieldset.querySelector('legend')).toHaveTextContent(name);
    expect(group(name).getByRole('radio', { name: selected })).toBeChecked();
    for (const tenant of [...TENANTS_OK.tenants, extra]) {
      const radio = group(name).getByRole('radio', { name: tenant.name });
      expect(radio).toHaveAccessibleName(tenant.name);
      expect(radio).toHaveAccessibleDescription(tenant.apiHost);
      expect(radio).toHaveAttribute('value', tenant.id);
    }
  }
  expect(group('원본 테넌트').getByRole('radio', { name: 'DEV' }).getAttribute('name'))
    .not.toBe(group('대상 테넌트').getByRole('radio', { name: 'DEV' }).getAttribute('name'));
  expect(document.querySelector('select')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  const heading = screen.getByRole('heading', { level: 3, name: '테넌트' });
  const card = heading.closest('div.rounded-lg')!;
  expect(card.nextElementSibling).toContainElement(screen.getByRole('heading', { name: '실행' }));
});

it('REQ-308 AC-5·AC-7: DEV PRD가 없으면 미선택이고 원본 안내만 보이며 패키지를 조회하지 않는다', async () => {
  const fn = setup([extra]);
  await screen.findByRole('radiogroup', { name: '원본 테넌트' });
  await waitFor(() => expect(group('원본 테넌트').getAllByRole('radio')).toHaveLength(1));
  expect(group('원본 테넌트').getByRole('radio')).not.toBeChecked();
  expect(group('대상 테넌트').getByRole('radio')).not.toBeChecked();
  expect(screen.getAllByText('원본 테넌트를 선택하세요').length).toBeGreaterThan(0);
  expect(screen.queryByLabelText('패키지 검색')).toBeNull();
  expect(screen.queryByRole('list', { name: '패키지 목록' })).toBeNull();
  expect(fn.mock.calls.some(([url]) => String(url).startsWith('/packages'))).toBe(false);
});

it('REQ-308 AC-5·AC-7: 원본 변경은 패키지 아티팩트 결과 마지막 요청을 비우고 새 원본으로 재조회한다', async () => {
  const fn = setup();
  await pickPackage();
  await userEvent.click(screen.getByRole('checkbox', { name: /IF_Order_Sync/ }));
  await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
  await screen.findByRole('region', { name: '이관 결과' });
  await userEvent.click(group('원본 테넌트').getByRole('radio', { name: 'EXTRA' }));
  await screen.findByLabelText('패키지 검색');
  expect(screen.queryByRole('region', { name: '이관 결과' })).toBeNull();
  expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: '드라이런 실행' })).toBeDisabled();
  expect(within(screen.getByRole('list', { name: '패키지 목록' })).getAllByRole('radio').every(r => !(r as HTMLInputElement).checked)).toBe(true);
  expect(fn.mock.calls.map(([url]) => url)).toContain('/packages?tenantId=source%20%2F2');
  await pickPackage();
  expect(screen.getByText('0개 선택 / 전체 2개')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
  await screen.findByRole('region', { name: '이관 결과' });
  await userEvent.click(screen.getByRole('button', { name: '이 구성으로 실제 이관' }));
  expect(within(screen.getByRole('dialog')).getByText('아티팩트 수').nextElementSibling).toHaveTextContent('전체');
  await userEvent.click(screen.getByRole('button', { name: '실행' }));
  await waitFor(() => expect(fn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3));
  const posts = fn.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init?.body as string));
  expect(posts[1]).toEqual({ packageId: 'PkgTransportDemo', dryRun: true, deploy: false, sourceTenantId: extra.id, targetTenantId: 'PRD' });
  expect(posts[2]).toEqual({ ...posts[1], dryRun: false });
  expect(fn.mock.calls.map(([url]) => url)).toContain('/packages/PkgTransportDemo/artifacts?tenantId=source%20%2F2');
});

it.each([null, 'DEV'])('REQ-308 AC-5·AC-7: 대상 %s는 두 실행을 막고 재실행 요청에도 확인창을 열지 않는다', async targetTenantId => {
  const value = { targetTenantId };
  const view = render(<TestTenantProvider value={value}><RunPanel packageId="P" artifactIds={[]} onResult={() => {}} /></TestTenantProvider>);
  const reason = targetTenantId ? '원본과 대상이 같습니다' : '대상 테넌트를 선택하세요';
  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '드라이런 실행' })).toBeDisabled();
  await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
  expect(screen.getByRole('button', { name: (targetTenantId ?? 'PRD') + '로 이관' })).toBeDisabled();
  view.rerender(<TestTenantProvider value={value}><RunPanel packageId="P" artifactIds={[]} onResult={() => {}} realRequest={1} /></TestTenantProvider>);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('REQ-308 AC-5·AC-7: 대상이 원본과 같아지면 기존 결과의 실제 이관 열기도 막는다', async () => {
  setup();
  await pickPackage();
  await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
  await screen.findByRole('region', { name: '이관 결과' });
  await userEvent.click(group('대상 테넌트').getByRole('radio', { name: 'DEV' }));
  await userEvent.click(screen.getByRole('button', { name: '이 구성으로 실제 이관' }));
  expect(screen.getByText('원본과 대상이 같습니다')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('REQ-308 AC-5·AC-7: 테넌트 0개는 안내 버튼으로 테넌트 탭을 연다', async () => {
  setup([]);
  expect(await screen.findByText('등록된 테넌트가 없습니다')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '테넌트 탭으로 이동' }));
  expect(screen.getByRole('tab', { name: '테넌트' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { level: 2, name: '테넌트' })).toBeInTheDocument();
});

it('REQ-308 AC-5·AC-7: 테넌트 라디오는 Tab과 화살표로 조작하며 도달 요소는 활성 BUTTON INPUT이다', async () => {
  setup();
  await screen.findByLabelText('패키지 검색');
  const source = group('원본 테넌트').getByRole('radio', { name: 'DEV' });
  const target = group('대상 테넌트').getByRole('radio', { name: 'PRD' });
  (document.activeElement as HTMLElement)?.blur();
  const seen: HTMLElement[] = [];
  for (let i = 0; i < 30; i++) {
    await userEvent.tab();
    const el = document.activeElement as HTMLElement;
    if (el === document.body || seen.includes(el)) break;
    seen.push(el);
    expect(['BUTTON', 'INPUT']).toContain(el.tagName);
    expect(el).toBeEnabled();
  }
  expect(seen).toContain(source);
  expect(seen).toContain(target);
  source.focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(group('원본 테넌트').getByRole('radio', { name: 'PRD' })).toBeChecked();
});

it('REQ-308 AC-5·AC-7: 원본 변경 후 이전 원본의 늦은 실행 결과를 다시 표시하지 않는다', async () => {
  let release!: (response: Response) => void;
  mockApi({ 'GET /tenants': () => json({ ...TENANTS_OK, tenants: [...TENANTS_OK.tenants, extra] }),
    'GET /tenants/status': () => json(TENANT_STATUS_OK), 'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /packages?tenantId=source%20%2F2': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
    'POST /transport': () => new Promise<Response>(resolve => { release = resolve; }) });
  render(<App />);
  await pickPackage();
  await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
  await userEvent.click(group('원본 테넌트').getByRole('radio', { name: 'EXTRA' }));
  await act(async () => release(json(result)));
  expect(screen.queryByRole('region', { name: '이관 결과' })).toBeNull();
});

it('REQ-308 AC-5·AC-7: 목록 API는 선택 id를 인코딩하고 인자가 없으면 기존 경로를 지킨다', async () => {
  const fn = mockApi({ 'GET /packages': () => json([]), 'GET /packages/P%2F1/artifacts': () => json([]),
    'GET /packages?tenantId=A%20%2F%3F': () => json([]), 'GET /packages/P%2F1/artifacts?tenantId=A%20%2F%3F': () => json([]) });
  await getPackages(); await getArtifacts('P/1'); await getPackages('A /?'); await getArtifacts('P/1', 'A /?');
  expect(fn.mock.calls.map(([url]) => url)).toEqual(['/packages', '/packages/P%2F1/artifacts', '/packages?tenantId=A%20%2F%3F', '/packages/P%2F1/artifacts?tenantId=A%20%2F%3F']);
});
