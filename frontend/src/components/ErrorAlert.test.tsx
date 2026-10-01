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

  it('REQ-107 AC-3: role=alert의 danger 색조 Callout — danger-bg 배경, 오류 아이콘(aria-hidden), 굵기 600 danger-fg 제목, ink 서버 message', () => {
    render(<ErrorAlert error={{ title: 'CPI에 연결할 수 없습니다', message: 'CPI unavailable' }} />);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('bg-danger-bg');
    expect(alert.className).toContain('text-danger-fg');
    expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const title = screen.getByText('CPI에 연결할 수 없습니다');
    expect(title.className).toContain('font-semibold');
    expect(title.closest('div[class*="text-danger-fg"]')).toBe(alert);
    expect(screen.getByText('CPI unavailable').closest('div[class*="text-ink"]')).not.toBeNull();
  });

  it('REQ-107 AC-3: "다시 시도"는 onRetry가 있을 때만 있고 sm secondary 버튼이다', () => {
    const { rerender } = render(<ErrorAlert error={{ title: 't', message: 'm' }} />);
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    rerender(<ErrorAlert error={{ title: 't', message: 'm' }} onRetry={() => {}} />);
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry.className).toContain('h-7');
    expect(retry.className).toContain('border-hairline-strong');
    expect(retry.className).toContain('bg-canvas');
  });

  it('REQ-107 AC-3: message가 없어도 제목만으로 alert를 보이고 재시도 버튼만 있는 경우도 렌더된다', () => {
    const { rerender } = render(<ErrorAlert error={{ title: '제목만' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('제목만');
    rerender(<ErrorAlert error={{ title: '제목만' }} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});
