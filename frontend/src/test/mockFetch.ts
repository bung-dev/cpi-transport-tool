import { vi } from 'vitest';

type Handler = (init?: RequestInit) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** "METHOD /path" → 핸들러. 등록되지 않은 요청은 실제 네트워크 대신 throw 한다(REQ-010 AC-2). */
export function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const h = routes[key];
    if (!h) throw new Error(`mock 없음: ${key}`);
    return h(init);
  });
  vi.stubGlobal('fetch', fn);
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
