import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

// AI-NOTE: 네이티브 radio를 appearance-none으로 그린다(Checkbox와 같은 이유). 같은 name의 라디오는 브라우저가 화살표 키 이동을 처리한다 (근거: REQ-103 AC-2, REQ-101 AC-7, wiki/decisions/ADR-012)
const CONTROL_CLASS =
  'grid h-4 w-4 shrink-0 appearance-none place-items-center rounded-full border-[1.5px] border-control-border bg-canvas cursor-pointer transition duration-150 checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50 after:hidden after:h-1.5 after:w-1.5 after:rounded-full after:bg-on-primary checked:after:block';

/** 목록 행이나 선택지 상자가 전체를 label로 감쌀 때 쓰는 컨트롤만의 형태 */
export function RadioControl({ className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="radio" className={`${CONTROL_CLASS} ${className}`} {...rest} />;
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Radio({ label, id, className = '', ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className}`}>
      <RadioControl id={inputId} className="mt-0.5" {...rest} />
      <label htmlFor={inputId} className="text-sm text-ink break-words min-w-0">
        {label}
      </label>
    </div>
  );
}
