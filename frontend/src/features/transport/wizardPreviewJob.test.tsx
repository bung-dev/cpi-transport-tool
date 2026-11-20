import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import { currentStep, stepButton, toArtifacts } from '../../test/wizard';

// 20261120-async-transport S3 REQ-807: 미리보기를 이관 작업으로 실행하고 마법사 안에서 진행을 보인다.
// 화면 계약(이 테스트가 정함):
// - 진행 중: region "미리보기 진행" 안에 글자 "미리보기 중 n/N", progressbar "미리보기 진행률"(aria-valuenow=n, aria-valuemax=N),
//   list "iFlow 진행"(iFlow마다 listitem: 아티팩트 이름(모르면 ID)과 단계 글자), 버튼 "취소". "미리보기 실행"은 비활성.
// - 단계 글자: WAITING 대기, DOWNLOAD 내려받기, CONFIGURATION_READ 구성 값 읽기, TARGET 대상 확인, UPLOAD 업로드, DEPLOY 배포,
//   DONE은 결과에 따라 완료/실패, SKIPPED 건너뜀.
// - 시작 직후 바로 한 번 조회하고, 진행 중이면 1초마다 다시 조회한다.
afterEach(() => vi.unstubAllGlobals());

const JOB = 'job-p1';
const body = { packages: [{ packageId: 'PkgTransportDemo' }], dryRun: true };
const item = (artifactId: string, stage: string, status: string | null = null) => ({ packageId: 'PkgTransportDemo', artifactId, stage, status });
const running = (done: number, items: unknown[]) => ({
  jobId: JOB, status: 'RUNNING', dryRun: true, deploy: false, startedAt: '2026-11-20T01:00:00Z', finishedAt: null,
  total: 2, done, sourceTenant: { id: 'DEV', name: 'DEV' }, targetTenant: { id: 'PRD', name: 'PRD' },
  packages: [{ packageId: 'PkgTransportDemo', packageName: null, targetPackage: 'NOT_CHECKED' }], items, result: null,
});
const finished = (status: string, items: unknown[], over: Record<string, unknown> = {}) => ({
  ...running(2, items), status, finishedAt: '2026-11-20T01:00:05Z',
  result: { ...respondTo(body, { transportId: 't-job', jobStatus: status }), ...over },
});

/** 조회할 때마다 다음 응답을 돌려주고, 마지막 응답은 계속 돌려준다. */
function sequence(...responses: (() => Response)[]) {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)]();
}

type Routes = Parameters<typeof mockApi>[0];
function setup(extra: Routes) {
  const fn = mockApi(baseRoutes({
    'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
    'POST /transport/jobs': () => json({ jobId: JOB, status: 'RUNNING', dryRun: true, total: 2 }, 202),
    ...extra,
  }));
  renderAt('#/transport');
  return fn;
}
async function runPreview() {
  await toArtifacts();
  await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
}
const progress = () => screen.findByRole('region', { name: '미리보기 진행' }, { timeout: 3000 });

describe('REQ-807 미리보기 진행 표시', () => {
  it('REQ-807: 실행하면 작업 API로 시작하고 n/N·진행 막대·iFlow별 단계가 보이며, 끝나면 같은 자리에 미리보기 결과가 나온다', async () => {
    const fn = setup({
      [`GET /transport/jobs/${JOB}`]: sequence(
        () => json(running(0, [item('IF_Order_Sync', 'DOWNLOAD'), item('IF_Customer_Push', 'WAITING')])),
        () => json(running(1, [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'CONFIGURATION_READ')])),
        () => json(finished('COMPLETED', [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'DONE', 'FAILED')])),
      ),
    });
    await runPreview();
    const region = await progress();
    expect(within(region).getByText('미리보기 중 0/2')).toBeInTheDocument();
    const bar = within(region).getByRole('progressbar', { name: '미리보기 진행률' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    const rows = within(within(region).getByRole('list', { name: 'iFlow 진행' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Order Sync');
    expect(rows[0]).toHaveTextContent('내려받기');
    expect(rows[1]).toHaveTextContent('Customer Push');
    expect(rows[1]).toHaveTextContent('대기');
    expect(within(region).getByRole('button', { name: '취소' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();

    await waitFor(() => expect(within(region).getByText('미리보기 중 1/2')).toBeInTheDocument(), { timeout: 3000 });
    const later = within(within(region).getByRole('list', { name: 'iFlow 진행' })).getAllByRole('listitem');
    expect(later[0]).toHaveTextContent('완료');
    expect(later[1]).toHaveTextContent('구성 값 읽기');

    const result = await screen.findByRole('region', { name: '이관 결과' }, { timeout: 3000 });
    expect(within(result).getByText('t-job')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '미리보기 진행' })).toBeNull();
    expect(currentStep()).toBe('미리보기');

    const start = fn.mock.calls.filter(([url, init]) => url === '/transport/jobs' && init?.method === 'POST');
    expect(start).toHaveLength(1);
    const sent = JSON.parse(start[0][1]?.body as string);
    expect(sent).toMatchObject({ dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
    expect(sent.packages[0].packageId).toBe('PkgTransportDemo');
    expect(fn.mock.calls.some(([url, init]) => url === '/transport' && init?.method === 'POST')).toBe(false);
  });

  it('REQ-807: 진행 중 취소를 누르면 취소 요청을 보내고, 취소되면 안내와 다시 실행할 수 있는 실행 버튼이 보이며 실제 이관 단계로 갈 수 없다', async () => {
    let cancelled = false;
    const fn = setup({
      [`GET /transport/jobs/${JOB}`]: () => json(cancelled
        ? finished('CANCELLED', [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'SKIPPED')])
        : running(0, [item('IF_Order_Sync', 'DOWNLOAD'), item('IF_Customer_Push', 'WAITING')])),
      [`POST /transport/jobs/${JOB}/cancel`]: () => { cancelled = true; return new Response(null, { status: 202 }); },
    });
    await runPreview();
    const region = await progress();
    await userEvent.click(within(region).getByRole('button', { name: '취소' }));
    expect(fn.mock.calls.some(([url, init]) => url === `/transport/jobs/${JOB}/cancel` && init?.method === 'POST')).toBe(true);
    expect(await screen.findByText('미리보기를 취소했습니다', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: '이관 결과' })).toBeNull();
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
    expect(stepButton('실제 이관')).toBeDisabled();
  });

  it('REQ-807 실패: 진행 조회가 연속 3번 실패하면 안내와 다시 시도 버튼이 보이고, 다시 시도하면 조회를 이어 결과가 나온다', async () => {
    let healthy = false;
    const fn = setup({
      [`GET /transport/jobs/${JOB}`]: () => healthy
        ? json(finished('COMPLETED', [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'DONE', 'SUCCESS')]))
        : json({ error: 'CPI_UNAVAILABLE', message: 'x' }, 502),
    });
    await runPreview();
    expect(await screen.findByText('진행 상황을 불러오지 못했습니다', undefined, { timeout: 5000 })).toBeInTheDocument();
    const polls = () => fn.mock.calls.filter(([url]) => url === `/transport/jobs/${JOB}`).length;
    expect(polls()).toBe(3);
    // 안내가 보이는 동안 조회를 멈춘다.
    await new Promise((r) => setTimeout(r, 1300));
    expect(polls()).toBe(3);
    healthy = true;
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('region', { name: '이관 결과' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('진행 상황을 불러오지 못했습니다')).toBeNull();
  }, 15000);

  it('REQ-807 실패: 시작 요청이 오류면 지금과 같은 오류 안내가 나오고 진행 표시는 나오지 않는다', async () => {
    setup({
      'POST /transport/jobs': () => json({ error: 'PACKAGE_NOT_FOUND', message: 'Package not found' }, 404),
    });
    await runPreview();
    expect(await screen.findByText(/패키지를 찾을 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '미리보기 진행' })).toBeNull();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
  });
});
