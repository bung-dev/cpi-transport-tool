// 묶음 s10 — REQ-319 읽기 전용 기본값 앱 (QA-224). qa_cases.md "묶음 s10" 절 그대로.
// 앱: --profile stub (읽기 전용 켜짐). 초기 등록 DEV·PRD, 이력 0건.
// S3b(REQ-420·423): 실행 모드 라디오 대신 단계 줄과 부제, 미리보기 결과의 "이 구성으로 실제 이관"·실제 이관 단계의 "PRD로 이관"이
// 읽기 전용 이유와 함께 비활성인지를 본다(ADR-018).
import { expect, test, type Page } from '@playwright/test';
import { after, app, R, shot, stubCount, stubReset } from '../../lib/qa';
import {
  brief,
  choosePackage,
  foreignHosts,
  OLD_TERM,
  openTab,
  openTransport,
  previewBtn,
  realBtn,
  realFromResult,
  resultBadge,
  runInfo,
  runPreview,
  STEP_LABELS,
  stepBtn,
  subtitleOf,
  scannerControl,
  scanOldTerm,
  watch,
  type ScanResult,
  type Watch,
} from '../../lib/ui';

test.afterEach(async ({ request }) => {
  await after(request);
});

async function scan(page: Page, rec: any, state: string, w: Watch): Promise<ScanResult> {
  const r = await scanOldTerm(page, state, w);
  (rec.scans ??= []).push(brief(r));
  expect.soft(r.failTotal, `H-8 ${state}: FAIL 검색어 '${OLD_TERM}' 0건 (${r.fail.map((h) => `${h.source}/${h.variant}=${h.count}`).join(', ')})`).toBe(0);
  return r;
}
const norm = (s: string) => s.trim().normalize('NFC');
const hasOld = (s: string) => [s.normalize('NFC'), s.normalize('NFKC')].some((m) => m.replace(/[​-‍⁠﻿­]/g, '').includes(OLD_TERM));

test('QA-224: 읽기 전용 앱 - 안내 문구와 미리보기 동작', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-224');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  rec.scannerControl = await scannerControl(page, w);
  expect(rec.scannerControl.allFound, 'H-9 변형 5종 모두 찾음').toBe(true);
  expect(rec.scannerControl.cleanZero, 'H-9 제거 뒤 0건').toBe(true);

  // 1. 부제(실제 경로와 미리보기 안내), 단계 줄, 실행 버튼
  const para = (await page.locator('main p').first().innerText()).trim();
  rec.paragraph = para;
  expect.soft(norm(para), 'H-11 부제 문자열 완전 일치').toBe(subtitleOf('DEV → PRD'));
  const ri = await runInfo(page);
  rec.runInfo = ri;
  expect.soft(ri.steps, '단계 줄 이름').toEqual([...STEP_LABELS]);
  expect.soft(ri.deployControls, '배포 컨트롤 없음').toEqual([]);
  await scan(page, rec, '읽기전용-이관', w);
  await shot(page, 'QA-224-transport');
  // 2. 미리보기 실행은 읽기 전용이어도 동작
  await choosePackage(page, 'PkgTransportDemo');
  rec.previewBtnCount = await previewBtn(page).count();
  expect.soft(rec.previewBtnCount, '실행 버튼 이름 정확히 미리보기 실행').toBe(1);
  expect.soft(await previewBtn(page).isDisabled(), '읽기 전용이어도 미리보기 실행 활성').toBe(false);
  await page.waitForTimeout(1000);
  await stubReset(request);
  const out = await runPreview(page);
  rec.preview = { status: out.status, dryRun: out.postData?.dryRun, badge: await resultBadge(page), prdRequests: await stubCount(request, 18082) };
  expect.soft(out.postData?.dryRun, '요청 dryRun true').toBe(true);
  expect.soft(rec.preview.badge, '결과 머리 배지').toBe('미리보기');
  expect.soft(rec.preview.prdRequests, '대상 요청 0건').toBe(0);
  await scan(page, rec, '읽기전용-미리보기결과', w);
  await shot(page, 'QA-224-preview-result');
  // 3. 실제 이관은 막힘: 결과의 "이 구성으로 실제 이관"과 실제 이관 단계의 "PRD로 이관"이 비활성이고 이유가 보인다
  const reasonOf = (loc: ReturnType<typeof realFromResult>) =>
    loc.evaluate((b) => (b.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim());
  rec.realFromResult = { disabled: await realFromResult(page).isDisabled(), reason: await reasonOf(realFromResult(page)) };
  await stepBtn(page, '실제 이관').click();
  rec.realStep = { disabled: await realBtn(page, 'PRD').isDisabled(), reason: await reasonOf(realBtn(page, 'PRD')) };
  const ro = await page.getByText(/읽기 전용/).allInnerTexts();
  rec.readOnlyNotices = ro.map((s) => s.replace(/\s+/g, ' ').trim());
  expect.soft(rec.realFromResult.disabled, '"이 구성으로 실제 이관" 비활성').toBe(true);
  expect.soft(rec.realFromResult.reason, '"이 구성으로 실제 이관" 비활성 이유').toContain('읽기 전용');
  expect.soft(rec.realStep.disabled, '"PRD로 이관" 비활성').toBe(true);
  expect.soft(rec.realStep.reason, '"PRD로 이관" 비활성 이유').toContain('읽기 전용');
  expect.soft(rec.readOnlyNotices.length, '읽기 전용 안내 문구가 보임').toBeGreaterThan(0);
  await scan(page, rec, '읽기전용-실제이관', w);
  await shot(page, 'QA-224-real-step');
  // 5. 이력·테넌트 탭
  await openTab(page, '이력');
  await scan(page, rec, '읽기전용-이력', w);
  await openTab(page, '테넌트');
  await scan(page, rec, '읽기전용-테넌트', w);
  // 6. API 쓰기 거절
  await stubReset(request);
  const r = await app(request, 'POST', '/transport', { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
  const msg = String(r.json?.message ?? '');
  rec.apiWrite = { status: r.status, error: r.json?.error, message: msg, oldTermInMessage: hasOld(msg), stubRequests: { dev: await stubCount(request, 18081), prd: await stubCount(request, 18082) } };
  expect.soft(r.status, '쓰기 거절 409').toBe(409);
  expect.soft(r.json?.error, 'READ_ONLY_MODE').toBe('READ_ONLY_MODE');
  expect.soft(rec.apiWrite.stubRequests.prd, '대상 스텁 요청 0건').toBe(0);
  expect.soft(rec.apiWrite.oldTermInMessage, 'message 에 옛 명칭 없음 (있으면 Q-17 FAIL/NEEDS_DECISION)').toBe(false);
  rec.pageerrors = w.errors;
  rec.consoleErrors = w.consoleErrors;
  rec.consoleExcluded_httpErrorLogs = w.consoleExcluded.length;
  rec.nonLocalRequests = foreignHosts(w);
  expect.soft(w.errors).toEqual([]);
  expect.soft(w.consoleErrors).toEqual([]);
  expect.soft(foreignHosts(w)).toEqual([]);
});
