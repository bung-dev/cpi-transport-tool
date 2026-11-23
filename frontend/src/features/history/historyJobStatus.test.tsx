import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import { json, mockApi, packagesOf } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';

// 20261120-async-transport S3 REQ-806: 이력 줄의 작업 상태(jobStatus). 취소됨·중단됨이면 결과 칸에 표시를 더한다.
// 완료(COMPLETED)와 필드 없는 예전 줄·동기 이관 줄은 지금과 같다.
afterEach(() => vi.unstubAllGlobals());

const entry = (id: string, jobStatus?: string) => ({
  transportId: id,
  packages: packagesOf('PkgTransportDemo'),
  dryRun: false,
  deploy: false,
  startedAt: '2026-11-20T01:00:00Z',
  finishedAt: '2026-11-20T01:00:01Z',
  summary: { total: 1, succeeded: 1, failed: 0 },
  results: [{ artifactId: 'IF_A', status: 'SUCCESS', action: 'UPDATED', deployStatus: 'NOT_REQUESTED', error: null, configurations: [] }],
  ...(jobStatus ? { jobStatus } : {}),
}) as unknown as TransportResponse;

describe('이력의 작업 상태 (REQ-806)', () => {
  it('REQ-806: 결과 칸에 취소됨·중단됨 표시가 붙고, 완료와 예전 줄에는 붙지 않는다', async () => {
    mockApi(baseRoutes({
      'GET /transport/history': () => json([entry('t-cancel', 'CANCELLED'), entry('t-int', 'INTERRUPTED'),
        entry('t-done', 'COMPLETED'), entry('t-old')]),
    }));
    renderAt('#/history');
    await screen.findByRole('table');
    const header = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const resultCell = (id: string) => {
      const row = screen.getAllByRole('row').find((r) => within(r).queryByRole('button', { name: id }));
      return within(row!).getAllByRole('cell')[header.indexOf('결과')];
    };
    expect(resultCell('t-cancel')).toHaveTextContent('취소됨');
    expect(resultCell('t-cancel')).toHaveTextContent('성공 1 / 전체 1');
    expect(resultCell('t-int')).toHaveTextContent('중단됨');
    for (const id of ['t-done', 't-old']) {
      expect(resultCell(id)).not.toHaveTextContent('취소됨');
      expect(resultCell(id)).not.toHaveTextContent('중단됨');
      expect(resultCell(id)).toHaveTextContent('성공 1 / 전체 1');
    }
  });
});
