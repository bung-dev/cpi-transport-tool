import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import { json, mockApi } from '../../test/mockFetch';
import { TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { TestTenantProvider } from '../../test/tenantProvider';
import { TransportResult } from '../result/TransportResult';
import { type TenantContextValue } from '../tenants/TenantContext';
import { RunModeSelect } from './RunModeSelect';
import { RunPanel } from './RunPanel';

afterEach(() => vi.unstubAllGlobals());
const RESULT: TransportResponse = { transportId: 't-read-only', packageId: 'P', dryRun: true, deploy: false,
  startedAt: '', finishedAt: '', summary: { total: 0, succeeded: 0, failed: 0 }, results: [] };
const READ_ONLY = '읽기 전용 모드입니다. 실제 이관은 꺼져 있습니다';
const FAILED = '읽기 전용 여부를 확인하지 못했습니다. 상태 칩을 눌러 다시 확인하세요';
const states: [string, Partial<TenantContextValue>, string | undefined][] = [
  ['켜짐', { readOnly: true, status: { state: 'success', data: { ...TENANT_STATUS_OK, readOnly: true } } }, READ_ONLY],
  ['응답 대기', { readOnly: undefined, status: { state: 'loading' } }, undefined],
  ['요청 실패', { readOnly: undefined, status: { state: 'error', error: { title: 'test-dummy-error' } } }, FAILED],
  ['모름', { readOnly: undefined }, undefined],
];

it.each(states)('REQ-302 AC-5·AC-7: %s에서 두 실제 이관 컨트롤만 비활성, 설명 연결, 드라이런 실행 유지', async (_label, value, notice) => {
  const fn = mockApi({ 'POST /transport': () => json(RESULT) });
  const onResult = vi.fn(), onOpenReal = vi.fn();
  render(<TestTenantProvider value={value}><RunPanel packageId="P" artifactIds={[]} onResult={onResult} />
    <TransportResult result={RESULT} onOpenReal={onOpenReal} /></TestTenantProvider>);
  const real = screen.getByRole('radio', { name: '실제 이관' });
  const fromResult = screen.getByRole('button', { name: '이 구성으로 실제 이관' });
  expect(real).toBeDisabled(); expect(fromResult).toBeDisabled();
  if (notice) {
    expect(real).toHaveAccessibleDescription(expect.stringContaining(notice));
    expect(fromResult).toHaveAccessibleDescription(notice); expect(screen.getAllByText(notice)).toHaveLength(2);
  } else {
    expect(screen.queryByText(READ_ONLY)).toBeNull(); expect(screen.queryByText(FAILED)).toBeNull();
  }
  await userEvent.click(real); await userEvent.click(fromResult);
  expect(onOpenReal).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('radio', { name: '드라이런' })).toBeEnabled();
  expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(RESULT));
  expect(JSON.parse(fn.mock.calls[0][1]?.body as string)).toMatchObject({ dryRun: true, deploy: false });
  expect(fn.mock.calls.every(([url]) => url === '/transport')).toBe(true);
});
it('REQ-302 AC-5·AC-7: provider 없음의 단독 화면은 실제 이관 비활성이고 드라이런 모드를 쓸 수 있으며 테넌트 조회를 하지 않는다', async () => {
  const fn = mockApi({}); const onChange = vi.fn(), onOpenReal = vi.fn();
  render(<><RunModeSelect mode="real" onChange={onChange} /><TransportResult result={RESULT} onOpenReal={onOpenReal} /></>);
  expect(screen.getByRole('radio', { name: '실제 이관' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '이 구성으로 실제 이관' })).toBeDisabled();
  const dryRun = screen.getByRole('radio', { name: '드라이런' });
  expect(dryRun).toBeEnabled(); expect(dryRun).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: '이 구성으로 실제 이관' }));
  expect(onOpenReal).not.toHaveBeenCalled(); expect(fn).not.toHaveBeenCalled();
});
it('REQ-302 AC-5·AC-7: provider 없는 RunPanel은 요청 번호로도 실제 이관으로 바뀌지 않는다', () => {
  const fn = mockApi({});
  const { rerender } = render(<RunPanel packageId="P" artifactIds={[]} realRequest={0} onResult={() => {}} />);
  rerender(<RunPanel packageId="P" artifactIds={[]} realRequest={1} onResult={() => {}} />);
  expect(screen.getByRole('radio', { name: '실제 이관' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(fn).not.toHaveBeenCalled();
});
it.each(states)('REQ-302 AC-5·AC-7: %s에서 실제 이관 요청 번호를 무시하며 나중에 허용돼도 되살리지 않는다', (_label, value) => {
  const fn = mockApi({});
  const view = (n: number, current: Partial<TenantContextValue>) => <TestTenantProvider value={current}>
    <RunPanel packageId="P" artifactIds={[]} realRequest={n} onResult={() => {}} /></TestTenantProvider>;
  const { rerender } = render(view(0, value)); rerender(view(1, value));
  expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked(); expect(screen.queryByRole('dialog')).toBeNull();
  rerender(view(1, { readOnly: false }));
  expect(screen.getByRole('radio', { name: '실제 이관' })).toBeEnabled();
  expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked(); expect(screen.queryByRole('dialog')).toBeNull();
  expect(fn).not.toHaveBeenCalled();
});
it('REQ-302 AC-5·AC-7: false면 두 컨트롤 활성, 결과 버튼 클릭 가능, 실제 이관 대화상자 경로 유지', async () => {
  const fn = mockApi({}); const onOpenReal = vi.fn();
  render(<TestTenantProvider><RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />
    <TransportResult result={RESULT} onOpenReal={onOpenReal} /></TestTenantProvider>);
  expect(screen.getByRole('radio', { name: '실제 이관' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '이 구성으로 실제 이관' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '이 구성으로 실제 이관' })); expect(onOpenReal).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
  await userEvent.click(screen.getByRole('button', { name: 'PRD로 이관' }));
  expect(screen.getByRole('dialog', { name: '실제 이관 확인' })).toBeInTheDocument(); expect(fn).not.toHaveBeenCalled();
});
it('REQ-302 AC-5·AC-7: 재확인 대기부터 열린 확인창과 배포 선택을 닫고 드라이런으로 유지한다', async () => {
  const fn = mockApi({ 'POST /transport': () => json(RESULT) }); const onResult = vi.fn();
  const view = (value: Partial<TenantContextValue>) => <TestTenantProvider value={value}>
    <RunPanel packageId="P" artifactIds={[]} onResult={onResult} /></TestTenantProvider>;
  const { rerender } = render(view({ readOnly: false }));
  await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
  await userEvent.click(screen.getByRole('switch', { name: '배포' }));
  await userEvent.click(screen.getByRole('button', { name: 'PRD로 이관' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  rerender(view({ readOnly: undefined, status: { state: 'loading' } }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('switch', { name: '배포' })).toBeNull();
  expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked();
  rerender(view({ readOnly: false })); expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(RESULT));
  expect(JSON.parse(fn.mock.calls[0][1]?.body as string)).toMatchObject({ dryRun: true, deploy: false });
});
it('REQ-302 AC-6: 409 READ_ONLY_MODE의 지정 제목과 서버 message를 함께 보인다', async () => {
  const message = 'test-dummy-server-read-only-message';
  mockApi({ 'POST /transport': () => json({ error: 'READ_ONLY_MODE', message }, 409) });
  render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
  await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
  await userEvent.click(screen.getByRole('button', { name: 'PRD로 이관' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '실행' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('읽기 전용 모드에서는 실제 이관을 할 수 없습니다'); expect(alert).toHaveTextContent(message);
});
