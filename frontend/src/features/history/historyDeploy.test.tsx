import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, DeployStatus, TransportResponse } from '../../api/types';
import { json, mockApi } from '../../test/mockFetch';
import { HistoryTab } from './HistoryTab';

afterEach(() => vi.unstubAllGlobals());

function entry(id: string, statuses: DeployStatus[], overrides: Partial<TransportResponse> = {}): TransportResponse {
  const results: ArtifactResult[] = statuses.map((deployStatus, i) => ({
    artifactId: `IF_History_${i}`, status: deployStatus === 'ERROR' || deployStatus === 'TIMEOUT' ? 'FAILED' : 'SUCCESS',
    action: 'UPDATED', deployStatus, replacements: [], unmappedKeys: [],
    error: deployStatus === 'ERROR' ? { code: 'DEPLOY_FAILED', message: 'DEPLOY: CPI deployment ERROR',
      detail: '첫 줄\n둘째 줄 <img src=x>', detailHttpStatus: 200 } : null,
  }));
  return {
    transportId: id, packageId: 'PkgFaultDemo', dryRun: false, deploy: true,
    startedAt: '2026-10-14T00:00:00Z', finishedAt: '2026-10-14T00:01:00Z',
    summary: { total: results.length, succeeded: results.filter((r) => r.status === 'SUCCESS').length,
      failed: results.filter((r) => r.status === 'FAILED').length },
    results, ...overrides,
  };
}

async function showHistory(entries: TransportResponse[]) {
  mockApi({ 'GET /transport/history': () => json(entries) });
  render(<HistoryTab />);
  await screen.findByRole('table');
}

function cell(id: string, column: string) {
  const columnIndex = screen.getAllByRole('columnheader').findIndex((heading) => heading.textContent === column);
  const row = screen.getByRole('button', { name: id }).closest('tr')!;
  return within(row).getAllByRole('cell')[columnIndex];
}

describe('이력 배포 결과', () => {
  it('REQ-309 AC-9·AC-10: 배포 열에 성공·실패 합계를 표시하고 결과 열 실패와 구분한다', async () => {
    await showHistory([
      entry('success', ['STARTED', 'STARTED', 'NOT_REQUESTED']),
      entry('failure', ['ERROR', 'STARTED']),
      entry('timeout', ['TIMEOUT']),
      entry('mixed', ['ERROR', 'TIMEOUT', 'STARTED']),
    ]);
    const success = cell('success', '배포');
    expect(within(success).getByText('배포')).toHaveClass('bg-info-bg');
    expect(within(success).getByText('성공')).toHaveClass('bg-success-bg', 'text-success-fg');
    for (const [id, label] of [['failure', '실패 1'], ['timeout', '실패 1'], ['mixed', '실패 2']]) {
      const deployCell = cell(id, '배포');
      expect(within(deployCell).getByText('배포')).toHaveClass('bg-info-bg');
      const badge = within(deployCell).getByText(label);
      expect(badge).toHaveClass('bg-danger-bg', 'text-danger-fg');
      const transportBadge = within(cell(id, '결과')).getByText(label);
      expect(transportBadge).not.toBe(badge);
    }
  });

  it.each([
    { id: 'empty', statuses: [], overrides: {}, requested: true },
    { id: 'before-deploy', statuses: ['NOT_REQUESTED'], overrides: {}, requested: true },
    { id: 'skipped', statuses: ['SKIPPED_DRY_RUN'], overrides: {}, requested: true },
    { id: 'dry-run', statuses: ['ERROR'], overrides: { dryRun: true }, requested: true },
    { id: 'deploy-off', statuses: ['ERROR'], overrides: { deploy: false }, requested: false },
    { id: 'dry-off', statuses: ['STARTED'], overrides: { dryRun: true, deploy: false }, requested: false },
  ] as { id: string; statuses: DeployStatus[]; overrides: Partial<TransportResponse>; requested: boolean }[])(
    'REQ-309 AC-9·AC-10: $id 항목은 배포 결과를 더하지 않는다',
    async ({ id, statuses, overrides, requested }) => {
      await showHistory([entry(id, statuses, overrides)]);
      const deployCell = cell(id, '배포');
      expect(deployCell.textContent).toBe(requested ? '배포' : '배포 안 함');
      expect(within(deployCell).queryByText(/^(성공|실패 \d+)$/)).toBeNull();
    },
  );

  it('REQ-309 AC-7·AC-8·AC-9·AC-10: 행 클릭 상세에 같은 배포 요약과 오류 상세를 보인다', async () => {
    const fetch = mockApi({ 'GET /transport/history': () => json([entry('history-detail', ['ERROR', 'TIMEOUT', 'STARTED', 'NOT_REQUESTED'])]) });
    const { container } = render(<HistoryTab />);
    await screen.findByRole('table');
    await userEvent.click(cell('history-detail', '패키지'));
    const region = screen.getByRole('region', { name: '이관 결과' });
    expect(within(region).getByText('배포 실패 1개 · 시간 초과 1개 · 배포 성공 1개 · 배포 안 됨 1개')).toHaveClass('text-danger-fg');
    expect(within(region).getByRole('heading', { level: 5, name: '배포 오류 상세' }).nextElementSibling?.textContent).toBe('첫 줄\n둘째 줄 <img src=x>');
    expect(container.querySelector('img')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('REQ-309 AC-8·AC-9·AC-10: 성공한 이력 상세에도 배포 성공 요약을 보인다', async () => {
    await showHistory([entry('success-detail', ['STARTED'])]);
    await userEvent.click(screen.getByRole('button', { name: 'success-detail' }));
    expect(screen.getByText('배포 성공 1개')).toHaveClass('text-success-fg');
    expect(screen.queryByRole('heading', { name: '배포 오류 상세' })).toBeNull();
  });
});
