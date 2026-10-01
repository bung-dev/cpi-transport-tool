import { Skeleton } from './Skeleton';

interface Props {
  /** 자리 표시 행 수(3개 이상) */
  rows?: number;
}

// REQ-107 AC-1: 목록 행 모양의 스켈레톤. role="status"에 접근 가능한 글자 "불러오는 중"이 있다(시각적으로는 숨김).
export function ListSkeleton({ rows = 3 }: Props) {
  return (
    <div role="status" className="flex flex-col gap-0.5">
      <span className="sr-only">불러오는 중</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-2.5 px-2.5">
          <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
          <Skeleton className="w-40 max-w-[50%]" />
          <Skeleton className="ml-auto w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}
