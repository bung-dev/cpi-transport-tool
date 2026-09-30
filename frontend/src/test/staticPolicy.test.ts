import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 소스 조건(REQ-012)을 테스트로 고정한다. 이 파일의 금지 문자열은 조각을 이어 붙여 만들어 자기 검사에 걸리지 않게 한다.
const SRC = resolve(__dirname, '..');
const SELF = resolve(__filename);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && resolve(p) !== SELF ? [p] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

function offenders(re: RegExp): string[] {
  return files.filter((f) => re.test(f.text)).map((f) => f.path);
}

describe('소스 정적 정책', () => {
  it('REQ-012 AC-1: 검사 대상 소스 파일이 존재한다', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('REQ-012 AC-1: 위험한 HTML 주입·동적 실행 API를 쓰지 않는다', () => {
    const forbidden = [
      'dangerously' + 'SetInnerHTML',
      'inner' + 'HTML',
      'ev' + 'al\\(',
      'new ' + 'Function\\(',
    ];
    for (const word of forbidden) expect(offenders(new RegExp(word)), word).toEqual([]);
  });

  it('REQ-012 AC-2: 자격증명 입력란(password 입력, secret/token 이름의 입력)이 없다', () => {
    expect(offenders(new RegExp('type=["\']pass' + 'word["\']'))).toEqual([]);
    expect(offenders(new RegExp('<input[^>]*(secr' + 'et|tok' + 'en)', 'i'))).toEqual([]);
  });

  it('REQ-012 AC-2: import.meta.env에서 VITE_ 변수를 읽지 않는다', () => {
    expect(offenders(new RegExp('import\\.meta\\.env\\.VITE' + '_'))).toEqual([]);
    expect(offenders(new RegExp('VITE' + '_[A-Z]'))).toEqual([]);
  });

  it('REQ-012 AC-3: localStorage/sessionStorage를 쓰지 않는다', () => {
    expect(offenders(new RegExp('local' + 'Storage'))).toEqual([]);
    expect(offenders(new RegExp('session' + 'Storage'))).toEqual([]);
  });
});
