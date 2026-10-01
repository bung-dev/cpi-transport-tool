import { describe, expect, it } from 'vitest';
import type { ArtifactResult, ReplacementStatus } from '../../api/types';
import { initialExpanded, isProblemArtifact, isProblemReplacement, problemCount, totalProblemCount } from './problems';

const rep = (status: ReplacementStatus) => ({ targetType: 'header' as const, key: 'k', status, before: null, after: null, occurrences: 0 });
const art = (status: ArtifactResult['status'], reps: ReplacementStatus[]): ArtifactResult => ({
  artifactId: 'a',
  status,
  action: 'NONE',
  deployStatus: 'NOT_REQUESTED',
  error: null,
  replacements: reps.map(rep),
  unmappedKeys: [],
});

describe('문제 항목 판정', () => {
  it.each<[ReplacementStatus, boolean]>([
    ['VALUE_MISMATCH', true],
    ['KEY_NOT_FOUND', true],
    ['FAILED', true],
    ['SENSITIVE_SKIPPED', false],
    ['PLANNED', false],
    ['APPLIED', false],
  ])('REQ-105 AC-5: 치환 항목 %s의 문제 항목 여부는 %s', (status, expected) => {
    expect(isProblemReplacement(rep(status))).toBe(expected);
  });

  it('REQ-105 AC-5: 문제 아티팩트는 status FAILED이거나 문제 항목이 1개 이상이다', () => {
    expect(isProblemArtifact(art('FAILED', []))).toBe(true);
    expect(isProblemArtifact(art('SUCCESS', ['APPLIED', 'KEY_NOT_FOUND']))).toBe(true);
    expect(isProblemArtifact(art('SUCCESS', ['APPLIED', 'PLANNED', 'SENSITIVE_SKIPPED']))).toBe(false);
    expect(problemCount(art('SUCCESS', ['APPLIED', 'KEY_NOT_FOUND', 'FAILED']))).toBe(2);
    expect(totalProblemCount([art('SUCCESS', ['FAILED']), art('FAILED', []), art('SUCCESS', ['VALUE_MISMATCH', 'KEY_NOT_FOUND'])])).toBe(3);
  });

  it('REQ-105 AC-3: 처음 펼침 상태는 문제 아티팩트만 펼침이고 1개뿐이면 펼침이다', () => {
    expect(initialExpanded([art('SUCCESS', ['APPLIED']), art('FAILED', []), art('SUCCESS', ['PLANNED'])])).toEqual([false, true, false]);
    expect(initialExpanded([art('SUCCESS', ['APPLIED'])])).toEqual([true]);
    expect(initialExpanded([])).toEqual([]);
  });
});
