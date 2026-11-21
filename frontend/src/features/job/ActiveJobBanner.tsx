import { createContext, useEffect, useState } from 'react';
import { getActiveTransportJob } from '../../api/client';
import { JOB_ALREADY_RUNNING } from '../../api/errors';
import type { ActiveJob } from '../../api/types';
import { jobHref } from '../../app/routes';

export const ActiveJobContext = createContext<ActiveJob | null | undefined>(undefined);

export function useActiveJob() {
  const [job, setJob] = useState<ActiveJob | null>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const active = await getActiveTransportJob().catch(() => undefined);
      if (stopped) return;
      setJob(active ?? null);
      timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return job;
}

export function ActiveJobBanner({ job }: { job: ActiveJob }) {
  return <div role="status" aria-label="실제 이관 진행 중" className="bg-primary-soft text-primary">
    <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-2 px-4 py-2 text-sm md:px-6">
      <span>실제 이관 진행 중 {job.done}/{job.total}</span>
      <span aria-hidden="true">—</span>
      <a href={jobHref(job.jobId)} className="font-medium underline">보기</a>
    </div>
  </div>;
}

export function ActiveJobNotice({ jobId, onView }: { jobId: string; onView?: () => void }) {
  return <>{JOB_ALREADY_RUNNING}{' '}
    <a href={jobHref(jobId)} onClick={onView} className="text-primary underline">진행 중인 작업 보기</a>
  </>;
}
