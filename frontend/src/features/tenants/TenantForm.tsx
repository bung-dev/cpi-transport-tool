import { useId, useRef, useState, type FormEvent } from 'react';
import { registerTenant, updateTenant } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/TextInput';
interface Props { tenantId?: string; disabled?: boolean; onSuccess: () => Promise<void>; onCancel?: () => void }
export function TenantForm({ tenantId, disabled = false, onSuccess, onCancel }: Props) {
  const [name, setName] = useState('');
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
        await updateTenant(tenantId, { ...(name.trim() ? { name: name.trim() } : {}), ...(serviceKey ? { serviceKey } : {}) });
      } else {
        await registerTenant(name.trim(), serviceKey!);
      }
      setName(''); setText('');
      if (fileRef.current) fileRef.current.value = '';
      await onSuccess();
    } catch (e) { setError(toApiError(e)); }
    finally { setBusy(false); }
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
