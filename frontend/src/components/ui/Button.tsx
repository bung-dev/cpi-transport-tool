import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary';

const base = 'rounded-md px-[18px] py-[10px] text-sm font-medium cursor-pointer';
const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-on-primary active:bg-primary-pressed disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed',
  secondary:
    'bg-transparent text-ink border border-hairline-strong disabled:text-muted disabled:cursor-not-allowed',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: Props) {
  return <button type={type} className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
