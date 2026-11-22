import type { JobItem, JobStage } from '../../api/types';
import { TYPE_LABELS, typeOf } from '../../lib/artifactTypes';

const STAGES: Record<JobStage, string> = {
  WAITING: '대기', DOWNLOAD: '내려받기', CONFIGURATION_READ: '구성 값 읽기', TARGET: '대상 확인',
  UPLOAD: '업로드', DEPLOY: '배포', DONE: '완료', SKIPPED: '건너뜀',
};

export function JobProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const percent = total > 0 ? done / total * 100 : 0;
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuenow={done} aria-valuemax={total}
    className="h-2 w-full overflow-hidden rounded-full bg-hairline">
    <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
  </div>;
}

export function JobItems({ items, nameOf }: { items: JobItem[]; nameOf?: (item: JobItem) => string | undefined }) {
  return <ul aria-label="iFlow 진행" className="mt-3 min-w-0 divide-y divide-hairline">
    {items.map(item => (
      <li key={JSON.stringify([item.packageId, typeOf(item), item.artifactId])} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
        <span className="min-w-0 break-all">{nameOf?.(item) || item.artifactId}</span>
        <span className="text-xs text-ink-secondary">{TYPE_LABELS[typeOf(item)]}</span>
        <span className="ml-auto text-sm text-ink-secondary">{item.stage === 'DONE' && item.status === 'FAILED' ? '실패' : STAGES[item.stage]}</span>
      </li>
    ))}
  </ul>;
}
