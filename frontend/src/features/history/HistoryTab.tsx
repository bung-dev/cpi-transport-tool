import { useState } from 'react';
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

  // 상세는 목록 응답의 항목을 그대로 쓴다(추가 API 호출 없음, REQ-007 AC-2).
  if (state.status === 'ok' && selected !== null && state.data[selected]) {
    return (
      <div className="flex flex-col gap-4 min-w-0">
        <div>
          <Button onClick={() => setSelected(null)}>목록으로</Button>
        </div>
        <TransportResult result={state.data[selected]} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div>
        <Button
          onClick={() => {
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
                      onClick={() => setSelected(i)}
                      className="cursor-pointer text-left text-link-blue underline break-all"
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
