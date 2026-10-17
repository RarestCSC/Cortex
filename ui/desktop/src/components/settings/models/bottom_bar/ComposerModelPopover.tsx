import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, LoaderCircle, Search } from 'lucide-react';
import {
  acpSaveDefaults,
  acpSaveThinkingEffort,
  acpSetSessionModel,
} from '../../../../acp/providers';
import { useModelAndProvider } from '../../../ModelAndProviderContext';
import { useComposerModelCatalog } from '../../../../hooks/useComposerModelCatalog';
import { useConfigOptions } from '../../../../hooks/useConfigOptions';
import { getModelDisplayName } from '../predefinedModelsUtils';
import type Model from '../modelInterface';
import { defineMessages, useIntl } from '../../../../i18n';
import { trackModelChanged } from '../../../../utils/analytics';
import { toastError, toastSuccess } from '../../../../toasts';
import { ComposerProviderManager } from '../../providers/ComposerProviderManager';

const i18n = defineMessages({
  currentSession: {
    id: 'composerModel.currentSession',
    defaultMessage: 'Current session · only affects this chat',
  },
  newSessionDefault: {
    id: 'composerModel.newSessionDefault',
    defaultMessage: 'New-session default · used for future chats',
  },
  providers: { id: 'composerModel.providers', defaultMessage: 'Providers' },
  moreProviders: { id: 'composerModel.moreProviders', defaultMessage: 'More providers' },
  searchModels: { id: 'composerModel.searchModels', defaultMessage: 'Search models' },
  selectProvider: {
    id: 'composerModel.selectProvider',
    defaultMessage: 'Choose a configured provider to browse models',
  },
  noModels: { id: 'composerModel.noModels', defaultMessage: 'No models found' },
  loading: { id: 'composerModel.loading', defaultMessage: 'Loading models…' },
  switching: { id: 'composerModel.switching', defaultMessage: 'Switching model…' },
  switchFailed: { id: 'composerModel.switchFailed', defaultMessage: 'Could not switch model' },
  unavailable: {
    id: 'composerModel.unavailable',
    defaultMessage: 'Model configuration is unavailable',
  },
  useCustomModel: {
    id: 'composerModel.useCustomModel',
    defaultMessage: 'Use custom model ID “{model}”',
  },
  manageProviders: { id: 'composerModel.manageProviders', defaultMessage: 'Manage providers' },
  closePicker: { id: 'composerModel.closePicker', defaultMessage: 'Close model picker' },
  localSettings: { id: 'composerModel.localSettings', defaultMessage: 'Local model settings' },
  saveAsDefault: {
    id: 'composerModel.saveAsDefault',
    defaultMessage: 'Save current selection as new-session default',
  },
  savedDefault: {
    id: 'composerModel.savedDefault',
    defaultMessage: 'Saved model default for new sessions',
  },
  defaultSaveFailed: {
    id: 'composerModel.defaultSaveFailed',
    defaultMessage: 'Could not save model default: {error}',
  },
  saveEffortFailed: {
    id: 'composerModel.saveEffortFailed',
    defaultMessage: 'Model default saved, but thinking preference failed: {error}',
  },
  harnessEffortNotSaved: {
    id: 'composerModel.harnessEffortNotSaved',
    defaultMessage:
      'Model default saved. This provider-specific thinking value is only valid for the current session.',
  },
});

interface ComposerModelPopoverProps {
  sessionId: string | null;
  onPrepareSessionModel?: (model: Model) => Promise<void>;
  currentModel: string | null;
  currentProvider: string | null;
  disabled?: boolean;
  onSelected?: (model: string, provider: string) => void;
  onLocalSettings?: () => void;
}

const COLLAPSE_STORAGE_KEY = 'composerModel.collapsedProviders';

function readCollapsedProviders(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function ComposerModelPopover({
  sessionId,
  onPrepareSessionModel,
  currentModel,
  currentProvider,
  disabled = false,
  onSelected,
  onLocalSettings,
}: ComposerModelPopoverProps) {
  const intl = useIntl();
  const { changeModel } = useModelAndProvider();
  const { options: configOptions, status: configStatus } = useConfigOptions(sessionId);
  const catalog = useComposerModelCatalog(currentProvider);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [switching, setSwitching] = useState(false);
  const [showProviderManager, setShowProviderManager] = useState(false);
  const [providerManagerHeight, setProviderManagerHeight] = useState<number>();
  const [savingDefault, setSavingDefault] = useState(false);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(readCollapsedProviders);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const titlebarBottom =
        document.querySelector('.titlebar-drag-region')?.getBoundingClientRect().bottom ?? 0;
      const topBoundary = Math.max(8, titlebarBottom + 8);
      const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 500;
      const above = rect.top - topBoundary - 8;
      const below = window.innerHeight - rect.bottom - 8;
      const side = above >= Math.min(panelHeight, 240) || above > below ? 'top' : 'bottom';
      const maxHeight = Math.max(1, Math.min(520, side === 'top' ? above : below));
      const top =
        side === 'top'
          ? Math.max(topBoundary, rect.top - Math.min(panelHeight, maxHeight) - 8)
          : Math.max(topBoundary, rect.bottom + 8);
      setPlacement({ top, left, width, maxHeight });
    };
    place();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : undefined;
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open, showProviderManager]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open && !showProviderManager) {
      for (const provider of catalog.providers) void catalog.loadProviderModels(provider.name);
    }
  }, [open, showProviderManager, catalog.providers, catalog.loadProviderModels]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalog.providers.map((provider) => ({
      provider,
      models: (catalog.providerResults[provider.name]?.models ?? []).filter(
        (model) =>
          !query ||
          model.name.toLowerCase().includes(query) ||
          (model.alias ?? '').toLowerCase().includes(query) ||
          provider.metadata.display_name.toLowerCase().includes(query)
      ),
    }));
  }, [catalog.providers, catalog.providerResults, search]);
  const hasModels = groups.some((group) => group.models.length > 0);

  // Searching must never hide a hit behind a collapsed header.
  const searching = search.trim().length > 0;

  const toggleProvider = (providerName: string) => {
    setCollapsedProviders((previous) => {
      const next = new Set(previous);
      if (next.has(providerName)) {
        next.delete(providerName);
      } else {
        next.add(providerName);
      }
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // A blocked storage quota only costs persistence, not the toggle itself.
      }
      return next;
    });
  };

  const selectModel = async (model: Model) => {
    if (switching || configStatus === 'pending') return;
    setSwitching(true);
    try {
      if (!sessionId && onPrepareSessionModel) {
        await onPrepareSessionModel(model);
        trackModelChanged(model.provider, model.name);
        setOpen(false);
      } else if (sessionId) {
        const applied = await acpSetSessionModel(sessionId, model.provider, model.name);
        const appliedModel = applied.modelId ?? model.name;
        const appliedProvider = applied.providerId ?? model.provider;
        trackModelChanged(appliedProvider, appliedModel);
        onSelected?.(appliedModel, appliedProvider);
      } else {
        const succeeded = await changeModel(null, model);
        if (!succeeded) return;
        trackModelChanged(model.provider, model.name);
        onSelected?.(model.name, model.provider);
      }
      setSearch('');
    } catch (error) {
      toastError({
        title: intl.formatMessage(i18n.switchFailed),
        msg: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSwitching(false);
    }
  };

  const currentLabel = currentModel
    ? getModelDisplayName(currentModel)
    : intl.formatMessage(i18n.unavailable);
  const scopeLabel = sessionId
    ? intl.formatMessage(i18n.currentSession)
    : onPrepareSessionModel
      ? intl.formatMessage(i18n.currentSession)
      : intl.formatMessage(i18n.newSessionDefault);

  const saveAsDefault = async () => {
    if (!currentModel || !currentProvider || savingDefault) return;
    setSavingDefault(true);
    try {
      await acpSaveDefaults(currentProvider, currentModel);
      const effortOption = configOptions.find((option) => option.id === 'thinking_effort');
      if (
        effortOption?.type === 'select' &&
        ['off', 'low', 'medium', 'high', 'max'].includes(effortOption.currentValue)
      ) {
        try {
          await acpSaveThinkingEffort(
            effortOption.currentValue as 'off' | 'low' | 'medium' | 'high' | 'max'
          );
        } catch (error) {
          toastError({
            title: intl.formatMessage(i18n.savedDefault),
            msg: intl.formatMessage(i18n.saveEffortFailed, {
              error: error instanceof Error ? error.message : String(error),
            }),
          });
          return;
        }
      }
      toastSuccess({
        title: intl.formatMessage(i18n.savedDefault),
        msg: intl.formatMessage(i18n.savedDefault),
      });
      if (
        effortOption?.type === 'select' &&
        !['off', 'low', 'medium', 'high', 'max'].includes(effortOption.currentValue)
      ) {
        toastSuccess({
          title: intl.formatMessage(i18n.savedDefault),
          msg: intl.formatMessage(i18n.harnessEffortNotSaved),
        });
      }
    } catch (error) {
      toastError({
        title: intl.formatMessage(i18n.defaultSaveFailed, {
          error: error instanceof Error ? error.message : String(error),
        }),
        msg: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingDefault(false);
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        disabled={disabled || switching}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 max-w-[min(38vw,380px)] items-center gap-1 text-text-primary/70 transition-colors hover:text-text-primary disabled:opacity-50"
        title={currentModel ?? undefined}
      >
        <span className="truncate text-xs">{currentLabel}</span>
        <ChevronDown aria-hidden="true" className="h-3 w-3 flex-shrink-0" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={intl.formatMessage(i18n.closePicker)}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            data-testid="composer-model-popover"
            aria-label={scopeLabel}
            className="no-drag fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border-primary bg-background-primary text-sm shadow-xl"
            style={{
              top: placement?.top ?? 8,
              left: placement?.left ?? 8,
              width: placement?.width ?? 'min(320px, calc(100vw - 1rem))',
              height: showProviderManager ? providerManagerHeight : undefined,
              maxHeight: placement ? `${placement.maxHeight}px` : 'min(70vh, 520px)',
              visibility: placement ? 'visible' : 'hidden',
            }}
          >
            {showProviderManager ? (
              <ComposerProviderManager
                onBack={(provider) => {
                  setShowProviderManager(false);
                  if (provider) {
                    catalog.refresh();
                  }
                }}
              />
            ) : (
              <>
                {(switching || catalog.error) && (
                  <div className="px-3 pt-2">
                    {switching && (
                      <p
                        role="status"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-text-secondary"
                      >
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                        {intl.formatMessage(i18n.switching)}
                      </p>
                    )}
                    {catalog.error && (
                      <p role="alert" className="mt-1 text-xs text-text-danger">
                        {catalog.error}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col">
                  <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <label className="m-2 flex items-center gap-2 rounded border border-border-subtle px-2">
                      <Search className="h-3.5 w-3.5 text-text-secondary" />
                      <input
                        aria-label={intl.formatMessage(i18n.searchModels)}
                        className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none"
                        placeholder={intl.formatMessage(i18n.searchModels)}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                      {catalog.loadingModels ? (
                        <p className="p-2 text-xs text-text-secondary">
                          {intl.formatMessage(i18n.loading)}
                        </p>
                      ) : null}
                      {catalog.loadingProviders && (
                        <LoaderCircle className="m-2 h-4 w-4 animate-spin" />
                      )}
                      {!catalog.loadingProviders && catalog.providers.length === 0 && (
                        <p className="p-2 text-xs text-text-secondary">
                          {intl.formatMessage(i18n.selectProvider)}
                        </p>
                      )}
                      {!catalog.loadingModels &&
                        !catalog.loadingProviders &&
                        catalog.providers.length > 0 &&
                        !hasModels && (
                          <p className="p-2 text-xs text-text-secondary">
                            {intl.formatMessage(i18n.noModels)}
                          </p>
                        )}
                      {groups.map(({ provider, models }) => {
                        const collapsed = !searching && collapsedProviders.has(provider.name);
                        return (
                          (models.length > 0 ||
                            provider.name === 'local' ||
                            (search.trim() && !hasModels)) && (
                            <section
                              key={provider.name}
                              aria-label={provider.metadata.display_name}
                            >
                              <button
                                type="button"
                                aria-expanded={!collapsed}
                                className="flex w-full min-w-0 items-center gap-1 px-2 pb-1 pt-2 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
                                title={provider.metadata.display_name}
                                onClick={() => toggleProvider(provider.name)}
                              >
                                <ChevronDown
                                  className={clsx(
                                    'h-3 w-3 shrink-0 transition-transform',
                                    collapsed && '-rotate-90'
                                  )}
                                />
                                <span className="truncate">{provider.metadata.display_name}</span>
                              </button>
                              {!collapsed && (
                                <>
                                  {models.map((model) => {
                                    const selected =
                                      model.name === currentModel &&
                                      model.provider === currentProvider;
                                    return (
                                      <button
                                        key={`${model.provider}/${model.name}`}
                                        type="button"
                                        disabled={switching || configStatus === 'pending'}
                                        className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left hover:bg-background-secondary disabled:opacity-50"
                                        title={model.name}
                                        onClick={() => void selectModel(model)}
                                      >
                                        <span className="min-w-0 flex-1 truncate">
                                          {model.alias || model.name}
                                        </span>
                                        {selected && <Check className="h-4 w-4 shrink-0" />}
                                      </button>
                                    );
                                  })}
                                  {search.trim() && !hasModels && (
                                    <button
                                      type="button"
                                      disabled={switching || configStatus === 'pending'}
                                      className="w-full rounded px-2 py-2 text-left text-xs text-text-secondary hover:bg-background-secondary disabled:opacity-50"
                                      onClick={() =>
                                        void selectModel({
                                          name: search.trim(),
                                          provider: provider.name,
                                        })
                                      }
                                    >
                                      {intl.formatMessage(i18n.useCustomModel, {
                                        model: search.trim(),
                                      })}
                                    </button>
                                  )}
                                  {provider.name === 'local' && onLocalSettings && (
                                    <button
                                      type="button"
                                      className="mt-2 w-full border-t border-border-subtle px-2 py-2 text-left text-xs"
                                      onClick={onLocalSettings}
                                    >
                                      {intl.formatMessage(i18n.localSettings)}
                                    </button>
                                  )}
                                </>
                              )}
                            </section>
                          )
                        );
                      })}
                    </div>
                  </section>
                </div>
                <div className="border-t border-border-subtle p-2">
                  <button
                    type="button"
                    className="text-xs text-text-secondary hover:text-text-primary"
                    onClick={() => {
                      // The model list is far shorter than the space the panel may use,
                      // so freezing the height here would leave the provider form
                      // crammed into a few hundred pixels. Grow it to the placement
                      // limit instead; the panel still clamps itself to the viewport.
                      setProviderManagerHeight(placement?.maxHeight);
                      setShowProviderManager(true);
                    }}
                  >
                    {intl.formatMessage(i18n.manageProviders)}
                  </button>
                  {sessionId && currentModel && currentProvider && (
                    <button
                      type="button"
                      disabled={savingDefault || switching || configStatus === 'pending'}
                      className="ml-3 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
                      onClick={() => void saveAsDefault()}
                    >
                      {intl.formatMessage(i18n.saveAsDefault)}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
