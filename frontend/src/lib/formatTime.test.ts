import { describe, expect, it } from 'vitest';
import { formatTime } from './formatTime';

// 기대값은 같은 순간을 로컬 시각 부품으로 직접 만든다(실행 환경의 시간대와 무관하게 성립).
function local(y: number, mo: number, d: number, h: number, mi: number, s: number) {
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

describe('formatTime', () => {
  it('REQ-006 AC-1: 소수 초 9자리와 Z를 로컬 YYYY-MM-DD HH:mm:ss로 바꾼다', () => {
    expect(formatTime('2026-09-29T07:05:05.351940500Z')).toBe(local(2026, 9, 29, 7, 5, 5));
  });

  it('REQ-006 AC-1: 소수 초가 1자리이거나 없어도 초 단위까지 표시한다', () => {
    expect(formatTime('2026-09-29T07:05:59.9Z')).toBe(local(2026, 9, 29, 7, 5, 59));
    expect(formatTime('2026-01-02T03:04:05Z')).toBe(local(2026, 1, 2, 3, 4, 5));
  });

  it('REQ-006 AC-1: 형식은 0 채움 24시간제 19자', () => {
    expect(formatTime('2026-01-02T03:04:05Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('REQ-006 AC-1: 해석할 수 없는 값은 원문 그대로', () => {
    expect(formatTime('not a date')).toBe('not a date');
  });
});
