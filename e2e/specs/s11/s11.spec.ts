// 묶음 s11 — REQ-319 테넌트 0개 앱 (QA-225). qa_cases.md "묶음 s11" 절 그대로.
// 앱: --profile stub --dev unset --prd unset (테넌트 0개).
import { expect, test, type Page } from '@playwright/test';
import { after, app, R, shot, tenantList } from '../../lib/qa';
import {
  brief,
  CLOSING_SENTENCE,
  foreignHosts,
  modeInfo,
  OLD_TERM,
  openTab,
  previewBtn,
  scannerControl,
  scanOldTerm,
  watch,
  type ScanResult,
  type Watch,
  tabBtn,
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
const hasOld = (s: string) => [s.normalize('NFC'), s.normalize('NFKC')].some((m) => m.replace(/[​-‍⁠﻿­]/g, '').includes(OLD_TERM));

test('QA-225: 테넌트 0개 앱 - 안내 문구와 이름 유지', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-225');
  const w = watch(page);
  rec.tenantsAtStart = (await tenantList(request)).length;
  expect(rec.tenantsAtStart, '테넌트 0개로 시작').toBe(0);
  await page.goto('/#/transport');
  await expect(page.getByRole('heading', { name: '패키지 이관', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  rec.scannerControl = await scannerControl(page, w);
  expect(rec.scannerControl.allFound, 'H-9 변형 5종 모두 찾음').toBe(true);
  expect(rec.scannerControl.cleanZero, 'H-9 제거 뒤 0건').toBe(true);

  // 1. 설명 끝문장, 항목 제목, 버튼 이름, 비활성 이유, 설명 문장(기록만)
  const para = (await page.locator('main p').first().innerText()).trim();
  rec.paragraph = para;
  expect.soft(para.endsWith(CLOSING_SENTENCE), '설명 문단이 끝문장으로 끝남').toBe(true);
  const mi = await modeInfo(page);
  rec.modeInfo = mi;
  expect.soft(mi.items.map((i) => i.title), '두 제목').toEqual(['미리보기', '실제 이관']);
  expect.soft(mi.items.map((i) => i.checked), '기본 선택 미리보기').toEqual([true, false]);
  rec.descriptionSentences_recordOnly = mi.items.map((i) => i.desc);
  for (const i of mi.items) expect.soft(hasOld(i.desc), `설명 문장에 옛 명칭 없음: ${i.desc}`).toBe(false);
  rec.previewBtnCount = await previewBtn(page).count();
  expect.soft(rec.previewBtnCount, '실행 버튼 이름 정확히 미리보기 실행').toBe(1);
  rec.previewDisabled = await previewBtn(page).isDisabled();
  expect.soft(rec.previewDisabled, '버튼 비활성').toBe(true);
  const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  rec.mainText = mainText.slice(0, 600);
  rec.disabledReason = (await page.getByText(/먼저 테넌트를 등록하세요/).allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  rec.noTenantNotice = (await page.getByText(/등록된 테넌트가 없습니다/).allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  expect.soft(rec.disabledReason.length, '비활성 이유 "먼저 테넌트를 등록하세요"').toBeGreaterThan(0);
  // 2. 실행 카드·패키지 영역·안내
  await scan(page, rec, '0개-이관', w);
  await shot(page, 'QA-225-transport');
  // 3. "테넌트 탭으로 이동"
  const go = page.getByRole('button', { name: '테넌트 탭으로 이동', exact: true });
  rec.goButtonCount = await go.count();
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
