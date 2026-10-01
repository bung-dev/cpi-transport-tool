import type { HTMLAttributes, ReactNode } from 'react';

type HeadingLevel = 'h2' | 'h3' | 'h4';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 카드 제목(16px·굵기 600). 제목도 actions도 없으면 머리를 그리지 않는다. */
  title?: ReactNode;
  titleAs?: HeadingLevel;
  /** 제목 옆의 보조 글자(12px) */
  meta?: ReactNode;
  /** 머리 오른쪽 동작 영역 */
  actions?: ReactNode;
}

// REQ-103 AC-5: canvas, 1px hairline, 반경 lg, shadow-xs, 안쪽 여백 20px(640px 미만 16px).
export function Card({ title, titleAs: Title = 'h3', meta, actions, className = '', children, ...rest }: Props) {
  const hasHead = title !== undefined || actions !== undefined;
  return (
    <div
      className={`min-w-0 rounded-lg border border-hairline bg-canvas p-4 shadow-xs sm:p-5 ${className}`}
      {...rest}
    >
      {hasHead && (
        <div className="mb-3 flex min-h-7 flex-wrap items-center gap-2">
          {title !== undefined && <Title className="text-base font-semibold">{title}</Title>}
          {meta !== undefined && <span className="text-xs text-ink-tertiary">{meta}</span>}
          {actions !== undefined && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
