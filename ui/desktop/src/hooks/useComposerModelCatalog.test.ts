import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderDetails } from '../types/providers';
import { listComposerProviders } from './useComposerModelCatalog';
import { acpListSettingsProviderDetails } from '../acp/providers';
import { acpReadConfig } from '../acp/config';

vi.mock('../acp/providers', () => ({ acpListSettingsProviderDetails: vi.fn() }));
vi.mock('../acp/config', () => ({ acpReadConfig: vi.fn() }));
vi.mock('../components/settings/models/modelInterface', () => ({
  fetchModelsForProviders: vi.fn(),
}));

function provider(name: string, overrides: Partial<ProviderDetails> = {}): ProviderDetails {
  return {
    name,
    is_configured: true,
    is_available: true,
    visible_in_setup: true,
    deprecated: false,
    provider_type: 'Builtin',
    uses_acp: false,
    metadata: {
      name,
      display_name: name,
      description: '',
      default_model: 'model',
      known_models: [],
      model_doc_link: '',
      config_keys: [],
    },
    ...overrides,
  };
}

describe('Composer configured providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(acpReadConfig).mockResolvedValue(null);
  });

  it('hides implicit builtin defaults while keeping added custom providers', async () => {
    vi.mocked(acpListSettingsProviderDetails).mockResolvedValue([
      provider('atomic'),
      provider('lmstudio'),
      provider('builtin-declarative', { provider_type: 'Declarative' }),
      provider('custom_lite-gpt', { provider_type: 'Custom' }),
      provider('unconfigured', { is_configured: false }),
    ]);
    expect((await listComposerProviders(null)).map((item) => item.name)).toEqual([
      'custom_lite-gpt',
    ]);
  });

  it('keeps explicitly enabled or current providers but not credentials inherited from the environment', async () => {
    const keyed = provider('keyed');
    keyed.metadata.config_keys = [
      { name: 'API_KEY', secret: true, required: true, oauth_flow: false },
    ];
    vi.mocked(acpListSettingsProviderDetails).mockResolvedValue([
      provider('enabled'),
      provider('current'),
      keyed,
      provider('implicit'),
    ]);
    vi.mocked(acpReadConfig).mockResolvedValue({ enabled: { configured: true, enabled: true } });
    expect((await listComposerProviders('current')).map((item) => item.name)).toEqual([
      'enabled',
      'current',
    ]);
    expect(acpReadConfig).toHaveBeenCalledExactlyOnceWith('providers');
  });

  it('does not include a default-host provider without an explicit enabled entry', async () => {
    const host = provider('host');
    host.metadata.config_keys = [
      {
        name: 'HOST',
        secret: false,
        required: true,
        default: 'http://localhost',
        oauth_flow: false,
      },
    ];
    vi.mocked(acpListSettingsProviderDetails).mockResolvedValue([host]);
    expect(await listComposerProviders(null)).toEqual([]);
    vi.mocked(acpReadConfig).mockImplementation(async (key) =>
      key === 'HOST' ? 'http://configured-host' : null
    );
    expect(await listComposerProviders(null)).toEqual([]);
    expect(acpReadConfig).not.toHaveBeenCalledWith('HOST', true);
  });
});
