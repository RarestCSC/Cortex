import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlTestWrapper } from '../../../../i18n/test-utils';
import { ThinkingEffortControl } from './ThinkingEffortControl';

const mockSetOption = vi.fn();
let mockOptions: Array<Record<string, unknown>> = [];
let mockStatus = 'unavailable';

vi.mock('../../../../hooks/useConfigOptions', () => ({
  useConfigOptions: () => ({
    options: mockOptions,
    status: mockStatus,
    setOption: mockSetOption,
  }),
}));

describe('thinking effort control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetOption.mockResolvedValue(undefined);
    mockStatus = 'confirmed';
    mockOptions = [];
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });

  it('previews a drag and sets only the final thinking_effort once on release', async () => {
    mockOptions = [
      {
        id: 'thinking_effort',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
    ];
    render(<ThinkingEffortControl sessionId="session-1" />, { wrapper: IntlTestWrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Thinking: High' }));
    const slider = screen.getByRole('slider', { name: 'Thinking' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider).toHaveAttribute('aria-valuetext', 'Low');
    expect(screen.getByRole('button', { name: 'Thinking: High' })).toBeInTheDocument();
    expect(screen.getByText('Preview · release to apply')).toBeInTheDocument();
    expect(mockSetOption).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '100' } });
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.pointerUp(slider);
    fireEvent.pointerUp(slider);

    expect(mockSetOption).toHaveBeenCalledExactlyOnceWith('thinking_effort', 'low');
    await waitFor(() => expect(slider).not.toBeDisabled());
  });

  it('distinguishes unavailable options from a model with only off', () => {
    mockOptions = [];
    mockStatus = 'unavailable';
    const { unmount } = render(<ThinkingEffortControl sessionId="session-1" />, {
      wrapper: IntlTestWrapper,
    });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Configuration is not available yet')).toBeInTheDocument();
    unmount();

    mockOptions = [
      {
        id: 'thinking_effort',
        type: 'select',
        currentValue: 'off',
        options: [{ value: 'off', name: 'Off' }],
      },
    ];
    mockStatus = 'confirmed';
    render(<ThinkingEffortControl sessionId="session-1" />, { wrapper: IntlTestWrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Thinking: Off' }));
    expect(screen.getByText('This model has no adjustable thinking effort')).toBeInTheDocument();
  });

  it('clamps its width and flips below the trigger when there is no room above', () => {
    mockOptions = [
      {
        id: 'thinking_effort',
        type: 'select',
        currentValue: 'high',
        options: [{ value: 'high', name: 'High' }],
      },
    ];
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'BUTTON') {
          return {
            top: 5,
            bottom: 35,
            left: 260,
            right: 290,
            width: 30,
            height: 30,
            x: 260,
            y: 5,
            toJSON: () => ({}),
          } as DOMRect;
        }
        if (this.getAttribute('data-testid') === 'thinking-effort-popover') {
          return {
            top: 0,
            bottom: 200,
            left: 0,
            right: 200,
            width: 200,
            height: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return new DOMRect();
      });

    render(<ThinkingEffortControl sessionId="session-1" />, { wrapper: IntlTestWrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Thinking: High' }));

    const popover = screen.getByTestId('thinking-effort-popover');
    expect(popover).toHaveAttribute('data-placement', 'bottom');
    expect(popover.style.left).toBe('8px');
    expect(popover.style.width).toBe('284px');
    expect(popover.style.maxHeight).toBe('309px');
    rectSpy.mockRestore();
  });

  it('dismisses on an outside pointer press and Escape, but keeps inside presses open', () => {
    mockOptions = [
      {
        id: 'thinking_effort',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
    ];
    render(<ThinkingEffortControl sessionId="session-1" />, { wrapper: IntlTestWrapper });
    const trigger = screen.getByRole('button', { name: 'Thinking: High' });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByTestId('thinking-effort-popover'));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('thinking-effort-popover')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('thinking-effort-popover')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(mockSetOption).not.toHaveBeenCalled();
  });

  function setChoices(values: string[], currentValue = values[0]) {
    mockOptions = [
      {
        id: 'thinking_effort',
        type: 'select',
        currentValue,
        options: values.map((value) => ({
          value,
          name: value === 'custom' ? 'Harness custom' : value,
        })),
      },
    ];
  }

  it('opens below the home composer when opening above would cover the welcome brand', () => {
    setChoices(['off', 'high'], 'high');
    const welcome = document.createElement('div');
    welcome.className = 'cortex-welcome';
    document.body.appendChild(welcome);
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'BUTTON')
          return { top: 350, bottom: 380, left: 80, height: 30, width: 80 } as DOMRect;
        if (this.classList.contains('cortex-welcome'))
          return { top: 170, bottom: 290, height: 120 } as DOMRect;
        if (this.getAttribute('data-drop-zone') === 'true') return { bottom: 420 } as DOMRect;
        if (this.getAttribute('data-testid') === 'thinking-effort-popover')
          return { height: 200 } as DOMRect;
        return new DOMRect();
      });
    try {
      render(
        <div data-drop-zone="true">
          <ThinkingEffortControl sessionId="session-1" modelLabel="Test model" compact />
        </div>,
        { wrapper: IntlTestWrapper }
      );
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('thinking-effort-popover')).toHaveAttribute(
        'data-placement',
        'bottom'
      );
      expect(screen.getByTestId('thinking-effort-popover').style.top).toBe('428px');
      expect(screen.getByTestId('thinking-effort-popover').style.maxHeight).toBe('332px');
    } finally {
      rectSpy.mockRestore();
      welcome.remove();
    }
  });

  function openControl() {
    const result = render(
      <ThinkingEffortControl sessionId="session-1" modelLabel="Test model" compact />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button'));
    return { ...result, slider: screen.getByRole('slider') };
  }

  it('shows the model and maps grouped harness choices without inventing standard levels', async () => {
    mockOptions = [
      {
        id: 'thinking_effort',
        type: 'select',
        currentValue: 'quick',
        options: [
          {
            group: 'Harness',
            options: [
              { value: 'quick', name: 'Quick' },
              { value: 'custom', name: 'Harness custom' },
            ],
          },
          { value: 'deep', name: 'Deep' },
        ],
      },
    ];
    const { slider } = openControl();
    expect(screen.getByRole('dialog', { name: 'Thinking' })).toBeInTheDocument();
    expect(screen.getByText('Test model')).toBeInTheDocument();
    const stops = screen.getByRole('dialog').querySelectorAll('.effort-stop');
    expect(Array.from(stops, (stop) => stop.getAttribute('data-value'))).toEqual([
      'quick',
      'custom',
      'deep',
    ]);
    expect(screen.getByRole('dialog').querySelectorAll('.effort-stop-label')).toHaveLength(3);
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '50' } });
    expect(slider).toHaveAttribute('aria-valuetext', 'Harness custom');
    expect(
      screen.getByRole('dialog').querySelector('.effort-stop-label[data-active="true"]')
    ).toHaveTextContent('Harness custom');
    fireEvent.pointerUp(slider);
    expect(mockSetOption).toHaveBeenCalledExactlyOnceWith('thinking_effort', 'custom');
    await waitFor(() => expect(slider).not.toBeDisabled());
  });

  it('renders a visible stop and label for every actual backend level, not a fixed four-level scale', () => {
    setChoices(['off', 'low', 'medium', 'high', 'max'], 'medium');
    openControl();
    const panel = screen.getByRole('dialog');
    const stops = Array.from(panel.querySelectorAll('.effort-stop'));
    expect(stops.map((stop) => stop.getAttribute('data-value'))).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'max',
    ]);
    expect(stops.map((stop) => stop.getAttribute('data-filled'))).toEqual([
      'true',
      'true',
      'true',
      'false',
      'false',
    ]);
    expect(
      Array.from(panel.querySelectorAll('.effort-stop-label'), (label) => label.textContent)
    ).toEqual(['Off', 'Low', 'Medium', 'High', 'Max']);
    expect(panel.querySelector('.effort-stop-label[data-active="true"]')).toHaveTextContent(
      'Medium'
    );
    expect(mockSetOption).not.toHaveBeenCalled();
  });

  it('moves one real level per arrow key and commits on key release, with Home and End support', async () => {
    setChoices(['off', 'medium', 'max'], 'medium');
    const { slider } = openControl();
    expect(slider).toHaveFocus();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuetext', 'Max');
    expect(mockSetOption).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(mockSetOption).toHaveBeenCalledExactlyOnceWith('thinking_effort', 'max');
    await waitFor(() => expect(slider).not.toBeDisabled());
    mockSetOption.mockClear();
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyUp(slider, { key: 'Home' });
    expect(mockSetOption).toHaveBeenCalledExactlyOnceWith('thinking_effort', 'off');
    await waitFor(() => expect(slider).not.toBeDisabled());
  });

  it('does not write when a drag returns to the confirmed level', () => {
    setChoices(['low', 'high'], 'high');
    const { slider } = openControl();
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.change(slider, { target: { value: '100' } });
    fireEvent.pointerUp(slider);
    expect(mockSetOption).not.toHaveBeenCalled();
  });

  it('uses the confirmed server response, including a normalized result, after submission', async () => {
    setChoices(['off', 'low', 'high'], 'off');
    const { slider, rerender } = openControl();
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '100' } });
    fireEvent.pointerUp(slider);
    expect(mockSetOption).toHaveBeenCalledExactlyOnceWith('thinking_effort', 'high');
    await waitFor(() => expect(slider).not.toBeDisabled());
    setChoices(['off', 'low', 'high'], 'low');
    rerender(<ThinkingEffortControl sessionId="session-1" modelLabel="Test model" compact />);
    expect(screen.getByRole('button', { name: 'Thinking: Low' })).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuetext', 'Low');
    expect(slider).toHaveValue('50');
  });

  it('does not map an unknown confirmed value to a made-up supported level', () => {
    setChoices(['low', 'high'], 'unlisted');
    const { slider } = openControl();
    expect(screen.getByRole('button', { name: 'Thinking: unlisted' })).toBeInTheDocument();
    expect(slider).toBeDisabled();
    expect(slider).toHaveAttribute('aria-valuetext', 'unlisted');
    expect(mockSetOption).not.toHaveBeenCalled();
  });

  it.each(['pointerCancel', 'lostPointerCapture', 'Escape', 'outside'])(
    'cancels an uncommitted preview on %s',
    (reason) => {
      setChoices(['off', 'high'], 'high');
      const { slider } = openControl();
      fireEvent.pointerDown(slider);
      fireEvent.change(slider, { target: { value: '0' } });
      if (reason === 'Escape') fireEvent.keyDown(slider, { key: 'Escape' });
      else if (reason === 'outside') fireEvent.pointerDown(document.body);
      else if (reason === 'pointerCancel') fireEvent.pointerCancel(slider);
      else fireEvent.lostPointerCapture(slider);
      fireEvent.pointerUp(slider);
      expect(mockSetOption).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Thinking: High' })).toBeInTheDocument();
    }
  );

  it.each(['session', 'model', 'choices', 'confirmed', 'pending'])(
    'invalidates a drag when %s changes',
    (change) => {
      setChoices(['low', 'high'], 'high');
      const { slider, rerender } = openControl();
      fireEvent.pointerDown(slider);
      fireEvent.change(slider, { target: { value: '0' } });
      if (change === 'choices') setChoices(['off', 'medium', 'max'], 'medium');
      if (change === 'confirmed') setChoices(['low', 'high'], 'low');
      if (change === 'pending') mockStatus = 'pending';
      rerender(
        <ThinkingEffortControl
          sessionId={change === 'session' ? 'session-2' : 'session-1'}
          modelLabel={change === 'model' ? 'New model' : 'Test model'}
          compact
        />
      );
      fireEvent.pointerUp(slider);
      expect(mockSetOption).not.toHaveBeenCalled();
      if (change === 'session') expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  );

  it('blocks duplicate submits while pending and returns to server state with an error on failure', async () => {
    setChoices(['low', 'high'], 'high');
    let reject!: (error: Error) => void;
    mockSetOption.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    const { slider, rerender } = openControl();
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.pointerUp(slider);
    expect(slider).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Updating…');
    expect(slider).toHaveAttribute('aria-valuetext', 'High');
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.pointerUp(slider);
    expect(mockSetOption).toHaveBeenCalledTimes(1);
    mockStatus = 'error';
    await act(async () => reject(new Error('rejected')));
    rerender(<ThinkingEffortControl sessionId="session-1" modelLabel="Test model" compact />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not update thinking effort');
    expect(slider).not.toBeDisabled();
    expect(slider).toHaveAttribute('aria-valuetext', 'High');
  });
});
