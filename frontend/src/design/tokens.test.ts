import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 디자인 토큰 조건(REQ-101)을 index.css와 소스 파일을 읽어 검사한다.
// 이 파일은 금지 이름을 정규식으로 적으므로 스캔 대상에서 뺀다(선례: test/staticPolicy.test.ts).
const SRC = resolve(__dirname, '..');
const SELF = resolve(__filename);
const css = readFileSync(join(SRC, 'index.css'), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx|css)$/.test(e.name) && resolve(p) !== SELF ? [p] : [];
  });
}
const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/** `@theme` 블록 안의 `--이름: 값;`을 읽는다. */
function themeVars(): Record<string, string> {
  const block = css.slice(css.indexOf('@theme'));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const vars = themeVars();
const color = (name: string) => vars[`--color-${name}`];

const COLOR_TOKENS: Record<string, string> = {
  canvas: '#ffffff',
  surface: '#f7f7f5',
  'surface-hover': '#f1f1ef',
  scrim: '#0f0f0f66',
  hairline: '#e9e9e7',
  'hairline-strong': '#d3d1cb',
  'control-border': '#8f8e8a',
  ink: '#1a1a1a',
  'ink-secondary': '#5f5e5b',
  'ink-tertiary': '#6b6a65',
  'ink-disabled': '#a3a29e',
  primary: '#5645d4',
  'primary-hover': '#4c3bc4',
  'primary-pressed': '#4130a8',
  'primary-soft': '#f0eefc',
  'on-primary': '#ffffff',
  'success-bg': '#e3f4e8',
  'success-fg': '#1b6e3c',
  'warning-bg': '#fdecd8',
  'warning-fg': '#8a4500',
  'danger-bg': '#fde4e4',
  'danger-fg': '#b42318',
  'info-bg': '#e1effb',
  'info-fg': '#1d5fa8',
  'accent-bg': '#ebe7fa',
  'accent-fg': '#4534b3',
  'caution-bg': '#fbf3d0',
  'caution-fg': '#7a5b00',
  'neutral-bg': '#efefed',
  'neutral-fg': '#4d4c48',
};
const OTHER_TOKENS: Record<string, string> = {
  '--radius-sm': '6px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
  '--radius-xl': '16px',
  '--radius-full': '9999px',
  '--shadow-xs': '0 1px 2px 0 rgba(15, 15, 15, 0.04)',
  '--shadow-md': '0 4px 12px 0 rgba(15, 15, 15, 0.08)',
  '--shadow-overlay': '0 16px 48px -8px rgba(15, 15, 15, 0.16)',
};

// 이전 토큰 이름: card-tint-*, charcoal, slate, steel, stone, muted, ink-deep, link-blue, semantic-*
const OLD_NAME = '(?:card-tint-[a-z]+|charcoal|slate|steel|stone|muted|ink-deep|link-blue|semantic-[a-z]+)';
const UTILITY =
  '(?:text|bg|border|border-[xytrblse]|ring|outline|fill|stroke|from|via|to|divide|accent|caret|decoration|shadow|placeholder)';
const PALETTE =
  'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const HEX_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/;
const paletteRe = (palette: string) =>
  new RegExp(`(?<![\\w-])(?:[a-z-]+:)*${UTILITY}-(?:(?:${palette})-\\d+|black|white)(?![a-z0-9-])`);

describe('디자인 토큰', () => {
  it('REQ-101 AC-1: @theme에 색 토큰 30개가 표의 값으로 정의된다', () => {
    expect(Object.keys(COLOR_TOKENS)).toHaveLength(30);
    for (const [name, value] of Object.entries(COLOR_TOKENS)) expect(color(name), `--color-${name}`).toBe(value);
  });

  it('REQ-101 AC-1: 반경 5개와 그림자 3개가 표의 값으로 정의된다', () => {
    for (const [name, value] of Object.entries(OTHER_TOKENS)) expect(vars[name], name).toBe(value);
  });

  it('REQ-101 AC-1: 상태 7종은 <상태>-bg/<상태>-fg 쌍이다', () => {
    for (const s of ['success', 'warning', 'danger', 'info', 'accent', 'caution', 'neutral']) {
      expect(color(`${s}-bg`), `${s}-bg`).toBeDefined();
      expect(color(`${s}-fg`), `${s}-fg`).toBeDefined();
    }
  });

  it('REQ-101 AC-1: @theme static을 유지한다(쓰지 않는 토큰도 빌드 CSS에 남기기 위함)', () => {
    expect(css).toMatch(/@theme static\s*\{/);
  });

  it('REQ-101 AC-1: 이전 토큰 이름은 index.css와 frontend/src의 다른 파일에 없다', () => {
    const tokenRe = new RegExp(`--color-${OLD_NAME}(?![a-z0-9-])`);
    const classRe = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*${UTILITY}-${OLD_NAME}(?![a-z0-9])`);
    const offenders = files.filter((f) => tokenRe.test(f.text) || classRe.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
    const oldVars = Object.keys(vars).filter((k) => new RegExp(`^--color-${OLD_NAME}$`).test(k));
    expect(oldVars).toEqual([]);
  });

  it('REQ-101 AC-2: 테스트가 아닌 .tsx에 색 16진수 리터럴과 기본 팔레트 색 유틸리티가 없다', () => {
    const targets = files.filter((f) => f.path.endsWith('.tsx') && !/\.test\.tsx$/.test(f.path));
    expect(targets.length).toBeGreaterThan(10);
    expect(targets.filter((f) => HEX_RE.test(f.text)).map((f) => f.path)).toEqual([]);
    expect(targets.filter((f) => paletteRe(PALETTE).test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it('REQ-101 AC-2: 검사 정규식이 위반 예시를 실제로 잡는다', () => {
    expect(HEX_RE.test('className="text-[#fff]"')).toBe(true);
    expect(HEX_RE.test('const c = "#1a1a1a"')).toBe(true);
    expect(HEX_RE.test('<div id="root">')).toBe(false);
    const re = paletteRe(PALETTE);
    expect(re.test('bg-gray-500')).toBe(true);
    expect(re.test('hover:text-red-600')).toBe(true);
    expect(re.test('bg-black/40')).toBe(true);
    expect(re.test('text-white')).toBe(true);
    expect(re.test('bg-surface text-ink border-hairline')).toBe(false);
  });

  it('REQ-101 AC-3: 본문·고정폭 글꼴 순서가 명세와 같다', () => {
    expect(vars['--font-sans']).toBe(
      "Pretendard, Inter, -apple-system, system-ui, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
    );
    expect(vars['--font-mono']).toBe("ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace");
  });

  it('REQ-101 AC-3: index.css에 @font-face와 외부 URL이 없다', () => {
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/https?:\/\//i);
    expect(css).not.toMatch(/@import\s+url|url\(/);
  });

  it('REQ-101 AC-4: body는 본문 글꼴, 14px, 줄 높이 1.5, ink 글자색', () => {
    const body = css.match(/\nbody\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(body).toContain('font-family: var(--font-sans)');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('line-height: 1.5');
    expect(body).toContain('color: var(--color-ink)');
  });
});

// WCAG 2.x 상대 휘도와 대비
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const STATES = ['success', 'warning', 'danger', 'info', 'accent', 'caution', 'neutral'];
const PAIRS: [string, string][] = [
  ...['ink', 'ink-secondary', 'ink-tertiary'].flatMap((t) =>
    ['canvas', 'surface', 'surface-hover', 'primary-soft'].map((bg): [string, string] => [t, bg]),
  ),
  ...['primary', 'primary-hover', 'primary-pressed'].map((bg): [string, string] => ['on-primary', bg]),
  ...['canvas', 'surface-hover', 'primary-soft'].map((bg): [string, string] => ['primary', bg]),
  ...STATES.map((s): [string, string] => [`${s}-fg`, `${s}-bg`]),
  ['ink', 'danger-bg'],
  ['success-fg', 'canvas'],
  ['danger-fg', 'canvas'],
];

describe('토큰 대비', () => {
  it('REQ-101 AC-5: 글자/배경 쌍 목록은 명세와 같은 수다(12 + 3 + 3 + 7 + 3 = 28)', () => {
    expect(PAIRS).toHaveLength(28);
  });

  it.each(PAIRS)('REQ-101 AC-5: %s / %s 대비는 4.5:1 이상', (fg, bg) => {
    expect(contrast(color(fg), color(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('REQ-101 AC-5: control-border / canvas 대비는 3:1 이상', () => {
    expect(contrast(color('control-border'), color('canvas'))).toBeGreaterThanOrEqual(3);
  });

  it('REQ-101 AC-5: 대비 계산이 알려진 값과 맞는다(검은색/흰색 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

describe('기반 규칙', () => {
  it('REQ-101 AC-6: prefers-reduced-motion에서 전환·애니메이션을 0.01ms 이하로 줄이는 전역 규칙이 있다', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start);
    expect(block).toMatch(/\*::before/);
    expect(block).toMatch(/\*::after/);
    expect(block).toContain('animation-duration: 0.01ms');
    expect(block).toContain('transition-duration: 0.01ms');
    expect(block).toContain('scroll-behavior: auto');
  });

  it('REQ-101 AC-7: :focus-visible에 primary 2px 외곽선과 offset 2px 규칙이 있다', () => {
    const rule = css.match(/:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('outline: 2px solid var(--color-primary)');
    expect(rule).toContain('outline-offset: 2px');
  });

  it('REQ-101 AC-7: 평상시에도 외곽선 색이 primary라 전환 유틸리티가 포커스 색을 ink에서 서서히 바꾸지 않는다', () => {
    expect(css).toMatch(/:where\([^)]*\)\s*\{\s*outline-color:\s*var\(--color-primary\);\s*\}/);
  });
});
