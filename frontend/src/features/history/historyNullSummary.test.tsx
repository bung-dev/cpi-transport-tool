import { screen, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import { json, mockApi, packagesOf } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';

// 20261120-r1-wording REQ-807: summary가 없는(null) 이력 기록. 이력 저장소는 summary를 채우지 않으므로 서버가 null로 돌려줄 수 있다.
afterEach(() => vi.unstubAllGlobals());

const noSummary = (id: string) => ({
  transportId: id,
  packages: packagesOf('PkgTransportDemo'),
  dryRun: false,
  deploy: false,
  startedAt: '2026-11-20T01:00:00Z',
  finishedAt: '2026-11-20T01:00:01Z',
  summary: null,
  results: [{ artifactId: 'IF_Old', status: 'SUCCESS', action: 'NONE', deployStatus: 'SKIPPED_DRY_RUN', error: null, configurations: [] }],
}) as unknown as TransportResponse;

describe('summary 없는 이력 기록 (REQ-807)', () => {
  it('REQ-807: 이력 표의 결과 칸은 "—"이고 다른 칸과 행은 그대로 보인다', async () => {
    mockApi(baseRoutes({ 'GET /transport/history': () => json([noSummary('t-null')]) }));
    renderAt('#/history');
    await screen.findByRole('table');
    const header = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[header.indexOf('결과')].textContent).toBe('—');
    expect(within(row).getByRole('button', { name: 't-null' })).toBeInTheDocument();
  });

  it('REQ-807: 상세를 열면 통계 타일(전체·성공·실패) 없이 결과 화면이 오류 없이 보인다', async () => {
    mockApi(baseRoutes({ 'GET /transport/history': () => json([noSummary('t-null')]) }));
    renderAt('#/history');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 't-null' }));
    const region = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(region).queryByText('전체')).toBeNull();
    expect(within(region).getByText('t-null')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'IF_Old' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
