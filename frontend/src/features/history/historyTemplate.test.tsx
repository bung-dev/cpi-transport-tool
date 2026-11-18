import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import { json, mockApi, packagesOf } from '../../test/mockFetch';
import { tpl } from '../../test/appRoutes';
import { HistoryTab } from './HistoryTab';

// S3 REQ-425: 이관 이력 표의 템플릿 열과 목록|상세.
afterEach(() => vi.unstubAllGlobals());

const entry = (id: string, over: Partial<TransportResponse> = {}): TransportResponse => ({
  sourceTenant: { id: 'DEV', name: 'DEV' },
  targetTenant: { id: 'PRD', name: 'PRD' },
  transportId: id,
  packages: packagesOf('PkgH'),
  dryRun: true,
  deploy: false,
  startedAt: '2026-11-16T01:00:00Z',
  finishedAt: '2026-11-16T01:00:02Z',
  summary: { total: 1, succeeded: 1, failed: 0 },
  results: [{ artifactId: 'IF_H', status: 'SUCCESS', action: 'NONE', deployStatus: 'SKIPPED_DRY_RUN', error: null, configurations: [] }],
  ...over,
});

const HISTORY = [
  entry('t-live', { template: { id: 'tpl-live', name: '정기 배포' } }),
  entry('t-gone', { template: { id: 'tpl-gone', name: '옛 템플릿' } }),
  entry('t-none'),
];

function templateCell(transportId: string) {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  const row = screen.getByRole('button', { name: transportId }).closest('tr')!;
  return within(row).getAllByRole('cell')[headers.indexOf('템플릿')];
}

describe('이관 이력 템플릿 열 (REQ-425)', () => {
  it('REQ-425: 열은 시작 시각·템플릿·원본·대상·패키지·모드·배포·결과·이관 ID 순서다', async () => {
    mockApi({ 'GET /transport/history': () => json(HISTORY), 'GET /templates': () => json([tpl({ id: 'tpl-live', name: '정기 배포' })]) });
    render(<HistoryTab />);
    await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '시작 시각', '템플릿', '원본', '대상', '패키지', '모드', '배포', '결과', '이관 ID',
    ]);
  });

  it('REQ-425: 템플릿이 없던 실행은 "—", 있는 템플릿은 기록된 이름, 이후 삭제된 템플릿은 "(삭제됨)"을 붙인다', async () => {
    const fn = mockApi({ 'GET /transport/history': () => json(HISTORY), 'GET /templates': () => json([tpl({ id: 'tpl-live', name: '이름 바뀐 정기 배포' })]) });
    render(<HistoryTab />);
    await screen.findByRole('table');
    await waitFor(() => expect(templateCell('t-gone').textContent).toBe('옛 템플릿 (삭제됨)'));
    // 실행 당시 이름을 보인다(지금 템플릿 이름으로 바꾸지 않는다)
    expect(templateCell('t-live').textContent).toBe('정기 배포');
    expect(templateCell('t-none').textContent).toBe('—');
    expect(fn.mock.calls.filter(([url]) => String(url) === '/templates')).toHaveLength(1);
  });

  it('REQ-425: 템플릿 목록 조회에 실패해도 이력 표는 보이고 기록된 이름만 보인다("(삭제됨)" 판단 없음)', async () => {
    mockApi({ 'GET /transport/history': () => json(HISTORY), 'GET /templates': () => json({ code: 'TEMPLATE_STORE_UNREADABLE', message: 'x' }, 500) });
    render(<HistoryTab />);
    await screen.findByRole('table');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(templateCell('t-gone').textContent).toBe('옛 템플릿');
    expect(templateCell('t-none').textContent).toBe('—');
  });

  it('REQ-425: 템플릿 이름은 텍스트로만 보인다', async () => {
    mockApi({ 'GET /transport/history': () => json([entry('t-x', { template: { id: 'tpl-x', name: '<img src=x onerror=1>' } })]), 'GET /templates': () => json([tpl({ id: 'tpl-x', name: 'x' })]) });
    const { container } = render(<HistoryTab />);
    await screen.findByRole('table');
    expect(templateCell('t-x').textContent).toBe('<img src=x onerror=1>');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('이관 이력 상세 (REQ-425)', () => {
  it('REQ-425: 행을 누르면 탐색 목록과 상세 카드가 있는 결과(템플릿 이름 포함)를 보이고 "이 구성으로 실제 이관"은 없다', async () => {
    mockApi({ 'GET /transport/history': () => json(HISTORY), 'GET /templates': () => json([]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-live' }));
    const region = screen.getByRole('region', { name: '이관 결과' });
    expect(within(region).getByRole('navigation', { name: '결과 바로가기' })).toBeInTheDocument();
    expect(within(region).getByText('템플릿 정기 배포')).toBeInTheDocument();
    expect(within(region).getByText('DEV → PRD')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
  });

  it('REQ-425: "목록으로"로 돌아가면 연 행의 이관 ID 버튼에 포커스가 간다', async () => {
    mockApi({ 'GET /transport/history': () => json(HISTORY), 'GET /templates': () => json([]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-gone' }));
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(screen.getByRole('button', { name: 't-gone' })).toHaveFocus();
  });
});
