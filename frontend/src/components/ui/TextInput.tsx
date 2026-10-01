import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** true면 label을 화면에서 숨긴다(스크린 리더에는 연결되어 있다). */
  hideLabel?: boolean;
  /** 앞쪽 아이콘 자리 */
  icon?: ReactNode;
}

// REQ-103 AC-3: 높이 40px, 반경 md, 1px control-border. 포커스의 primary 테두리·primary-soft 링은 전역 외곽선(REQ-101 AC-7)에 더하는 것이다.
export function TextInput({ label, hideLabel = false, icon, id, className = '', ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'text-sm text-ink'}>
        {label}
      </label>
      <div className="relative min-w-0">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary">{icon}</span>
        )}
        <input
          id={inputId}
          type="text"
          className={`h-10 w-full rounded-md border border-control-border bg-canvas text-ink placeholder:text-ink-tertiary transition duration-150 focus:border-primary focus:ring-3 focus:ring-primary-soft ${
            icon ? 'pl-9 pr-3' : 'px-3'
          } ${className}`}
          {...rest}
        />
      </div>
    </div>
  );
}
