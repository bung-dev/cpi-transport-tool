// 묶음 s12 — 20261120-r1-wording S2(REQ-804~806): 대시보드 "오늘 요약" 숫자 → 조건이 붙은 이관 이력.
// 앱: app-rw(DEV·PRD env, 쓰기 허용). 로컬 스텁만 쓴다.
import { expect, test, type Page } from '@playwright/test';
import { after, app } from '../../lib/qa';
import { foreignHosts, watch } from '../../lib/ui';

test.use({ actionTimeout: 20000 });
test.afterEach(async ({ request }) => { await after(request); });

const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const todayCount = async (page: Page, label: string) => {
  const link = page.getByRole('region', { name: '오늘 요약' }).getByRole('link', { name: new RegExp(`^${label} \\d+건 이력 보기$`) });
  const name = (await link.getAttribute('aria-label')) ?? (await link.innerText());
  return { link, n: Number((name.match(/(\d+)건/) ?? [])[1] ?? (await link.innerText()).match(/\d+/)?.[0]) };
};

test('QA-REQ805-1: 오늘 숫자를 누르면 같은 조건의 이력으로 가고, 건수가 숫자와 같으며 새로고침해도 조건이 남는다', async ({ page, request }) => {
  // 오늘 미리보기 1건, 실제 이관 성공 1건을 만든다(다른 묶음이 만든 오늘 이력도 함께 센다)
  const dry = await app(request, 'POST', '/transport', { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
  expect(dry.status, '미리보기').toBe(200);
  const real = await app(request, 'POST', '/transport', { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: false, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
  expect(real.status, '실제 이관').toBe(200);

  const w = watch(page);
  const cases: Array<[string, string, string]> = [
    ['미리보기', 'date=today&mode=preview', '조건: 오늘 · 미리보기'],
    ['실제 이관', 'date=today&mode=real', '조건: 오늘 · 실제 이관'],
    ['성공', 'date=today&mode=real&result=succeeded', '조건: 오늘 · 실제 이관 · 성공'],
    ['실패', 'date=today&mode=real&result=failed', '조건: 오늘 · 실제 이관 · 실패'],
  ];
  for (const [label, query, conditionText] of cases) {
    await page.goto('/#/dashboard');
    await expect(page.getByRole('region', { name: '오늘 요약' })).toBeVisible();
    const { link, n } = await todayCount(page, label);
    expect(Number.isNaN(n), `${label} 숫자 읽기`).toBe(false);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#/history\\?${query.replace(/[?&=]/g, (c) => `\\${c}`)}$`));
    const bar = page.getByRole('group', { name: '이력 조건' });
    await expect(bar).toContainText(conditionText);
    await expect(bar).toContainText(`${n}건`);
    if (n === 0) await expect(page.getByText('조건에 맞는 이력이 없습니다')).toBeVisible();
    else await expect(page.getByRole('table').getByRole('row')).toHaveCount(n + 1);
    // API도 같은 조건으로 부른다
    expect(w.reqs.some((r) => r.url.endsWith(`/transport/history?${query}`)), `${label}: API 조건`).toBe(true);
    if (label === '미리보기') expect(n, '방금 만든 미리보기가 들어 있다').toBeGreaterThanOrEqual(1);
    if (label === '성공') expect(n, '방금 만든 성공 실제 이관이 들어 있다').toBeGreaterThanOrEqual(1);
  }

  // 새로고침해도 조건이 남는다
  await page.reload();
  await expect(page.getByRole('group', { name: '이력 조건' })).toContainText('조건: 오늘 · 실제 이관 · 실패');
  // 조건 해제 → 전체 이력
  await page.getByRole('group', { name: '이력 조건' }).getByRole('button', { name: '조건 해제', exact: true }).click();
  await expect(page).toHaveURL(/#\/history$/);
  await expect(page.getByRole('group', { name: '이력 조건' })).toHaveCount(0);

  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`QA-REQ806-1: 폭 ${width}px에서 조건 줄이 있는 이력 화면에 페이지 가로 스크롤이 없다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/history?date=today&mode=real&result=succeeded');
    await expect(page.getByRole('group', { name: '이력 조건' })).toBeVisible();
    await page.waitForTimeout(300);
    expect(await pageOverflow(page), `@${width}`).toBeLessThanOrEqual(0);
    if (width === 1280) {
      // 넓은 폭에서는 조건 줄이 한 줄이다
      const box = await page.getByRole('group', { name: '이력 조건' }).boundingBox();
      expect(box!.height, '한 줄 높이').toBeLessThan(56);
    }
  });
}
