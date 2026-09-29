// REQ-003 AC-4: 상태 배지 배경색 매핑표. 상태별 tint 클래스는 이 모듈에서만 정한다.
export type StatusKind = 'artifactStatus' | 'replacementStatus' | 'deployStatus' | 'transportAction';

const FALLBACK = 'bg-card-tint-gray';

export const STATUS_BADGE_CLASSES: Record<StatusKind, Record<string, string>> = {
  artifactStatus: {
    SUCCESS: 'bg-card-tint-mint',
    FAILED: 'bg-card-tint-rose',
  },
  replacementStatus: {
    APPLIED: 'bg-card-tint-mint',
    PLANNED: 'bg-card-tint-lavender',
    VALUE_MISMATCH: 'bg-card-tint-peach',
    KEY_NOT_FOUND: 'bg-card-tint-gray',
    SENSITIVE_SKIPPED: 'bg-card-tint-yellow',
    FAILED: 'bg-card-tint-rose',
  },
  deployStatus: {
    STARTED: 'bg-card-tint-mint',
    ERROR: 'bg-card-tint-rose',
    TIMEOUT: 'bg-card-tint-peach',
    NOT_REQUESTED: 'bg-card-tint-gray',
    SKIPPED_DRY_RUN: 'bg-card-tint-lavender',
  },
  transportAction: {
    CREATED: 'bg-card-tint-sky',
    UPDATED: 'bg-card-tint-lavender',
    NONE: 'bg-card-tint-gray',
  },
};

export function badgeClass(kind: StatusKind, value: string): string {
  return Object.hasOwn(STATUS_BADGE_CLASSES[kind], value) ? STATUS_BADGE_CLASSES[kind][value] : FALLBACK;
}
