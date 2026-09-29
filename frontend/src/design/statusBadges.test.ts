import { describe, it, expect } from 'vitest';
import { badgeClass, type StatusKind } from './statusBadges';

const table: [StatusKind, string, string][] = [
  ['artifactStatus', 'SUCCESS', 'mint'],
  ['artifactStatus', 'FAILED', 'rose'],
  ['replacementStatus', 'APPLIED', 'mint'],
  ['replacementStatus', 'PLANNED', 'lavender'],
  ['replacementStatus', 'VALUE_MISMATCH', 'peach'],
  ['replacementStatus', 'KEY_NOT_FOUND', 'gray'],
  ['replacementStatus', 'SENSITIVE_SKIPPED', 'yellow'],
  ['replacementStatus', 'FAILED', 'rose'],
  ['deployStatus', 'STARTED', 'mint'],
  ['deployStatus', 'ERROR', 'rose'],
  ['deployStatus', 'TIMEOUT', 'peach'],
  ['deployStatus', 'NOT_REQUESTED', 'gray'],
  ['deployStatus', 'SKIPPED_DRY_RUN', 'lavender'],
  ['transportAction', 'CREATED', 'sky'],
  ['transportAction', 'UPDATED', 'lavender'],
  ['transportAction', 'NONE', 'gray'],
];

describe('상태 배지 매핑', () => {
  it.each(table)('REQ-003 AC-4: %s %s → card-tint-%s', (kind, value, tint) => {
    expect(badgeClass(kind, value)).toBe(`bg-card-tint-${tint}`);
  });

  it('REQ-003 AC-4: 알 수 없는 값과 prototype 이름은 card-tint-gray', () => {
    expect(badgeClass('artifactStatus', 'WHATEVER')).toBe('bg-card-tint-gray');
    expect(badgeClass('deployStatus', 'toString')).toBe('bg-card-tint-gray');
  });
});
