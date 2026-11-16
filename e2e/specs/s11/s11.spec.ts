// 묶음 s11 — REQ-319 테넌트 0개 앱 (QA-225). qa_cases.md "묶음 s11" 절 그대로.
// 앱: --profile stub --dev unset --prd unset (테넌트 0개).
// S3b(REQ-420): 새 이관 부제·단계 줄을 보고, "템플릿 없이 진행" 뒤 패키지 단계의 등록 안내와 "테넌트 화면으로 이동"을 본다.
import { expect, test, type Page } from '@playwright/test';
import { after, app, R, shot, tenantList } from '../../lib/qa';
import {
  blocked,
  brief,
  foreignHosts,
  OLD_TERM,
  openTab,
  openWizard,
  runInfo,
  startManual,
  STEP_LABELS,
  stepBtn,
  SUBTITLE_TAIL,
  scannerControl,
  scanOldTerm,
  watch,
  type ScanResult,
  type Watch,
  tabBtn } from '../../lib/ui';

test.afterEach(async ({ request }) => {
  await after(request);
});

async function scan(page: Page, rec: any, state: string, w: Watch): Promise<ScanResult> {
  const r = await scanOldTerm(page, state, w);
  (rec.scans ??= []).push(brief(r));
  expect.soft(r.failTotal, `H-8 ${state}: FAIL 검색어 '${OLD_TERM}' 0건 (${r.fail.map((h) => `${h.source}/${h.variant}=${h.count}`).join(', ')})`).toBe(0);
  return r;
}
const hasOld = (s: string) => [s.normalize('NFC'), s.normalize('NFKC')].some((m) => m.replace(/[​-‍⁠﻿­]/g, '').includes(OLD_TERM));

test('QA-225: 테넌트 0개 앱 - 안내 문구와 이름 유지', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-225');
  const w = watch(page);
  rec.tenantsAtStart = (await tenantList(request)).length;
  expect(rec.tenantsAtStart, '테넌트 0개로 시작').toBe(0);
  await openWizard(page);
  await page.waitForTimeout(800);
  rec.scannerControl = await scannerControl(page, w);
  expect(rec.scannerControl.allFound, 'H-9 변형 5종 모두 찾음').toBe(true);
  expect(rec.scannerControl.cleanZero, 'H-9 제거 뒤 0건').toBe(true);

  // 1. 부제 끝문장, 단계 줄 이름, 비활성 단계, 등록 안내
  const para = (await page.locator('main p').first().innerText()).trim();
  rec.paragraph = para;
  expect.soft(para.endsWith(` · ${SUBTITLE_TAIL}`), '부제가 미리보기 안내로 끝남').toBe(true);
  expect.soft(hasOld(para), '부제에 옛 명칭 없음').toBe(false);
  await startManual(page);
  await page.waitForTimeout(400);
  const ri = await runInfo(page);
  rec.runInfo = ri;
  expect.soft(ri.steps, '단계 줄 이름').toEqual([...STEP_LABELS]);
  for (const s of ri.steps) expect.soft(hasOld(s), `단계 이름에 옛 명칭 없음: ${s}`).toBe(false);
  rec.disabled = {
    next: await blocked(page.getByRole('button', { name: '다음', exact: true })),
    allPreview: await blocked(page.getByRole('button', { name: '전체 아티팩트로 미리보기', exact: true })),
    previewStep: await stepBtn(page, '미리보기').isDisabled(),
  };
  expect.soft(rec.disabled, '패키지 단계 버튼과 미리보기 단계 비활성').toEqual({ next: true, allPreview: true, previewStep: true });
  const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  rec.mainText = mainText.slice(0, 600);
  rec.disabledReason = (await page.getByText(/먼저 테넌트를 등록하세요/).allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  expect.soft(rec.disabledReason.length, '안내 "먼저 테넌트를 등록하세요"').toBeGreaterThan(0);
  // 2. 실행 카드·패키지 영역·안내
  await scan(page, rec, '0개-이관', w);
  await shot(page, 'QA-225-transport');
  // 3. "테넌트 화면으로 이동"
  const go = page.getByRole('button', { name: '테넌트 화면으로 이동', exact: true });
  rec.goButtonCount = await go.count();
  expect.soft(rec.goButtonCount, '"테넌트 화면으로 이동" 버튼').toBe(1);
  if (rec.goButtonCount) await go.click();
  else await openTab(page, '테넌트');
  await expect(tabBtn(page, '테넌트')).toHaveAttribute('aria-current', 'page');
  await scan(page, rec, '0개-테넌트', w);
  await shot(page, 'QA-225-tenants');
  // 4. 이력 탭
  await openTab(page, '이력');
  await scan(page, rec, '0개-이력', w);
  await shot(page, 'QA-225-history');
  // 5. API
  const r = await app(request, 'POST', '/transport', { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: true, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
  const msg = String(r.json?.message ?? '');
  rec.api = { status: r.status, error: r.json?.error, message: msg, oldTermInMessage: hasOld(msg) };
  expect.soft(rec.api.oldTermInMessage, 'message 에 옛 명칭 없음 (있으면 QA-222 규칙, Q-17)').toBe(false);
  rec.pageerrors = w.errors;
  rec.consoleErrors = w.consoleErrors;
  rec.consoleExcluded_httpErrorLogs = w.consoleExcluded.length;
  rec.nonLocalRequests = foreignHosts(w);
  expect.soft(w.errors).toEqual([]);
  expect.soft(w.consoleErrors).toEqual([]);
  expect.soft(foreignHosts(w)).toEqual([]);
});
