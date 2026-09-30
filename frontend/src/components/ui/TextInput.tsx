import { useId, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextInput({ label, id, className = '', ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={inputId} className="text-sm text-charcoal">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        className={`h-11 rounded-md border border-hairline-strong bg-canvas px-4 text-ink focus:border-2 focus:border-primary ${className}`}
        {...rest}
      />
    </div>
  );
}
