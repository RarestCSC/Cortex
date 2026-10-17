import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useConfigOptions } from '../../../../hooks/useConfigOptions';
import { defineMessages, useIntl } from '../../../../i18n';
import './ThinkingEffortControl.css';

const i18n = defineMessages({
  thinking: { id: 'composerConfig.thinking', defaultMessage: 'Thinking' },
  currentSession: {
    id: 'composerConfig.currentSession',
    defaultMessage: 'Current session · only affects this chat',
  },
  unavailable: {
    id: 'composerConfig.unavailable',
    defaultMessage: 'Configuration is not available yet',
  },
  unsupported: {
    id: 'composerConfig.unsupported',
    defaultMessage: 'This model has no adjustable thinking effort',
  },
  changing: { id: 'composerConfig.changing', defaultMessage: 'Updating…' },
  requestFailed: {
    id: 'composerConfig.requestFailed',
    defaultMessage: 'Could not update thinking effort',
  },
  off: { id: 'composerConfig.off', defaultMessage: 'Off' },
  low: { id: 'composerConfig.low', defaultMessage: 'Low' },
  medium: { id: 'composerConfig.medium', defaultMessage: 'Medium' },
  high: { id: 'composerConfig.high', defaultMessage: 'High' },
  max: { id: 'composerConfig.max', defaultMessage: 'Max' },
  offHint: {
    id: 'composerConfig.offHint',
    defaultMessage: 'Requests the off setting; actual behavior depends on the model.',
  },
  lowHint: { id: 'composerConfig.lowHint', defaultMessage: 'Less reasoning, prioritizing speed.' },
  mediumHint: {
    id: 'composerConfig.mediumHint',
    defaultMessage: 'Balances reasoning depth and response speed.',
  },
  highHint: {
    id: 'composerConfig.highHint',
    defaultMessage: 'More reasoning, prioritizing depth.',
  },
  maxHint: {
    id: 'composerConfig.maxHint',
    defaultMessage: 'The highest effort offered by this model.',
  },
  customHint: {
    id: 'composerConfig.customHint',
    defaultMessage: 'A model-defined setting. Release to apply it to this chat.',
  },
  preview: { id: 'composerConfig.preview', defaultMessage: 'Preview · release to apply' },
});

interface ThinkingEffortControlProps {
  sessionId: string | null;
  compact?: boolean;
  modelLabel?: string;
}

const SLIDER_MAX = 100;
const SLIDER_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
];

export function ThinkingEffortControl({
  sessionId,
  compact = false,
  modelLabel,
}: ThinkingEffortControlProps) {
  const intl = useIntl();
  const { options, status, setOption } = useConfigOptions(sessionId);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ identity: string; kind: 'pointer' | 'keyboard' } | null>(null);
  const draftRef = useRef<{ identity: string; value: number } | null>(null);
  const [draft, setDraft] = useState<{ identity: string; value: number } | null>(null);
  const submittingRef = useRef(new Set<string>());
  const [submittingSession, setSubmittingSession] = useState<string | null>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    side: 'top' | 'bottom';
  }>();
  const effort = options.find((option) => option.id === 'thinking_effort');
  const selected = effort?.type === 'select' ? effort.currentValue : undefined;
  const choices =
    effort?.type === 'select'
      ? effort.options.flatMap((item) => ('options' in item ? item.options : [item]))
      : [];
  const identity = JSON.stringify([sessionId, modelLabel, selected, choices, status]);
  const selectedIndex = choices.findIndex((choice) => choice.value === selected);
  const lastIndex = choices.length - 1;
  const toIndex = (value: number) =>
    Math.min(lastIndex, Math.max(0, Math.round((value / SLIDER_MAX) * lastIndex)));
  const toPosition = (index: number) => (lastIndex > 0 ? (index / lastIndex) * SLIDER_MAX : 0);
  const sliderValue =
    draft?.identity === identity ? draft.value : toPosition(Math.max(0, selectedIndex));
  const activeChoice = choices[toIndex(sliderValue)];
  const busy = status === 'pending' || submittingSession === sessionId;
  const adjustable = selectedIndex >= 0 && choices.length > 1 && !busy && status !== 'unavailable';
  const previewing = draft?.identity === identity && activeChoice?.value !== selected;
  const cancelPreview = () => {
    gestureRef.current = null;
    draftRef.current = null;
    setDraft(null);
  };
  const previewPosition = (value: number) => {
    if (!adjustable) return;
    const next = { identity, value: Math.max(0, Math.min(SLIDER_MAX, value)) };
    draftRef.current = next;
    setDraft(next);
  };
  const commitPreview = () => {
    const pending = draftRef.current;
    cancelPreview();
    if (
      !sessionId ||
      !adjustable ||
      pending?.identity !== identity ||
      submittingRef.current.has(sessionId)
    )
      return;
    const nextValue = choices[toIndex(pending.value)]?.value;
    if (!nextValue || nextValue === selected) return;
    submittingRef.current.add(sessionId);
    setSubmittingSession(sessionId);
    void setOption('thinking_effort', nextValue)
      .catch(() => undefined)
      .finally(() => {
        submittingRef.current.delete(sessionId);
        setSubmittingSession((current) => (current === sessionId ? null : current));
      });
  };
  const labelFor = (value: string, fallback: string) => {
    const key = value.toLowerCase() as 'off' | 'low' | 'medium' | 'high' | 'max';
    return ['off', 'low', 'medium', 'high', 'max'].includes(key)
      ? intl.formatMessage(i18n[key])
      : fallback;
  };
  const hintFor = (value: string) => {
    const key = value.toLowerCase();
    const message =
      key === 'off'
        ? i18n.offHint
        : key === 'low'
          ? i18n.lowHint
          : key === 'medium'
            ? i18n.mediumHint
            : key === 'high'
              ? i18n.highHint
              : key === 'max'
                ? i18n.maxHint
                : i18n.customHint;
    return intl.formatMessage(message);
  };

  useLayoutEffect(() => {
    gestureRef.current = null;
    draftRef.current = null;
    setDraft(null);
  }, [identity]);

  useEffect(() => {
    setOpen(false);
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      ) {
        cancelPreview();
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelPreview();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onKeyDown);
    (panelRef.current?.querySelector<HTMLInputElement>('input') ?? panelRef.current)?.focus();
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const placePanel = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const width = Math.min(288, window.innerWidth - 16);
      const height = Math.max(panel.getBoundingClientRect().height, panel.scrollHeight + 2);
      const gap = 8;
      const topBoundary = Math.max(
        8,
        (document.querySelector('.titlebar-drag-region')?.getBoundingClientRect().bottom ?? 0) + gap
      );
      const roomAbove = Math.max(0, trigger.top - gap - topBoundary);
      const composer = triggerRef.current?.closest('[data-drop-zone="true"]');
      const bottomAnchor = composer?.getBoundingClientRect().bottom ?? trigger.bottom;
      const roomBelow = Math.max(0, window.innerHeight - bottomAnchor - gap - 8);
      const welcome = document.querySelector('.cortex-welcome')?.getBoundingClientRect();
      const wouldCoverWelcome =
        welcome && trigger.top - gap > welcome.top && trigger.top - height - gap < welcome.bottom;
      const side =
        wouldCoverWelcome && roomBelow >= height
          ? 'bottom'
          : roomAbove >= height || roomAbove >= roomBelow
            ? 'top'
            : 'bottom';
      const availableHeight = Math.max(1, side === 'top' ? roomAbove : roomBelow);
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8));
      const top =
        side === 'top'
          ? Math.max(topBoundary, trigger.top - Math.min(height, availableHeight) - gap)
          : Math.max(topBoundary, bottomAnchor + gap);
      setPlacement({ top, left, width, maxHeight: availableHeight, side });
    };
    placePanel();
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    return () => {
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
    };
  }, [open, identity, busy, previewing, intl]);

  if (!sessionId) return null;
  const label = selected
    ? labelFor(selected, choices.find((choice) => choice.value === selected)?.name ?? selected)
    : intl.formatMessage(i18n.thinking);
  const activeLabel =
    selectedIndex >= 0 && activeChoice ? labelFor(activeChoice.value, activeChoice.name) : label;
  const tone = selected?.toLowerCase() ?? 'off';
  const activeTone = activeChoice?.value.toLowerCase() ?? tone;
  const sliderStyle = {
    '--effort-progress': `calc(var(--effort-thumb-size) / 2 + (100% - var(--effort-thumb-size)) * ${sliderValue / SLIDER_MAX})`,
    '--effort-label-width': `${100 / choices.length}%`,
  } as CSSProperties;

  return (
    <div className="relative shrink-0" data-testid="thinking-effort-control">
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex max-w-40 items-center gap-1 rounded-full px-2 py-1 text-xs text-text-primary/70 outline-none hover:bg-background-secondary hover:text-text-primary focus-visible:ring-1 focus-visible:ring-border-active disabled:opacity-50"
        aria-label={`${intl.formatMessage(i18n.thinking)}: ${label}`}
        title={`${intl.formatMessage(i18n.thinking)}: ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={busy}
        onClick={() => {
          cancelPreview();
          setOpen((value) => !value);
        }}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="effort-label truncate" data-tone={tone}>
          {compact ? label : `${intl.formatMessage(i18n.thinking)}: ${label}`}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={panelRef}
          data-testid="thinking-effort-popover"
          data-placement={placement?.side}
          role="dialog"
          aria-label={intl.formatMessage(i18n.thinking)}
          aria-busy={busy}
          tabIndex={-1}
          className="effort-popover fixed z-50 min-w-0 text-sm shadow-lg no-drag"
          style={{
            top: placement?.top ?? 0,
            left: placement?.left ?? 0,
            width: placement?.width ?? Math.min(288, window.innerWidth - 16),
            maxHeight: placement ? `${placement.maxHeight}px` : 'min(70vh, 24rem)',
            overflowY: 'auto',
            visibility: placement ? 'visible' : 'hidden',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="effort-head-icon" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div className="min-w-0 flex-1 text-center">
              <p className="effort-label font-semibold" data-tone={activeTone}>
                {activeLabel}
              </p>
              {modelLabel && (
                <p className="truncate text-[10px] text-text-secondary" title={modelLabel}>
                  {modelLabel}
                </p>
              )}
            </div>
            <span className="w-8 shrink-0" aria-hidden="true" />
          </div>
          {busy && (
            <p role="status" className="text-xs text-text-secondary">
              {intl.formatMessage(i18n.changing)}
            </p>
          )}
          {status === 'error' && (
            <p role="alert" className="text-xs text-text-danger">
              {intl.formatMessage(i18n.requestFailed)}
            </p>
          )}
          {status === 'unavailable' || !effort ? (
            <p className="px-2 py-2 text-xs text-text-secondary">
              {intl.formatMessage(i18n.unavailable)}
            </p>
          ) : effort.type !== 'select' ? (
            <p className="px-2 py-2 text-xs text-text-secondary">
              {intl.formatMessage(i18n.unsupported)}
            </p>
          ) : choices.length <= 1 ? (
            <p className="px-2 py-2 text-xs text-text-secondary">
              {intl.formatMessage(i18n.unsupported)}
            </p>
          ) : (
            <>
              <div className="effort-slider-group" style={sliderStyle}>
                <div className="effort-slider">
                  <div className="effort-track" aria-hidden="true">
                    <div className="effort-fill" />
                    {choices.map((choice, index) => (
                      <span
                        key={choice.value}
                        className="effort-stop"
                        data-value={choice.value}
                        data-filled={toPosition(index) <= sliderValue}
                        style={{
                          left: `calc(var(--effort-thumb-size) / 2 + (100% - var(--effort-thumb-size)) * ${index / lastIndex})`,
                        }}
                      />
                    ))}
                  </div>
                  <input
                    className="effort-range"
                    type="range"
                    min={0}
                    max={SLIDER_MAX}
                    step={0.1}
                    value={sliderValue}
                    disabled={!adjustable}
                    aria-label={intl.formatMessage(i18n.thinking)}
                    aria-valuetext={activeLabel}
                    onPointerDown={(event) => {
                      gestureRef.current = { identity, kind: 'pointer' };
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                    }}
                    onChange={(event) => previewPosition(Number(event.target.value))}
                    onPointerUp={() => {
                      if (
                        gestureRef.current?.identity === identity &&
                        gestureRef.current.kind === 'pointer'
                      )
                        commitPreview();
                    }}
                    onPointerCancel={cancelPreview}
                    onLostPointerCapture={() => {
                      if (gestureRef.current?.kind === 'pointer') cancelPreview();
                    }}
                    onKeyDown={(event) => {
                      if (!SLIDER_KEYS.includes(event.key) || !adjustable) return;
                      event.preventDefault();
                      gestureRef.current = { identity, kind: 'keyboard' };
                      const index = toIndex(
                        draftRef.current?.identity === identity
                          ? draftRef.current.value
                          : sliderValue
                      );
                      const next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? lastIndex
                            : index +
                              (['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 1);
                      previewPosition(toPosition(Math.min(lastIndex, Math.max(0, next))));
                    }}
                    onKeyUp={(event) => {
                      if (
                        SLIDER_KEYS.includes(event.key) &&
                        gestureRef.current?.kind === 'keyboard'
                      )
                        commitPreview();
                    }}
                    onBlur={() => {
                      if (gestureRef.current?.kind === 'keyboard') commitPreview();
                    }}
                  />
                </div>
                <div className="effort-stops-labels" aria-hidden="true">
                  {choices.map((choice, index) => (
                    <span
                      key={choice.value}
                      className="effort-stop-label"
                      data-active={selectedIndex >= 0 && choice.value === activeChoice?.value}
                      title={labelFor(choice.value, choice.name)}
                      style={{
                        left: `calc(var(--effort-thumb-size) / 2 + (100% - var(--effort-thumb-size)) * ${index / lastIndex})`,
                      }}
                    >
                      {labelFor(choice.value, choice.name)}
                    </span>
                  ))}
                </div>
              </div>
              <p className="effort-hint text-xs text-text-secondary">
                {hintFor(selectedIndex >= 0 ? (activeChoice?.value ?? '') : (selected ?? ''))}
              </p>
            </>
          )}
          <p className="text-[10px] text-text-secondary" role={previewing ? 'status' : undefined}>
            {intl.formatMessage(previewing ? i18n.preview : i18n.currentSession)}
          </p>
        </div>
      )}
    </div>
  );
}
