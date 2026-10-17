import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlTestWrapper } from '../../../i18n/test-utils';
import { ComposerProviderManager } from './ComposerProviderManager';

const mockList = vi.fn();
const mockGetCustom = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockReadConfig = vi.fn();
const mockUpsertConfig = vi.fn();

vi.mock('../../../acp/config', () => ({
  acpReadConfig: (...args: unknown[]) => mockReadConfig(...args),
  acpUpsertConfig: (...args: unknown[]) => mockUpsertConfig(...args),
}));

vi.mock('../../../acp/providers', () => ({
  acpListSettingsProviderDetails: (...args: unknown[]) => mockList(...args),
  acpGetCustomProvider: (...args: unknown[]) => mockGetCustom(...args),
  acpCreateCustomProviderFromRequest: (...args: unknown[]) => mockCreate(...args),
  acpUpdateCustomProviderFromRequest: (...args: unknown[]) => mockUpdate(...args),
  acpDeleteCustomProvider: (...args: unknown[]) => mockDelete(...args),
}));

vi.mock('./modal/ProviderConfigurationModal', () => ({
  ProviderConfigurationContent: ({
    onConfigured,
  }: {
    onConfigured: (provider: { name: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onConfigured({ name: 'openai', metadata: { default_model: 'builtin-model' } } as {
          name: string;
        })
      }
    >
      Save provider
    </button>
  ),
}));

vi.mock('./modal/subcomponents/forms/CustomProviderForm', () => ({
  default: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (data: unknown) => void;
    onCancel: () => void;
  }) => (
    <>
      <button type="button" onClick={() => void onSubmit({ display_name: 'Custom' })}>
        Save custom
      </button>
      <button type="button" onClick={onCancel}>
        Cancel custom
      </button>
    </>
  ),
}));

const builtin = {
  name: 'openai',
  is_configured: true,
  is_available: true,
  visible_in_setup: true,
  deprecated: false,
  provider_type: 'Builtin',
  uses_acp: false,
  metadata: { display_name: 'Builtin', description: '', config_keys: [], known_models: [] },
};

describe('ComposerProviderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([builtin]);
    mockCreate.mockResolvedValue({ provider_name: 'custom-new' });
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockReadConfig.mockResolvedValue({
      other: { enabled: true, configured: true, model: 'other-model' },
    });
    mockUpsertConfig.mockResolvedValue(undefined);
  });

  it('returns to model browsing after a provider is configured without navigating', async () => {
    const onBack = vi.fn();
    render(<ComposerProviderManager onBack={onBack} />, { wrapper: IntlTestWrapper });
    await waitFor(() => expect(screen.getByText('Builtin')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Configure / edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() => expect(onBack).toHaveBeenCalledWith('openai'));
    expect(mockUpsertConfig).toHaveBeenCalledExactlyOnceWith('providers', {
      other: { enabled: true, configured: true, model: 'other-model' },
      openai: { enabled: true, configured: true, model: 'builtin-model' },
    });
  });

  it('saves a new custom provider and returns its id for browsing', async () => {
    const onBack = vi.fn();
    render(<ComposerProviderManager onBack={onBack} />, { wrapper: IntlTestWrapper });
    await waitFor(() => expect(screen.getByText('Builtin')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add custom provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save custom' }));
    await waitFor(() => expect(onBack).toHaveBeenCalledWith('custom-new'));
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('returns from the provider list and edit view without submitting or saving', async () => {
    const onBack = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ComposerProviderManager onBack={onBack} />
      </form>,
      { wrapper: IntlTestWrapper }
    );
    await screen.findByText('Builtin');
    fireEvent.click(screen.getByRole('button', { name: 'Configure / edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage providers' }));
    expect(screen.getByTestId('composer-provider-manager')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to models' }));
    expect(onBack).toHaveBeenCalledExactlyOnceWith();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mockUpsertConfig).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('shows custom providers first, limits builtins to the six chosen providers, and keeps adding visible while searching', async () => {
    const commonIds = ['openai', 'anthropic', 'google', 'openrouter', 'ollama', 'deepseek'];
    mockList.mockResolvedValue([
      ...commonIds
        .slice()
        .reverse()
        .map((name) => ({
          ...builtin,
          name,
          metadata: { ...builtin.metadata, display_name: name },
        })),
      { ...builtin, name: 'other', metadata: { ...builtin.metadata, display_name: 'Other' } },
      {
        ...builtin,
        name: 'custom-lite',
        provider_type: 'Custom',
        metadata: { ...builtin.metadata, display_name: 'lite-gpt' },
      },
      {
        ...builtin,
        name: 'custom-unconfigured',
        provider_type: 'Custom',
        is_configured: false,
        metadata: { ...builtin.metadata, display_name: 'Unconfigured custom' },
      },
    ]);
    render(<ComposerProviderManager onBack={vi.fn()} />, { wrapper: IntlTestWrapper });
    await screen.findByText('lite-gpt');
    const manager = screen.getByTestId('composer-provider-manager');
    expect(
      Array.from(manager.querySelectorAll('[data-provider-id]')).map((row) =>
        row.getAttribute('data-provider-id')
      )
    ).toEqual(['custom-lite', 'custom-unconfigured', ...commonIds]);
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add custom provider' });
    const search = screen.getByRole('textbox', { name: 'Search providers' });
    expect(add.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(search, { target: { value: 'Other' } });
    expect(manager.querySelectorAll('[data-provider-id]')).toHaveLength(0);
    expect(add).toBeInTheDocument();
    fireEvent.click(add);
    expect(screen.getByRole('button', { name: 'Save custom' })).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpsertConfig).not.toHaveBeenCalled();
  });
});
