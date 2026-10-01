import type { ReactNode } from 'react';
import { InboxIcon } from './icons';

interface Props {
  title: string;
  description?: string;
  icon?: ReactNode;
}

// REQ-103 AC-7: 아이콘 + 제목 + 선택적 설명. 가운데 정렬, ink-secondary(REQ-107 AC-2).
export function EmptyState({ title, description, icon }: Props) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-3 py-7 text-center text-ink-secondary">
      <span className="mb-1 grid h-9 w-9 place-items-center rounded-full bg-surface text-ink-tertiary">
        {icon ?? <InboxIcon />}
      </span>
      <p className="font-medium">{title}</p>
      {description && <p className="text-xs text-ink-tertiary">{description}</p>}
    </div>
  );
}
