// REQ-103 AC-4: 상태 배지의 (분류, 값) → 상태 이름 매핑표. 이 매핑은 이 모듈에서만 정한다.
// 상태 이름은 index.css의 `<상태>-bg`/`<상태>-fg` 토큰 이름과 같다. 색 클래스는 components/ui/Badge.tsx 가 정한다.
export type StatusKind = 'artifactStatus' | 'replacementStatus' | 'deployStatus' | 'transportAction';
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'caution' | 'neutral';

const FALLBACK: StatusTone = 'neutral';

export const STATUS_BADGE_TONES: Record<StatusKind, Record<string, StatusTone>> = {
  artifactStatus: {
    SUCCESS: 'success',
    FAILED: 'danger',
  },
  replacementStatus: {
    APPLIED: 'success',
    PLANNED: 'accent',
    VALUE_MISMATCH: 'warning',
    KEY_NOT_FOUND: 'neutral',
    SENSITIVE_SKIPPED: 'caution',
    FAILED: 'danger',
  },
  deployStatus: {
    STARTED: 'success',
    ERROR: 'danger',
    TIMEOUT: 'warning',
    NOT_REQUESTED: 'neutral',
    SKIPPED_DRY_RUN: 'accent',
  },
  transportAction: {
    CREATED: 'info',
    UPDATED: 'accent',
    NONE: 'neutral',
  },
};

// 표에 없는 값과 객체 prototype 이름(toString 등)은 neutral이다.
export function badgeTone(kind: StatusKind, value: string): StatusTone {
  return Object.hasOwn(STATUS_BADGE_TONES[kind], value) ? STATUS_BADGE_TONES[kind][value] : FALLBACK;
}
