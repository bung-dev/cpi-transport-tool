import { useEffect, useRef, useState } from 'react';
import { getHistory } from '../../api/client';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Table, Td, Th, Tr } from '../../components/ui/Table';
import { formatTime } from '../../lib/formatTime';
import { useRemote } from '../../lib/useRemote';
import { TransportResult } from '../result/TransportResult';

const yesNo = (v: boolean) => (v ? '예' : '아니오');

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
      <div className="flex flex-col gap-4 min-w-0">
        <div>
          <Button ref={backRef} onClick={() => setSelected(null)}>
            목록으로
          </Button>
        </div>
        <TransportResult result={state.data[selected]} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div>
        <Button
          ref={refreshBtn}
          onClick={() => {
            refreshing.current = true;
            setSelected(null);
            retry();
          }}
          disabled={state.status === 'loading'}
        >
          새로고침
        </Button>
      </div>
      {state.status === 'loading' && <p role="status">불러오는 중</p>}
      {state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
      {state.status === 'ok' &&
        (state.data.length === 0 ? (
          <p>이관 이력이 없습니다</p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>시작 시각</Th>
                <Th>packageId</Th>
                <Th>드라이런</Th>
                <Th>배포</Th>
                <Th>요약</Th>
                <Th>transportId</Th>
              </Tr>
            </thead>
            <tbody>
              {state.data.map((h, i) => (
                <Tr key={`${h.transportId}-${i}`}>
                  <Td>{formatTime(h.startedAt)}</Td>
                  <Td>{h.packageId}</Td>
                  <Td>{yesNo(h.dryRun)}</Td>
                  <Td>{yesNo(h.deploy)}</Td>
                  <Td>{`${h.summary.succeeded}/${h.summary.total}, 실패 ${h.summary.failed}`}</Td>
                  <Td>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) rowButtons.current.set(i, el);
                        else rowButtons.current.delete(i);
                      }}
                      onClick={() => {
                        openedFrom.current = i;
                        setSelected(i);
                      }}
                      className="cursor-pointer text-left text-primary underline break-all"
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
  );
}
