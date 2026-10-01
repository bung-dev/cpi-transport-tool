import type { ButtonHTMLAttributes, Ref } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'sm';

// AI-NOTE: 클래스는 완성된 문자열로만 적는다. Tailwind는 소스에 그대로 적힌 클래스만 만든다 (근거: wiki/decisions/ADR-010, REQ-103 AC-1)
// hover·누름은 enabled: 로 걸어 비활성에서는 색이 바뀌지 않게 한다. 전환은 한 값(150ms)으로 통일한다 (REQ-101 AC-6).
const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium cursor-pointer transition duration-150 disabled:cursor-not-allowed disabled:shadow-none';
const sizes: Record<Size, string> = {
  md: 'h-9 px-3.5 rounded-md text-sm',
  sm: 'h-7 px-2.5 rounded-sm text-[13px]',
};
const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-on-primary shadow-xs enabled:hover:bg-primary-hover enabled:active:bg-primary-pressed disabled:bg-surface-hover disabled:text-ink-disabled',
  secondary:
    'bg-canvas text-ink border border-hairline-strong enabled:hover:bg-surface-hover disabled:text-ink-disabled disabled:border-hairline disabled:bg-canvas',
  ghost: 'bg-transparent text-ink enabled:hover:bg-surface-hover disabled:text-ink-disabled',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** 스피너를 보이고 aria-busy="true"이며 클릭할 수 없다. */
  loading?: boolean;
  /** 부모 폭을 모두 채운다. */
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`${base} ${sizes[size]} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
