// REQ-103 AC-7: SVG 스피너. 회전 애니메이션은 index.css의 움직임 줄이기 규칙으로 멈춘다(REQ-101 AC-6).
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      data-spinner
      className={`h-3.5 w-3.5 shrink-0 animate-spin ${className}`}
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
