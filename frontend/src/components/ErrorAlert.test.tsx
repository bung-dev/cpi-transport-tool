import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorAlert } from './ErrorAlert';

describe('ErrorAlert', () => {
  it('REQ-008 AC-3: role=alert에 제목과 서버 message를 보이고, 재시도 버튼은 onRetry가 있을 때만', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorAlert error={{ title: '서버 연결 설정이 없습니다', message: 'CPI_DEV_API_URL' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('서버 연결 설정이 없습니다');
    expect(alert).toHaveTextContent('CPI_DEV_API_URL');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    rerender(<ErrorAlert error={{ title: 't' }} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('REQ-008 AC-3: message의 HTML 문자열은 요소가 아니라 글자로 보인다', () => {
    render(<ErrorAlert error={{ title: 't', message: '<script>alert(1)</script><b>x</b>' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('<script>alert(1)</script><b>x</b>');
    expect(alert.querySelector('script, b')).toBeNull();
  });
});
