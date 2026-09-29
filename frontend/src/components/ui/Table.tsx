import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export function Table({
  wrapperClassName = '',
  className = '',
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
  return (
    <div className={`overflow-x-auto border border-hairline rounded-md ${wrapperClassName}`}>
      <table className={`w-full border-collapse text-sm text-left ${className}`} {...rest} />
    </div>
  );
}

export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={`px-3 py-2 font-medium text-charcoal bg-surface ${className}`} {...rest} />;
}

export function Td({ className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-3 py-2 align-top break-all ${className}`} {...rest} />;
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-t border-hairline first:border-t-0 ${className}`} {...rest} />;
}
