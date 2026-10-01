import { useId } from 'react';
import type { ArtifactResult, TransportResponse } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table, Td, Th, Tr } from '../../components/ui/Table';
import { formatTime } from '../../lib/formatTime';

const yesNo = (v: boolean) => (v ? '예' : '아니오');
const orDash = (v: string | null) => (v === null ? '—' : v);

// REQ-006 AC-4, REQ-012 AC-1: 서버 값은 모두 JSX 텍스트 노드로만 렌더링한다.
function ArtifactCard({ r }: { r: ArtifactResult }) {
  return (
    <Card>
      <div className="flex flex-col gap-2 min-w-0">
        <h3 className="font-medium break-all">{r.artifactId}</h3>
        <div className="flex flex-wrap gap-2">
          <StatusBadge kind="artifactStatus" value={r.status} />
          <StatusBadge kind="transportAction" value={r.action} />
          <StatusBadge kind="deployStatus" value={r.deployStatus} />
        </div>
        {r.error && (
          <p className="text-sm text-danger-fg break-words">
            <span className="font-medium">{r.error.code}</span>: {r.error.message}
          </p>
        )}
        <div>
          <h4 className="mb-1 text-sm font-medium">치환 항목</h4>
          {r.replacements.length === 0 ? (
            <p className="text-sm text-ink-secondary">치환 항목 없음</p>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>targetType</Th>
                  <Th>key</Th>
                  <Th>status</Th>
                  <Th>before</Th>
                  <Th>after</Th>
                  <Th>occurrences</Th>
                </Tr>
              </thead>
              <tbody>
                {r.replacements.map((x, i) => (
                  <Tr key={i}>
                    <Td>{x.targetType}</Td>
                    <Td>{x.key}</Td>
                    <Td>
                      <StatusBadge kind="replacementStatus" value={x.status} />
                    </Td>
                    <Td>{orDash(x.before)}</Td>
                    <Td>{orDash(x.after)}</Td>
                    <Td>{x.occurrences}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <div>
          <h4 className="mb-1 text-sm font-medium">매핑되지 않은 키</h4>
          {r.unmappedKeys.length === 0 ? (
            <p className="text-sm text-ink-secondary">매핑되지 않은 키 없음</p>
          ) : (
            <ul className="text-sm break-all">
              {r.unmappedKeys.map((u, i) => (
                <li key={i}>
                  {u.targetType} / {u.key}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

export function TransportResult({ result }: { result: TransportResponse }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 min-w-0">
      <h2 id={titleId} className="text-lg font-semibold">
        이관 결과
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 min-w-0">
        <Item label="transportId" value={result.transportId} />
        <Item label="packageId" value={result.packageId} />
        <Item label="드라이런" value={yesNo(result.dryRun)} />
        <Item label="배포" value={yesNo(result.deploy)} />
        <Item label="시작" value={formatTime(result.startedAt)} />
        <Item label="종료" value={formatTime(result.finishedAt)} />
        <Item label="전체" value={String(result.summary.total)} />
        <Item label="성공" value={String(result.summary.succeeded)} />
        <Item label="실패" value={String(result.summary.failed)} />
      </dl>
      <div className="flex flex-col gap-3 min-w-0">
        {result.results.map((r, i) => (
          <ArtifactCard key={`${r.artifactId}-${i}`} r={r} />
        ))}
      </div>
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-ink-secondary shrink-0">
        {label}:{' '}
      </dt>
      <dd className="break-all min-w-0">{value}</dd>
    </div>
  );
}
