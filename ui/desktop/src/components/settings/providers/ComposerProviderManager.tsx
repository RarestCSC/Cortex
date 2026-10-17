import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, LoaderCircle, Plus, Search } from 'lucide-react';
import {
  acpCreateCustomProviderFromRequest,
  acpDeleteCustomProvider,
  acpGetCustomProvider,
  acpListSettingsProviderDetails,
  acpUpdateCustomProviderFromRequest,
  toLocalModelCapabilities,
} from '../../../acp/providers';
import { acpReadConfig, acpUpsertConfig } from '../../../acp/config';
import type { ProviderDetails, UpdateCustomProviderRequest } from '../../../types/providers';
import CustomProviderForm from './modal/subcomponents/forms/CustomProviderForm';
import { ProviderConfigurationContent } from './modal/ProviderConfigurationModal';
import { defineMessages, useIntl } from '../../../i18n';

const i18n = defineMessages({
  title: { id: 'composerProviders.title', defaultMessage: 'Manage providers' },
  description: {
    id: 'composerProviders.description',
    defaultMessage:
      'Provider settings are global. Saving a provider will not change this chat or its default model.',
  },
  back: { id: 'composerProviders.back', defaultMessage: 'Back to models' },
  add: { id: 'composerProviders.add', defaultMessage: 'Add custom provider' },
  edit: { id: 'composerProviders.edit', defaultMessage: 'Configure / edit' },
  configured: { id: 'composerProviders.configured', defaultMessage: 'Configured' },
  notConfigured: { id: 'composerProviders.notConfigured', defaultMessage: 'Not configured' },
  search: { id: 'composerProviders.search', defaultMessage: 'Search providers' },
  loading: { id: 'composerProviders.loading', defaultMessage: 'Loading providers…' },
  failed: { id: 'composerProviders.failed', defaultMessage: 'Could not load providers' },
});

interface ComposerProviderManagerProps {
  onBack: (browseProvider?: string) => void;
}

const COMMON_PROVIDER_IDS = ['openai', 'anthropic', 'google', 'openrouter', 'ollama', 'deepseek'];

export function ComposerProviderManager({ onBack }: ComposerProviderManagerProps) {
  const intl = useIntl();
  const [providers, setProviders] = useState<ProviderDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ProviderDetails | null>(null);
  const [custom, setCustom] = useState<{
    id?: string;
    initialData: UpdateCustomProviderRequest | null;
    isEditable?: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await acpListSettingsProviderDetails());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const editCustom = async (selected: ProviderDetails) => {
    const result = await acpGetCustomProvider(selected.name);
    setCustom({
      id: selected.name,
      isEditable: result.editable,
      initialData: {
        engine: result.provider.engine,
        display_name: result.provider.displayName,
        api_url: result.provider.apiUrl,
        base_path: result.provider.basePath ?? undefined,
        api_key: '',
        models: result.provider.models ?? [],
        model_capabilities: toLocalModelCapabilities(result.provider.modelCapabilities),
        supports_streaming: result.provider.supportsStreaming ?? true,
        requires_auth: result.provider.requiresAuth ?? true,
        headers: result.provider.headers ?? undefined,
        catalog_provider_id: result.provider.catalogProviderId ?? undefined,
        toolshim: result.provider.toolshim,
      },
    });
  };

  const submitCustom = async (data: UpdateCustomProviderRequest) => {
    if (custom?.id) await acpUpdateCustomProviderFromRequest(custom.id, data);
    else {
      const created = await acpCreateCustomProviderFromRequest(data);
      setCustom(null);
      await refresh();
      onBack(created.provider_name);
      return;
    }
    setCustom(null);
    await refresh();
    onBack(custom.id);
  };

  const deleteCustom = async () => {
    if (!custom?.id) return;
    await acpDeleteCustomProvider(custom.id);
    setCustom(null);
    await refresh();
  };

  if (custom) {
    return (
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 self-start text-xs"
          onClick={() => setCustom(null)}
        >
          <ArrowLeft className="h-3 w-3" />
          {intl.formatMessage(i18n.title)}
        </button>
        <CustomProviderForm
          initialData={custom.initialData}
          isEditable={custom.isEditable ?? true}
          onSubmit={submitCustom}
          onCancel={() => setCustom(null)}
          onDelete={custom.id ? deleteCustom : undefined}
        />
      </div>
    );
  }

  if (provider) {
    return (
      <div className="flex min-h-0 flex-col overflow-y-auto p-3">
        <button
          type="button"
          className="mb-3 inline-flex items-center gap-1 self-start text-xs"
          onClick={() => setProvider(null)}
        >
          <ArrowLeft className="h-3 w-3" />
          {intl.formatMessage(i18n.title)}
        </button>
        {error && (
          <p role="alert" className="mb-2 text-xs text-text-danger">
            {error}
          </p>
        )}
        <ProviderConfigurationContent
          provider={provider}
          onClose={() => setProvider(null)}
          onConfigured={async (configured) => {
            try {
              const saved = await acpReadConfig('providers');
              const entries =
                saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
              const entry = entries[configured.name] as Record<string, unknown> | undefined;
              await acpUpsertConfig('providers', {
                ...entries,
                [configured.name]: {
                  ...entry,
                  enabled: true,
                  configured: true,
                  model: entry?.model ?? configured.metadata.default_model,
                },
              });
              setProvider(null);
              await refresh();
              onBack(configured.name);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        />
      </div>
    );
  }

  const visibleProviders = [
    ...providers.filter((item) => item.provider_type === 'Custom'),
    ...COMMON_PROVIDER_IDS.flatMap((id) =>
      providers.filter((item) => item.name === id && item.provider_type !== 'Custom')
    ),
  ];
  const filtered = visibleProviders.filter((item) =>
    `${item.metadata.display_name} ${item.metadata.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  return (
    <div
      className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3"
      data-testid="composer-provider-manager"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 self-start text-xs"
        onClick={() => onBack()}
      >
        <ArrowLeft className="h-3 w-3" />
        {intl.formatMessage(i18n.back)}
      </button>
      <div>
        <h3 className="text-sm font-semibold">{intl.formatMessage(i18n.title)}</h3>
        <p className="mt-1 text-xs text-text-secondary">{intl.formatMessage(i18n.description)}</p>
      </div>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-2 rounded border border-border-subtle px-2 py-1.5 text-xs font-medium text-text-primary hover:bg-background-secondary"
        onClick={() => setCustom({ initialData: null })}
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="leading-7">{intl.formatMessage(i18n.add)}</span>
      </button>
      <label className="flex items-center gap-2 rounded border border-border-subtle px-2">
        <Search className="h-3.5 w-3.5 text-text-secondary" />
        <input
          aria-label={intl.formatMessage(i18n.search)}
          placeholder={intl.formatMessage(i18n.search)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none"
        />
      </label>
      <div className="flex flex-col gap-1">
        {loading && (
          <p className="inline-flex items-center gap-2 p-2 text-xs">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            {intl.formatMessage(i18n.loading)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-text-danger">
            {intl.formatMessage(i18n.failed)}: {error}
          </p>
        )}
        {filtered.map((item) => (
          <div
            key={item.name}
            data-provider-id={item.name}
            className="flex items-center gap-2 rounded border border-border-subtle px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium leading-3.5">{item.metadata.display_name}</p>
              <p className="text-[11px] leading-3.5 text-text-secondary">
                {intl.formatMessage(item.is_configured ? i18n.configured : i18n.notConfigured)}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded border border-border-subtle px-2 py-1 text-xs"
              onClick={() =>
                item.provider_type === 'Custom' ? void editCustom(item) : setProvider(item)
              }
            >
              {intl.formatMessage(i18n.edit)}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
