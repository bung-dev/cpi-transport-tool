import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { Badge } from '../components/ui/Badge';
import { StatusBadge } from '../components/ui/StatusBadge';
import { badgeTone, type StatusKind, type StatusTone } from './statusBadges';

const table: [StatusKind, string, StatusTone][] = [
  ['artifactStatus', 'SUCCESS', 'success'],
  ['artifactStatus', 'FAILED', 'danger'],
  ['replacementStatus', 'APPLIED', 'success'],
  ['replacementStatus', 'PLANNED', 'accent'],
  ['replacementStatus', 'VALUE_MISMATCH', 'warning'],
  ['replacementStatus', 'KEY_NOT_FOUND', 'neutral'],
  ['replacementStatus', 'SENSITIVE_SKIPPED', 'caution'],
  ['replacementStatus', 'FAILED', 'danger'],
  ['deployStatus', 'STARTED', 'success'],
  ['deployStatus', 'ERROR', 'danger'],
  ['deployStatus', 'TIMEOUT', 'warning'],
  ['deployStatus', 'NOT_REQUESTED', 'neutral'],
  ['deployStatus', 'SKIPPED_DRY_RUN', 'accent'],
  ['transportAction', 'CREATED', 'info'],
  ['transportAction', 'UPDATED', 'accent'],
  ['transportAction', 'NONE', 'neutral'],
];

describe('상태 배지 매핑', () => {
  it.each(table)('REQ-103 AC-4: %s %s → %s', (kind, value, tone) => {
    expect(badgeTone(kind, value)).toBe(tone);
  });

  it('REQ-103 AC-4: 표에 없는 값과 prototype 이름은 neutral', () => {
    expect(badgeTone('artifactStatus', 'WHATEVER')).toBe('neutral');
    expect(badgeTone('deployStatus', 'toString')).toBe('neutral');
    expect(badgeTone('replacementStatus', 'constructor')).toBe('neutral');
    expect(badgeTone('transportAction', '__proto__')).toBe('neutral');
  });

  it('REQ-103 AC-4: 표는 16쌍이다', () => {
    expect(table).toHaveLength(16);
  });
});

describe('Badge 컴포넌트', () => {
  it.each<[StatusTone]>([['success'], ['warning'], ['danger'], ['info'], ['accent'], ['caution'], ['neutral']])(
    'REQ-103 AC-4: Badge %s는 <상태>-bg/<상태>-fg 클래스, 반경 full, 12px·굵기 500',
    (tone) => {
      render(createElement(Badge, { tone }, '글자'));
      const cls = screen.getByText('글자').className;
      expect(cls).toContain(`bg-${tone}-bg`);
      expect(cls).toContain(`text-${tone}-fg`);
      expect(cls).toContain('rounded-full');
      expect(cls).toContain('text-xs');
      expect(cls).toContain('font-medium');
    },
  );

  it('REQ-103 AC-4: 점은 요청할 때만 6px fg 색으로 그린다', () => {
    const { container, rerender } = render(createElement(Badge, { tone: 'danger' }, '글자'));
    expect(container.querySelector('[data-badge-dot]')).toBeNull();
    rerender(createElement(Badge, { tone: 'danger', dot: true }, '글자'));
    const dot = container.querySelector('[data-badge-dot]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('h-1.5');
    expect(dot?.className).toContain('w-1.5');
    expect(dot?.className).toContain('bg-danger-fg');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('REQ-103 AC-4: StatusBadge는 매핑 모듈의 상태를 쓰고 값 원문을 보인다', () => {
    render(
      createElement('div', null, [
        createElement(StatusBadge, { key: 1, kind: 'deployStatus', value: 'TIMEOUT' }),
        createElement(StatusBadge, { key: 2, kind: 'deployStatus', value: 'toString' }),
      ]),
    );
    expect(screen.getByText('TIMEOUT').className).toContain('bg-warning-bg');
    expect(screen.getByText('TIMEOUT').className).toContain('text-warning-fg');
    expect(screen.getByText('toString').className).toContain('bg-neutral-bg');
  });
});
