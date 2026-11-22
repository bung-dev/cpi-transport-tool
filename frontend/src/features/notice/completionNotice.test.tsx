import { screen, waitFor } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import { toArtifacts } from '../../test/wizard';

// 20261122-completion-notice S1: REQ-1101 끝남 감지, REQ-1102 탭 제목 표시.
// 화면 계약(이 테스트가 정함):
// - 이 탭이 진행 중으로 본 실제 이관 작업: 진행 중 띠(GET /transport/jobs/active 200) 또는 완료 화면(#/job?id=)의 조회가 RUNNING을 받은 작업.
//   진행 중 띠가 사라지면(active 204) 그 작업 ID로 GET /transport/jobs/{id}를 한 번 읽는다. 끝났으면(RUNNING 아님) 끝남이다.
// - 마법사에서 시작한 미리보기 작업은 마법사의 진행 조회가 끝난 상태를 받으면 끝남이다.
// - 끝남을 안 순간 document.visibilityState가 'hidden'이면 document.title 앞에 "(완료) " 또는 "(확인 필요) "를 붙인다.
//   확인 필요 = 결과 summary의 failed·skipped가 1 이상이거나 작업 상태가 CANCELLED·INTERRUPTED.
//   visibilitychange로 visible이 되면 앞 표시를 뗀다. 표시는 하나만이고 둘 중 하나라도 확인 필요면 "(확인 필요) ".
// - 보고 있으면(visible) 제목을 바꾸지 않는다. 조회 실패·첫 조회에 이미 끝난 작업은 알리지 않는다.
const TITLE = 'CPI Transport Tool';
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  document.title = TITLE;
});
afterEach(() => {
  setVisibility('visible');
  delete (document as unknown as Record<string, unknown>).visibilityState;
  vi.unstubAllGlobals();
});

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

const realBody = { packages: [{ packageId: 'PkgTransportDemo' }], dryRun: false };
const previewBody = { packages: [{ packageId: 'PkgTransportDemo' }], dryRun: true };
type Summary = { total: number; succeeded: number; failed: number; skipped?: number };
function job(id: string, status: string, opts: { dryRun?: boolean; summary?: Summary } = {}) {
  const dryRun = opts.dryRun ?? false;
  const running = status === 'RUNNING';
  return {
    jobId: id, status, dryRun, deploy: false, startedAt: '2026-11-22T01:00:00Z', finishedAt: running ? null : '2026-11-22T01:00:30Z',
    total: 2, done: running ? 1 : 2, sourceTenant: { id: 'DEV', name: 'DEV' }, targetTenant: { id: 'PRD', name: 'PRD' },
    packages: [{ packageId: 'PkgTransportDemo', packageName: null, targetPackage: dryRun ? 'NOT_CHECKED' : 'EXISTING' }],
    items: [
      { packageId: 'PkgTransportDemo', artifactId: 'IF_Order_Sync', stage: 'DONE', status: 'SUCCESS' },
      { packageId: 'PkgTransportDemo', artifactId: 'IF_Customer_Push', stage: running ? 'UPLOAD' : 'DONE', status: running ? null : 'SUCCESS' },
    ],
    result: running ? null : respondTo(dryRun ? previewBody : realBody, {
      transportId: `t-${id}`, jobStatus: status, summary: opts.summary ?? { total: 2, succeeded: 2, failed: 0 },
    }),
  };
}
function sequence(...responses: (() => Response)[]) {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)]();
}
const noContent = () => new Response(null, { status: 204 });
const active = (id: string) => () => json({ jobId: id, total: 2, done: 1 });
const lookups = (fn: ReturnType<typeof mockApi>, id: string) =>
  fn.mock.calls.filter(([url, init]) => String(url) === `/transport/jobs/${id}` && (init?.method ?? 'GET') === 'GET').length;
const banner = () => screen.queryByRole('status', { name: /실제 이관 진행 중/ });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('REQ-1101·1102 진행 중 띠로 본 실제 이관', () => {
  it('REQ-1101·1102: 띠가 사라지면 작업을 한 번 읽고, 탭을 보고 있지 않았으면 제목 앞에 "(완료) "가 붙고 다시 보면 뗀다', async () => {
    const fn = mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active('job-n1'), noContent),
      'GET /transport/jobs/job-n1': () => json(job('job-n1', 'COMPLETED')),
    }));
    renderAt('#/dashboard');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(완료) ${TITLE}`), { timeout: 5000 });
    expect(lookups(fn, 'job-n1')).toBe(1);
    // 띠가 다시 나타나지 않는 동안 더 읽지 않는다.
    await wait(2500);
    expect(lookups(fn, 'job-n1')).toBe(1);
    expect(document.title).toBe(`(완료) ${TITLE}`);
    setVisibility('visible');
    expect(document.title).toBe(TITLE);
  }, 15000);

  it.each([
    ['실패가 있으면', 'COMPLETED', { total: 2, succeeded: 1, failed: 1 }],
    ['건너뜀이 있으면', 'COMPLETED', { total: 2, succeeded: 1, failed: 0, skipped: 1 }],
    ['취소됨이면', 'CANCELLED', { total: 2, succeeded: 1, failed: 0 }],
    ['중단됨이면', 'INTERRUPTED', { total: 2, succeeded: 1, failed: 0 }],
  ] as const)('REQ-1102: %s 제목 앞 표시는 "(확인 필요) "다', async (_label, status, summary) => {
    const id = `job-c-${status}-${summary.failed}-${summary.skipped ?? 0}`;
    mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active(id), noContent),
      [`GET /transport/jobs/${id}`]: () => json(job(id, status, { summary: { ...summary } })),
    }));
    renderAt('#/dashboard');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(확인 필요) ${TITLE}`), { timeout: 5000 });
  }, 10000);

  it('REQ-1102: 끝남을 안 순간 탭을 보고 있으면 제목을 바꾸지 않는다', async () => {
    const fn = mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active('job-n2'), noContent),
      'GET /transport/jobs/job-n2': () => json(job('job-n2', 'COMPLETED')),
    }));
    renderAt('#/dashboard');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    await waitFor(() => expect(lookups(fn, 'job-n2')).toBe(1), { timeout: 5000 });
    await wait(200);
    expect(document.title).toBe(TITLE);
    // 나중에 탭을 숨겼다 다시 봐도 지난 끝남으로 표시하지 않는다.
    setVisibility('hidden');
    await wait(200);
    expect(document.title).toBe(TITLE);
  }, 10000);

  it('REQ-1102: 표시가 붙은 동안 다른 작업이 또 끝나면 표시는 하나만이고, 앞 작업이 확인 필요였으면 "(확인 필요) "로 남는다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active('job-a'), noContent, active('job-b'), noContent),
      'GET /transport/jobs/job-a': () => json(job('job-a', 'COMPLETED', { summary: { total: 2, succeeded: 1, failed: 1 } })),
      'GET /transport/jobs/job-b': () => json(job('job-b', 'COMPLETED')),
    }));
    renderAt('#/dashboard');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(확인 필요) ${TITLE}`), { timeout: 5000 });
    await waitFor(() => expect(banner()).not.toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(banner()).toBeNull(), { timeout: 5000 });
    await wait(300);
    expect(document.title).toBe(`(확인 필요) ${TITLE}`);
    setVisibility('visible');
    expect(document.title).toBe(TITLE);
  }, 20000);

  it('REQ-1102: 앞 작업이 완료였고 다음 작업이 확인 필요면 표시가 "(확인 필요) " 하나로 바뀐다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active('job-c'), noContent, active('job-d'), noContent),
      'GET /transport/jobs/job-c': () => json(job('job-c', 'COMPLETED')),
      'GET /transport/jobs/job-d': () => json(job('job-d', 'CANCELLED')),
    }));
    renderAt('#/dashboard');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(완료) ${TITLE}`), { timeout: 5000 });
    await waitFor(() => expect(document.title).toBe(`(확인 필요) ${TITLE}`), { timeout: 8000 });
  }, 20000);

  it.each([
    ['404', () => json({ error: 'JOB_NOT_FOUND', message: 'x' }, 404)],
    ['네트워크 오류', () => { throw new TypeError('Failed to fetch'); }],
  ] as const)('REQ-1101 실패: 띠가 사라진 뒤 작업 조회가 %s면 알리지 않고 화면 오류도 없다', async (label, failure) => {
    const id = `job-f-${label === '404' ? '404' : 'net'}`;
    const fn = mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active(id), noContent),
      [`GET /transport/jobs/${id}`]: failure,
    }));
    renderAt('#/dashboard');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(lookups(fn, id)).toBe(1), { timeout: 5000 });
    await wait(300);
    expect(document.title).toBe(TITLE);
    expect(screen.queryByRole('alert')).toBeNull();
  }, 10000);

  it('REQ-1101: 띠가 사라졌을 때 작업이 아직 진행 중이면 끝남이 아니다', async () => {
    const fn = mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active('job-r'), noContent),
      'GET /transport/jobs/job-r': () => json(job('job-r', 'RUNNING')),
    }));
    renderAt('#/dashboard');
    await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(lookups(fn, 'job-r')).toBeGreaterThanOrEqual(1), { timeout: 5000 });
    await wait(300);
    expect(document.title).toBe(TITLE);
  }, 10000);
});

describe('REQ-1101·1102 완료 화면으로 본 실제 이관', () => {
  it('REQ-1101·1102: 완료 화면 조회가 진행 중을 본 작업이 끝나면 탭을 보고 있지 않을 때 "(완료) "가 붙는다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/job-s1': sequence(() => json(job('job-s1', 'RUNNING')), () => json(job('job-s1', 'COMPLETED'))),
    }));
    renderAt('#/job?id=job-s1');
    expect(await screen.findByRole('heading', { name: '실제 이관 중' }, { timeout: 3000 })).toBeInTheDocument();
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(완료) ${TITLE}`), { timeout: 3000 });
    setVisibility('visible');
    expect(document.title).toBe(TITLE);
  });

  it('REQ-1101 실패: 탭을 연 뒤 첫 조회에서 이미 끝난 작업이면 알리지 않는다', async () => {
    setVisibility('hidden');
    mockApi(baseRoutes({
      'GET /transport/jobs/job-s2': () => json(job('job-s2', 'COMPLETED', { summary: { total: 2, succeeded: 1, failed: 1 } })),
    }));
    renderAt('#/job?id=job-s2');
    expect(await screen.findByRole('heading', { name: '실제 이관 완료' }, { timeout: 3000 })).toBeInTheDocument();
    await wait(1500);
    expect(document.title).toBe(TITLE);
  });

  it('REQ-1101: 진행 중 띠와 완료 화면이 같은 작업을 함께 봐도 제목 앞 표시는 하나다', async () => {
    mockApi(baseRoutes({
      'GET /transport/jobs/active': sequence(active('job-s3'), noContent),
      'GET /transport/jobs/job-s3': sequence(() => json(job('job-s3', 'RUNNING')), () => json(job('job-s3', 'RUNNING')),
        () => json(job('job-s3', 'COMPLETED'))),
    }));
    renderAt('#/job?id=job-s3');
    expect(await screen.findByRole('heading', { name: '실제 이관 중' }, { timeout: 3000 })).toBeInTheDocument();
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(완료) ${TITLE}`), { timeout: 5000 });
    await wait(2500);
    expect(document.title).toBe(`(완료) ${TITLE}`);
  }, 15000);
});

describe('REQ-1101·1102 마법사 미리보기', () => {
  function setupPreview(id: string, finished: ReturnType<typeof job>) {
    mockApi(baseRoutes({
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      'POST /transport/jobs': () => json({ jobId: id, status: 'RUNNING', dryRun: true, total: 2 }, 202),
      [`GET /transport/jobs/${id}`]: sequence(() => json(job(id, 'RUNNING', { dryRun: true })), () => json(finished)),
    }));
    renderAt('#/transport');
  }

  it('REQ-1101·1102: 마법사에서 시작한 미리보기가 끝나면 탭을 보고 있지 않을 때 "(완료) "가 붙는다', async () => {
    setupPreview('job-p1', job('job-p1', 'COMPLETED', { dryRun: true }));
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '미리보기 진행' }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(완료) ${TITLE}`), { timeout: 3000 });
    setVisibility('visible');
    expect(document.title).toBe(TITLE);
  });

  it('REQ-1102: 미리보기 결과에 실패가 있으면 "(확인 필요) "다', async () => {
    setupPreview('job-p2', job('job-p2', 'COMPLETED', { dryRun: true, summary: { total: 2, succeeded: 1, failed: 1 } }));
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '미리보기 진행' }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(확인 필요) ${TITLE}`), { timeout: 3000 });
  });

  it('REQ-1102: 미리보기가 끝날 때 탭을 보고 있으면 제목을 바꾸지 않는다', async () => {
    setupPreview('job-p3', job('job-p3', 'COMPLETED', { dryRun: true }));
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' }, { timeout: 4000 });
    await wait(200);
    expect(document.title).toBe(TITLE);
  });
});
