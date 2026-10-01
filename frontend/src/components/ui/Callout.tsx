import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircleIcon, InfoIcon, WarningIcon } from './icons';

export type CalloutTone = 'danger' | 'warning' | 'info';

// AI-NOTE: 색조별 클래스는 완성된 문자열로 적는다(조립 금지). 근거: wiki/decisions/ADR-010
const TONES: Record<CalloutTone, { box: string; body: string; icon: ReactNode }> = {
  danger: { box: 'bg-danger-bg text-danger-fg', body: 'text-ink', icon: <AlertCircleIcon className="mt-0.5" /> },
  warning: { box: 'bg-warning-bg text-warning-fg', body: 'text-warning-fg', icon: <WarningIcon className="mt-0.5" /> },
  info: { box: 'bg-info-bg text-info-fg', body: 'text-info-fg', icon: <InfoIcon className="mt-0.5" /> },
};

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone: CalloutTone;
  title?: ReactNode;
}

// REQ-103 AC-7: 아이콘 + 제목 + 본문. 제목은 굵기 600이다. role은 호출하는 쪽이 정한다(오류는 role="alert").
export function Callout({ tone, title, className = '', children, ...rest }: Props) {
  const t = TONES[tone];
  return (
    <div className={`flex min-w-0 gap-2.5 rounded-md px-3 py-2.5 text-[13px] ${t.box} ${className}`} {...rest}>
      {t.icon}
      <div className="min-w-0 break-words">
        {title !== undefined && <p className="font-semibold">{title}</p>}
        {children !== undefined && children !== null && <div className={t.body}>{children}</div>}
      </div>
    </div>
  );
}
