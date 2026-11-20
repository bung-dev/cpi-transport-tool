import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';

// 20261120-async-transport 리뷰 1차 뒤 화면 다듬기(사람 결정 2026-11-20), E2E 캡처에서 본 것:
// 1) 진행 막대: 브라우저 기본 <progress>는 바탕이 짙은 회색이라 0일 때도 꽉 찬 막대처럼 보였다.
//    role=progressbar 요소(aria-valuenow·aria-valuemax·aria-valuemin=0) 안에 채움 요소 하나를 두고, 채움 너비는 인라인 style width "n/N %"다.
// 2) 결과가 0건(취소·중단으로 끝난 iFlow 없음)이면 결과 화면의 "결과 바로가기" 상자를 그리지 않는다(빈 테두리 상자가 남았다).
afterEach(() => vi.unstubAllGlobals());

const JOB = 'job-r1';
const base = {
  jobId: JOB, dryRun: false, deploy: false, startedAt: '2026-11-20T01:00:00Z',
  sourceTenant: { id: 'DEV', name: '개발' }, targetTenant: { id: 'PRD', name: '운영' },
  packages: [{ packageId: 'PkgTransportDemo', packageName: null, targetPackage: 'EXISTING' }],
};

describe('작업 화면 다듬기', () => {
  it.each([[0, 4, '0%'], [1, 4, '25%'], [4, 4, '100%']])('진행 막대는 %i/%i에서 채움 너비가 %s이고 aria 값이 맞다', async (done, total, width) => {
    mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: () => json({ ...base, status: 'RUNNING', finishedAt: null, total, done, result: null,
        items: Array.from({ length: total }, (_, i) => ({ packageId: 'PkgTransportDemo', artifactId: `IF_${i}`, stage: i < done ? 'DONE' : 'WAITING', status: i < done ? 'SUCCESS' : null })) }),
    }));
    renderAt(`#/job?id=${JOB}`);
    const bar = await screen.findByRole('progressbar', { name: '실제 이관 진행률' });
    expect(bar.tagName).not.toBe('PROGRESS');
    expect(bar).toHaveAttribute('aria-valuenow', String(done));
    expect(bar).toHaveAttribute('aria-valuemax', String(total));
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe(width);
  });

  it('결과가 0건으로 끝난 작업은 "결과 바로가기" 상자를 그리지 않는다', async () => {
    const result = respondTo({ packages: [{ packageId: 'PkgTransportDemo' }], dryRun: false },
      { transportId: 't-empty', jobStatus: 'CANCELLED', summary: { total: 0, succeeded: 0, failed: 0 }, results: [] });
    mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: () => json({ ...base, status: 'CANCELLED', finishedAt: '2026-11-20T01:00:02Z', total: 2, done: 2, result,
        items: [{ packageId: 'PkgTransportDemo', artifactId: 'IF_A', stage: 'SKIPPED', status: null },
          { packageId: 'PkgTransportDemo', artifactId: 'IF_B', stage: 'SKIPPED', status: null }] }),
    }));
    renderAt(`#/job?id=${JOB}`);
    const region = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(region).getByText('t-empty')).toBeInTheDocument();
    expect(within(region).queryByRole('navigation', { name: '결과 바로가기' })).toBeNull();
  });
});
