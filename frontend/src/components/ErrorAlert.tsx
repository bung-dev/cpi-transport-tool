import type { ApiError } from '../api/errors';
import { Button } from './ui/Button';

interface Props {
  error: ApiError;
  onRetry?: () => void;
}

// REQ-008 AC-3: 제목과 서버 message는 텍스트 노드로만 렌더링한다.
export function ErrorAlert({ error, onRetry }: Props) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger-fg bg-surface p-4 min-w-0 break-words text-ink"
    >
      <p className="font-medium">{error.title}</p>
      {error.message !== undefined && <p className="mt-1 text-sm">{error.message}</p>}
      {onRetry && (
        <div className="mt-3">
          <Button onClick={onRetry}>다시 시도</Button>
        </div>
      )}
    </div>
  );
}
