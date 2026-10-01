import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

// REQ-103 AC-6: 반경 lg·1px hairline 테두리의 가로 스크롤 래퍼. 넓은 표는 이 래퍼 안에서만 가로로 스크롤한다(REQ-108 AC-1).
export function Table({
  wrapperClassName = '',
  className = '',
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
  return (
    <div className={`overflow-x-auto border border-hairline rounded-lg bg-canvas ${wrapperClassName}`}>
      <table className={`w-full border-collapse text-sm text-left ${className}`} {...rest} />
    </div>
  );
}

/** numeric: 숫자 칸이면 오른쪽 정렬한다. */
export function Th({
  numeric = false,
  className = '',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-medium whitespace-nowrap text-ink-tertiary bg-surface ${
        numeric ? 'text-right' : 'text-left'
      } ${className}`}
      {...rest}
    />
  );
}

/** numeric: 숫자 칸이면 오른쪽 정렬하고 tabular-nums를 쓴다(REQ-101 AC-4). */
export function Td({
  numeric = false,
  className = '',
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={`px-3 py-2.5 align-top break-all ${numeric ? 'text-right tabular-nums' : ''} ${className}`}
      {...rest}
    />
  );
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-t border-hairline first:border-t-0 transition-colors duration-150 hover:bg-surface-hover ${className}`}
      {...rest}
    />
  );
}
