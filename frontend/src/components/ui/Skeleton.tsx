import type { HTMLAttributes } from 'react';

// REQ-103 AC-7: 자리 표시 블록. 깜빡임은 animate-pulse이고 움직임 줄이기 규칙으로 멈춘다(REQ-101 AC-6).
export function Skeleton({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={`h-3.5 rounded-sm bg-surface-hover animate-pulse ${className}`} {...rest} />;
}
