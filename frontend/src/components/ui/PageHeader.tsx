import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  /** 오른쪽 동작 영역. 폭 640px 이상에서 제목과 같은 줄에 놓인다. */
  actions?: ReactNode;
}

// REQ-102 AC-5: 탭 패널 맨 위의 페이지 머리. 제목은 h2(24px·600·음수 자간)다.
export function PageHeader({ title, description, actions }: Props) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
