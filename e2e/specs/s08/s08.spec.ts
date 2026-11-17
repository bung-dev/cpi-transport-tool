// 묶음 s08 — 핵심 흐름 회귀 (QA-213). qa_cases.md "핵심 흐름 회귀" 절 그대로.
// 앱: --profile stub --read-only false. 대표 사용자 흐름 1~7단계(등록 → 키보드로 선택 → 미리보기 → 실제 이관 → 이력).
import { expect, test } from '@playwright/test';
import { after, app, dropTenant, findTenant, historyOf, key, R, shot, stubCount, stubReset, writeCount } from '../../lib/qa';
import {
  confirmDialogRun,
  foreignHosts,
  historyTable,
  confirmDialog,
  kbdFlow,
  openTab,
  realFromResult,
  registerViaUi,
  resultBadge,
  resultRegion,
  waitTransport,
  watch,
} from '../../lib/ui';

test.afterEach(async ({ request }) => {
  await after(request);
});

test('QA-213: 대표 사용자 흐름 1~7단계 (최종 코드)', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-213');
  const NAME = 'QA-FLOW-TGT';
  await stubReset(request);
  const n0 = (await historyOf(request)).length;
  const c0 = (await app(request, 'GET', '/tenants')).json.tenants.length;
  rec.start = { historyCount: n0, tenantCount: c0 };
  const w = watch(page);
  try {
    // 1. 테넌트 탭에서 붙여넣기로 등록 (성공 시 입력 비움)
    await page.goto('/');
    await registerViaUi(page, NAME, key(18082, '127.0.0.1'));
    // S2(REQ-412): 성공하면 서랍이 닫힌다. 다시 열어 입력이 비었는지 보고 닫는다.
    await page.getByRole('button', { name: '테넌트 등록', exact: true }).click();
    const g = page.getByRole('dialog', { name: '테넌트 등록' });
    rec.step1 = {
      nameAfter: await g.getByRole('textbox', { name: '이름' }).inputValue(),
      keyAfterLen: (await g.getByRole('textbox', { name: '서비스 키 붙여넣기' }).inputValue()).length,
      tenantsAfter: (await app(request, 'GET', '/tenants')).json.tenants.map((t: any) => t.name),
    };
    await shot(page, 'QA-213-1-registered');
    expect(rec.step1.nameAfter, '성공하면 이름 입력 비움').toBe('');
    expect(rec.step1.keyAfterLen, '성공하면 서비스 키 입력 비움').toBe(0);
    expect(rec.step1.tenantsAfter).toContain(NAME);
    await page.keyboard.press('Escape');
    await expect(g).toBeHidden();

    // 2~3. 새 이관에서 키보드만으로 "템플릿 없이 진행" → 경로 변경 창의 원본 DEV·대상 QA-FLOW-TGT → 패키지 → "다음" (포커스 판정은 kbdFlow 안에서)
    const steps = await kbdFlow(page, w, NAME);
    rec.step3_keyboard = steps;
    await shot(page, 'QA-213-3-keyboard-selected');
    expect(steps.buttonDisabled).toBe(false);

    // 4. 미리보기: Tab 으로 도달한 버튼에서 Enter
    const w0 = await writeCount(request, 18082);
    const prev = await waitTransport(page, async () => {
      await page.keyboard.press('Enter');
    });
    await expect(resultRegion(page).first()).toBeVisible();
    const w1 = await writeCount(request, 18082);
    const order = (prev.body?.results ?? []).find((r: any) => r.artifactId === 'IF_Order_Sync');
    rec.step4 = {
      http: prev.status,
      request: prev.postData,
      badge: await resultBadge(page),
      summary: prev.body?.summary,
      orderSyncReplacementCountSum: (order?.replacements ?? []).reduce((a: number, x: any) => a + (x.count ?? 0), 0),
      orderSyncReplacementRows: (order?.replacements ?? []).length,
      targetStubWriteRequests: { before: w0, after: w1 },
    };
    await shot(page, 'QA-213-4-preview-result');
    expect(prev.status).toBe(200);
    expect(prev.postData.dryRun).toBe(true);
    expect(prev.postData.targetTenantId, '대상 = 등록한 QA-FLOW-TGT 의 id').toBe((await findTenant(request, NAME)).id);
    expect(rec.step4.badge).toBe('미리보기');
    expect(w1 - w0, '미리보기는 대상 스텁에 쓰기 요청 0건').toBe(0);

    // 5. 실제 이관 (마우스 사용 가능): 결과의 "이 구성으로 실제 이관" → 확인 대화상자(대상 이름 표시) → 승인
    await realFromResult(page).click();
    const dlg = confirmDialog(page);
    await expect(dlg).toBeVisible();
    rec.step5_dialog = { name: await dlg.getAttribute('aria-labelledby'), text: (await dlg.innerText()).replace(/\s+/g, ' ') };
    await shot(page, 'QA-213-5-confirm-dialog');
    expect(rec.step5_dialog.text, '확인 대화상자에 대상 이름 표시').toContain(NAME);
    const real = await confirmDialogRun(page);
    await expect(resultRegion(page).first()).toBeVisible();

    // 6. 결과 SUCCESS 와 action
    const acts = (real.body?.results ?? []).map((r: any) => `${r.artifactId}:${r.status}:${r.action}`);
    rec.step6 = { http: real.status, request: real.postData, summary: real.body?.summary, actions: acts, transportId: real.body?.transportId, badge: await resultBadge(page) };
    await shot(page, 'QA-213-6-real-result');
    expect(real.status).toBe(200);
    expect(real.postData.dryRun).toBe(false);
    expect(real.body.summary.failed, '실패 0').toBe(0);
    for (const r of real.body.results) expect(r.status, `${r.artifactId} SUCCESS`).toBe('SUCCESS');
    expect(rec.step6.badge).toBe('실제 이관');
    const tid: string = real.body.transportId;

    // 7. 이력 탭: 방금 이관 행(원본 DEV, 대상 QA-FLOW-TGT, 모드 "실제 이관")과 상세
    await openTab(page, '이력');
    const ht = await historyTable(page);
    const idx = { src: ht.headers.indexOf('원본'), tgt: ht.headers.indexOf('대상'), mode: ht.headers.indexOf('모드'), id: ht.headers.indexOf('이관 ID') };
    const mine = ht.rows.find((r) => r[idx.id] === tid);
    rec.step7 = { headers: ht.headers, row: mine, rowCount: ht.rows.length };
    await shot(page, 'QA-213-7-history');
    expect(mine, '방금 이관 행이 이력 목록에 있음').toBeTruthy();
    expect(mine![idx.src]).toBe('DEV');
    expect(mine![idx.tgt]).toBe(NAME);
    expect(mine![idx.mode]).toBe('실제 이관');
    await page.getByRole('button', { name: tid, exact: true }).click();
    await expect(resultRegion(page).first()).toBeVisible();
    rec.step7.detail = { badge: await resultBadge(page), text: (await resultRegion(page).first().innerText()).replace(/\s+/g, ' ').slice(0, 300) };
    await shot(page, 'QA-213-7-history-detail');
    expect(rec.step7.detail.badge).toBe('실제 이관');
    expect(rec.step7.detail.text).toContain(NAME);

    // 8. 새로고침 뒤에도 같은 행, GET /transport/history 에 transportId
    await page.reload();
    await openTab(page, '이력');
    const ht2 = await historyTable(page);
    const mine2 = ht2.rows.find((r) => r[idx.id] === tid);
    const hist = await historyOf(request);
    const apiRow = hist.find((h: any) => h.transportId === tid);
    rec.step8 = { rowAfterReload: mine2, apiRow: apiRow && { dryRun: apiRow.dryRun, source: apiRow.sourceTenant?.name, target: apiRow.targetTenant?.name, deploy: apiRow.deploy }, historyCount: hist.length };
    await shot(page, 'QA-213-8-history-reloaded');
    expect(mine2, '새로고침 뒤에도 같은 행').toBeTruthy();
    expect(apiRow, 'GET /transport/history 에 transportId').toBeTruthy();
    expect(apiRow.sourceTenant.name).toBe('DEV');
    expect(apiRow.targetTenant.name).toBe(NAME);
    expect(hist.length, '이력 건수가 n0 이상 증가하고 실제 이관 행 포함').toBeGreaterThanOrEqual(n0 + 1);
    expect(hist.some((h: any) => h.dryRun === false)).toBe(true);
    rec.previewRecordedInHistory_observation = hist.some((h: any) => h.dryRun === true);
    rec.stubRequestCounts = { dev: await stubCount(request, 18081), prd: await stubCount(request, 18082) };
  } finally {
    const t = await findTenant(request, NAME);
    if (t) rec.cleanup = (await dropTenant(request, t.id)).status;
    rec.pageerrors = w.errors;
    rec.consoleErrors = w.consoleErrors;
    rec.consoleExcluded_httpErrorLogs = w.consoleExcluded.length;
    rec.nonLocalRequests = foreignHosts(w);
  }
  expect(w.errors, 'pageerror 0건').toEqual([]);
  expect(w.consoleErrors, 'console.error 0건').toEqual([]);
  expect(foreignHosts(w), 'localhost:8080 밖 요청 0건').toEqual([]);
});
