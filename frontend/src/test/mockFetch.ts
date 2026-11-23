import { vi } from 'vitest';

type Handler = (init?: RequestInit) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 20261120-versioning REQ-004: 화면 아래 footer가 부르는 GET /version의 기본 응답 */
export const VERSION = { version: '0.1.0', commit: 'abc1234', buildTime: '2026-11-20T10:00:00Z' };

/**
 * "METHOD /path" → 핸들러. 등록되지 않은 요청은 실제 네트워크 대신 throw 한다(REQ-010 AC-2).
 * 20261120-versioning REQ-004: 'GET /version'을 등록하지 않으면 VERSION을 돌려주고 반환하는 fn의 호출 기록에 넣지 않는다
 * (기존 테스트의 요청 목록·횟수 단언이 footer 요청에 흔들리지 않게). 등록하면 다른 경로처럼 기록된다.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const h = routes[key];
    if (!h) throw new Error(`mock 없음: ${key}`);
    return h(init);
  });
  // 20261120-async-transport: 화면은 이관을 작업 API(POST /transport/jobs → GET /transport/jobs/{id})로 실행한다.
  // 작업 경로를 등록하지 않은 테스트는 등록된 'POST /transport' 핸들러로 바로 끝나는 작업을 흉내 낸다:
  // 시작 요청은 'POST /transport'로 기록되고(postBodies 등 기존 단언 유지), 오류 응답은 그대로 돌려준다.
  // 작업 조회와 'GET /transport/jobs/active'(등록 안 하면 204)는 호출 기록에 넣지 않는다.
  const jobs = new Map<string, unknown>();
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    if (key === 'GET /version' && !routes['GET /version']) return json(VERSION);
    if (!routes[key]) {
      if (key === 'GET /transport/jobs/active') return new Response(null, { status: 204 });
      if (key === 'POST /transport/jobs' && routes['POST /transport']) {
        const response = await fn('/transport', init);
        if (!response.ok) return response;
        const result = await response.json();
        const jobId = `job-${jobs.size + 1}`;
        const items = (result.results ?? []).map((r: { packageId?: string; artifactId: string; status: string }) =>
          ({ packageId: r.packageId ?? result.packages?.[0]?.packageId ?? null, artifactId: r.artifactId, stage: 'DONE', status: r.status }));
        jobs.set(jobId, {
          jobId, status: 'COMPLETED', dryRun: result.dryRun, deploy: result.deploy, startedAt: result.startedAt,
          finishedAt: result.finishedAt, total: items.length, done: items.length, sourceTenant: result.sourceTenant ?? null,
          targetTenant: result.targetTenant ?? null, packages: result.packages ?? [], items, result,
        });
        return json({ jobId, status: 'RUNNING', dryRun: result.dryRun, total: items.length }, 202);
      }
      const job = key.startsWith('GET /transport/jobs/') ? jobs.get(key.slice('GET /transport/jobs/'.length)) : undefined;
      if (job) return json(job);
    }
    return fn(input, init);
  });
  vi.stubGlobal('fetch', fetchStub);
  return fn;
}

export const PACKAGES = [
  { id: 'PkgTransportDemo', name: 'Transport Demo', version: '1.0.0' },
  { id: 'PkgFaultDemo', name: 'Fault Demo', version: '1.0.0' },
  { id: 'PkgNotInPrd', name: 'Not In PRD', version: '1.0.0' },
];

export const ARTIFACTS = [
  { id: 'IF_Order_Sync', name: 'Order Sync', version: '1.0.3' },
  { id: 'IF_Customer_Push', name: 'Customer Push', version: '2.1.0' },
];

/** 20261118 S3 REQ-602: 응답·이력의 packages 항목. 이름·대상 패키지 상태가 필요 없는 테스트용(예전 형식 기록과 같은 모양) */
export const packagesOf = (...ids: string[]) => ids.map((packageId) => ({ packageId, packageName: null, targetPackage: null }));

/**
 * 20261118 S3: POST /transport 본문(packages)으로 만든 응답. 미리보기는 NOT_CHECKED, 실제 이관은 EXISTING이고
 * 결과는 패키지마다 아티팩트 1개(SUCCESS)다. over로 덮어쓴다.
 */
export function respondTo(body: { packages: { packageId: string }[]; dryRun?: boolean; deploy?: boolean }, over: Record<string, unknown> = {}) {
  const dry = Boolean(body.dryRun);
  return {
    transportId: dry ? 't-dry' : 't-real',
    packages: body.packages.map((p) => ({ packageId: p.packageId, packageName: null, targetPackage: dry ? 'NOT_CHECKED' : 'EXISTING' })),
    dryRun: dry,
    deploy: Boolean(body.deploy),
    startedAt: '2026-11-18T01:00:00Z',
    finishedAt: '2026-11-18T01:00:01Z',
    summary: { total: body.packages.length, succeeded: body.packages.length, failed: 0 },
    results: body.packages.map((p) => ({
      packageId: p.packageId, artifactId: `IF_${p.packageId}`, status: 'SUCCESS', action: 'NONE',
      deployStatus: dry ? 'SKIPPED_DRY_RUN' : 'NOT_REQUESTED', error: null, configurations: [],
    })),
    ...over,
  };
}
