import type { HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  /** 배경 색 클래스. 상태별 값은 design/statusBadges.ts 에서만 정한다. */
  bgClass?: string;
}

export function Badge({ bgClass = '', className = '', ...rest }: Props) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-charcoal break-all ${bgClass} ${className}`}
      {...rest}
    />
  );
}
