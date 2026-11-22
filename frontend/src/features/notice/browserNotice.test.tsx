import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, navLink, renderAt } from '../../test/appRoutes';
import { browserStore, installNotification, type FakeNotification } from '../../test/noticeFakes';
import { currentStep, toArtifacts } from '../../test/wizard';

// 20261122-completion-notice S2: REQ-1104 브라우저 알림(REQ-1101 한 번만 포함).
// 화면 계약(이 테스트가 정함):
// - 끝남을 안 순간 탭을 보고 있지 않고(visibilityState 'hidden') 설정 "브라우저 알림"이 켜짐·Notification.permission 'granted'면
//   new Notification(제목, { body, tag: 작업 ID })를 한 번 만든다.
//   제목: 실제 이관 "실제 이관 완료"/"실제 이관 취소됨"/"실제 이관 중단됨", 미리보기 "미리보기 완료"/"미리보기 취소됨"/"미리보기 중단됨".
//   본문: "<원본 이름> → <대상 이름> · 성공 <succeeded> · 실패 <failed>", 결과 summary가 없으면 "<원본 이름> → <대상 이름>".
// - 알림을 누르면(onclick 또는 click 리스너) window.focus(), 실제 이관은 location.hash "#/job?id=<작업 ID>", 미리보기는 "#/transport"(미리보기 결과 단계), 알림 close().
// - 보고 있으면, 꺼져 있으면, 허락이 granted가 아니면 만들지 않는다. 만들기가 예외를 내도 탭 제목 표시는 그대로이고 화면 오류가 없다.
const TITLE = 'CPI Transport Tool';
let visibility: DocumentVisibilityState = 'visible';
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => {
  browserStore().clear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  document.title = TITLE;
});
afterEach(() => {
  setVisibility('visible');
  delete (document as unknown as Record<string, unknown>).visibilityState;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  browserStore().clear();
});

const realBody = { packages: [{ packageId: 'PkgTransportDemo' }], dryRun: false };
const previewBody = { packages: [{ packageId: 'PkgTransportDemo' }], dryRun: true };
type Summary = { total: number; succeeded: number; failed: number };
function job(id: string, status: string, opts: { dryRun?: boolean; summary?: Summary; noResult?: boolean } = {}) {
  const dryRun = opts.dryRun ?? false;
  const running = status === 'RUNNING';
  return {
    jobId: id, status, dryRun, deploy: false, startedAt: '2026-11-22T01:00:00Z', finishedAt: running ? null : '2026-11-22T01:00:30Z',
    total: 2, done: running ? 1 : 2, sourceTenant: { id: 'DEV', name: '개발' }, targetTenant: { id: 'PRD', name: '운영' },
    packages: [{ packageId: 'PkgTransportDemo', packageName: null, targetPackage: dryRun ? 'NOT_CHECKED' : 'EXISTING' }],
    items: [
      { packageId: 'PkgTransportDemo', artifactId: 'IF_Order_Sync', stage: 'DONE', status: 'SUCCESS' },
      { packageId: 'PkgTransportDemo', artifactId: 'IF_Customer_Push', stage: running ? 'UPLOAD' : 'DONE', status: running ? null : 'SUCCESS' },
    ],
    result: running || opts.noResult ? null : respondTo(dryRun ? previewBody : realBody, {
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SETTINGS = { 'GET /settings': () => json({ previewConcurrency: 4, transportConcurrency: 4 }) };

/** 설정 탭에서 "브라우저 알림"을 켠다(허락 granted). */
async function enableNotice() {
  const sw = await screen.findByRole('switch', { name: '브라우저 알림' });
  await userEvent.click(sw);
  await waitFor(() => expect(screen.getByRole('switch', { name: '브라우저 알림' })).toBeChecked());
}
async function finishBannerJob(N: typeof FakeNotification, id: string, finished: ReturnType<typeof job>, opts: { enable?: boolean } = {}) {
  mockApi(baseRoutes({
    ...SETTINGS,
    'GET /transport/jobs/active': sequence(active(id), noContent),
    [`GET /transport/jobs/${id}`]: () => json(finished),
  }));
  renderAt('#/settings');
  if (opts.enable ?? true) await enableNotice();
  await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 });
  setVisibility('hidden');
  await waitFor(() => expect(document.title).not.toBe(TITLE), { timeout: 5000 });
  return N.instances;
}

describe('REQ-1104 실제 이관 브라우저 알림', () => {
  it('REQ-1104: 탭을 보고 있지 않을 때 끝나면 제목·본문·tag가 맞는 알림 하나를 띄운다', async () => {
    const N = installNotification('granted');
    const instances = await finishBannerJob(N, 'job-b1', job('job-b1', 'COMPLETED', { summary: { total: 3, succeeded: 2, failed: 1 } }));
    expect(instances).toHaveLength(1);
    expect(instances[0].title).toBe('실제 이관 완료');
    expect(instances[0].options.body).toBe('개발 → 운영 · 성공 2 · 실패 1');
    expect(instances[0].options.tag).toBe('job-b1');
    await wait(2500);
    expect(N.instances).toHaveLength(1);
  }, 15000);

  it.each([['CANCELLED', '실제 이관 취소됨'], ['INTERRUPTED', '실제 이관 중단됨']])('REQ-1104: 작업이 %s로 끝나면 제목이 "%s"다', async (status, title) => {
    const N = installNotification('granted');
    const id = `job-b-${status}`;
    const instances = await finishBannerJob(N, id, job(id, status));
    expect(instances.map((n) => n.title)).toEqual([title]);
  }, 10000);

  it('REQ-1104: 결과 summary가 없으면 본문은 "<원본> → <대상>"만이다', async () => {
    const N = installNotification('granted');
    const instances = await finishBannerJob(N, 'job-b2', job('job-b2', 'INTERRUPTED', { noResult: true }));
    expect(instances).toHaveLength(1);
    expect(instances[0].options.body).toBe('개발 → 운영');
  }, 10000);

  it('REQ-1104: 알림을 누르면 탭을 앞으로 가져오고 그 작업의 완료 화면으로 가며 알림을 닫는다', async () => {
    const N = installNotification('granted');
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    const instances = await finishBannerJob(N, 'job-b3', job('job-b3', 'COMPLETED'));
    expect(instances).toHaveLength(1);
    instances[0].click();
    expect(focus).toHaveBeenCalled();
    expect(instances[0].close).toHaveBeenCalled();
    await waitFor(() => expect(window.location.hash).toBe('#/job?id=job-b3'));
    expect(await screen.findByRole('heading', { name: '실제 이관 완료' }, { timeout: 3000 })).toBeInTheDocument();
  }, 10000);

  it('REQ-1104: 탭을 보고 있으면 알림을 띄우지 않는다', async () => {
    const N = installNotification('granted');
    const fn = mockApi(baseRoutes({
      ...SETTINGS,
      'GET /transport/jobs/active': sequence(active('job-b4'), noContent),
      'GET /transport/jobs/job-b4': () => json(job('job-b4', 'COMPLETED')),
    }));
    renderAt('#/settings');
    await enableNotice();
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/transport/jobs/job-b4')).toBe(true), { timeout: 5000 });
    await wait(300);
    expect(N.instances).toHaveLength(0);
    expect(document.title).toBe(TITLE);
  }, 10000);

  it('REQ-1104: 설정이 꺼져 있으면 알림 없이 탭 제목 표시만 한다', async () => {
    const N = installNotification('granted');
    await finishBannerJob(N, 'job-b5', job('job-b5', 'COMPLETED'), { enable: false });
    expect(document.title).toBe(`(완료) ${TITLE}`);
    expect(N.instances).toHaveLength(0);
  }, 10000);

  it('REQ-1103 실패: 켠 뒤 브라우저에서 허락을 막았으면 알림을 띄우지 않는다(탭 제목 표시는 그대로)', async () => {
    const N = installNotification('granted');
    mockApi(baseRoutes({
      ...SETTINGS,
      'GET /transport/jobs/active': sequence(active('job-b6'), noContent),
      'GET /transport/jobs/job-b6': () => json(job('job-b6', 'COMPLETED')),
    }));
    renderAt('#/settings');
    await enableNotice();
    N.permission = 'denied';
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(완료) ${TITLE}`), { timeout: 5000 });
    expect(N.instances).toHaveLength(0);
  }, 10000);

  it('REQ-1104 실패: 알림 만들기가 예외를 내도 탭 제목 표시는 그대로이고 화면 오류가 없다', async () => {
    const N = installNotification('granted');
    mockApi(baseRoutes({
      ...SETTINGS,
      'GET /transport/jobs/active': sequence(active('job-b7'), noContent),
      'GET /transport/jobs/job-b7': () => json(job('job-b7', 'COMPLETED')),
    }));
    renderAt('#/settings');
    await enableNotice();
    N.fail = true;
    setVisibility('hidden');
    await waitFor(() => expect(document.title).toBe(`(완료) ${TITLE}`), { timeout: 5000 });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('region', { name: '완료 알림' })).toBeInTheDocument();
  }, 10000);

  it('REQ-1101: 진행 중 띠와 완료 화면이 같은 작업을 함께 봐도 알림은 하나다', async () => {
    const N = installNotification('granted');
    mockApi(baseRoutes({
      ...SETTINGS,
      'GET /transport/jobs/active': sequence(active('job-b8'), active('job-b8'), noContent),
      'GET /transport/jobs/job-b8': sequence(() => json(job('job-b8', 'RUNNING')), () => json(job('job-b8', 'RUNNING')),
        () => json(job('job-b8', 'RUNNING')), () => json(job('job-b8', 'COMPLETED'))),
    }));
    renderAt('#/settings');
    await enableNotice();
    await userEvent.click(within(await screen.findByRole('status', { name: /실제 이관 진행 중/ }, { timeout: 3000 })).getByRole('link', { name: '보기' }));
    expect(await screen.findByRole('heading', { name: '실제 이관 중' }, { timeout: 3000 })).toBeInTheDocument();
    setVisibility('hidden');
    await waitFor(() => expect(N.instances).toHaveLength(1), { timeout: 8000 });
    await wait(2500);
    expect(N.instances).toHaveLength(1);
    expect(N.instances[0].options.tag).toBe('job-b8');
  }, 20000);
});

describe('REQ-1104 미리보기 브라우저 알림', () => {
  async function previewTo(N: typeof FakeNotification, id: string, finished: ReturnType<typeof job>) {
    mockApi(baseRoutes({
      ...SETTINGS,
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      'POST /transport/jobs': () => json({ jobId: id, status: 'RUNNING', dryRun: true, total: 2 }, 202),
      [`GET /transport/jobs/${id}`]: sequence(() => json(job(id, 'RUNNING', { dryRun: true })), () => json(finished)),
    }));
    renderAt('#/settings');
    await enableNotice();
    await userEvent.click(navLink('새 이관'));
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '미리보기 진행' }, { timeout: 3000 });
    setVisibility('hidden');
    await waitFor(() => expect(N.instances).toHaveLength(1), { timeout: 3000 });
    return N.instances[0];
  }

  it.each([['COMPLETED', '미리보기 완료'], ['CANCELLED', '미리보기 취소됨'], ['INTERRUPTED', '미리보기 중단됨']])('REQ-1104: 미리보기가 %s로 끝나면 제목이 "%s"다', async (status, title) => {
    const N = installNotification('granted');
    const id = `job-pv-${status}`;
    const n = await previewTo(N, id, job(id, status, { dryRun: true, summary: { total: 2, succeeded: 1, failed: 1 } }));
    expect(n.title).toBe(title);
    expect(n.options.body).toBe('개발 → 운영 · 성공 1 · 실패 1');
    expect(n.options.tag).toBe(id);
  }, 15000);

  it('REQ-1104: 미리보기 알림을 누르면 탭을 앞으로 가져오고 마법사의 미리보기 결과 단계로 가며 알림을 닫는다', async () => {
    const N = installNotification('granted');
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    const n = await previewTo(N, 'job-pv-click', job('job-pv-click', 'COMPLETED', { dryRun: true }));
    n.click();
    expect(focus).toHaveBeenCalled();
    expect(n.close).toHaveBeenCalled();
    expect(window.location.hash).toBe('#/transport');
    expect(await screen.findByRole('region', { name: '이관 결과' }, { timeout: 3000 })).toBeInTheDocument();
    expect(currentStep()).toBe('미리보기');
  }, 15000);
});
