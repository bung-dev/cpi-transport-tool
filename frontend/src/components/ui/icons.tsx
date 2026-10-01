import type { ReactNode } from 'react';

// REQ-103 AC-7: 인라인 SVG 아이콘. 아이콘 글꼴과 외부 이미지를 쓰지 않는다. 장식이므로 aria-hidden, 색은 currentColor를 따른다.
interface IconProps {
  className?: string;
}

function Svg({ className = '', children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`h-4 w-4 shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

/** 제품 기호(이관 방향을 나타내는 두 화살표) */
export function BrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.25 7A5.25 5.25 0 1 0 12 10.75" />
      <path d="M13.5 2.5V7H9" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 8H3M7 4L3 8l4 4" />
    </Svg>
  );
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 10.75v.01" />
    </Svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5l6 10.5H2L8 2.5z" />
      <path d="M8 6.5v3M8 11.25v.01" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.25V11M8 5.25v.01" />
    </Svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 9.5l1.75-5.25A1 1 0 0 1 4.7 3.5h6.6a1 1 0 0 1 .95.75L14 9.5" />
      <path d="M2 9.5v2.25a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5h-3.25L9.5 11h-3L5.25 9.5H2z" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6l4 4 4-4" />
    </Svg>
  );
}
