import type { JobItem, JobStage } from '../../api/types';

const STAGES: Record<JobStage, string> = {
  WAITING: '대기', DOWNLOAD: '내려받기', CONFIGURATION_READ: '구성 값 읽기', TARGET: '대상 확인',
  UPLOAD: '업로드', DEPLOY: '배포', DONE: '완료', SKIPPED: '건너뜀',
};

export function JobProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  return <progress aria-label={label} aria-valuenow={done} aria-valuemax={total}
    value={done} max={total || 1} className="block h-2 w-full accent-primary" />;
}

export function JobItems({ items, nameOf }: { items: JobItem[]; nameOf?: (item: JobItem) => string | undefined }) {
  return <ul aria-label="iFlow 진행" className="mt-3 min-w-0 divide-y divide-hairline">
    {items.map(item => (
      <li key={JSON.stringify([item.packageId, item.artifactId])} className="flex min-w-0 items-baseline justify-between gap-3 py-2">
        <span className="min-w-0 break-all">{nameOf?.(item) || item.artifactId}</span>
        <span className="shrink-0 text-sm text-ink-secondary">{item.stage === 'DONE' && item.status === 'FAILED' ? '실패' : STAGES[item.stage]}</span>
      </li>
    ))}
  </ul>;
}
