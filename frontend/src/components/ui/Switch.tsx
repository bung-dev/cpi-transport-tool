import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

// AI-NOTE: role="switch"인 네이티브 checkbox를 appearance-none으로 그린다(트랙 36×20px, 손잡이는 after). 전역 :focus-visible 외곽선이 트랙에 그대로 보인다 (근거: REQ-103 AC-2, REQ-101 AC-7, wiki/decisions/ADR-012)
const CONTROL_CLASS =
  'relative h-5 w-9 shrink-0 appearance-none rounded-full bg-control-border cursor-pointer transition duration-150 checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-canvas after:shadow-xs after:transition-transform after:duration-150 checked:after:translate-x-4';

/** label을 따로 두는 곳에서 쓰는 컨트롤만의 형태 */
export function SwitchControl({ className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>) {
  return <input type="checkbox" role="switch" className={`${CONTROL_CLASS} ${className}`} {...rest} />;
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  label: ReactNode;
  /** 라벨 아래의 보조 설명(12px) */
  description?: ReactNode;
}

export function Switch({ label, description, id, className = '', ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = `${inputId}-desc`;
  return (
    <div className={`flex items-start justify-between gap-3 min-w-0 ${className}`}>
      <div className="min-w-0">
        <label htmlFor={inputId} className="cursor-pointer font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-xs text-ink-tertiary">
            {description}
          </p>
        )}
      </div>
      <SwitchControl id={inputId} aria-describedby={description ? descId : undefined} {...rest} />
    </div>
  );
}
