import { describe, expect, it } from 'vitest';
import type { ArtifactResult, ConfigurationStatus } from '../../api/types';
import { initialExpanded, isProblemArtifact, isProblemConfiguration, problemCount, totalProblemCount } from './problems';

const cfg = (status: ConfigurationStatus) => ({ key: 'k', value: 'v', dataType: 'xsd:string', status });
const art = (status: ArtifactResult['status'], items: ConfigurationStatus[]): ArtifactResult => ({
  artifactId: 'a',
  status,
  action: 'NONE',
  deployStatus: 'NOT_REQUESTED',
  error: null,
  configurations: items.map(cfg),
});

describe('문제 항목 판정', () => {
  it.each<[ConfigurationStatus, boolean]>([
    ['FAILED', true],
    ['PLANNED', false],
    ['COPIED', false],
    ['SKIPPED_EMPTY', false],
    ['BUNDLED', false],
  ])('REQ-511, REQ-707: 구성 값 %s의 문제 항목 여부는 %s', (status, expected) => {
    expect(isProblemConfiguration(cfg(status))).toBe(expected);
  });

  it('REQ-105 AC-5, REQ-511: 문제 아티팩트는 status FAILED이거나 FAILED 구성 값이 1개 이상이다', () => {
    expect(isProblemArtifact(art('FAILED', []))).toBe(true);
    expect(isProblemArtifact(art('SUCCESS', ['COPIED', 'FAILED']))).toBe(true);
    expect(isProblemArtifact(art('SUCCESS', ['COPIED', 'PLANNED', 'SKIPPED_EMPTY']))).toBe(false);
    expect(isProblemArtifact(art('SUCCESS', ['BUNDLED', 'BUNDLED']))).toBe(false);
    expect(problemCount(art('SUCCESS', ['COPIED', 'FAILED', 'FAILED']))).toBe(2);
    expect(totalProblemCount([art('SUCCESS', ['FAILED']), art('FAILED', []), art('SUCCESS', ['FAILED', 'SKIPPED_EMPTY'])])).toBe(2);
  });

  it('REQ-512: configurations가 없는 예전 기록도 문제 항목 0건으로 센다', () => {
    const legacy = { artifactId: 'old', status: 'SUCCESS', action: 'NONE', deployStatus: 'NOT_REQUESTED', error: null } as unknown as ArtifactResult;
    expect(problemCount(legacy)).toBe(0);
    expect(isProblemArtifact(legacy)).toBe(false);
  });

  it('REQ-105 AC-3: 처음 펼침 상태는 문제 아티팩트만 펼침이고 1개뿐이면 펼침이다', () => {
    expect(initialExpanded([art('SUCCESS', ['COPIED']), art('FAILED', []), art('SUCCESS', ['PLANNED'])])).toEqual([false, true, false]);
    expect(initialExpanded([art('SUCCESS', ['COPIED'])])).toEqual([true]);
    expect(initialExpanded([])).toEqual([]);
  });
});
