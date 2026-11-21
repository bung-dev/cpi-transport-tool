import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult } from '../../api/types';
import { json, mockApi, packagesOf } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';

// 20261121-perf-retry S5, REQ-908 다시 이관 화면. 화면 계약(이 테스트가 정함):
// - 실제 이관 결과(작업 완료 화면 #/job, 이력 결과 #/history?transportId=)에 실패(status FAILED) + 건너뜀(result.skipped)이 1개 이상이면
//   버튼 "실패한 N개 다시 이관"(N = 실패 수 + 건너뜀 수). 0개이거나 미리보기 결과면 버튼이 없다.
// - 누르면 dialog "실패분 다시 이관": 경로 "<원본 이름> → <대상 이름>", list "다시 이관할 iFlow"의 항목마다 artifactId와 등급 글자
//   ("고쳐야 함" / "다시 시도 가능" / 건너뜀은 "건너뜀" / 등급 없는 옛 실패는 "실패"), 글자 "배포 켬" 또는 "배포 끔", 버튼 "취소"·"실행".
// - "실행" → POST /transport/jobs/retry {"transportId": <원래 transportId>} → 202 {jobId} → #/job?id=<jobId>.
// - 다른 실제 이관이 진행 중(GET /transport/jobs/active 200)이면 "실행"이 비활성이고 확인창에 "다른 실제 이관이 진행 중입니다".
// - 시작이 오류면 확인창 안에 role=alert가 보이고 주소는 그대로다.
// - 결과에 retryOf가 있으면 링크 "다시 이관 — 원래 이관 <retryOf>"(href #/history?transportId=<retryOf>).
afterEach(() => vi.unstubAllGlobals());

const JOB = 'job-r1';
const art = (artifactId: string, over: Partial<ArtifactResult> = {}): ArtifactResult => ({
  packageId: 'PkgFaultDemo', artifactId, status: 'SUCCESS', action: 'UPDATED', deployStatus: 'NOT_REQUESTED', error: null, configurations: [], grade: 'SUCCESS', ...over,
});
const failed = (artifactId: string, grade: ArtifactResult['grade']) =>
  art(artifactId, { status: 'FAILED', action: 'NONE', grade, error: { code: 'UPLOAD_FAILED', message: 'UPLOAD: HTTP 500; CPI call failed' } });

function result(results: ArtifactResult[], over: Record<string, unknown> = {}) {
  const failures = results.filter((r) => r.status === 'FAILED').length;
  return {
    transportId: 't-job', packages: packagesOf('PkgFaultDemo'), dryRun: false, deploy: true,
    startedAt: '2026-11-21T01:00:00Z', finishedAt: '2026-11-21T01:00:30Z',
    summary: { total: results.length, succeeded: results.length - failures, failed: failures, fixRequired: 1, retryable: 1, skipped: 1 },
    results, sourceTenant: { id: 'DEV', name: '개발' }, targetTenant: { id: 'PRD', name: '운영' }, jobStatus: 'CANCELLED',
    skipped: [{ packageId: 'PkgFaultDemo', artifactId: 'IF_Skipped' }],
    ...over,
  };
}
const MIXED = [art('IF_Ok'), failed('IF_Fix', 'FIX_REQUIRED'), failed('IF_Retry', 'RETRYABLE')];
function job(res: ReturnType<typeof result>) {
  const items = [
    ...res.results.map((r) => ({ packageId: 'PkgFaultDemo', artifactId: r.artifactId, stage: 'DONE', status: r.status })),
    ...((res.skipped as { artifactId: string }[]) ?? []).map((s) => ({ packageId: 'PkgFaultDemo', artifactId: s.artifactId, stage: 'SKIPPED', status: null })),
  ];
  return {
    jobId: JOB, status: res.jobStatus ?? 'COMPLETED', dryRun: res.dryRun, deploy: res.deploy, startedAt: res.startedAt, finishedAt: res.finishedAt,
    total: items.length, done: items.length, sourceTenant: res.sourceTenant, targetTenant: res.targetTenant,
    packages: [{ packageId: 'PkgFaultDemo', packageName: null, targetPackage: 'EXISTING' }], items, result: res,
  };
}
type Routes = Parameters<typeof mockApi>[0];
function openJob(res: ReturnType<typeof result>, extra: Routes = {}) {
  const fn = mockApi(baseRoutes({ [`GET /transport/jobs/${JOB}`]: () => json(job(res)), ...extra }));
  renderAt(`#/job?id=${JOB}`);
  return fn;
}
const retryButton = (n: number) => screen.findByRole('button', { name: `실패한 ${n}개 다시 이관` }, { timeout: 3000 });
const dialog = () => screen.getByRole('dialog', { name: '실패분 다시 이관' });
const retryCalls = (fn: ReturnType<typeof mockApi>) =>
  fn.mock.calls.filter(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}` === 'POST /transport/jobs/retry');

describe('REQ-908 다시 이관 — 작업 완료 화면', () => {
  it('REQ-908: 실패 2개 + 건너뜀 1개면 "실패한 3개 다시 이관"이 보이고, 확인창에 경로·iFlow와 등급·배포가 보인다', async () => {
    openJob(result(MIXED));
    await userEvent.click(await retryButton(3));
    const d = dialog();
    expect(d).toHaveTextContent('개발 → 운영');
    const items = within(within(d).getByRole('list', { name: '다시 이관할 iFlow' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('IF_Fix'), expect.stringContaining('IF_Retry'), expect.stringContaining('IF_Skipped'),
    ]);
    expect(items[0]).toHaveTextContent('고쳐야 함');
    expect(items[1]).toHaveTextContent('다시 시도 가능');
    expect(items[2]).toHaveTextContent('건너뜀');
    expect(within(d).queryByText(/IF_Ok/)).toBeNull();
    expect(d).toHaveTextContent('배포 켬');
    expect(within(d).getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('REQ-908: "실행"은 POST /transport/jobs/retry로 원래 transportId를 보내고 새 작업 화면으로 간다', async () => {
    const fn = openJob(result(MIXED), {
      'POST /transport/jobs/retry': () => json({ jobId: 'job-r2', status: 'RUNNING', dryRun: false, total: 3 }, 202),
      'GET /transport/jobs/job-r2': () => json({ ...job(result(MIXED)), jobId: 'job-r2', status: 'RUNNING', result: null }),
    });
    await userEvent.click(await retryButton(3));
    await userEvent.click(within(dialog()).getByRole('button', { name: '실행' }));
    await waitFor(() => expect(window.location.hash).toBe('#/job?id=job-r2'));
    const calls = retryCalls(fn);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1]?.body as string)).toEqual({ transportId: 't-job' });
  });

  it('REQ-908: 실패·건너뜀이 0개면 버튼이 없다', async () => {
    openJob(result([art('IF_Ok')], { skipped: [], jobStatus: 'COMPLETED' }));
    expect(await screen.findByRole('heading', { name: '실제 이관 완료' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /다시 이관$/ })).toBeNull();
  });

  it('REQ-908: 등급 없는 옛 실패는 "실패"로 보이고 skipped가 없으면 실패만 센다', async () => {
    const old = art('IF_Old', { status: 'FAILED', action: 'NONE', grade: undefined, error: { code: 'UPLOAD_FAILED', message: 'x' } });
    openJob(result([art('IF_Ok'), old], { skipped: undefined, jobStatus: 'COMPLETED', summary: { total: 2, succeeded: 1, failed: 1 } }));
    await userEvent.click(await retryButton(1));
    const items = within(within(dialog()).getByRole('list', { name: '다시 이관할 iFlow' })).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('IF_Old');
    expect(items[0]).toHaveTextContent('실패');
  });

  it('REQ-908 실패: 다른 실제 이관이 진행 중이면 "실행"이 막히고 진행 중 안내가 보인다', async () => {
    const fn = openJob(result(MIXED), {
      'GET /transport/jobs/active': () => json({ jobId: 'job-other', total: 4, done: 1 }),
      'GET /transport/jobs/job-other': () => json({ ...job(result(MIXED)), jobId: 'job-other', status: 'RUNNING', result: null }),
    });
    await userEvent.click(await retryButton(3));
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: '실행' })).toBeDisabled());
    expect(dialog()).toHaveTextContent('다른 실제 이관이 진행 중입니다');
    expect(retryCalls(fn)).toHaveLength(0);
  });

  it.each([
    [404, 'TRANSPORT_NOT_FOUND'], [400, 'NOTHING_TO_RETRY'], [409, 'JOB_ALREADY_RUNNING'], [500, 'INTERNAL'],
  ])('REQ-908 실패: 시작이 %i %s이면 확인창에 오류가 보이고 화면은 그대로다', async (status, code) => {
    openJob(result(MIXED), { 'POST /transport/jobs/retry': () => json({ error: code, message: 'test-dummy' }, status) });
    await userEvent.click(await retryButton(3));
    await userEvent.click(within(dialog()).getByRole('button', { name: '실행' }));
    expect(await within(dialog()).findByRole('alert')).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/job?id=${JOB}`);
  });

  it('REQ-908: 다시 이관한 작업의 완료 화면에 "다시 이관 — 원래 이관 <id>" 링크가 보인다', async () => {
    openJob(result([art('IF_Ok')], { skipped: [], jobStatus: 'COMPLETED', retryOf: 't-orig' }));
    const link = await screen.findByRole('link', { name: '다시 이관 — 원래 이관 t-orig' }, { timeout: 3000 });
    expect(link).toHaveAttribute('href', '#/history?transportId=t-orig');
  });
});

describe('REQ-908 다시 이관 — 이관 이력 결과', () => {
  const history = (entries: unknown[]) => ({ 'GET /transport/history': () => json(entries) });

  it('REQ-908: 이력의 실제 이관 결과에도 버튼이 있고 실행하면 새 작업 화면으로 간다', async () => {
    const fn = mockApi(baseRoutes({
      ...history([result(MIXED, { transportId: 't-hist' })]),
      'POST /transport/jobs/retry': () => json({ jobId: 'job-r3', status: 'RUNNING', dryRun: false, total: 3 }, 202),
      'GET /transport/jobs/job-r3': () => json({ ...job(result(MIXED)), jobId: 'job-r3', status: 'RUNNING', result: null }),
    }));
    renderAt('#/history?transportId=t-hist');
    await userEvent.click(await retryButton(3));
    await userEvent.click(within(dialog()).getByRole('button', { name: '실행' }));
    await waitFor(() => expect(window.location.hash).toBe('#/job?id=job-r3'));
    expect(JSON.parse(retryCalls(fn)[0][1]?.body as string)).toEqual({ transportId: 't-hist' });
  });

  it('REQ-908: 이력의 미리보기 결과에는 버튼이 없다', async () => {
    mockApi(baseRoutes(history([result(MIXED, { transportId: 't-preview', dryRun: true, deploy: false })])));
    renderAt('#/history?transportId=t-preview');
    expect(await screen.findByRole('region', { name: '이관 결과' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /다시 이관$/ })).toBeNull();
  });

  it('REQ-908: retryOf가 있는 이력 결과에는 원래 이관 링크가 있다', async () => {
    mockApi(baseRoutes(history([result([art('IF_Ok')], { transportId: 't-again', skipped: [], retryOf: 't-hist' })])));
    renderAt('#/history?transportId=t-again');
    expect(await screen.findByRole('link', { name: '다시 이관 — 원래 이관 t-hist' })).toHaveAttribute('href', '#/history?transportId=t-hist');
  });
});
