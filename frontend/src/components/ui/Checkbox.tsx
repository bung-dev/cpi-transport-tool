import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

// AI-NOTE: 네이티브 input을 appearance-none으로 그린다. 숨기지 않으므로 전역 :focus-visible 외곽선이 그려진 모양에 그대로 보이고, label 연결과 Space 조작은 브라우저가 한다 (근거: REQ-103 AC-2, REQ-101 AC-7, wiki/decisions/ADR-012)
const CONTROL_CLASS =
  'grid h-4 w-4 shrink-0 appearance-none place-items-center rounded-sm border-[1.5px] border-control-border bg-canvas cursor-pointer transition duration-150 checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50 after:hidden after:h-1 after:w-2 after:-translate-y-px after:-rotate-45 after:border-b-2 after:border-l-2 after:border-on-primary checked:after:block';

/** 목록 행이 행 전체를 label로 감쌀 때 쓰는 컨트롤만의 형태 */
export function CheckboxControl({ className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="checkbox" className={`${CONTROL_CLASS} ${className}`} {...rest} />;
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Checkbox({ label, id, className = '', ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className}`}>
      <CheckboxControl id={inputId} className="mt-0.5" {...rest} />
      <label htmlFor={inputId} className="text-sm text-ink break-words min-w-0">
        {label}
      </label>
    </div>
  );
}
