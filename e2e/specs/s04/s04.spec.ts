// 묶음 s04 — REQ-315 갱신 거절(400, 본문 없음) 때 편집 락 가능성 안내 (QA-177~186). qa_cases.md "REQ-315" 절 그대로.
// 앱: --profile stub --read-only false. 갱신 400 은 18082 의 임시 매핑(H-4)으로 만든다.
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { addMap, after, call, delMap, historyFile, historyOf, R, shot, stubReset, writeText } from '../../lib/qa';
import { foreignHosts, openTab, openTransport, realFlow, resultRegion, watch } from '../../lib/ui';
import { countOf, NOTICE, openAllCards, putCount, putMapping, resultText, stubAll, xport } from '../../lib/r2';

test.afterEach(async ({ request }) => {
  await after(request);
});

const msgOf = (res: any, i = 0): string => String(res.json?.results?.[i]?.error?.message ?? '');
const brief = (res: any) => ({
  http: res.status,
  results: (res.json?.results ?? []).map((r: any) => ({ id: r.artifactId, status: r.status, code: r.error?.code ?? null, message: r.error?.message ?? null })),
});
const dec = (u: string) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

test('QA-177: 400 빈 본문 - 아티팩트 FAILED 와 안내 (API 와 화면)', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-177');
  // 기준 흐름(관찰값): 임시 매핑 없이 실제 이관 1회
  await stubReset(request);
  const baseline = await xport(request);
  rec.baseline = brief(baseline);
  rec.baselineStub18082 = (await stubAll(request, 18082)).filter((q) => !q.url.startsWith('/oauth/token'));
  await stubReset(request);
  const id = await addMap(request, 18082, putMapping(400, undefined));
  rec.mappingId = id;
  await stubReset(request);
  const api = await xport(request);
  rec.api = brief(api);
  expect(api.status, 'HTTP 200 (요청 단위 오류 아님)').toBe(200);
  expect(api.json.results[0].status).toBe('FAILED');
  expect(msgOf(api), 'API error.message 에 안내 문구').toContain(NOTICE);
  rec.putCountApi = await putCount(request);
  expect(rec.putCountApi, 'PUT …Version=active 18082 에 1건').toBe(1);
  // 화면
  await stubReset(request);
  const w = watch(page);
  await openTransport(page);
  // S3b(REQ-423): 화면의 실제 이관은 미리보기 뒤 "이 구성으로 실제 이관" → 확인창. 미리보기는 대상에 요청하지 않아 PUT 수는 그대로다.
  const { real: ui } = await realFlow(page, { artifacts: ['IF_Order_Sync'] });
  rec.selectedArtifacts = ui.postData?.packages?.[0]?.artifactIds;
  expect(rec.selectedArtifacts, '고른 아티팩트 IF_Order_Sync 하나').toEqual(['IF_Order_Sync']);
  rec.ui = { http: ui.status, request: ui.postData, results: brief({ status: ui.status, json: ui.body }).results };
  expect(ui.status).toBe(200);
  await expect(resultRegion(page).first()).toBeVisible();
  await openAllCards(page);
  const txt = await resultText(page);
  rec.uiResultTextContainsNotice = txt.includes(NOTICE);
  rec.uiNoticeVisible = await page.getByText(NOTICE, { exact: false }).first().isVisible().catch(() => false);
  rec.putCountUi = await putCount(request);
  await shot(page, 'QA-177-result');
  expect(rec.uiNoticeVisible, '화면 결과 카드에 같은 안내가 보임').toBe(true);
  expect(rec.putCountUi, 'UI 흐름에서도 PUT 1건').toBe(1);
  rec.pageerrors = w.errors;
  rec.nonLocalRequests = foreignHosts(w);
  await delMap(request, 18082, id);
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

test('QA-178: 400 본문이 공백뿐인 경우', async ({ request }) => {
  const rec = R('QA-178');
  const variants: Array<[string, string, boolean]> = [
    ['공백 한 칸', ' ', true],
    ['공백 여러 칸', '     ', true],
    ['개행', '\n', true],
    ['탭과 개행', '\t\r\n', true],
    ['전각 공백(U+3000, 기록만)', '　', false],
  ];
  rec.variants = [];
  for (const [name, body, judged] of variants) {
    const id = await addMap(request, 18082, putMapping(400, body));
    await stubReset(request);
    const r = await xport(request);
    const m = msgOf(r);
    rec.variants.push({ name, judged, ...brief(r).results[0], noticeCount: countOf(m, NOTICE) });
    if (judged) {
      expect.soft(r.json.results[0].status, `${name}: FAILED`).toBe('FAILED');
      expect.soft(m, `${name}: 안내 포함`).toContain(NOTICE);
    }
    await delMap(request, 18082, id);
  }
});

test('QA-179: 400이지만 본문이 있는 경우 - 안내 없음', async ({ request }) => {
  const rec = R('QA-179');
  const variants: Array<[string, string, string]> = [
    ['한 글자 x', 'x', 'text/plain'],
    ['JSON', '{"error":{"message":{"value":"bad"}}}', 'application/json'],
    ['HTML', '<html><body>locked</body></html>', 'text/html'],
    ['0', '0', 'text/plain'],
  ];
  rec.variants = [];
  for (const [name, body, ct] of variants) {
    const id = await addMap(request, 18082, putMapping(400, body, { 'Content-Type': ct }));
    await stubReset(request);
    const r = await xport(request);
    const m = msgOf(r);
    rec.variants.push({ name, ...brief(r).results[0], rawBodyEchoed: m.includes(body) });
    expect.soft(r.json.results[0].status, `${name}: FAILED`).toBe('FAILED');
    expect.soft(countOf(m, NOTICE), `${name}: error.message 에 안내 없음 (message=${m})`).toBe(0);
    await delMap(request, 18082, id);
  }
  const echoed = rec.variants.filter((v: any) => v.rawBodyEchoed && v.name !== '0' && v.name !== '한 글자 x');
  rec.note_bodyEchoObservation = echoed.length ? 'CPI 본문 원문이 message 에 그대로 노출됨(기록만)' : 'CPI 본문 원문 노출 없음(길이 1 변형 제외)';
});

test('QA-180: 생성(POST) 단계의 400 빈 본문 - 안내 없음', async ({ request }) => {
  const rec = R('QA-180');
  const id = await addMap(request, 18082, { priority: 1, request: { method: 'POST', urlPath: '/api/v1/IntegrationDesigntimeArtifacts' }, response: { status: 400 } });
  await stubReset(request);
  const r = await xport(request, { artifactIds: ['IF_Customer_Push'] });
  rec.result = brief(r);
  const reqs = (await stubAll(request, 18082)).filter((q) => !q.url.startsWith('/oauth/token'));
  rec.stub18082 = reqs;
  rec.createPostCount = reqs.filter((q) => q.method === 'POST' && q.url.split('?')[0] === '/api/v1/IntegrationDesigntimeArtifacts').length;
  expect(r.json.results[0].status).toBe('FAILED');
  expect(countOf(msgOf(r), NOTICE), '안내 문구 없음').toBe(0);
  expect(rec.createPostCount, '생성 POST 기록').toBeGreaterThanOrEqual(1);
  await delMap(request, 18082, id);
});

test('QA-181: 실제 이관은 Configurations PUT을 보내지 않고 잠금 안내도 없다(20261119 REQ-701, 구성 값은 iFlow와 함께 옮겨짐)', async ({ request }) => {
  const rec = R('QA-181');
  // 예전 QA-181은 "Configurations PUT 400 빈 본문이면 안내 없음"이었다. REQ-701로 구성 값 PUT 자체가 없어졌으므로
  // 그 단계가 실제 이관에 없음을 확인한다(사람 승인 2026-11-19).
  await stubReset(request);
  const r = await xport(request, { artifactIds: ['IF_Order_Sync', 'IF_Customer_Push'] });
  rec.result = brief(r);
  rec.stub18082 = (await stubAll(request, 18082)).filter((q) => !q.url.startsWith('/oauth/token'));
  expect(r.status).toBe(200);
  expect(r.json.results.map((x: any) => x.status)).toEqual(['SUCCESS', 'SUCCESS']);
  expect(r.json.results.flatMap((x: any) => x.configurations.map((c: any) => c.status)).every((s: string) => s === 'BUNDLED'), '구성 값은 모두 BUNDLED').toBe(true);
  expect(rec.stub18082.filter((q: any) => q.method === 'PUT' && /Configurations/.test(dec(q.url))), 'Configurations PUT 0회').toEqual([]);
  expect(countOf(msgOf(r), NOTICE), '안내 문구 없음').toBe(0);
});

test('QA-182: DEPLOY 단계 400 빈 본문 - 안내 없음', async ({ request }) => {
  const rec = R('QA-182');
  await stubReset(request);
  const base = await xport(request, { deploy: true });
  const baseReqs = (await stubAll(request, 18082)).filter((q) => !q.url.startsWith('/oauth/token'));
  rec.baselineResult = brief(base);
  rec.baselineStub18082 = baseReqs;
  const dep = baseReqs.find((q) => /Deploy/i.test(dec(q.url)));
  expect(dep, '배포 요청이 기준 흐름 기록에 있음').toBeTruthy();
  rec.deployPath = dec(dep!.url);
  const id = await addMap(request, 18082, { priority: 1, request: { method: dep!.method, urlPathPattern: '.*Deploy.*' }, response: { status: 400 } });
  await stubReset(request);
  const r = await xport(request, { deploy: true });
  rec.result = brief(r);
  rec.stub18082 = (await stubAll(request, 18082)).filter((q) => !q.url.startsWith('/oauth/token'));
  expect(r.json.results[0].status).toBe('FAILED');
  expect(countOf(msgOf(r), NOTICE), '안내 문구 없음').toBe(0);
  expect(rec.stub18082.some((q: any) => /Deploy/i.test(dec(q.url))), '배포 요청이 매핑에 닿음').toBe(true);
  await delMap(request, 18082, id);
});

test('QA-183: 400이 아닌 상태 코드 - 안내 없음', async ({ request }) => {
  const rec = R('QA-183');
  rec.statuses = [];
  for (const st of [401, 403, 404, 409, 422, 500, 502, 503]) {
    const id = await addMap(request, 18082, putMapping(st, undefined));
    await stubReset(request);
    const r = await xport(request);
    const all = await stubAll(request, 18082);
    rec.statuses.push({
      stubStatus: st,
      ...brief(r).results[0],
      http: r.status,
      putCount: await putCount(request),
      tokenRequests: all.filter((q) => q.url.startsWith('/oauth/token')).length,
      requestCount: all.filter((q) => !q.url.startsWith('/oauth/token')).length,
    });
    expect.soft(countOf(msgOf(r), NOTICE), `${st}: 안내 문구 없음 (message=${msgOf(r)})`).toBe(0);
    await delMap(request, 18082, id);
  }
});

test('QA-184: 이력에 저장된 같은 결과와 이력 상세 화면', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-184');
  const n0 = (await historyOf(request)).length;
  const id = await addMap(request, 18082, putMapping(400, undefined));
  await stubReset(request);
  const r = await xport(request);
  const tid: string = r.json.transportId;
  rec.transportId = tid;
  expect(msgOf(r)).toContain(NOTICE);
  const hist = await historyOf(request);
  const row = hist.find((h: any) => h.transportId === tid);
  rec.historyApi = { count: hist.length, n0, message: row?.results?.[0]?.error?.message };
  expect(row?.results?.[0]?.error?.message, '이력 API 의 안내').toContain(NOTICE);
  expect(hist.length, '이력 건수 n0+1').toBe(n0 + 1);
  const lines = fs.readFileSync(historyFile(), 'utf8').split(/\r?\n/).filter(Boolean);
  const line = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .find((o) => o?.transportId === tid);
  rec.historyFile = { file: historyFile().split(/[\\/]/).pop(), lineFound: !!line, noticeInLine: String(line?.results?.[0]?.error?.message ?? '').includes(NOTICE) };
  expect(rec.historyFile.noticeInLine, '이력 파일 줄의 안내').toBe(true);
  const w = watch(page);
  await page.goto('/');
  await openTab(page, '이력');
  await page.getByRole('button', { name: tid, exact: true }).click();
  await expect(resultRegion(page).first()).toBeVisible();
  await openAllCards(page);
  rec.detailNoticeVisible = await page.getByText(NOTICE, { exact: false }).first().isVisible().catch(() => false);
  await shot(page, 'QA-184-history-detail');
  expect(rec.detailNoticeVisible, '이력 상세 화면에 안내').toBe(true);
  await page.reload();
  await openTab(page, '이력');
  await page.getByRole('button', { name: tid, exact: true }).click();
  await openAllCards(page);
  rec.detailNoticeVisibleAfterReload = await page.getByText(NOTICE, { exact: false }).first().isVisible().catch(() => false);
  expect(rec.detailNoticeVisibleAfterReload, '새로고침 뒤에도 안내').toBe(true);
  expect(w.errors).toEqual([]);
  await delMap(request, 18082, id);
});

test('QA-185: 락 해제·다른 버전 요청 없음, 요청 수 유지', async ({ request }) => {
  const rec = R('QA-185');
  const lister = async () => {
    const out: string[] = [];
    for (const p of [18081, 18082]) for (const q of await stubAll(request, p)) out.push(`${p} ${q.method} ${dec(q.url)}`);
    return out;
  };
  const id = await addMap(request, 18082, putMapping(400, undefined));
  await stubReset(request);
  const r400 = await xport(request);
  const list400 = await lister();
  await delMap(request, 18082, id);
  await stubReset(request);
  const rOk = await xport(request);
  const listOk = await lister();
  rec.list400 = list400;
  rec.listNormal = listOk;
  rec.results = { r400: brief(r400).results, rOk: brief(rOk).results };
  const kinds = (l: string[]) => new Set(l.map((x) => x.replace(/\?.*$/, '')));
  const okKinds = kinds(listOk);
  const newKinds = [...kinds(list400)].filter((k) => !okKinds.has(k));
  rec.newKindsNotInNormal = newKinds;
  expect(newKinds, '정상 흐름에 없는 새 종류의 요청 0건').toEqual([]);
  expect(list400.filter((x) => / DELETE /.test(x)), 'DELETE 0건').toEqual([]);
  const other = list400.filter((x) => /Version='(?!active')/.test(x) && / (PUT|POST) /.test(x));
  expect(other, 'active 가 아닌 버전 PUT/POST 0건').toEqual([]);
  const puts = list400.filter((x) => x.startsWith('18082 PUT ') && /IF_Order_Sync',Version='active'\)$/.test(x));
  rec.putActiveCount = puts.length;
  expect(puts.length, "PUT Version='active' 정확히 1건").toBe(1);
  const postsOf = (l: string[]) => l.filter((x) => x.startsWith('18082 POST ') && !x.includes('/oauth/token') && x.includes('IntegrationDesigntimeArtifacts'));
  expect(postsOf(list400), '같은 아티팩트에 대한 추가 POST 없음(정상 흐름과 같은 POST 집합)').toEqual(postsOf(listOk));
});

test('QA-186: 여러 아티팩트·반복 이관에서 안내가 한 아티팩트에 한 번만', async ({ request }) => {
  const rec = R('QA-186');
  const n0 = (await historyOf(request)).length;
  const id = await addMap(request, 18082, putMapping(400, undefined));
  await stubReset(request);
  rec.runs = [];
  const tids: string[] = [];
  for (let i = 1; i <= 3; i++) {
    for (const p of [18081, 18082]) await call(request, 'DELETE', `http://localhost:${p}/__admin/requests`);
    const r = await xport(request, { artifactIds: ['IF_Order_Sync', 'IF_Customer_Push'] });
    tids.push(r.json.transportId);
    const byId = Object.fromEntries((r.json.results as any[]).map((x) => [x.artifactId, x]));
    const om = String(byId.IF_Order_Sync?.error?.message ?? '');
    const pm = String(byId.IF_Customer_Push?.error?.message ?? '');
    rec.runs.push({
      run: i,
      http: r.status,
      order: { status: byId.IF_Order_Sync?.status, noticeCount: countOf(om, NOTICE), message: om },
      push: { status: byId.IF_Customer_Push?.status, noticeCount: countOf(pm, NOTICE), message: pm || null },
    });
    expect.soft(byId.IF_Order_Sync?.status, `${i}회 IF_Order_Sync FAILED`).toBe('FAILED');
    expect.soft(countOf(om, NOTICE), `${i}회 안내 정확히 1회`).toBe(1);
    expect.soft(countOf(pm, NOTICE), `${i}회 IF_Customer_Push 에는 안내 없음`).toBe(0);
  }
  const hist = await historyOf(request);
  rec.history = {
    n0,
    now: hist.length,
    perRunNoticeCount: tids.map((t) => countOf(String(hist.find((h: any) => h.transportId === t)?.results?.find((x: any) => x.artifactId === 'IF_Order_Sync')?.error?.message ?? ''), NOTICE)),
  };
  expect(hist.length, '이력 3건 증가').toBe(n0 + 3);
  expect(rec.history.perRunNoticeCount, '이력 각 항목 안내 1회씩').toEqual([1, 1, 1]);
  writeText('QA-186-runs.txt', JSON.stringify(rec.runs, null, 2));
  await delMap(request, 18082, id);
});
