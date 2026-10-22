import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getTenants, getTenantStatus } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import type { TenantsResponse, TenantStatusResponse } from '../../api/types';
export type LoadState<T> = { state: 'loading' } | { state: 'success'; data: T } | { state: 'error'; error: ApiError };
export interface TenantContextValue {
  tenants: LoadState<TenantsResponse>;
  status: LoadState<TenantStatusResponse>;
  readOnly: boolean | undefined;
  sourceTenantId: string | null;
  targetTenantId: string | null;
  setSourceTenantId: (id: string | null) => void;
  setTargetTenantId: (id: string | null) => void;
  /** 원본 라디오를 사용자가 바꿨을 때만 부른다. 재마운트된 TenantSelect가 take로 한 번 받아 그 라디오로 포커스를 돌린다(REQ-310). */
  requestSourceFocus: (id: string) => void;
  takeSourceFocusRequest: () => string | null;
  reload: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  openTenantsTab: () => void;
}
const noop = () => {};
export const DEFAULT_TENANT_CONTEXT: TenantContextValue = {
  tenants: { state: 'loading' }, status: { state: 'loading' }, readOnly: undefined,
  sourceTenantId: null, targetTenantId: null, setSourceTenantId: noop, setTargetTenantId: noop,
  requestSourceFocus: noop, takeSourceFocusRequest: () => null,
  reload: async () => {}, refreshStatus: async () => {}, openTenantsTab: noop,
};
export const TenantContext = createContext<TenantContextValue>(DEFAULT_TENANT_CONTEXT);
export function useTenants() { return useContext(TenantContext); }
export function useReadOnlyState() {
  const { readOnly, status } = useTenants();
  return {
    realDisabled: readOnly !== false,
    notice: readOnly === true ? '읽기 전용 모드입니다. 실제 이관은 꺼져 있습니다'
      : status.state === 'error' ? '읽기 전용 여부를 확인하지 못했습니다. 상태 칩을 눌러 다시 확인하세요' : undefined,
  };
}
export function TenantProvider({ children, openTenantsTab }: { children: ReactNode; openTenantsTab: () => void }) {
  const [tenants, setTenants] = useState<LoadState<TenantsResponse>>({ state: 'loading' });
  const [status, setStatus] = useState<LoadState<TenantStatusResponse>>({ state: 'loading' });
  const [sourceTenantId, setSourceTenantId] = useState<string | null>(null);
  const [targetTenantId, setTargetTenantId] = useState<string | null>(null);
  // AI-NOTE: 원본이 바뀌면 TransportTab이 폼 전체를 다시 마운트(key)해 포커스가 있던 라디오가 사라진다. 포커스 요청은 재마운트에서 살아남는 Provider의 ref에 두고 새 TenantSelect가 한 번만 소비한다. 초기 로드·reload로 원본이 정해질 때는 요청하지 않아 포커스를 훔치지 않는다 (근거: REQ-310, REQ-308 AC-5)
  const sourceFocus = useRef<string | null>(null);
  const requestSourceFocus = useCallback((id: string) => { sourceFocus.current = id; }, []);
  const takeSourceFocusRequest = useCallback(() => { const id = sourceFocus.current; sourceFocus.current = null; return id; }, []);
  const initialized = useRef(false);
  const started = useRef(false);
  const listVersion = useRef(0);
  const statusVersion = useRef(0);
  const statusPending = useRef(0);
  const loadStatus = useCallback(async (refresh: boolean) => {
    const version = ++statusVersion.current;
    statusPending.current += 1;
    setStatus({ state: 'loading' });
    try {
      const data = await getTenantStatus(refresh);
      if (version === statusVersion.current) setStatus({ state: 'success', data });
    } catch (e) {
      if (version === statusVersion.current) setStatus({ state: 'error', error: toApiError(e) });
    } finally {
      statusPending.current -= 1;
    }
  }, []);
  const reload = useCallback(async () => {
    const version = ++listVersion.current;
    setTenants({ state: 'loading' });
    await Promise.all([loadStatus(false), (async () => {
      try {
        const data = await getTenants();
        if (version !== listVersion.current) return;
        const has = (id: string | null) => data.tenants.some(t => t.id === id);
        if (!initialized.current) {
          setSourceTenantId(has('DEV') ? 'DEV' : null);
          setTargetTenantId(has('PRD') ? 'PRD' : null);
          initialized.current = true;
        } else {
          setSourceTenantId(id => has(id) ? id : null);
          setTargetTenantId(id => has(id) ? id : null);
        }
        setTenants({ state: 'success', data });
      } catch (e) {
        if (version === listVersion.current) setTenants({ state: 'error', error: toApiError(e) });
      }
    })()]);
  }, [loadStatus]);
  const refreshStatus = useCallback(async () => {
    if (statusPending.current > 0) return;
    await loadStatus(true);
  }, [loadStatus]);
  useEffect(() => { if (!started.current) { started.current = true; void reload(); } }, [reload]);
  return <TenantContext.Provider value={{ tenants, status, readOnly: status.state === 'success' ? status.data.readOnly : undefined,
    sourceTenantId, targetTenantId, setSourceTenantId, setTargetTenantId, requestSourceFocus, takeSourceFocusRequest, reload, refreshStatus, openTenantsTab }}>{children}</TenantContext.Provider>;
}
