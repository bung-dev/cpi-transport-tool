// 묶음 s02 — REQ-311 AC-1·AC-2 번들 다운로드 요청의 명시적 Accept (QA-150~155). qa_cases.md "REQ-311" 절 그대로.
// 앱: --profile stub --read-only false. 브라우저 페이지를 열지 않고 request 픽스처(API)로만 동작한다.
import { expect, test } from '@playwright/test';
import { acceptOf, addMap, after, app, BUNDLE_ACCEPT, call, headerOf, historyOf, JSON_ACCEPT, R, stubCount, stubFind, stubReset, STUB } from '../../lib/qa';

test.afterEach(async ({ request }) => {
  await after(request);
});

const VALUE_RE = '.*\\$value';
const dec = (u: string) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};
const row = (port: number, q: any) => ({ port, method: q.method, url: dec(q.url), accept: acceptOf(q), csrf: headerOf(q, 'X-CSRF-Token') });
async function bundleGets(request: any) {
  const out: any[] = [];
  for (const port of [18081, 18082]) for (const q of await stubFind(request, port, 'GET', VALUE_RE)) if (!/ErrorInformation/.test(q.url)) out.push(row(port, q));
  return out;
}
const DRY = { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync', 'IF_Customer_Push'], dryRun: true, sourceTenantId: 'DEV', targetTenantId: 'PRD' };

test('QA-150: 미리보기(dryRun:true)의 번들 다운로드 Accept', async ({ request }) => {
  const rec = R('QA-150');
  await stubReset(request);
  const r = await app(request, 'POST', '/transport', DRY);
  rec.http = r.status;
  rec.resultSummary = r.json?.summary;
  expect(r.status).toBe(200);
  const rows = await bundleGets(request);
  rec.bundleRequests = rows;
  rec.count18082 = await stubCount(request, 18082);
  expect(rows.filter((x) => /IF_Order_Sync/.test(x.url)).length, 'IF_Order_Sync $value 요청').toBeGreaterThanOrEqual(1);
  expect(rows.filter((x) => /IF_Customer_Push/.test(x.url)).length, 'IF_Customer_Push $value 요청').toBeGreaterThanOrEqual(1);
  for (const x of rows) {
    expect(x.url, '번들 다운로드 요청 경로').toMatch(/IntegrationDesigntimeArtifacts\(Id='[^']+',Version='[^']+'\)\/\$value$/);
    expect(x.accept, `Accept 값 하나, 정확히 일치 (${x.url})`).toBe(BUNDLE_ACCEPT);
  }
  expect(rec.count18082, '미리보기이므로 대상(18082) 요청 0건').toBe(0);
});

test('QA-151: 실제 이관 경로와 반복에서 번들 요청 Accept', async ({ request }) => {
  const rec = R('QA-151');
  const h0 = (await historyOf(request)).length;
  rec.historyStart = h0;
  rec.rounds = [];
  for (let i = 1; i <= 3; i++) {
    await stubReset(request);
    const r = await app(request, 'POST', '/transport', { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync', 'IF_Customer_Push'], dryRun: false, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
    const rows = await bundleGets(request);
    rec.rounds.push({ round: i, http: r.status, actions: (r.json?.results ?? []).map((x: any) => `${x.artifactId}:${x.status}:${x.action}`), bundleRequests: rows });
    expect(r.status, `${i}회 HTTP`).toBe(200);
    expect(rows.length, `${i}회 번들 다운로드 요청 1건 이상`).toBeGreaterThanOrEqual(1);
    for (const x of rows) expect(x.accept, `${i}회 Accept (${x.url})`).toBe(BUNDLE_ACCEPT);
  }
  const h1 = (await historyOf(request)).length;
  rec.historyEnd = h1;
  expect(h1, '이력 건수 +3').toBe(h0 + 3);
});

test('QA-152: JSON 조회 요청의 Accept', async ({ request }) => {
  const rec = R('QA-152');
  await stubReset(request);
  const calls: any[] = [];
  for (const [m, p, b] of [
    ['GET', '/packages?tenantId=DEV', undefined],
    ['GET', '/packages/PkgTransportDemo/artifacts?tenantId=DEV', undefined],
    ['GET', '/tenants/status?refresh=true', undefined],
    ['POST', '/transport', DRY],
  ] as const) {
    const r = await app(request, m as any, p, b);
    calls.push({ m, p, http: r.status });
    expect(r.status, `${m} ${p}`).toBe(200);
  }
  rec.calls = calls;
  const gets: any[] = [];
  for (const port of [18081, 18082]) for (const q of await stubFind(request, port, 'GET', '.*')) gets.push(row(port, q));
  const jsonGets = gets.filter((x) => !/\$value$/.test(x.url));
  rec.allGets = jsonGets;
  rec.errorInformationRequests = jsonGets.filter((x) => /ErrorInformation/.test(x.url)).length;
  const ambiguous = jsonGets.filter((x) => /\$top=1/.test(x.url) || String(x.csrf ?? '').toLowerCase() === 'fetch');
  const classified = jsonGets.filter((x) => !ambiguous.includes(x));
  rec.classifiedCount = classified.length;
  rec.ambiguous = ambiguous;
  const notes: string[] = [];
  for (const x of ambiguous) {
    if (x.accept === null || (typeof x.accept === 'string' && x.accept.trim() === '')) notes.push(`FAIL 후보: Accept 없음 ${x.url}`);
    else if (x.accept !== JSON_ACCEPT) notes.push(`NEEDS_DECISION: Accept=${JSON.stringify(x.accept)} (${x.url})`);
  }
  rec.ambiguousNotes = notes;
  expect(jsonGets.length, 'JSON 조회 GET 1건 이상').toBeGreaterThan(0);
  expect(rec.errorInformationRequests, 'ErrorInformation 요청은 이 케이스에서 일어나지 않음').toBe(0);
  for (const x of jsonGets) expect(x.accept === null || (typeof x.accept === 'string' && x.accept.trim() === ''), `어떤 GET도 Accept 가 비어 있거나 없지 않다 (${x.url})`).toBe(false);
  for (const x of classified) expect(x.accept, `Accept 정확히 application/json (${x.url})`).toBe(JSON_ACCEPT);
  expect(notes.filter((n) => n.startsWith('FAIL')), '분류 모호한 GET 의 Accept 없음').toEqual([]);
});

test('QA-153: 다음 페이지(__next) 요청의 Accept', async ({ request }) => {
  const rec = R('QA-153');
  const json = { 'Content-Type': 'application/json' };
  const idA = await addMap(request, 18081, {
    priority: 1,
    request: { method: 'GET', urlPath: '/api/v1/IntegrationPackages', queryParameters: { $skiptoken: { absent: true } } },
    response: { status: 200, jsonBody: { d: { results: [{ Id: 'PkgPage1', Name: 'Page One', Version: '1.0.0' }], __next: 'IntegrationPackages?$skiptoken=2' } }, headers: json },
  });
  const idB = await addMap(request, 18081, {
    priority: 1,
    request: { method: 'GET', urlPath: '/api/v1/IntegrationPackages', queryParameters: { $skiptoken: { equalTo: '2' } } },
    response: { status: 200, jsonBody: { d: { results: [{ Id: 'PkgPage2', Name: 'Page Two', Version: '1.0.0' }] } }, headers: json },
  });
  rec.tempMappings = [idA, idB];
  await stubReset(request);
  const r = await app(request, 'GET', '/packages?tenantId=DEV');
  rec.http = r.status;
  rec.appResponse = r.json;
  const reqs = (await stubFind(request, 18081, 'GET', '/api/v1/IntegrationPackages')).map((q) => row(18081, q));
  rec.packageListRequests = reqs;
  const ids = (r.json ?? []).map((p: any) => p.id);
  expect(r.status).toBe(200);
  expect(ids, '두 페이지 합쳐 돌려줌').toEqual(expect.arrayContaining(['PkgPage1', 'PkgPage2']));
  expect(reqs.some((x) => /skiptoken=2/.test(x.url)), '두 번째 요청이 __next(상대 경로)를 따라감').toBe(true);
  expect(reqs.length, '첫 페이지와 다음 페이지 두 건').toBeGreaterThanOrEqual(2);
  for (const x of reqs) expect(x.accept, `Accept 정확히 application/json (${x.url})`).toBe(JSON_ACCEPT);
  // 매핑 삭제 확인
  for (const id of [idA, idB]) await call(request, 'DELETE', `${STUB[18081]}/__admin/mappings/${id}`);
  const again = await app(request, 'GET', '/packages?tenantId=DEV');
  rec.afterDeleteIds = (again.json ?? []).map((p: any) => p.id);
  expect(rec.afterDeleteIds).toEqual(['PkgTransportDemo', 'PkgFaultDemo', 'PkgNotInPrd', 'PkgCreateFail']);
});

test('QA-154: 배포 오류 상세(ErrorInformation/$value) 요청 헤더 비변경', async ({ request }) => {
  const rec = R('QA-154');
  rec.appStatus = 'app-status 는 별도 command 로 확인(배포 대기 인자 stub 프로필 기본)';
  const idA = await addMap(request, 18082, {
    priority: 1,
    request: { method: 'GET', urlPath: "/api/v1/IntegrationRuntimeArtifacts('IF_Order_Sync')" },
    response: { status: 200, body: '{"d":{"Id":"IF_Order_Sync","Status":"ERROR"}}', headers: { 'Content-Type': 'application/json' } },
  });
  const idB = await addMap(request, 18082, {
    priority: 1,
    request: { method: 'GET', urlPath: "/api/v1/IntegrationRuntimeArtifacts('IF_Order_Sync')/ErrorInformation/$value" },
    response: { status: 200, body: 'qa-error-detail', headers: { 'Content-Type': 'text/plain' } },
  });
  rec.tempMappings = [idA, idB];
  await stubReset(request);
  const r = await app(request, 'POST', '/transport', { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: false, deploy: true, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
  rec.http = r.status;
  const res = (r.json?.results ?? []).find((x: any) => x.artifactId === 'IF_Order_Sync');
  rec.result = res ? { status: res.status, action: res.action, deployStatus: res.deployStatus, error: res.error } : null;
  const errReqs = (await stubFind(request, 18082, 'GET', '.*ErrorInformation.*')).map((q) => row(18082, q));
  const bundle = await bundleGets(request);
  rec.errorInformationRequests = errReqs;
  rec.bundleRequests = bundle;
  const errAccept = errReqs[0]?.accept ?? null;
  rec.observedErrorInformationAccept = errAccept;
  rec.sameAsBundle = errAccept === BUNDLE_ACCEPT;
  expect(r.status).toBe(200);
  expect(res?.status, 'IF_Order_Sync FAILED').toBe('FAILED');
  expect(res?.error?.code, 'DEPLOY_FAILED').toBe('DEPLOY_FAILED');
  expect(errReqs.length, 'ErrorInformation/$value 요청 정확히 1회').toBe(1);
  expect(errAccept, '배포 오류 상세 요청의 Accept 는 번들 기준값으로 바뀌지 않았다').not.toBe(BUNDLE_ACCEPT);
  expect(bundle.length).toBeGreaterThanOrEqual(1);
  for (const x of bundle) expect(x.accept).toBe(BUNDLE_ACCEPT);
});

test('QA-155: 규칙 밖 ID는 CPI 요청 없이 거절', async ({ request }) => {
  const rec = R('QA-155');
  rec.calls = [];
  const bad: Array<[string, any]> = [
    ["artifact x' OR '1'='1", { packageId: 'PkgTransportDemo', artifactIds: ["x' OR '1'='1"] }],
    ['artifact ../../etc/passwd', { packageId: 'PkgTransportDemo', artifactIds: ['../../etc/passwd'] }],
    ['artifact IF_Order_Sync)/$value?x=(', { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync)/$value?x=('] }],
    ['artifact empty string', { packageId: 'PkgTransportDemo', artifactIds: [''] }],
    ['artifact 101 chars', { packageId: 'PkgTransportDemo', artifactIds: ['A'.repeat(101)] }],
    ['package PkgTransportDemo/../..', { packageId: 'PkgTransportDemo/../..', artifactIds: ['IF_Order_Sync'] }],
    ['package "a b"', { packageId: 'a b', artifactIds: ['IF_Order_Sync'] }],
  ];
  for (const [label, part] of bad) {
    await stubReset(request);
    const r = await app(request, 'POST', '/transport', { ...part, dryRun: true, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
    const v1 = await stubCount(request, 18081, 'GET', VALUE_RE);
    const v2 = await stubCount(request, 18082, 'GET', VALUE_RE);
    const a1 = await stubCount(request, 18081);
    const a2 = await stubCount(request, 18082);
    rec.calls.push({ label, http: r.status, error: r.json?.error, message: r.json?.message, valueGets18081: v1, valueGets18082: v2, allRequests18081: a1, allRequests18082: a2 });
    expect(r.status, `${label}: 400`).toBe(400);
    expect(r.json?.error, `${label}: INVALID_REQUEST`).toBe('INVALID_REQUEST');
    expect(v1 + v2, `${label}: 번들 다운로드 요청 0건`).toBe(0);
  }
  const alive = await app(request, 'GET', '/transport/history');
  rec.appAliveAfter = alive.status;
  expect(alive.status, '앱이 죽거나 5xx 가 아님').toBe(200);
});
