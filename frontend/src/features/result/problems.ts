import type { ArtifactResult, ConfigurationItem } from '../../api/types';

// REQ-511: 요약 줄, 처음 펼침 상태, 필터, 건수는 FAILED 구성 값만 문제 항목으로 센다.
export function isProblemConfiguration(c: ConfigurationItem): boolean {
  return c.status === 'FAILED';
}

/** 아티팩트의 문제 항목 수 */
export function problemCount(a: ArtifactResult): number {
  return (a.configurations ?? []).filter(isProblemConfiguration).length;
}

/** "문제 아티팩트": status가 FAILED이거나 문제 항목이 1개 이상인 아티팩트 */
export function isProblemArtifact(a: ArtifactResult): boolean {
  return a.status === 'FAILED' || problemCount(a) > 0;
}

/** 결과 전체의 문제 항목 수 */
export function totalProblemCount(results: ArtifactResult[]): number {
  return results.reduce((sum, a) => sum + problemCount(a), 0);
}

/**
 * 결과 전체의 실패 아티팩트 수: status가 FAILED인 아티팩트 수. "실패" 통계 타일(summary.failed)과 같은 값이다(REQ-316 AC-1).
 * 구성 값 문제 항목만 세는 totalProblemCount와 합치지 않는다(REQ-511, ADR-014).
 */
export function failedArtifactCount(results: ArtifactResult[]): number {
  return results.filter((a) => a.status === 'FAILED').length;
}

/** 카드의 처음 펼침 상태: 문제 아티팩트는 펼침, 그 밖은 접힘. 아티팩트가 1개뿐이면 펼침. */
export function initialExpanded(results: ArtifactResult[]): boolean[] {
  return results.length === 1 ? [true] : results.map(isProblemArtifact);
}
