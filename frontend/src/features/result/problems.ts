import type { ArtifactResult, Replacement, ReplacementStatus } from '../../api/types';

// REQ-105 용어: "문제 항목"은 status가 VALUE_MISMATCH, KEY_NOT_FOUND, FAILED인 치환 항목이다.
// SENSITIVE_SKIPPED, PLANNED, APPLIED는 문제 항목이 아니다. 요약 줄, 처음 펼침 상태, 필터, 건수가 모두 이 기준을 쓰므로 한 모듈에만 둔다.
const PROBLEM_STATUSES: readonly ReplacementStatus[] = ['VALUE_MISMATCH', 'KEY_NOT_FOUND', 'FAILED'];

export function isProblemReplacement(r: Replacement): boolean {
  return PROBLEM_STATUSES.includes(r.status);
}

/** 아티팩트의 문제 항목 수 */
export function problemCount(a: ArtifactResult): number {
  return a.replacements.filter(isProblemReplacement).length;
}

/** "문제 아티팩트": status가 FAILED이거나 문제 항목이 1개 이상인 아티팩트 */
export function isProblemArtifact(a: ArtifactResult): boolean {
  return a.status === 'FAILED' || problemCount(a) > 0;
}

/** 결과 전체의 문제 항목 수 */
export function totalProblemCount(results: ArtifactResult[]): number {
  return results.reduce((sum, a) => sum + problemCount(a), 0);
}

/** 카드의 처음 펼침 상태: 문제 아티팩트는 펼침, 그 밖은 접힘. 아티팩트가 1개뿐이면 펼침. */
export function initialExpanded(results: ArtifactResult[]): boolean[] {
  return results.length === 1 ? [true] : results.map(isProblemArtifact);
}
