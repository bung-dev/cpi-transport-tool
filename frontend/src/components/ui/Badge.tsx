import type { HTMLAttributes } from 'react';
import type { StatusTone } from '../../design/statusBadges';

// AI-NOTE: Tailwind는 소스에 완성된 문자열로 적힌 클래스만 만든다. `bg-${tone}-bg`처럼 조립하지 않고 상태별 클래스 전체를 적는다 (근거: wiki/decisions/ADR-010, REQ-101 AC-1)
const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string }> = {
  success: { badge: 'bg-success-bg text-success-fg', dot: 'bg-success-fg' },
  warning: { badge: 'bg-warning-bg text-warning-fg', dot: 'bg-warning-fg' },
  danger: { badge: 'bg-danger-bg text-danger-fg', dot: 'bg-danger-fg' },
  info: { badge: 'bg-info-bg text-info-fg', dot: 'bg-info-fg' },
  accent: { badge: 'bg-accent-bg text-accent-fg', dot: 'bg-accent-fg' },
  caution: { badge: 'bg-caution-bg text-caution-fg', dot: 'bg-caution-fg' },
  neutral: { badge: 'bg-neutral-bg text-neutral-fg', dot: 'bg-neutral-fg' },
};

interface Props extends HTMLAttributes<HTMLSpanElement> {
  /** 상태 이름. 분류별 값→상태 매핑은 design/statusBadges.ts 에서만 정한다. */
  tone?: StatusTone;
  /** 글자 앞에 fg 색 점(6px)을 보인다. */
  dot?: boolean;
}

export function Badge({ tone = 'neutral', dot = false, className = '', children, ...rest }: Props) {
  const c = TONE_CLASSES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium break-all ${c.badge} ${className}`}
      {...rest}
    >
      {dot && <span aria-hidden="true" data-badge-dot className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />}
      {children}
    </span>
  );
}
