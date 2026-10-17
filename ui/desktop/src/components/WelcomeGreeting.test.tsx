import { act, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntlTestWrapper } from '../i18n/test-utils';
import { greetingPeriodForHour, WelcomeGreeting } from './WelcomeGreeting';

describe('Cortex welcome greeting', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    [0, 'evening'],
    [4, 'evening'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('uses the Cortex time boundary at %i:00', (hour, expected) => {
    expect(greetingPeriodForHour(hour)).toBe(expected);
  });

  it('shows the Cortex brand and updates across a time boundary without adding a clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 11, 59));
    const { unmount } = render(<WelcomeGreeting />, { wrapper: IntlTestWrapper });
    expect(screen.getByRole('img', { name: 'Cortex' })).toBeInTheDocument();
    expect(screen.getByText("Good morning. What's the task?")).toBeInTheDocument();
    expect(screen.queryByText('11:59')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Good afternoon. What's the task?")).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the current locale rather than a hard-coded English greeting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 18));
    render(
      <IntlProvider locale="zh-CN" messages={{ 'hub.goodEvening': '晚上好，今天有什么任务？' }}>
        <WelcomeGreeting />
      </IntlProvider>
    );
    expect(screen.getByText('晚上好，今天有什么任务？')).toBeInTheDocument();
  });
});
