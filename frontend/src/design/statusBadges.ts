// REQ-103 AC-4: 상태 배지의 (분류, 값) → 상태 이름 매핑표. 이 매핑은 이 모듈에서만 정한다.
// 상태 이름은 index.css의 `<상태>-bg`/`<상태>-fg` 토큰 이름과 같다. 색 클래스는 components/ui/Badge.tsx 가 정한다.
export type StatusKind = 'artifactStatus' | 'configurationStatus' | 'deployStatus' | 'transportAction' | 'tenantCheck' | 'targetPackage';
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'caution' | 'neutral';

const FALLBACK: StatusTone = 'neutral';

export const STATUS_BADGE_TONES: Record<StatusKind, Record<string, StatusTone>> = {
  targetPackage: { EXISTING: 'neutral', CREATED: 'success', CREATE_FAILED: 'danger', NOT_FOUND: 'warning', CHECK_FAILED: 'danger' },
  tenantCheck: { OK: 'success', TOKEN_FAILED: 'danger', API_FORBIDDEN: 'danger', UNREACHABLE: 'danger', ERROR: 'danger', REQUEST_FAILED: 'danger' },
  artifactStatus: {
    SUCCESS: 'success',
    FAILED: 'danger',
  },
  configurationStatus: {
    PLANNED: 'accent',
    COPIED: 'success',
    SKIPPED_EMPTY: 'caution',
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

const CONFIGURATION_LABELS: Record<string, string> = {
  PLANNED: '복사 예정',
  COPIED: '복사됨',
  SKIPPED_EMPTY: '빈 값이라 건너뜀',
  FAILED: '실패',
};

const TARGET_PACKAGE_LABELS: Record<string, string> = { EXISTING: '있음', CREATED: '새로 만듦', CREATE_FAILED: '생성 실패', NOT_FOUND: '대상에 없음', CHECK_FAILED: '확인 실패' };

export function badgeLabel(kind: StatusKind, value: string): string {
  if (kind === 'targetPackage' && Object.hasOwn(TARGET_PACKAGE_LABELS, value)) return TARGET_PACKAGE_LABELS[value];
  return kind === 'configurationStatus' && Object.hasOwn(CONFIGURATION_LABELS, value)
    ? CONFIGURATION_LABELS[value]
    : value;
}
