import { useId, useRef, useState, type FormEvent } from 'react';
import { registerTenant, updateTenant } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/TextInput';
interface Props { tenantId?: string; initialName?: string; disabled?: boolean; onSuccess: () => Promise<void>; onCancel?: () => void }
export function TenantForm({ tenantId, initialName = '', disabled = false, onSuccess, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || busy) return;
    setError(undefined);
    setBusy(true);
    try {
      const file = fileRef.current?.files?.[0];
      let serviceKey: Record<string, unknown> | undefined;
      if (file || text || !tenantId) {
        try {
          const parsed: unknown = JSON.parse(file ? await file.text() : text);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
          serviceKey = parsed as Record<string, unknown>;
        } catch {
          setError({ title: '서비스 키 JSON 형식이 아닙니다' });
          return;
        }
      }
      if (tenantId) {
        const updatedName = name.trim();
        await updateTenant(tenantId, { ...(updatedName && updatedName !== initialName.trim() ? { name: updatedName } : {}), ...(serviceKey ? { serviceKey } : {}) });
      } else {
        await registerTenant(name.trim(), serviceKey!);
      }
      setName(''); setText('');
      if (fileRef.current) fileRef.current.value = '';
      await onSuccess();
    } catch (e) { setError(toApiError(e)); }
    finally {
      // AI-NOTE: 성공·실패(요청 전 JSON 검사, 서버 오류, 네트워크 오류, onSuccess 실패) 모두 서비스 키 입력과 파일 선택을 비운다. 이름은 실패 때 유지한다. 키를 고쳐 다시 붙여넣어야 하는 불편은 명세가 받아들인 대가다 (근거: REQ-318 AC-1·AC-2, 직전 REQ-305 AC-3·QA-102)
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  }
  return <form onSubmit={submit} className="grid min-w-0 gap-3">
    <fieldset disabled={disabled || busy} className="grid min-w-0 gap-3">
      <legend className="sr-only">{tenantId ? '테넌트 수정' : '테넌트 등록'}</legend>
      <TextInput label="이름" value={name} onChange={e => setName(e.target.value)} maxLength={40} required={!tenantId} />
      <label htmlFor={`${inputId}-file`} className="text-sm">서비스 키 파일</label>
      <input ref={fileRef} id={`${inputId}-file`} type="file" accept=".json,application/json" className="w-full min-w-0 text-sm" />
      <label htmlFor={`${inputId}-text`} className="text-sm">서비스 키 붙여넣기</label>
      <textarea id={`${inputId}-text`} value={text} onChange={e => setText(e.target.value)} rows={5} className="w-full min-w-0 rounded-md border border-control-border bg-canvas p-3 text-sm" />
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" loading={busy}>{tenantId ? '저장' : '등록'}</Button>
        {onCancel && <Button onClick={onCancel}>취소</Button>}</div>
    </fieldset>
    {error && <ErrorAlert error={error} />}
  </form>;
}
