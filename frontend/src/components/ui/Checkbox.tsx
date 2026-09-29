import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Checkbox({ label, id, className = '', ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className}`}>
      <input id={inputId} type="checkbox" className="mt-1 h-4 w-4 accent-primary" {...rest} />
      <label htmlFor={inputId} className="text-sm text-ink break-words min-w-0">
        {label}
      </label>
    </div>
  );
}
