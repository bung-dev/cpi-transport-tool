import { useEffect, useRef, useState } from 'react';
import { getHistory } from '../../api/client';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ArrowLeftIcon, RefreshIcon } from '../../components/ui/icons';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, Td, Th, Tr } from '../../components/ui/Table';
import { formatTime } from '../../lib/formatTime';
import { useRemote } from '../../lib/useRemote';
import { TransportResult } from '../result/TransportResult';

// REQ-106 AC-4: 조회 중에는 표 자리에 스켈레톤 행을 보이고 role="status"의 접근 가능한 글자 "불러오는 중"을 둔다(시각적으로는 숨김).
function TableSkeleton() {
  return (
    <div role="status" className="overflow-hidden rounded-lg border border-hairline bg-canvas">
      <span className="sr-only">불러오는 중</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-11 items-center gap-6 border-t border-hairline px-3 first:border-t-0">
          <Skeleton className="w-32" />
          <Skeleton className="w-24" />
          <Skeleton className="w-14" />
          <Skeleton className="hidden w-14 sm:block" />
          <Skeleton className="ml-auto w-28" />
        </div>
      ))}
    </div>
  );
}

export function HistoryTab() {
  const { state, retry } = useRemote(getHistory, 'history');
  const [selected, setSelected] = useState<number | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<number, HTMLButtonElement>());
  // 상세를 연 행. 목록으로 돌아왔을 때만 그 행에 포커스를 돌려주고, 새로고침·재진입 렌더에서는 포커스를 옮기지 않는다.
  const openedFrom = useRef<number | null>(null);
  // AI-NOTE: 새로고침 중에는 버튼이 disabled가 되어 실제 브라우저에서 포커스가 body로 떨어지므로, 응답이 끝나면 새로고침 버튼으로 되돌린다 (근거: REQ-009 AC-2, run 20260929-frontend-ui, dev-ISS-104).
  const refreshBtn = useRef<HTMLButtonElement>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    if (selected !== null) {
      backRef.current?.focus();
    } else if (openedFrom.current !== null) {
      rowButtons.current.get(openedFrom.current)?.focus();
      openedFrom.current = null;
    }
  }, [selected]);

  useEffect(() => {
    if (state.status !== 'loading' && refreshing.current) {
      refreshing.current = false;
      refreshBtn.current?.focus();
    }
  }, [state.status]);

  // 상세는 목록 응답의 항목을 그대로 쓴다(추가 API 호출 없음, REQ-007 AC-2).
  if (state.status === 'ok' && selected !== null && state.data[selected]) {
    return (
      <div className="min-w-0">
        <PageHeader title="이관 이력" description="지난 이관 기록을 확인합니다." />
        <div className="flex flex-col gap-4 min-w-0">
          <div>
            <Button ref={backRef} variant="ghost" onClick={() => setSelected(null)}>
              <ArrowLeftIcon />
              목록으로
            </Button>
          </div>
          <TransportResult result={state.data[selected]} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="이관 이력"
        description="지난 이관 기록을 확인합니다."
        actions={
          <Button
            ref={refreshBtn}
            onClick={() => {
              refreshing.current = true;
              setSelected(null);
              retry();
            }}
            disabled={state.status === 'loading'}
          >
            <RefreshIcon />
            새로고침
          </Button>
        }
      />
      <div className="flex flex-col gap-4 min-w-0">
        {state.status === 'loading' && <TableSkeleton />}
        {state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
        {state.status === 'ok' &&
          (state.data.length === 0 ? (
            <div className="rounded-lg border border-hairline bg-canvas">
              <EmptyState title="이관 이력이 없습니다" description="이관을 실행하면 여기에 기록됩니다." />
            </div>
          ) : (
            <Table className="min-w-[720px]">
              <thead>
                <Tr>
                  <Th>시작 시각</Th>
                  <Th>패키지</Th>
                  <Th>모드</Th>
                  <Th>배포</Th>
                  <Th>결과</Th>
                  <Th>이관 ID</Th>
                </Tr>
              </thead>
              <tbody>
                {state.data.map((h, i) => (
                  // 행의 어느 곳을 눌러도 상세가 열린다(마우스 편의). 키보드 경로는 행마다 이관 ID 버튼 하나이고 행에는 tabindex를 주지 않는다(ADR-012).
                  // 이관 ID 버튼의 클릭은 행으로 올라가 같은 핸들러가 처리한다.
                  <Tr
                    key={`${h.transportId}-${i}`}
                    className="cursor-pointer"
                    onClick={() => {
                      openedFrom.current = i;
                      setSelected(i);
                    }}
                  >
                    <Td className="whitespace-nowrap">{formatTime(h.startedAt)}</Td>
                    <Td className="font-mono text-[13px]">{h.packageId}</Td>
                    <Td>{h.dryRun ? <Badge tone="neutral">드라이런</Badge> : <Badge tone="accent">실제 이관</Badge>}</Td>
                    <Td>
                      {h.deploy ? <Badge tone="info">배포</Badge> : <span className="text-ink-tertiary">배포 안 함</span>}
                    </Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="tabular-nums">{`성공 ${h.summary.succeeded} / 전체 ${h.summary.total}`}</span>
                        {h.summary.failed >= 1 && <Badge tone="danger">{`실패 ${h.summary.failed}`}</Badge>}
                      </span>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) rowButtons.current.set(i, el);
                          else rowButtons.current.delete(i);
                        }}
                        className="cursor-pointer text-left font-mono text-[13px] text-primary break-all transition-colors duration-150 hover:underline"
                      >
                        {h.transportId}
                      </button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ))}
      </div>
    </div>
  );
}
