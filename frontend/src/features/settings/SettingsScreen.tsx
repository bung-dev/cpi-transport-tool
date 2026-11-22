import { useState } from 'react';
import { getSettings, saveSettings } from '../../api/client';
import { ApiRequestError, toApiError, type ApiError } from '../../api/errors';
import type { Settings } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Switch } from '../../components/ui/Switch';
import { TextInput } from '../../components/ui/TextInput';
import { useRemote } from '../../lib/useRemote';
import { readBrowserNoticeSetting, setBrowserNoticeEnabled } from '../notice/completionNotice';

const fields = [
  ['previewConcurrency', '미리보기 동시 처리 개수'],
  ['transportConcurrency', '실제 이관 동시 처리 개수'],
] as const;
const rangeMessage = '1~8 사이로 입력하세요';

type SaveState = 'idle' | 'saving' | 'saved' | 'invalid' | { error: ApiError };

function validCount(value: string) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 8;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [values, setValues] = useState({
    previewConcurrency: String(initial.previewConcurrency),
    transportConcurrency: String(initial.transportConcurrency),
  });
  const [state, setState] = useState<SaveState>('idle');
  const valid = fields.every(([key]) => validCount(values[key]));

  async function save() {
    if (!valid || state === 'saving') return;
    setState('saving');
    try {
      await saveSettings({
        previewConcurrency: Number(values.previewConcurrency),
        transportConcurrency: Number(values.transportConcurrency),
      });
      setState('saved');
    } catch (error) {
      setState(error instanceof ApiRequestError && error.status === 400 ? 'invalid' : { error: toApiError(error) });
    }
  }

  return (
    <Card className="max-w-lg">
      <form className="grid min-w-0 gap-5" onSubmit={event => { event.preventDefault(); void save(); }}>
        {fields.map(([key, label]) => {
          const invalid = !validCount(values[key]);
          return (
            <div key={key} className="grid min-w-0 gap-1">
              <TextInput label={label} type="number" min={1} max={8} step={1} value={values[key]}
                disabled={state === 'saving'} aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${key}-hint ${key}-error` : `${key}-hint`}
                onChange={event => {
                  setValues({ ...values, [key]: event.target.value });
                  setState('idle');
                }}
              />
              <p id={`${key}-hint`} className="text-sm text-ink-secondary">1이면 하나씩 차례로 처리합니다.</p>
              {invalid && <p id={`${key}-error`} className="text-sm text-danger-fg">{rangeMessage}</p>}
            </div>
          );
        })}
        <Button className="justify-self-start" type="submit" variant="primary" disabled={!valid} loading={state === 'saving'}>저장</Button>
        {state === 'invalid' && <p role="alert" className="text-danger-fg">{rangeMessage}</p>}
        {typeof state === 'object' && <ErrorAlert error={state.error} onRetry={save} />}
        {state === 'saved' && <p role="status" className="text-success-fg">저장했습니다. 다음 이관부터 적용됩니다.</p>}
      </form>
    </Card>
  );
}

function CompletionNoticeSetting() {
  const [setting, setSetting] = useState(readBrowserNoticeSetting);
  const [pending, setPending] = useState(false);

  async function change(enabled: boolean) {
    setPending(true);
    try {
      setSetting(await setBrowserNoticeEnabled(enabled));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card role="region" aria-labelledby="completion-notice-heading" className="mt-5 max-w-lg"
      title={<span id="completion-notice-heading">완료 알림</span>} titleAs="h2">
      <Switch label="브라우저 알림"
        description="이관이 끝났을 때 이 탭을 보고 있지 않으면 브라우저 알림을 띄웁니다. 이 브라우저에만 저장됩니다"
        checked={setting === 'on'} disabled={pending || setting === 'unsupported'}
        onChange={event => void change(event.target.checked)} />
      {setting === 'blocked' && (
        <p role="alert" className="mt-2 text-sm text-danger-fg">브라우저에서 알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용한 뒤 다시 켜세요</p>
      )}
      {setting === 'unsupported' && <p className="mt-2 text-sm text-ink-secondary">이 브라우저는 알림을 지원하지 않습니다</p>}
    </Card>
  );
}

export function SettingsScreen() {
  const { state, retry } = useRemote(getSettings, 'settings');
  return (
    <section className="min-w-0">
      <PageHeader title="설정" description="미리보기와 실제 이관에서 한 번에 처리할 iFlow 수를 정합니다." />
      {state.status === 'loading' && <p role="status">불러오는 중</p>}
      {state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
      {state.status === 'ok' && <SettingsForm initial={state.data} />}
      <CompletionNoticeSetting />
    </section>
  );
}
