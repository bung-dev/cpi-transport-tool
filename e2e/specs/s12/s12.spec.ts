// 묶음 s12 — 20261110-ui-refresh S2(REQ-410~414): 셸·해시 라우팅·⌘K 팔레트·테넌트 서랍·템플릿 저장.
// 앱: app-rw(DEV·PRD env, 쓰기 허용). 로컬 스텁만 쓴다. 더미 서비스 키만 쓴다.
import { expect, test, type Page } from '@playwright/test';
import { after, app, key, registerTenant, track } from '../../lib/qa';
import { foreignHosts, navLink, watch } from '../../lib/ui';

test.use({ actionTimeout: 20000 });

const ROUTES: Array<[string, string]> = [
  ['#/dashboard', '대시보드'],
  ['#/transport', '패키지 이관'],
  ['#/templates', '템플릿'],
  ['#/history', '이관 이력'],
  ['#/tenants', '테넌트'],
  ['#/audit', '감사 이력'],
];
const createdTemplates: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of createdTemplates.splice(0)) await app(request, 'DELETE', `/templates/${id}`).catch(() => undefined);
  await after(request);
});

async function templates(request: Parameters<typeof app>[0]): Promise<any[]> {
  const r = await app(request, 'GET', '/templates');
  expect(r.status, 'GET /templates').toBe(200);
  return r.json as any[];
}
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [1280, 390]) {
  test(`REQ-410: 폭 ${width}px에서 여섯 화면 모두 페이지 가로 스크롤이 없다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const w = watch(page);
    for (const [hash, heading] of ROUTES) {
      await page.goto(`/${hash}`);
      await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
      await page.waitForTimeout(300);
      expect(await pageOverflow(page), `${hash} @${width}`).toBeLessThanOrEqual(0);
    }
    if (width === 390) {
      const overflowX = await page.getByRole('navigation', { name: '주 메뉴' }).evaluate((n) => getComputedStyle(n).overflowX);
      expect(['auto', 'scroll']).toContain(overflowX);
    }
    expect(w.errors).toEqual([]);
    expect(foreignHosts(w)).toEqual([]);
  });
}

test('REQ-410: 메뉴로 바꾼 화면은 주소 해시에 남고 새로고침해도 같은 화면이다', async ({ page }) => {
  await page.goto('/');
  await expect(navLink(page, '대시보드')).toHaveAttribute('aria-current', 'page');
  await navLink(page, '감사 이력').click();
  await expect(page).toHaveURL(/#\/audit$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: '감사 이력', exact: true })).toBeVisible();
  await expect(navLink(page, '감사 이력')).toHaveAttribute('aria-current', 'page');
  await page.goto('/#/nope');
  await expect(page.getByRole('heading', { level: 2, name: '대시보드', exact: true })).toBeVisible();
});

test('REQ-411: Ctrl+K로 팔레트를 열어 화면을 이동하고 Esc로 닫는다', async ({ page }) => {
  await page.goto('/#/transport');
  const search = page.getByLabel('패키지 검색');
  await search.focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '검색 및 명령' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: '명령 검색' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(search).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('템플릿');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  await dialog.getByRole('combobox', { name: '명령 검색' }).fill('감사 이력');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/audit$/);
  await expect(page.getByRole('heading', { level: 2, name: '감사 이력', exact: true })).toBeVisible();
});

test('REQ-412: 서랍으로 등록한 테넌트가 새로고침 뒤에도 남고, 390px 서랍은 전체 폭이다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/tenants');
  await page.getByRole('button', { name: '테넌트 등록', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '테넌트 등록' });
  await expect(drawer.getByRole('button', { name: '파일 선택', exact: true })).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(388);
  await drawer.getByRole('textbox', { name: '이름' }).fill('S12 서랍 등록');
  await drawer.getByRole('textbox', { name: '서비스 키 붙여넣기' }).fill(JSON.stringify(key(18082, 'localhost', 's12-id', 's12-secret')));
  const resp = page.waitForResponse((r) => r.url().endsWith('/tenants') && r.request().method() === 'POST');
  await drawer.getByRole('button', { name: '등록', exact: true }).click();
  const created = await (await resp).json();
  track(created.id);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('row', { name: /S12 서랍 등록/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: /S12 서랍 등록/ })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('s12-secret');
});

test('REQ-412: 테넌트 삭제 확인창의 "템플릿 n개도 함께 삭제"를 고르면 그 템플릿도 지워지고, 고르지 않으면 사용 불가로 남는다', async ({ page, request }) => {
  const a = await registerTenant(request, 'S12 삭제 A', key(18082, 'localhost', 's12-a-id', 's12-a-secret'));
  const b = await registerTenant(request, 'S12 삭제 B', key(18082, 'localhost', 's12-b-id', 's12-b-secret'));
  for (const [name, src] of [['S12 A 경로', a], ['S12 B 경로', b]] as const) {
    const r = await app(request, 'POST', '/templates', { name, sourceTenantId: src, targetTenantId: 'PRD' });
    expect(r.status, name).toBe(201);
    createdTemplates.push(r.json.id);
  }
  await page.goto('/#/tenants');
  await page.getByRole('row', { name: /S12 삭제 A/ }).getByRole('button', { name: '삭제', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '테넌트 삭제 확인' });
  await expect(dialog.getByText('S12 A 경로')).toBeVisible();
  await dialog.getByRole('checkbox', { name: '템플릿 1개도 함께 삭제' }).check();
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('row', { name: /S12 삭제 A/ })).toBeHidden();
  expect((await templates(request)).some((t) => t.name === 'S12 A 경로')).toBe(false);

  await page.getByRole('row', { name: /S12 삭제 B/ }).getByRole('button', { name: '삭제', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '테넌트 삭제 확인' });
  await expect(dialog.getByRole('checkbox', { name: '템플릿 1개도 함께 삭제' })).not.toBeChecked();
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('row', { name: /S12 삭제 B/ })).toBeHidden();
  const left = (await templates(request)).find((t) => t.name === 'S12 B 경로');
  expect(left?.usable).toBe(false);
});

test('REQ-413: 템플릿 화면에서 만든 템플릿이 새로고침 뒤에도 남고 "이 템플릿으로 이관"이 경로를 채운다', async ({ page, request }) => {
  await page.goto('/#/templates');
  await page.getByRole('button', { name: '템플릿 만들기', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '템플릿 만들기' });
  await drawer.getByRole('textbox', { name: '이름' }).fill('S12 개발에서 운영');
  await drawer.getByRole('combobox', { name: '원본' }).selectOption('DEV');
  await drawer.getByRole('combobox', { name: '대상' }).selectOption('PRD');
  await drawer.getByRole('button', { name: '저장', exact: true }).click();
  await expect(drawer).toBeHidden();
  const saved = (await templates(request)).find((t) => t.name === 'S12 개발에서 운영');
  expect(saved).toBeTruthy();
  createdTemplates.push(saved.id);
  await page.reload();
  const row = page.getByRole('row', { name: /S12 개발에서 운영/ });
  await expect(row).toContainText('DEV → PRD');
  await expect(row).toContainText('실행 때 선택');
  await row.getByRole('button', { name: '이 템플릿으로 이관', exact: true }).click();
  await expect(page).toHaveURL(/#\/transport$/);
  await expect(page.getByRole('banner').getByRole('group', { name: '경로' })).toContainText('DEV');
});

test('REQ-414: 테넌트 변경이 감사 이력에 남고 분류 필터로 좁힌다', async ({ page, request }) => {
  await registerTenant(request, 'S12 감사 대상', key(18082, 'localhost', 's12-audit-id', 's12-audit-secret'));
  await page.goto('/#/audit');
  await expect(page.getByRole('row', { name: /S12 감사 대상/ })).toBeVisible();
  await page.getByRole('radiogroup', { name: '분류' }).getByRole('radio', { name: '템플릿' }).check();
  await expect(page.getByRole('row', { name: /S12 감사 대상/ })).toBeHidden();
  await page.getByRole('radiogroup', { name: '분류' }).getByRole('radio', { name: '테넌트' }).check();
  await expect(page.getByRole('row', { name: /S12 감사 대상/ })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('s12-audit-secret');
});
