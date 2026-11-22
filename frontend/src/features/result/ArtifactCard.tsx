import { useId, type ReactNode } from 'react';
import type { ArtifactResult } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Callout } from '../../components/ui/Callout';
import { Card } from '../../components/ui/Card';
import { ChevronDownIcon } from '../../components/ui/icons';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table, Td, Th, Tr } from '../../components/ui/Table';
import type { StatusKind } from '../../design/statusBadges';
import { TYPE_LABELS, typeOf } from '../../lib/artifactTypes';
import { isProblemConfiguration, problemCount } from './problems';

const orDash = (v: string | null): ReactNode => (v === null ? <span className="text-ink-tertiary">—</span> : v);

/** 분류 이름(12px, ink-tertiary)이 앞에 붙은 상태 배지. */
function LabeledBadge({ label, kind, value }: { label: string; kind: StatusKind; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-ink-tertiary">{label}</span>
      <StatusBadge kind={kind} value={value} />
    </span>
  );
}

interface Props {
  r: ArtifactResult;
  /** 펼침 여부 */
  expanded: boolean;
  onToggle: () => void;
  /** "문제 항목만 보기"가 켜진 동안: 구성 값 표에 문제 항목 행만 보이고 접기 버튼은 비활성이다(D-018 ②, D-019 ④). */
  onlyProblems: boolean;
}

// REQ-105 AC-2~5, AC-8: 서버 값은 모두 JSX 텍스트 노드로만 렌더링한다(REQ-006 AC-4, REQ-012 AC-1).
export function ArtifactCard({ r, expanded, onToggle, onlyProblems }: Props) {
  const bodyId = useId();
  const failed = r.status === 'FAILED';
  const type = typeOf(r);
  // REQ-512: 예전 이력에는 configurations가 없을 수 있다.
  const configurations = r.configurations ?? [];
  const rows = onlyProblems ? configurations.filter(isProblemConfiguration) : configurations;
  return (
    <Card className="relative overflow-hidden">
      {failed && <span aria-hidden="true" data-failed-band className="absolute inset-y-0 left-0 w-[3px] bg-danger-fg" />}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h4 className="mr-auto min-w-0 font-mono text-sm font-semibold break-all">
            {/* AI-NOTE: 접기·펼치기는 네이티브 button + aria-expanded다(Enter/Space는 브라우저가 처리). 전역 :focus-visible 외곽선을 지우지 않는다 (근거: REQ-105 AC-3, REQ-101 AC-7, wiki/decisions/ADR-012) */}
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={expanded ? bodyId : undefined}
              disabled={onlyProblems}
              onClick={onToggle}
              className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-left font-mono font-semibold break-all transition-colors duration-150 hover:text-primary disabled:cursor-default disabled:hover:text-ink"
            >
              <ChevronDownIcon className={`transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`} />
              {r.artifactId}
            </button>
          </h4>
          <dl className="inline-flex items-baseline gap-1.5 text-xs">
            <dt className="text-ink-tertiary">종류</dt>
            <dd>{TYPE_LABELS[type]}</dd>
          </dl>
          <LabeledBadge label="상태" kind="artifactStatus" value={r.status} />
          {failed && r.grade === 'FIX_REQUIRED' && <Badge tone="danger">고쳐야 함</Badge>}
          {failed && r.grade === 'RETRYABLE' && <Badge tone="warning">다시 시도 가능</Badge>}
          <LabeledBadge label="동작" kind="transportAction" value={r.action} />
          {r.reusedPreview === true && <Badge tone="info">미리보기 묶음 사용</Badge>}
          <LabeledBadge label="배포" kind="deployStatus" value={r.deployStatus} />
        </div>
        {!expanded && (
          <p className="text-xs text-ink-secondary">
            Externalized Parameters {type === 'INTEGRATION_FLOW' ? `${configurations.length}개 · 문제 ${problemCount(r)}건` : '해당 없음'}
          </p>
        )}
        {expanded && (
          <div id={bodyId} className="flex min-w-0 flex-col gap-3">
            {r.error && (
              <Callout tone="danger" title={<>{r.error.code === 'PACKAGE_CREATE_FAILED' && <span>패키지 생성 실패</span>} <span className="font-mono">{r.error.code}</span></>}>
                {r.error.message}
              </Callout>
            )}
            {r.error && (r.error.detail || r.error.detailHttpStatus != null) && (
              <div className="min-w-0 max-w-full">
                <h5 className="mb-1.5 text-xs font-semibold text-ink-secondary">배포 오류 상세</h5>
                <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-sm text-ink-secondary">
                  {r.error.detail || (r.error.detailHttpStatus === 0
                    ? '오류 상세를 가져오지 못했습니다(응답 없음)'
                    : `오류 상세를 가져오지 못했습니다(HTTP ${r.error.detailHttpStatus})`)}
                </p>
              </div>
            )}
            <div className="min-w-0">
              <h5 className="mb-1.5 text-xs font-semibold text-ink-secondary">Externalized Parameters</h5>
              {type !== 'INTEGRATION_FLOW' ? (
                <p className="text-sm text-ink-secondary">해당 없음</p>
              ) : configurations.length === 0 && !onlyProblems ? (
                <p className="text-sm text-ink-secondary">Externalized Parameters 없음</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-ink-secondary">문제 항목 없음</p>
              ) : (
                <Table className="table-fixed">
                  <thead>
                    <Tr>
                      <Th>키</Th>
                      <Th>값</Th>
                      <Th>상태</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {rows.map((x, i) => (
                      <Tr key={i}>
                        <Td className="font-mono text-[13px]">{x.key}</Td>
                        <Td className="font-mono text-[13px] break-all">{orDash(x.value)}</Td>
                        <Td>
                          <StatusBadge kind="configurationStatus" value={x.status} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
