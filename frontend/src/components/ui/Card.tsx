import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-canvas border border-hairline rounded-lg p-4 min-w-0 ${className}`} {...rest} />;
}
