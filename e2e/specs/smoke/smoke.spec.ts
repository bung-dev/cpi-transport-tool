// qa-tool 사전 확인용 최소 케이스(02_plan/run_instructions.md 5-2절). 화면 내용은 단언하지 않는다.
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('smoke: 첫 화면이 열리고 페이지 오류와 localhost:8080 밖 요청이 없다', async ({ page }) => {
  const pageErrors: string[] = [];
  const foreign: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('request', (r) => {
    const url = r.url();
    if (/^https?:/.test(url) && new URL(url).host !== 'localhost:8080') foreign.push(url);
  });

  await page.goto('/');
  await expect.poll(() => page.locator('#root > *').count()).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');

  await page.screenshot({ path: path.join(process.env.QA_ARTIFACT_DIR!, 'smoke.png'), fullPage: true });
  console.log(`pageerror ${pageErrors.length}건, localhost:8080 밖 요청 ${foreign.length}건 ${foreign.join(' ')}`);
  expect(pageErrors).toEqual([]);
  expect(foreign).toEqual([]);
});
