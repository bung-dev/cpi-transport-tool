import type { ReactNode } from 'react';
import type { ArtifactResult } from '../../api/types';
import { Callout } from '../../components/ui/Callout';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table, Td, Th, Tr } from '../../components/ui/Table';
import type { StatusKind } from '../../design/statusBadges';

const orDash = (v: string | null): ReactNode => (v === null ? <span className="text-ink-tertiary">—</span> : v);

/** 분류 이름(12px, ink-tertiary)이 앞에 붙은 상태 배지. 배지 글자는 API 값 원문이다. */
function LabeledBadge({ label, kind, value }: { label: string; kind: StatusKind; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-ink-tertiary">{label}</span>
      <StatusBadge kind={kind} value={value} />
    </span>
  );
}

// REQ-105 AC-2·AC-4, AC-8: 서버 값은 모두 JSX 텍스트 노드로만 렌더링한다(REQ-006 AC-4, REQ-012 AC-1).
export function ArtifactCard({ r }: { r: ArtifactResult }) {
  const failed = r.status === 'FAILED';
  return (
    <Card className="relative overflow-hidden">
      {failed && <span aria-hidden="true" data-failed-band className="absolute inset-y-0 left-0 w-[3px] bg-danger-fg" />}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h4 className="mr-auto min-w-0 font-mono text-sm font-semibold break-all">{r.artifactId}</h4>
          <LabeledBadge label="상태" kind="artifactStatus" value={r.status} />
          <LabeledBadge label="동작" kind="transportAction" value={r.action} />
          <LabeledBadge label="배포" kind="deployStatus" value={r.deployStatus} />
        </div>
        {r.error && (
          <Callout tone="danger" title={<span className="font-mono">{r.error.code}</span>}>
            {r.error.message}
          </Callout>
        )}
        <div>
          <h5 className="mb-1.5 text-xs font-semibold text-ink-secondary">치환 항목</h5>
          {r.replacements.length === 0 ? (
            <p className="text-sm text-ink-secondary">치환 항목 없음</p>
          ) : (
            <Table className="min-w-[640px]">
              <thead>
                <Tr>
                  <Th>대상 유형</Th>
                  <Th>키</Th>
                  <Th>상태</Th>
                  <Th>변경 전</Th>
                  <Th>변경 후</Th>
                  <Th numeric>횟수</Th>
                </Tr>
              </thead>
              <tbody>
                {r.replacements.map((x, i) => (
                  <Tr key={i}>
                    <Td>{x.targetType}</Td>
                    <Td className="font-mono text-[13px]">{x.key}</Td>
                    <Td>
                      <StatusBadge kind="replacementStatus" value={x.status} />
                    </Td>
                    <Td className="font-mono text-[13px]">{orDash(x.before)}</Td>
                    <Td className="font-mono text-[13px]">{orDash(x.after)}</Td>
                    <Td numeric>{x.occurrences}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <div>
          <h5 className="mb-1.5 text-xs font-semibold text-ink-secondary">매핑되지 않은 키</h5>
          {r.unmappedKeys.length === 0 ? (
            <p className="text-sm text-ink-secondary">매핑되지 않은 키 없음</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {r.unmappedKeys.map((u, i) => (
                <li key={i} className="rounded-sm bg-neutral-bg px-2 py-0.5 font-mono text-xs text-neutral-fg break-all">
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
