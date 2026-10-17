import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import zhCN from '../../../../i18n/messages/zh-CN.json';
import zhTW from '../../../../i18n/messages/zh-TW.json';
import { IntlTestWrapper } from '../../../../i18n/test-utils';
import { ComposerModelPopover } from './ComposerModelPopover';

const mockSetSessionModel = vi.fn();
const mockChangeModel = vi.fn();
const mockLoadProviderModels = vi.fn();
let mockStatus = 'confirmed';
let mockProviders = [{ name: 'alpha', metadata: { display_name: 'Alpha' } }];
let mockProviderResults: Record<string, unknown> = {
  alpha: {
    models: [{ name: 'alpha-model', provider: 'alpha' }],
    error: null,
    warning: null,
  },
};

vi.mock('../../../../acp/providers', () => ({
  acpSetSessionModel: (...args: unknown[]) => mockSetSessionModel(...args),
  acpListSettingsProviderDetails: async () => [],
}));

vi.mock('../../../../hooks/useConfigOptions', () => ({
  useConfigOptions: () => ({ status: mockStatus, options: [] }),
}));

vi.mock('../../../../hooks/useComposerModelCatalog', () => ({
  useComposerModelCatalog: () => ({
    providers: mockProviders,
    providerResults: mockProviderResults,
    loadingProviders: false,
    loadingModels: false,
    error: null,
    loadProviderModels: mockLoadProviderModels,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../../ModelAndProviderContext', () => ({
  useModelAndProvider: () => ({ changeModel: mockChangeModel }),
}));

vi.mock('../predefinedModelsUtils', () => ({
  getModelDisplayName: (model: string) => model,
}));

describe('ComposerModelPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockStatus = 'confirmed';
    mockProviders = [{ name: 'alpha', metadata: { display_name: 'Alpha' } }];
    mockProviderResults = {
      alpha: { models: [{ name: 'alpha-model', provider: 'alpha' }], error: null, warning: null },
    };
    mockSetSessionModel.mockResolvedValue({ providerId: 'alpha', modelId: 'alpha-model' });
    mockChangeModel.mockResolvedValue(true);
  });

  it('browses providers without writing and selects the current-provider model directly', async () => {
    const onSelected = vi.fn();
    render(
      <ComposerModelPopover
        sessionId="session-1"
        currentProvider="alpha"
        currentModel="old-model"
        onSelected={onSelected}
      />,
      { wrapper: IntlTestWrapper }
    );

    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    expect(screen.queryByText('Current session · only affects this chat')).not.toBeInTheDocument();
    const panel = screen.getByTestId('composer-model-popover');
    expect(panel).toHaveAttribute('aria-label', 'Current session · only affects this chat');
    expect(panel.firstElementChild?.querySelector('input')).toHaveAttribute(
      'aria-label',
      'Search models'
    );
    await waitFor(() => expect(mockLoadProviderModels).toHaveBeenCalledWith('alpha'));
    expect(mockSetSessionModel).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'alpha-model' }));
    await waitFor(() =>
      expect(mockSetSessionModel).toHaveBeenCalledWith('session-1', 'alpha', 'alpha-model')
    );
    expect(onSelected).toHaveBeenCalledWith('alpha-model', 'alpha');
    expect(mockChangeModel).not.toHaveBeenCalled();
  });

  it('uses the no-session default branch without calling session config APIs', async () => {
    render(
      <ComposerModelPopover sessionId={null} currentProvider="alpha" currentModel="old-model" />,
      { wrapper: IntlTestWrapper }
    );

    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-model' }));
    await waitFor(() =>
      expect(mockChangeModel).toHaveBeenCalledWith(null, {
        name: 'alpha-model',
        provider: 'alpha',
      })
    );
    expect(mockSetSessionModel).not.toHaveBeenCalled();
  });

  it('keeps the model list usable in a narrow viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 420 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    render(
      <ComposerModelPopover
        sessionId="session-1"
        currentProvider="alpha"
        currentModel="old-model"
      />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    const popover = screen.getByTestId('composer-model-popover');
    expect(popover.style.width).toBe('320px');
    expect(popover.style.maxHeight).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('collapses a provider group and keeps its models out of the list', () => {
    render(
      <ComposerModelPopover
        sessionId="session-1"
        currentProvider="alpha"
        currentModel="old-model"
      />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    expect(screen.getByRole('button', { name: 'alpha-model' })).toBeInTheDocument();

    const header = screen.getByRole('button', { name: 'Alpha' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'alpha-model' })).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByRole('button', { name: 'alpha-model' })).toBeInTheDocument();
  });

  it('forces every group open while searching so no hit stays hidden', () => {
    mockProviders.push({ name: 'beta', metadata: { display_name: 'Beta' } });
    mockProviderResults.beta = { models: [{ name: 'beta-model', provider: 'beta' }] };
    render(
      <ComposerModelPopover
        sessionId="session-1"
        currentProvider="alpha"
        currentModel="old-model"
      />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(screen.queryByRole('button', { name: 'alpha-model' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), {
      target: { value: 'alpha' },
    });
    expect(screen.getByRole('button', { name: 'alpha-model' })).toBeInTheDocument();
  });

  it('remembers a collapsed group across popovers', () => {
    const { unmount } = render(
      <ComposerModelPopover
        sessionId="session-1"
        currentProvider="alpha"
        currentModel="old-model"
      />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    unmount();

    render(
      <ComposerModelPopover
        sessionId="session-1"
        currentProvider="alpha"
        currentModel="old-model"
      />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'alpha-model' })).not.toBeInTheDocument();
  });

  it('prepares a real session before the first task without saving a global model default', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerModelPopover
        sessionId={null}
        currentProvider="alpha"
        currentModel="old-model"
        onPrepareSessionModel={prepare}
      />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    fireEvent.click(screen.getByRole('button', { name: 'alpha-model' }));
    await waitFor(() =>
      expect(prepare).toHaveBeenCalledExactlyOnceWith({ name: 'alpha-model', provider: 'alpha' })
    );
    expect(mockChangeModel).not.toHaveBeenCalled();
    expect(mockSetSessionModel).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId('composer-model-popover')).not.toBeInTheDocument()
    );
  });

  it('groups all configured providers and searches their displayed models', () => {
    mockProviders.push({ name: 'beta', metadata: { display_name: 'Beta' } });
    mockProviderResults.beta = { models: [{ name: 'beta-model', provider: 'beta' }] };
    render(
      <ComposerModelPopover
        sessionId="session-1"
        currentProvider="alpha"
        currentModel="old-model"
      />,
      { wrapper: IntlTestWrapper }
    );
    fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
    expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Beta' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), {
      target: { value: 'beta-model' },
    });
    expect(screen.getByRole('button', { name: 'beta-model' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'alpha-model' })).not.toBeInTheDocument();
    expect(mockSetSessionModel).not.toHaveBeenCalled();
  });

  it('keeps the management back button below the desktop titlebar and returns without submitting', async () => {
    const titlebar = document.createElement('div');
    titlebar.className = 'titlebar-drag-region';
    titlebar.getBoundingClientRect = () => ({ bottom: 32 }) as DOMRect;
    document.body.appendChild(titlebar);
    const submit = vi.fn((event) => event.preventDefault());
    try {
      render(
        <form onSubmit={submit}>
          <ComposerModelPopover
            sessionId="session-1"
            currentProvider="alpha"
            currentModel="old-model"
          />
        </form>,
        { wrapper: IntlTestWrapper }
      );
      fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), {
        target: { value: 'alpha' },
      });
      const panel = screen.getByTestId('composer-model-popover');
      const modelWidth = panel.style.width;
      panel.getBoundingClientRect = () => ({ height: 210 }) as DOMRect;
      fireEvent.click(screen.getByRole('button', { name: 'Manage providers' }));
      expect(panel.style.width).toBe(modelWidth);
      // The management form gets the placement budget, not the frozen height of
      // the short model list, so a long provider form is not crammed.
      expect(panel.style.height).toBe('520px');
      expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(40);
      expect(panel).toHaveClass('no-drag');
      fireEvent.click(await screen.findByRole('button', { name: 'Back to models' }));
      expect(screen.queryByTestId('composer-provider-manager')).not.toBeInTheDocument();
      expect(panel.style.height).toBe('');
      expect(screen.getByRole('textbox', { name: 'Search models' })).toHaveValue('alpha');
      expect(submit).not.toHaveBeenCalled();
      expect(mockSetSessionModel).not.toHaveBeenCalled();
      expect(mockChangeModel).not.toHaveBeenCalled();
    } finally {
      titlebar.remove();
    }
  });

  it.each([
    {
      locale: 'zh-CN',
      catalog: zhCN,
      search: '搜索模型',
      manage: '管理供应商',
      back: '返回模型',
      providerSearch: '搜索供应商',
    },
    {
      locale: 'zh-TW',
      catalog: zhTW,
      search: '搜尋模型',
      manage: '管理供應商',
      back: '返回模型',
      providerSearch: '搜尋供應商',
    },
  ])(
    'renders translated model and management views in $locale',
    async ({ locale, catalog, search, manage, back, providerSearch }) => {
      const messages = Object.fromEntries(
        Object.entries(catalog).map(([id, message]) => [id, message.defaultMessage])
      );
      render(
        <IntlProvider locale={locale} messages={messages}>
          <ComposerModelPopover
            sessionId="session-1"
            currentProvider="alpha"
            currentModel="old-model"
          />
        </IntlProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: 'old-model' }));
      expect(screen.getByRole('textbox', { name: search })).toHaveAttribute('placeholder', search);
      fireEvent.click(screen.getByRole('button', { name: manage }));
      const manager = within(await screen.findByTestId('composer-provider-manager'));
      expect(manager.getByRole('heading', { name: manage })).toBeInTheDocument();
      expect(manager.getByRole('textbox', { name: providerSearch })).toHaveAttribute(
        'placeholder',
        providerSearch
      );
      expect(manager.queryByText('Manage providers')).not.toBeInTheDocument();
      fireEvent.click(manager.getByRole('button', { name: back }));
      expect(screen.getByRole('textbox', { name: search })).toBeInTheDocument();
    }
  );
});
