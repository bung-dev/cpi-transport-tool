import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 개발 서버(npm run dev, 5173)는 프록시에 없는 경로를 백엔드로 넘기지 않는다.
// GET은 index.html(200)을, POST·DELETE 등은 빈 본문 404를 돌려줘 화면에 "알 수 없는 오류"가 뜬다.
// 화면이 부르는 API의 첫 경로 조각이 모두 프록시에 있는지 고정한다.
const ROOT = resolve(__dirname, '../..');
const client = readFileSync(resolve(ROOT, 'src/api/client.ts'), 'utf8');
const viteConfig = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');

function apiPrefixes(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/request(?:<[^>]*>)?\(\s*[`'"](\/[A-Za-z]+)/g)) found.add(m[1]);
  return [...found].sort();
}

function proxiedPrefixes(source: string): string[] {
  // 프록시 값은 문자열(또는 상수)이라 블록 안에 중괄호가 없다. 들여쓰기와 무관하게 첫 닫는 중괄호까지 읽는다.
  const block = source.match(/proxy:\s*\{([^{}]*)\}/)?.[1] ?? '';
  return [...block.matchAll(/['"](\/[A-Za-z]+)['"]\s*:/g)].map((m) => m[1]).sort();
}

describe('개발 서버 프록시', () => {
  it('client.ts에서 API 경로를 찾는다', () => {
    expect(apiPrefixes(client)).toEqual(expect.arrayContaining(['/tenants', '/transport', '/packages']));
  });

  it('화면이 부르는 모든 API 경로를 백엔드로 넘긴다', () => {
    const proxied = proxiedPrefixes(viteConfig);
    expect(apiPrefixes(client).filter((p) => !proxied.includes(p))).toEqual([]);
  });
});
