import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import { artifactRow, toArtifacts } from '../../test/wizard';

// 20261120-async-transport S4: REQ-808 실제 이관 작업 화면·완료 화면, REQ-809 진행 중 표시줄.
// 화면 계약(이 테스트가 정함):
// - 작업 화면 주소 `#/job?id=<jobId>`(주 메뉴 링크 아님). region "실제 이관 작업".
//   진행 중: 제목 "실제 이관 중", 글자 "<원본 이름> → <대상 이름>"(작업의 sourceTenant·targetTenant name), "실제 이관 중 n/N",
//   progressbar "실제 이관 진행률", list "iFlow 진행"(미리보기와 같은 단계 글자), 버튼 "취소".
//   "취소" → dialog "실제 이관 취소"(버튼 "계속 진행"·"취소 요청"), "취소 요청" → POST /transport/jobs/{id}/cancel.
//   끝남: 제목(heading) "실제 이관 완료" / "실제 이관 취소됨" / "실제 이관 중단됨", 글자 "걸린 시간 <n초|m분 n초>",
//   지금 결과 화면(region "이관 결과"), 버튼 "이관 이력에서 보기"(→ `#/history?transportId=<id>`), "새 이관 시작"(→ 빈 마법사 `#/transport`).
//   "이 구성으로 실제 이관"·"실제 이관 실행" 버튼은 없다.
//   없는 작업: 글자 "작업을 찾을 수 없습니다"와 링크 "이관 이력"(href `#/history`). 조회 연속 3번 실패: "진행 상황을 불러오지 못했습니다"와 "다시 시도".
// - 표시줄: 진행 중 실제 이관(GET /transport/jobs/active 200)이 있으면 작업 화면이 아닌 모든 화면 위에 role=status(aria-label "실제 이관 진행 중")
//   안에 글자 "실제 이관 진행 중 n/N"과 링크 "보기"(href `#/job?id=<jobId>`). 2초마다 다시 조회하고 204가 되면 사라진다. 조회 실패면 숨긴다.
//   진행 중이면 마법사의 "실제 이관 실행"·"이 구성으로 실제 이관"이 비활성이고 설명(aria-describedby)에 "다른 실제 이관이 진행 중입니다".
// - 이력 `#/history?transportId=<id>`는 그 이력의 결과 화면을 바로 연다.
afterEach(() => vi.unstubAllGlobals());

const JOB = 'job-r1';
const body = { packages: [{ packageId: 'PkgTransportDemo' }], dryRun: false };
const item = (artifactId: string, stage: string, status: string | null = null) => ({ packageId: 'PkgTransportDemo', artifactId, stage, status });
const running = (done: number, items: unknown[]) => ({
  jobId: JOB, status: 'RUNNING', dryRun: false, deploy: false, startedAt: '2026-11-20T01:00:00Z', finishedAt: null,
  total: 2, done, sourceTenant: { id: 'DEV', name: '개발' }, targetTenant: { id: 'PRD', name: '운영' },
  packages: [{ packageId: 'PkgTransportDemo', packageName: null, targetPackage: 'EXISTING' }], items, result: null,
});
const finished = (status: string, items: unknown[], finishedAt = '2026-11-20T01:01:05Z') => ({
  ...running(2, items), status, finishedAt,
  result: respondTo(body, { transportId: 't-job', jobStatus: status, finishedAt }),
});
const DONE_ITEMS = [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'DONE', 'SUCCESS')];
function sequence(...responses: (() => Response)[]) {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)]();
}
type Routes = Parameters<typeof mockApi>[0];
const jobRegion = () => screen.findByRole('region', { name: '실제 이관 작업' }, { timeout: 3000 });

describe('REQ-808 작업 화면', () => {
  it('REQ-808: 진행 중에는 경로·n/N·진행 막대·iFlow 단계·취소가 보이고, 끝나면 같은 화면이 완료 화면이 된다', async () => {
    mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: sequence(
        () => json(running(1, [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'UPLOAD')])),
        () => json(finished('COMPLETED', DONE_ITEMS)),
      ),
    }));
    renderAt(`#/job?id=${JOB}`);
    const region = await jobRegion();
    expect(within(region).getByRole('heading', { name: '실제 이관 중' })).toBeInTheDocument();
    expect(region).toHaveTextContent('개발 → 운영');
    expect(within(region).getByText('실제 이관 중 1/2')).toBeInTheDocument();
    const bar = within(region).getByRole('progressbar', { name: '실제 이관 진행률' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    const rows = within(within(region).getByRole('list', { name: 'iFlow 진행' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('IF_Order_Sync');
    expect(rows[0]).toHaveTextContent('완료');
    expect(rows[1]).toHaveTextContent('업로드');
    expect(within(region).getByRole('button', { name: '취소' })).toBeEnabled();
    expect(screen.queryByRole('status', { name: /실제 이관 진행 중/ })).toBeNull();

    expect(await screen.findByRole('heading', { name: '실제 이관 완료' }, { timeout: 3000 })).toBeInTheDocument();
    const done = await jobRegion();
    expect(done).toHaveTextContent('걸린 시간 1분 5초');
    const result = within(done).getByRole('region', { name: '이관 결과' });
    expect(within(result).getByText('t-job')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
    expect(screen.queryByRole('button', { name: '실제 이관 실행' })).toBeNull();
    expect(within(done).queryByRole('button', { name: '취소' })).toBeNull();
    expect(within(done).getByRole('button', { name: '이관 이력에서 보기' })).toBeInTheDocument();
    expect(within(done).getByRole('button', { name: '새 이관 시작' })).toBeInTheDocument();
  });

  it.each([['CANCELLED', '실제 이관 취소됨'], ['INTERRUPTED', '실제 이관 중단됨']])('REQ-808: 작업이 %s로 끝났으면 제목이 "%s"이고 건너뛴 iFlow는 "건너뜀"이다', async (status, title) => {
    mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: () => json(finished(status, [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'SKIPPED')], '2026-11-20T01:00:07Z')),
    }));
    renderAt(`#/job?id=${JOB}`);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    const region = await jobRegion();
    expect(region).toHaveTextContent('걸린 시간 7초');
    expect(within(region).getByRole('list', { name: 'iFlow 진행' })).toHaveTextContent('건너뜀');
  });

  it('REQ-808: 취소는 확인창을 거쳐 취소 요청을 보내고 "계속 진행"은 보내지 않는다', async () => {
    let cancelled = false;
    const fn = mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: () => json(cancelled
        ? finished('CANCELLED', [item('IF_Order_Sync', 'DONE', 'SUCCESS'), item('IF_Customer_Push', 'SKIPPED')])
        : running(0, [item('IF_Order_Sync', 'UPLOAD'), item('IF_Customer_Push', 'WAITING')])),
      [`POST /transport/jobs/${JOB}/cancel`]: () => { cancelled = true; return new Response(null, { status: 202 }); },
    }));
    renderAt(`#/job?id=${JOB}`);
    const region = await jobRegion();
    const cancelCalls = () => fn.mock.calls.filter(([url, init]) => url === `/transport/jobs/${JOB}/cancel` && init?.method === 'POST').length;
    await userEvent.click(within(region).getByRole('button', { name: '취소' }));
    let dialog = screen.getByRole('dialog', { name: '실제 이관 취소' });
    await userEvent.click(within(dialog).getByRole('button', { name: '계속 진행' }));
    expect(screen.queryByRole('dialog', { name: '실제 이관 취소' })).toBeNull();
    expect(cancelCalls()).toBe(0);
    await userEvent.click(within(region).getByRole('button', { name: '취소' }));
    dialog = screen.getByRole('dialog', { name: '실제 이관 취소' });
    await userEvent.click(within(dialog).getByRole('button', { name: '취소 요청' }));
    expect(cancelCalls()).toBe(1);
    expect(await screen.findByRole('heading', { name: '실제 이관 취소됨' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('REQ-808: "이관 이력에서 보기"는 그 이력의 결과를, "새 이관 시작"은 빈 마법사를 연다', async () => {
    const history = [{ ...finished('COMPLETED', DONE_ITEMS).result }];
    mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: () => json(finished('COMPLETED', DONE_ITEMS)),
      'GET /transport/history': () => json(history),
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
    }));
    renderAt(`#/job?id=${JOB}`);
    await userEvent.click(await screen.findByRole('button', { name: '이관 이력에서 보기' }));
    expect(window.location.hash).toBe('#/history?transportId=t-job');
    const result = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(result).getByText('t-job')).toBeInTheDocument();

    window.location.hash = `#/job?id=${JOB}`;
    await userEvent.click(await screen.findByRole('button', { name: '새 이관 시작' }));
    expect(window.location.hash).toBe('#/transport');
    expect(await screen.findByRole('button', { name: '템플릿 없이 진행' })).toBeInTheDocument();
  });

  it('REQ-808 실패: 없는 작업 주소는 안내와 이관 이력 링크를 보인다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/nope': () => json({ error: 'JOB_NOT_FOUND', message: 'Job not found' }, 404),
    }));
    renderAt('#/job?id=nope');
    expect(await screen.findByText('작업을 찾을 수 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이관 이력' })).toHaveAttribute('href', '#/history');
  });

  it('REQ-808 실패: 조회가 연속 3번 실패하면 안내와 다시 시도가 보이고 다시 시도로 이어진다', async () => {
    let healthy = false;
    mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: () => healthy ? json(finished('COMPLETED', DONE_ITEMS)) : json({ error: 'X', message: 'x' }, 500),
    }));
    renderAt(`#/job?id=${JOB}`);
    expect(await screen.findByText('진행 상황을 불러오지 못했습니다', undefined, { timeout: 5000 })).toBeInTheDocument();
    healthy = true;
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { name: '실제 이관 완료' }, { timeout: 3000 })).toBeInTheDocument();
  }, 15000);
});

describe('REQ-808 마법사에서 실제 이관 시작', () => {
  const TARGET = 'GET /packages/target-status?tenantId=PRD&packageIds=PkgTransportDemo';
  function setup(extra: Routes = {}) {
    const fn = mockApi(baseRoutes({
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      [TARGET]: () => json([{ packageId: 'PkgTransportDemo', exists: true }]),
      'POST /transport': (init) => json(respondTo(JSON.parse(init?.body as string))),
      ...extra,
    }));
    renderAt('#/transport');
    return fn;
  }
  async function confirmReal() {
    await toArtifacts();
    await userEvent.click(artifactRow('IF_Order_Sync'));
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const region = await screen.findByRole('region', { name: '이관 결과' });
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    const dialog = screen.getByRole('dialog', { name: '실제 이관 확인' });
    const run = within(dialog).getByRole('button', { name: '실행' });
    await waitFor(() => expect(run).toBeEnabled());
    await userEvent.click(run);
    return dialog;
  }

  it('REQ-808: 실행하면 작업을 시작하고 작업 화면으로 가며, 마법사로 돌아오면 선택이 비어 있다', async () => {
    setup({
      'POST /transport/jobs': (init) => {
        const sent = JSON.parse(init?.body as string);
        return sent.dryRun
          ? json({ jobId: 'job-p', status: 'RUNNING', dryRun: true, total: 1 }, 202)
          : json({ jobId: JOB, status: 'RUNNING', dryRun: false, total: 1 }, 202);
      },
      'GET /transport/jobs/job-p': () => json({ ...finished('COMPLETED', [item('IF_Customer_Push', 'DONE', 'SUCCESS')]), jobId: 'job-p', dryRun: true,
        result: respondTo({ ...body, dryRun: true }, { transportId: 't-dry', jobStatus: 'COMPLETED' }) }),
      [`GET /transport/jobs/${JOB}`]: () => json(finished('COMPLETED', [item('IF_Customer_Push', 'DONE', 'SUCCESS')])),
    });
    await confirmReal();
    await waitFor(() => expect(window.location.hash).toBe(`#/job?id=${JOB}`));
    expect(await screen.findByRole('heading', { name: '실제 이관 완료' }, { timeout: 3000 })).toBeInTheDocument();
    window.location.hash = '#/transport';
    expect(await screen.findByRole('button', { name: '템플릿 없이 진행' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
  });

  it('REQ-808 실패: 다른 실제 이관이 진행 중이라 409면 확인창에 안내와 그 작업 링크가 보이고 선택은 그대로다', async () => {
    setup({
      'POST /transport/jobs': (init) => JSON.parse(init?.body as string).dryRun
        ? json({ jobId: 'job-p', status: 'RUNNING', dryRun: true, total: 1 }, 202)
        : json({ error: 'JOB_ALREADY_RUNNING', message: 'running', jobId: 'job-other' }, 409),
      'GET /transport/jobs/job-p': () => json({ ...finished('COMPLETED', [item('IF_Customer_Push', 'DONE', 'SUCCESS')]), jobId: 'job-p', dryRun: true,
        result: respondTo({ ...body, dryRun: true }, { transportId: 't-dry', jobStatus: 'COMPLETED' }) }),
    });
    const dialog = await confirmReal();
    expect(await within(dialog).findByText(/다른 실제 이관이 진행 중입니다/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /진행 중인 작업 보기/ })).toHaveAttribute('href', '#/job?id=job-other');
    expect(window.location.hash).toBe('#/transport');
    expect(screen.getByRole('dialog', { name: '실제 이관 확인' })).toBeInTheDocument();
  });
});

describe('REQ-809 진행 중 표시줄', () => {
  it('REQ-809: 진행 중 실제 이관이 있으면 다른 화면 위에 n/N과 보기 링크가 보이고, 끝나면 다음 조회에서 사라진다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(
        () => json({ jobId: JOB, total: 4, done: 1 }),
        () => new Response(null, { status: 204 }),
      ),
    }));
    renderAt('#/dashboard');
    const bar = await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    expect(bar).toHaveTextContent('실제 이관 진행 중 1/4');
    expect(within(bar).getByRole('link', { name: '보기' })).toHaveAttribute('href', `#/job?id=${JOB}`);
    await waitFor(() => expect(screen.queryByRole('status', { name: /실제 이관 진행 중/ })).toBeNull(), { timeout: 4000 });
  }, 10000);

  it('REQ-809: 작업 화면 자신에서는 표시줄을 숨긴다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/active': () => json({ jobId: JOB, total: 2, done: 0 }),
      [`GET /transport/jobs/${JOB}`]: () => json(running(0, [item('IF_Order_Sync', 'WAITING'), item('IF_Customer_Push', 'WAITING')])),
    }));
    renderAt(`#/job?id=${JOB}`);
    await jobRegion();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('status', { name: /실제 이관 진행 중/ })).toBeNull();
  });

  it('REQ-809 실패: active 조회가 실패하면 표시줄 없이 화면은 그대로 동작한다', async () => {
    mockApi(baseRoutes({ 'GET /transport/jobs/active': () => json({ error: 'X', message: 'x' }, 500) }));
    renderAt('#/dashboard');
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('status', { name: /실제 이관 진행 중/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('REQ-809: 진행 중이면 마법사의 실제 이관 버튼이 비활성이고 같은 안내가 설명에 있다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/active': () => json({ jobId: JOB, total: 2, done: 0 }),
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      'POST /transport': (init) => json(respondTo(JSON.parse(init?.body as string))),
    }));
    renderAt('#/transport');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const region = await screen.findByRole('region', { name: '이관 결과' });
    const real = within(region).getByRole('button', { name: '이 구성으로 실제 이관' });
    expect(real).toBeDisabled();
    expect(real).toHaveAccessibleDescription(expect.stringContaining('다른 실제 이관이 진행 중입니다'));
  });
});
