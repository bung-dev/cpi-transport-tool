// 묶음 s12 — 20261119-transport-speedup S3: REQ-708 설정 탭, REQ-709 감사 이력의 설정 분류.
// 앱: app-rw(DEV·PRD env, 쓰기 허용). 설정 저장 파일은 e2e/tools/app.py가 build/e2e-app/<label>/settings.json으로 둔다.
import { expect, test, type Page } from '@playwright/test';
import { after, app, R, shot } from '../../lib/qa';
import { foreignHosts, navLink, watch } from '../../lib/ui';

test.use({ actionTimeout: 20000 });

const SAVED = '저장했습니다. 다음 이관부터 적용됩니다.';
const RANGE = '1~8 사이로 입력하세요';
const preview = (page: Page) => page.getByRole('spinbutton', { name: '미리보기 동시 처리 개수', exact: true });
const transport = (page: Page) => page.getByRole('spinbutton', { name: '실제 이관 동시 처리 개수', exact: true });
const save = (page: Page) => page.getByRole('button', { name: '저장', exact: true });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.beforeEach(async ({ request }) => {
  const r = await app(request, 'PUT', '/settings', { previewConcurrency: 4, transportConcurrency: 4 });
  expect(r.status, '설정 초기화').toBe(200);
});
test.afterEach(async ({ request }) => {
  await app(request, 'PUT', '/settings', { previewConcurrency: 4, transportConcurrency: 4 }).catch(() => undefined);
  await after(request);
});

test('QA-REQ708-1: 맨 끝 탭 "설정"에서 값을 바꿔 저장하면 알림이 보이고 새로고침 뒤에도 남으며 감사 이력 "설정" 분류에 변경으로 남는다', async ({ page, request }) => {
  test.setTimeout(120000);
  const rec = R('QA-REQ708-1');
  const w = watch(page);
  await page.goto('/#/dashboard');
  const links = page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link');
  await expect(links.last()).toHaveText('설정');
  await navLink(page, '설정').click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { level: 2, name: '설정', exact: true })).toBeVisible();
  await expect(preview(page)).toHaveValue('4');
  await expect(transport(page)).toHaveValue('4');
  await expect(page.getByText(/1이면 하나씩 차례로 처리/).first()).toBeVisible();

  await preview(page).fill('3');
  await transport(page).fill('2');
  await save(page).click();
  await expect(page.getByText(SAVED)).toBeVisible();
  await shot(page, 'QA-REQ708-1-saved');
  const api = await app(request, 'GET', '/settings');
  rec.api = api.json;
  expect(api.json).toEqual({ previewConcurrency: 3, transportConcurrency: 2 });

  await page.reload();
  await expect(preview(page)).toHaveValue('3');
  await expect(transport(page)).toHaveValue('2');

  // REQ-709: 감사 이력에서 분류 "설정"으로 걸러 본다.
  await navLink(page, '감사 이력').click();
  await page.getByRole('radiogroup', { name: '분류' }).getByRole('radio', { name: '설정', exact: true }).check();
  const row = page.getByRole('row', { name: /미리보기 4→3, 실제 이관 4→2/ }).first();
  await expect(row).toBeVisible();
  const cells = (await row.getByRole('cell').allInnerTexts()).map((t) => t.trim());
  rec.auditRow = cells;
  expect(cells.slice(1)).toEqual(['설정', '변경', '동시 처리', '미리보기 4→3, 실제 이관 4→2']);
  const others = await page.getByRole('row').filter({ hasNotText: '동시 처리' }).count();
  expect(others, '머리 행 말고는 설정 기록만').toBe(1);
  await shot(page, 'QA-REQ709-1-audit');
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

test('QA-REQ708-2: 로딩 표시, 범위 밖·빈 칸·소수 입력은 저장을 막고, 저장 실패는 오류와 다시 시도이며 입력이 남는다(1280·375px 넘침 없음)', async ({ page, request }) => {
  test.setTimeout(120000);
  const rec = R('QA-REQ708-2');
  const w = watch(page);
  // 로딩: GET /settings를 잠시 붙잡는다.
  await page.route('**/settings', async (route) => {
    if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto('/#/settings');
  await expect(page.getByText('불러오는 중')).toBeVisible();
  await expect(preview(page)).toHaveValue('4');
  await page.unroute('**/settings');

  for (const value of ['', '0', '9', '2.5']) {
    await preview(page).fill(value);
    await expect(save(page), `입력 "${value}"`).toBeDisabled();
    await expect(page.getByText(RANGE)).toBeVisible();
  }
  await shot(page, 'QA-REQ708-2-invalid');
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    rec[`overflow${width}`] = await overflow(page);
    expect(rec[`overflow${width}`], `${width}px 가로 넘침 없음`).toBeLessThanOrEqual(0);
  }
  await shot(page, 'QA-REQ708-2-375');
  await page.setViewportSize({ width: 1280, height: 900 });

  await preview(page).fill('5');
  await expect(save(page)).toBeEnabled();
  await expect(page.getByText(RANGE)).toHaveCount(0);

  // 저장 실패(500): 오류와 다시 시도, 입력 값은 남는다.
  let fail = true;
  await page.route('**/settings', async (route) => {
    if (route.request().method() === 'PUT' && fail) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'x' }) });
      return;
    }
    await route.fallback();
  });
  await save(page).click();
  const alert = page.getByRole('alert').first();
  await expect(alert).toBeVisible();
  await expect(page.getByText(SAVED)).toHaveCount(0);
  await expect(preview(page)).toHaveValue('5');
  await shot(page, 'QA-REQ708-2-save-failed');
  fail = false;
  await alert.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText(SAVED)).toBeVisible();
  const api = await app(request, 'GET', '/settings');
  rec.api = api.json;
  expect(api.json).toEqual({ previewConcurrency: 5, transportConcurrency: 4 });
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});
