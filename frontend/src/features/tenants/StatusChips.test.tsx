import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../App';
import type { TenantCheck, TransportResponse } from '../../api/types';
import { json, mockApi } from '../../test/mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { TestTenantProvider } from '../../test/tenantProvider';
import { RunPanel } from '../transport/RunPanel';
import { TransportResult } from '../result/TransportResult';
import { StatusChips } from './StatusChips';
import { TenantProvider } from './TenantContext';

afterEach(() => vi.unstubAllGlobals());
const RESULT: TransportResponse = { transportId: 't-chip', packageId: 'P', dryRun: true, deploy: false,
  startedAt: '', finishedAt: '', summary: { total: 0, succeeded: 0, failed: 0 }, results: [] };

it('REQ-303 AC-4·AC-5: 응답 전 확인 중이며 두 네이티브 버튼은 활성과 aria-busy를 유지한다', () => {
  render(<TestTenantProvider value={{ status: { state: 'loading' }, readOnly: undefined }}><StatusChips /></TestTenantProvider>);
  expect(screen.getAllByText('확인 중')).toHaveLength(2);
  for (const button of screen.getAllByRole('button')) {
    expect(button.tagName).toBe('BUTTON'); expect(button).toBeEnabled(); expect(button).toHaveAttribute('aria-busy', 'true');
  }
});
it.each<[TenantCheck, string, string]>([
  ['OK', '연결됨', 'success'], ['TOKEN_FAILED', '인증 실패', 'danger'], ['API_FORBIDDEN', '권한 없음', 'danger'],
  ['UNREACHABLE', '연결 안 됨', 'danger'], ['ERROR', '오류', 'danger'],
])('REQ-303 AC-4·AC-5: %s의 글자 %s와 %s tone을 선택한 원본·대상에 보인다', (check, label, tone) => {
  render(<TestTenantProvider value={{ status: { state: 'success', data: { ...TENANT_STATUS_OK,
    tenants: TENANT_STATUS_OK.tenants.map(t => ({ ...t, check })) } } }}><StatusChips /></TestTenantProvider>);
  expect(screen.getByRole('button', { name: '원본 DEV ' + label })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '대상 PRD ' + label })).toBeInTheDocument();
  for (const badge of screen.getAllByText(label)) expect(badge).toHaveClass('bg-' + tone + '-bg', 'text-' + tone + '-fg');
});
it('REQ-303 AC-4·AC-5: 선택 없음은 역할별 선택 안 됨과 neutral 톤이다', () => {
  render(<TestTenantProvider value={{ sourceTenantId: null, targetTenantId: null }}><StatusChips /></TestTenantProvider>);
  for (const label of ['원본 선택 안 됨', '대상 선택 안 됨']) {
    const button = screen.getByRole('button', { name: label });
    expect(within(button).getByText(label).parentElement).toHaveClass('bg-neutral-bg');
  }
});
it('REQ-303 AC-4·AC-5: 실제 선택한 등록 테넌트의 이름과 상태를 사용한다', () => {
  const registered = { ...TENANTS_OK.tenants[1], id: 'registered-1', name: '운영 대상', source: 'registered' as const };
  render(<TestTenantProvider value={{ targetTenantId: registered.id,
    tenants: { state: 'success', data: { ...TENANTS_OK, tenants: [...TENANTS_OK.tenants, registered] } },
    status: { state: 'success', data: { ...TENANT_STATUS_OK, tenants: [...TENANT_STATUS_OK.tenants, { ...registered, check: 'API_FORBIDDEN' }] } },
  }}><StatusChips /></TestTenantProvider>);
  expect(screen.getByRole('button', { name: '대상 운영 대상 권한 없음' })).toBeInTheDocument();
});
it.each(['true', 'false', 'unknown'])('REQ-303 AC-4·AC-5: 읽기 전용 표시 %s는 true일 때만 포커스 없는 칩이다', value => {
  render(<TestTenantProvider value={{ readOnly: value === 'unknown' ? undefined : value === 'true' }}><StatusChips /></TestTenantProvider>);
  const badge = screen.queryByText('읽기 전용');
  if (value === 'true') { expect(badge).toBeInTheDocument(); expect(badge).not.toHaveAttribute('tabindex'); expect(badge?.tagName).toBe('SPAN'); }
  else expect(badge).toBeNull();
});
it.each(['network', '500', 'non-json'])('REQ-303 AC-4·AC-5 / REQ-302 AC-5: 상태 요청 %s 실패는 danger 확인 실패와 두 컨트롤 비활성·안내로 이어진다', async failure => {
  mockApi({ 'GET /tenants': () => json(TENANTS_OK), 'GET /tenants/status': () => {
    if (failure === 'network') return Promise.reject(new Error('test-dummy-offline'));
    return failure === '500' ? json({}, 500) : new Response('test-dummy-invalid-json', { status: 200 });
  } });
  render(<TenantProvider openTenantsTab={() => {}}><StatusChips /><RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />
    <TransportResult result={RESULT} onOpenReal={() => {}} /></TenantProvider>);
  await screen.findByRole('button', { name: '원본 DEV 확인 실패' });
  for (const badge of screen.getAllByText('확인 실패')) expect(badge).toHaveClass('bg-danger-bg', 'text-danger-fg');
  expect(screen.getByRole('radio', { name: '실제 이관' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '이 구성으로 실제 이관' })).toBeDisabled();
  const message = '읽기 전용 여부를 확인하지 못했습니다. 상태 칩을 눌러 다시 확인하세요';
  expect(screen.getAllByText(message)).toHaveLength(2);
  expect(screen.getByRole('radio', { name: '실제 이관' })).toHaveAccessibleDescription(expect.stringContaining(message));
  expect(screen.getByRole('button', { name: '이 구성으로 실제 이관' })).toHaveAccessibleDescription(message);
});
it.each(['click', 'Enter'])('REQ-303 AC-4·AC-5: %s 재확인은 refresh=true 한 번, 진행 중 다른 칩 입력도 중복되지 않는다', async input => {
  let release!: (r: Response) => void;
  const fn = mockApi({ 'GET /tenants': () => json(TENANTS_OK), 'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /tenants/status?refresh=true': () => new Promise<Response>(r => { release = r; }) });
  render(<TenantProvider openTenantsTab={() => {}}><StatusChips /></TenantProvider>);
  const source = await screen.findByRole('button', { name: '원본 DEV 연결됨' });
  if (input === 'click') await userEvent.click(source); else { source.focus(); await userEvent.keyboard('{Enter}'); }
  const target = screen.getByRole('button', { name: '대상 PRD 확인 중' });
  expect(target).toBeEnabled(); expect(target).toHaveAttribute('aria-busy', 'true');
  await userEvent.click(target); source.focus(); await userEvent.keyboard('{Enter}');
  expect(fn.mock.calls.filter(([url]) => url === '/tenants/status?refresh=true')).toHaveLength(1);
  await act(async () => release(json(TENANT_STATUS_OK)));
  expect(screen.getByRole('button', { name: '대상 PRD 연결됨' })).toHaveAttribute('aria-busy', 'false');
});
it('REQ-303 AC-4·AC-5: 최초 상태 요청 중 칩 클릭과 Enter는 새 요청을 보내지 않는다', async () => {
  let release!: (r: Response) => void;
  const fn = mockApi({ 'GET /tenants': () => json(TENANTS_OK),
    'GET /tenants/status': () => new Promise<Response>(r => { release = r; }) });
  render(<TenantProvider openTenantsTab={() => {}}><StatusChips /></TenantProvider>);
  const source = await screen.findByRole('button', { name: '원본 DEV 확인 중' });
  await userEvent.click(source); await userEvent.keyboard('{Enter}');
  expect(fn).toHaveBeenCalledTimes(2);
  await act(async () => release(json(TENANT_STATUS_OK)));
});
it('REQ-303 AC-4·AC-5 / REQ-307 AC-6: App 상단 banner 안에 연결됨 칩 둘과 접근 가능한 제품명이 있다', async () => {
  mockApi({ 'GET /tenants': () => json(TENANTS_OK), 'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /packages?tenantId=DEV': () => json([]) });
  render(<App />);
  const banner = screen.getByRole('banner');
  await within(banner).findByRole('button', { name: '대상 PRD 연결됨' });
  expect(within(banner).getAllByText('연결됨')).toHaveLength(2);
  expect(within(banner).getByRole('heading', { name: 'CPI Transport Tool' })).toBeInTheDocument();
  expect(banner).toHaveClass('h-14');
  await waitFor(() => expect(screen.getByRole('radio', { name: '실제 이관' })).toBeEnabled());
});
