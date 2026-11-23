import { packageSummary } from '../../lib/packageSummary';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getHistory, getTemplates, HISTORY_FILTER_KEYS } from '../../api/client';
import { navigate, readQuery, subscribeToHashChange } from '../../app/routes';
import type { TransportHistoryEntry } from '../../api/types';
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
import { deployOutcome } from '../result/deployOutcome';

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

/** 템플릿 칸: 없으면 "—", 있으면 실행 당시 이름. 지금 목록에 그 id가 없으면 "(삭제됨)"을 붙인다(목록을 못 읽었으면 판단하지 않는다). */
function templateLabel(h: TransportHistoryEntry, liveIds: Set<string> | null): string {
  if (!h.template) return '—';
  return liveIds && !liveIds.has(h.template.id) ? `${h.template.name} (삭제됨)` : h.template.name;
}

export function HistoryTab() {
  const query = useSyncExternalStore(subscribeToHashChange, readQuery);
  return <HistoryList key={query} query={query} />;
}

const filterLabels = [
  ['date', 'today', '오늘'],
  ['mode', 'preview', '미리보기'],
  ['mode', 'real', '실제 이관'],
  ['result', 'succeeded', '성공'],
  ['result', 'failed', '실패'],
] as const;

function HistoryList({ query }: { query: string }) {
  const params = new URLSearchParams(query);
  const labels = HISTORY_FILTER_KEYS.flatMap(key => params.getAll(key).map(value => {
    const match = filterLabels.find(([knownKey, knownValue]) => knownKey === key && knownValue === value);
    return match?.[2] ?? `${key}=${value}`;
  }));
  const filtered = labels.length > 0;
  const { state, retry } = useRemote(() => getHistory(params), `history?${query}`);
  // 템플릿 열의 "(삭제됨)" 판단에만 쓴다. 실패해도 오류를 보이지 않고 기록된 이름만 보인다(REQ-425).
  const { state: templates } = useRemote(getTemplates, 'templates');
  const liveTemplateIds = templates.status === 'ok' ? new Set(templates.data.map((t) => t.id)) : null;
  const [selectedRow, setSelected] = useState<number | null>(null);
  const transportId = params.get('transportId');
  const linkedRow = transportId && state.status === 'ok' ? state.data.findIndex(h => h.transportId === transportId) : -1;
  const selected = selectedRow ?? (linkedRow >= 0 ? linkedRow : null);
  const backRef = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<number, HTMLButtonElement>());
  // 상세를 연 행. 목록으로 돌아왔을 때만 그 행에 포커스를 돌려주고, 새로고침·재진입 렌더에서는 포커스를 옮기지 않는다.
  const openedFrom = useRef<number | null>(null);
  // 새로고침 중에는 버튼이 disabled가 되어 실제 브라우저에서 포커스가 body로 떨어지므로, 응답이 끝나면 새로고침 버튼으로 되돌린다.
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
            <Button ref={backRef} variant="ghost" onClick={() => {
              setSelected(null);
              if (transportId) {
                params.delete('transportId');
                window.location.hash = params.size ? `#/history?${params}` : '#/history';
              }
            }}>
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
        {filtered && (
          <div role="group" aria-label="이력 조건"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm">
            <span className="basis-full wrap-anywhere sm:basis-auto">조건: {labels.join(' · ')}</span>
            {state.status === 'ok' && <span className="text-ink-secondary">{state.data.length}건</span>}
            <Button size="sm" onClick={() => navigate('history')}>조건 해제</Button>
          </div>
        )}
        {state.status === 'loading' && <TableSkeleton />}
        {state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
        {state.status === 'ok' &&
          (state.data.length === 0 ? (
            <div className="rounded-lg border border-hairline bg-canvas">
              <EmptyState title={filtered ? '조건에 맞는 이력이 없습니다' : '이관 이력이 없습니다'}
                description={filtered ? undefined : '이관을 실행하면 여기에 기록됩니다.'} />
            </div>
          ) : (
            <Table className="min-w-[720px]">
              <thead>
                <Tr>
                  <Th>시작 시각</Th>
                  <Th>템플릿</Th>
                  <Th>원본</Th>
                  <Th>대상</Th>
                  <Th>패키지</Th>
                  <Th>모드</Th>
                  <Th>배포</Th>
                  <Th>결과</Th>
                  <Th>이관 ID</Th>
                </Tr>
              </thead>
              <tbody>
                {state.data.map((h, i) => {
                  const outcome = deployOutcome(h);
                  return (
                  // 행의 어느 곳을 눌러도 상세가 열린다(마우스 편의). 키보드 경로는 행마다 이관 ID 버튼 하나이고 행에는 tabindex를 주지 않는다(ADR-012).
                  // 이관 ID 버튼의 클릭은 행으로 올라가 같은 핸들러가 처리한다. 짧은 셀(시작 시각·모드·배포·결과)은 줄바꿈하지 않고, 좁은 폭에서는 표 래퍼 안에서 가로로 스크롤한다(REQ-108 AC-1).
                  // 긴 텍스트 셀(템플릿·패키지·원본·대상·이관 ID)에 whitespace-nowrap을 주지 않는다. Td 기본 break-all로 줄바꿈해야 1280px(본문 최대 1200px)에서 40자 값 세 개와 UUID가 있어도 모든 열이 래퍼 안에 든다. 말줄임은 쓰지 않아 전체 값이 항상 보인다. min-w-28은 390px 가로 스크롤 때 긴 셀이 몇 글자 폭으로 눌려 행이 매우 높아지는 것을 막는 하한이며, 네 셀 하한 합과 짧은 셀 폭을 더해도 1280px 본문 폭 안에 든다
                  <Tr
                    key={`${h.transportId}-${i}`}
                    className="cursor-pointer"
                    onClick={() => {
                      openedFrom.current = i;
                      setSelected(i);
                    }}
                  >
                    <Td className="whitespace-nowrap">{formatTime(h.startedAt)}</Td>
                    <Td className="min-w-28">{templateLabel(h, liveTemplateIds)}</Td>
                    <Td className="min-w-28">{h.sourceTenant?.name ?? '-'}</Td>
                    <Td className="min-w-28">{h.targetTenant?.name ?? '-'}</Td>
                    <Td className="min-w-28 font-mono text-[13px]">{packageSummary(h.packages)}</Td>
                    <Td className="whitespace-nowrap">{h.dryRun ? <Badge tone="neutral">미리보기</Badge> : <Badge tone="accent">실제 이관</Badge>}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        {h.deploy ? <Badge tone="info">배포</Badge> : <span className="text-ink-tertiary">배포 안 함</span>}
                        {outcome && <Badge tone={outcome.tone}>{outcome.label}</Badge>}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        {h.summary ? <span className="tabular-nums">{`성공 ${h.summary.succeeded} / 전체 ${h.summary.total}`}</span> : '—'}
                        {h.summary && h.summary.failed >= 1 && <Badge tone="danger">{`실패 ${h.summary.failed}`}</Badge>}
                        {h.jobStatus === 'CANCELLED' && <Badge>취소됨</Badge>}
                        {h.jobStatus === 'INTERRUPTED' && <Badge tone="warning">중단됨</Badge>}
                      </span>
                    </Td>
                    <Td className="min-w-28">
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
                  );
                })}
              </tbody>
            </Table>
          ))}
      </div>
    </div>
  );
}
