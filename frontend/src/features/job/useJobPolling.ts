import { useEffect, useEffectEvent } from 'react';
import { getTransportJob } from '../../api/client';
import { ApiRequestError } from '../../api/errors';
import type { TransportJob } from '../../api/types';

export function useJobPolling(id: string | undefined, onJob: (job: TransportJob) => void,
  onFailure: () => void, onMissing?: () => void) {
  const received = useEffectEvent(onJob);
  const failed = useEffectEvent((missing: boolean) => {
    if (missing && onMissing) onMissing();
    else onFailure();
  });
  const stopOnMissing = Boolean(onMissing);
  useEffect(() => {
    if (!id) return;
    const jobId = id;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const job = await getTransportJob(jobId);
        if (stopped) return;
        failures = 0;
        received(job);
        if (job.status !== 'RUNNING') return;
      } catch (error) {
        if (stopped) return;
        const missing = stopOnMissing && error instanceof ApiRequestError && error.status === 404;
        if (missing || ++failures >= 3) {
          failed(missing);
          return;
        }
      }
      timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, stopOnMissing]);
}
