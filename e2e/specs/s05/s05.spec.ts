// 묶음 s05 — REQ-316 배포 실패 아티팩트가 있을 때 결과 머리 개수 (QA-188~193). qa_cases.md "REQ-316" 절 그대로.
// 앱: --profile stub --read-only false. FAILED 는 18082 의 PUT(Version=active) 400 / 생성 POST 400 임시 매핑(본문 있음)으로 만든다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addMap, after, delMap, historyOf, R, shot, stubReset } from '../../lib/qa';
import { confirmDialogRun, foreignHosts, modeRadio, openTab, openTransport, previewBtn, realBtn, resultRegion, waitTransport, watch } from '../../lib/ui';
import { filterSwitch, flat, headStats, openAllCards, putMapping } from '../../lib/r2';

test.use({ actionTimeout: 20000 });

test.afterEach(async ({ request }) => {
  await after(request);
});

const failPut = (request: APIRequestContext) => addMap(request, 18082, putMapping(400, 'bad'));
const failCreate = (request: APIRequestContext) =>
  addMap(request, 18082, { priority: 1, request: { method: 'POST', urlPath: '/api/v1/IntegrationDesigntimeArtifacts' }, response: { status: 400, body: 'bad', headers: { 'Content-Type': 'text/plain' } } });

/** 화면에서 PkgTransportDemo 의 두 아티팩트(모두)를 실제 이관 */
async function runRealUi(page: Page, request: APIRequestContext) {
  await stubReset(request);
  await openTransport(page);
  await page.getByRole('list', { name: '패키지 목록' }).getByRole('radio', { name: /PkgTransportDemo/ }).first().check();
  await expect(page.getByRole('list', { name: '아티팩트 목록' })).toBeVisible();
  await page.getByRole('button', { name: '전체 선택', exact: true }).click();
  await modeRadio(page, '실제 이관').check();
  await realBtn(page, 'PRD').click();
  const out = await confirmDialogRun(page);
  await expect(resultRegion(page).first()).toBeVisible();
  await page.waitForTimeout(300);
  return out;
}
const statuses = (body: any) => (body?.results ?? []).map((r: any) => `${r.artifactId}:${r.status}`);
const failedCount = (body: any) => (body?.results ?? []).filter((r: any) => r.status === 'FAILED').length;

test('QA-188: 부분 실패(성공 1·실패 1) - 실패 개수 표시', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-188');
  const w = watch(page);
  rec.startHistory = (await historyOf(request)).length;
  const id = await failPut(request);
  const out = await runRealUi(page, request);
  rec.api = { http: out.status, statuses: statuses(out.body), summary: out.body?.summary, transportId: out.body?.transportId };
  rec.head = await headStats(page);
  await shot(page, 'QA-188-1280');
  expect(failedCount(out.body), '준비된 상태: FAILED 정확히 1').toBe(1);
  expect(rec.head.tileValue, '"실패" 타일 값 1').toBe('1');
  expect(rec.head.failArtifactsTexts, '"실패 아티팩트 1개" 한 번').toEqual(['실패 아티팩트 1개']);
  expect(rec.head.failArtifactsM, 'M = 타일 값').toBe(Number(rec.head.tileValue));
  expect(rec.head.sameParentAsProblem || rec.head.ancestorContainsSwitchLabel, '"치환 문제 N건" 옆(같은 필터 영역)').toBeTruthy();
  expect(rec.head.ancestorContainsStatTiles, '통계 타일 영역과 다른 곳').toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  rec.info390 = { pageOverflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), head: await headStats(page) };
  await shot(page, 'QA-188-390');
  await page.setViewportSize({ width: 1280, height: 900 });
  await delMap(request, 18082, id);
  rec.pageerrors = w.errors;
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

test('QA-189: 전부 실패(M=2) - 타일과 같은 값', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-189');
  const a = await failPut(request);
  const b = await failCreate(request);
  const out = await runRealUi(page, request);
  rec.api = { http: out.status, statuses: statuses(out.body), summary: out.body?.summary, transportId: out.body?.transportId };
  rec.head = await headStats(page);
  await shot(page, 'QA-189-1280');
  expect(failedCount(out.body), '준비된 상태: FAILED 2').toBe(2);
  expect(rec.head.tileValue).toBe('2');
  expect(rec.head.failArtifactsTexts, '정확히 "실패 아티팩트 2개"').toEqual(['실패 아티팩트 2개']);
  expect(rec.head.failArtifactsM).toBe(Number(rec.head.tileValue));
  await delMap(request, 18082, a);
  await delMap(request, 18082, b);
});

test('QA-190: 실패 없음(M=0) - 보이지 않음, 실패 뒤 성공 재실행에서 사라짐', async ({ page, request }) => {
  test.setTimeout(300000);
  const rec = R('QA-190');
  const noFail = async (label: string) => {
    const t = flat(await resultRegion(page).first().innerText());
    const dom = await page.evaluate(() => document.documentElement.outerHTML.includes('실패 아티팩트'));
    return { label, regionHasText: t.includes('실패 아티팩트'), domHasText: dom, problemText: (t.match(/치환 문제 \d+건/) ?? [null])[0] };
  };
  // 1. 정상
  const o1 = await runRealUi(page, request);
  rec.step1 = { ...(await noFail('정상')), failed: failedCount(o1.body), tile: (await headStats(page)).tileValue, transportId: o1.body?.transportId };
  await shot(page, 'QA-190-1-normal');
  expect(rec.step1.failed).toBe(0);
  expect(rec.step1.problemText, '치환 문제 N건은 보임').toBeTruthy();
  expect(rec.step1.domHasText, 'M=0: "실패 아티팩트" DOM 어디에도 없음').toBe(false);
  // 2. 실패
  const id = await failPut(request);
  const o2 = await (async () => {
    await stubReset(request);
    await modeRadio(page, '실제 이관').check();
    await realBtn(page, 'PRD').click();
    return confirmDialogRun(page);
  })();
  await page.waitForTimeout(300);
  rec.step2 = { failed: failedCount(o2.body), head: await headStats(page), transportId: o2.body?.transportId };
  await shot(page, 'QA-190-2-failed');
  expect(rec.step2.failed).toBeGreaterThanOrEqual(1);
  expect(rec.step2.head.failArtifactsM, '실패 실행: 보임').toBe(rec.step2.failed);
  // 3. 매핑 삭제 + 초기화 뒤 같은 이관을 다시 (새로고침 없이 연속)
  await delMap(request, 18082, id);
  await stubReset(request);
  await modeRadio(page, '실제 이관').check();
  await realBtn(page, 'PRD').click();
  const o3 = await confirmDialogRun(page);
  await page.waitForTimeout(300);
  rec.step3 = { ...(await noFail('성공 재실행')), failed: failedCount(o3.body), transportId: o3.body?.transportId };
  await shot(page, 'QA-190-3-rerun-ok');
  expect(rec.step3.failed).toBe(0);
  expect(rec.step3.domHasText, '이전 결과의 잔상 없음(실패 아티팩트 텍스트 사라짐)').toBe(false);
  expect(rec.step3.problemText).toBeTruthy();
  // 5. 새로고침 후 이력 상세 세 행(0, M, 0)
  await page.reload();
  await openTab(page, '이력');
  rec.step5 = [];
  for (const [nm, t, expectM] of [['정상', o1.body.transportId, null], ['실패', o2.body.transportId, rec.step2.failed], ['성공 재실행', o3.body.transportId, null]] as Array<[string, string, number | null]>) {
    await page.getByRole('button', { name: t, exact: true }).click();
    await expect(resultRegion(page).first()).toBeVisible();
    const h = await headStats(page);
    const dom = await page.evaluate(() => document.documentElement.outerHTML.includes('실패 아티팩트'));
    rec.step5.push({ name: nm, transportId: t, head: h, domHas: dom });
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
    if (expectM === null) expect.soft(dom, `${nm}: 이력 상세에 실패 아티팩트 없음`).toBe(false);
    else expect.soft(h.failArtifactsM, `${nm}: 이력 상세 M`).toBe(expectM);
  }
  await shot(page, 'QA-190-5-history-detail');
});

test('QA-191: 미리보기 FAILED도 같은 규칙', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-191');
  const id = await addMap(request, 18081, {
    priority: 1,
    request: { method: 'GET', urlPath: "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order_Sync',Version='active')/$value" },
    response: { status: 500, body: 'download fail', headers: { 'Content-Type': 'text/plain' } },
  });
  await stubReset(request);
  await openTransport(page);
  await page.getByRole('list', { name: '패키지 목록' }).getByRole('radio', { name: /PkgTransportDemo/ }).first().check();
  await expect(page.getByRole('list', { name: '아티팩트 목록' })).toBeVisible();
  await page.getByRole('button', { name: '전체 선택', exact: true }).click();
  const out = await waitTransport(page, async () => {
    await previewBtn(page).click();
  });
  await expect(resultRegion(page).first()).toBeVisible();
  await page.waitForTimeout(300);
  const head = await headStats(page);
  rec.api = { http: out.status, statuses: statuses(out.body), codes: (out.body?.results ?? []).map((r: any) => `${r.artifactId}:${r.error?.code ?? ''}`), request: out.postData };
  rec.head = head;
  await shot(page, 'QA-191-preview-failed');
  const fc = failedCount(out.body);
  rec.failedStatusCount = fc;
  if (fc > 0) {
    expect(head.tileValue).toBe(String(fc));
    expect(head.failArtifactsM, 'M = 타일 값').toBe(fc);
  } else {
    rec.note = 'status=FAILED 가 나오지 않음: 상태 기록. FAILED 가 아닌 결과에는 텍스트가 없어야 함';
    expect(head.failArtifactsTexts, 'FAILED 가 없으면 실패 아티팩트 텍스트 없음').toEqual([]);
  }
  await delMap(request, 18081, id);
});

test('QA-192: "문제 항목 N건"의 N과 스위치 동작 유지', async ({ page, request }) => {
  test.setTimeout(300000);
  const rec = R('QA-192');
  rec.runs = [];
  const visibleCards = async () => {
    const loc = resultRegion(page).first().getByText(/^IF_(Order_Sync|Customer_Push)$/);
    let n = 0;
    for (let i = 0; i < (await loc.count()); i++) if (await loc.nth(i).isVisible()) n++;
    return n;
  };
  const scenarios: Array<[string, () => Promise<string[]>]> = [
    ['가-정상', async () => []],
    ['나-IF_Order_Sync 실패', async () => [await failPut(request)]],
    ['다-둘 다 실패', async () => [await failPut(request), await failCreate(request)]],
  ];
  const ids: string[] = [];
  for (const [name, setup] of scenarios) {
    const maps = await setup();
    const out = await runRealUi(page, request);
    const head0 = await headStats(page);
    const sw = filterSwitch(page);
    const off1 = await visibleCards();
    const swKind = await sw.count();
    await sw.check().catch(async () => sw.click());
    await page.waitForTimeout(200);
    const onState = { visible: await visibleCards(), checked: await sw.isChecked().catch(() => null), failedCardsVisible: (await resultRegion(page).first().innerText()).includes('FAILED') };
    await sw.uncheck().catch(async () => sw.click());
    await page.waitForTimeout(200);
    const off2 = await visibleCards();
    const perArtifact = (out.body?.results ?? []).map((r: any) => ({ id: r.artifactId, status: r.status, action: r.action, replacements: (r.replacements ?? []).length, unmappedKeys: (r.unmappedKeys ?? []).length, errorCode: r.error?.code ?? null }));
    const row = { name, statuses: statuses(out.body), perArtifact, N: head0.problemN, M: head0.failArtifactsM, switchControls: swKind, cardsOff: off1, switchOn: onState, cardsOffAgain: off2 };
    rec.runs.push(row);
    await shot(page, `QA-192-${name.slice(0, 1)}`);
    expect.soft(off2, `${name}: 스위치 off 로 되돌리면 카드 수 복귀`).toBe(off1);
    for (const m of maps) await delMap(request, 18082, m);
    ids.push(...maps);
  }
  const ns = rec.runs.map((r: any) => r.N);
  rec.nValues = ns;
  rec.nDiffers = new Set(ns).size > 1;
  if (rec.nDiffers) rec.note = 'FAILED 때문에 N 이 달라짐: FAIL 이 아니라 원인 기록·NEEDS_DECISION 보고 대상(qa_cases QA-192)';
  // qa_cases QA-192: FAILED 때문에 N 이 달라지는 것은 FAIL 이 아니라 원인 기록·NEEDS_DECISION 보고. 판정하는 것은 "N 이 FAILED 개수 때문에 늘지 않는다"(ADR-014).
  for (const r of rec.runs.slice(1)) expect.soft(r.N, `${r.name}: N 이 정상 실행의 N(${ns[0]})보다 늘지 않음`).toBeLessThanOrEqual(ns[0]);
  for (const r of rec.runs.slice(1)) expect.soft(r.switchOn.failedCardsVisible, `${r.name}: 스위치 on 에서 FAILED 카드가 보임`).toBe(true);
});

test('QA-193: 이력 상세 화면에서 같은 표시', async ({ page, request }) => {
  test.setTimeout(300000);
  const rec = R('QA-193');
  // 앞 케이스(188·189·190)의 이력이 쌓여 있다. 여기서는 M=1, M=2, M=0 을 새로 만들어 확실히 비교한다.
  rec.rows = [];
  const mk = async (name: string, maps: string[]) => {
    const out = await runRealUi(page, request);
    const live = await headStats(page);
    for (const m of maps) await delMap(request, 18082, m);
    return { name, transportId: out.body.transportId as string, failed: failedCount(out.body), live };
  };
  const made = [await mk('M=1', [await failPut(request)]), await mk('M=2', [await failPut(request), await failCreate(request)]), await mk('M=0', [])];
  await page.reload();
  await openTab(page, '이력');
  for (const m of made) {
    await page.getByRole('button', { name: m.transportId, exact: true }).click();
    await expect(resultRegion(page).first()).toBeVisible();
    const h = await headStats(page);
    const dom = await page.evaluate(() => document.documentElement.outerHTML.includes('실패 아티팩트'));
    rec.rows.push({ name: m.name, transportId: m.transportId, failedInApi: m.failed, liveAfterRun: { tile: m.live.tileValue, M: m.live.failArtifactsM, N: m.live.problemN }, historyDetail: h, domHas: dom });
    await shot(page, `QA-193-${m.name.replace('=', '')}`);
    expect.soft(h.tileValue, `${m.name}: 이력 상세 실패 타일`).toBe(String(m.failed));
    if (m.failed > 0) {
      expect.soft(h.failArtifactsM, `${m.name}: M`).toBe(m.failed);
      expect.soft(h.ancestorContainsSwitchLabel || h.sameParentAsProblem, `${m.name}: 문제 항목 옆`).toBeTruthy();
      expect.soft(h.failArtifactsM, `${m.name}: 실행 직후 화면과 같은 M`).toBe(m.live.failArtifactsM);
    } else {
      expect.soft(dom, `${m.name}: M=0 에는 없음`).toBe(false);
    }
    expect.soft(h.problemN, `${m.name}: 실행 직후와 같은 N`).toBe(m.live.problemN);
    await openAllCards(page);
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
  }
  const hist = await historyOf(request);
  rec.historyCount = hist.length;
});
