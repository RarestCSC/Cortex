import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IntlTestWrapper } from '../../../../../../i18n/test-utils';
import CustomProviderForm from './CustomProviderForm';

const templates = vi.hoisted(() => ({
  a: {
    providerId: 'template-a',
    name: 'Template A',
    format: 'openai',
    apiUrl: 'https://a.example.com',
    models: [
      {
        id: 'model-a',
        name: 'Model A',
        contextLimit: 8192,
        capabilities: {
          toolCall: false,
          reasoning: false,
          attachment: false,
          temperature: true,
        },
        deprecated: false,
      },
    ],
    supportsStreaming: true,
    envVar: 'TEMPLATE_A_API_KEY',
    docUrl: '',
  },
  b: {
    providerId: 'template-b',
    name: 'Template B',
    format: 'anthropic',
    apiUrl: 'https://b.example.com',
    models: [
      {
        id: 'model-b',
        name: 'Model B',
        contextLimit: 8192,
        capabilities: {
          toolCall: false,
          reasoning: false,
          attachment: false,
          temperature: true,
        },
        deprecated: false,
      },
    ],
    supportsStreaming: true,
    envVar: 'TEMPLATE_B_API_KEY',
    docUrl: '',
  },
}));

vi.mock('../ProviderCatalogPicker', () => ({
  default: ({ onSelect }: { onSelect: (template: typeof templates.a) => void }) => (
    <div>
      <button onClick={() => onSelect(templates.a)}>Use Template A</button>
      <button onClick={() => onSelect(templates.b)}>Use Template B</button>
    </div>
  ),
}));

const renderForm = (onSubmit = vi.fn()) => {
  render(
    <CustomProviderForm initialData={null} isEditable onSubmit={onSubmit} onCancel={vi.fn()} />,
    { wrapper: IntlTestWrapper }
  );
  return onSubmit;
};

const openTemplateCatalog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('Start from a provider template'));
};

const addHeader = async (user: ReturnType<typeof userEvent.setup>, name: string, value: string) => {
  const nameInputs = screen.getAllByPlaceholderText('Header name');
  const valueInputs = screen.getAllByPlaceholderText('Value');
  await user.type(nameInputs[nameInputs.length - 1], name);
  await user.type(valueInputs[valueInputs.length - 1], value);
  await user.click(screen.getByRole('button', { name: 'Add' }));
};

describe('CustomProviderForm transitions', () => {
  it('does not carry credentials from a cleared template into the next template', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await openTemplateCatalog(user);
    await user.click(screen.getByRole('button', { name: 'Use Template A' }));

    await user.type(screen.getByLabelText(/API Key/), 'template-a-secret');
    await addHeader(user, 'Authorization', 'Bearer template-a');

    const pendingNames = screen.getAllByPlaceholderText('Header name');
    const pendingValues = screen.getAllByPlaceholderText('Value');
    await user.type(pendingNames[pendingNames.length - 1], 'Authorization');
    await user.type(pendingValues[pendingValues.length - 1], 'Bearer pending-template-a');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('A header with this name already exists')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await openTemplateCatalog(user);
    await user.click(screen.getByRole('button', { name: 'Use Template B' }));

    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    expect(screen.queryByDisplayValue('Bearer template-a')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Bearer pending-template-a')).not.toBeInTheDocument();
    expect(screen.queryByText('A header with this name already exists')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/API Key/), 'template-b-secret');
    await addHeader(user, 'X-Template-B', 'template-b-header');
    await user.click(screen.getByRole('button', { name: 'Create Provider' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        api_key: 'template-b-secret',
        catalog_provider_id: 'template-b',
        headers: { 'X-Template-B': 'template-b-header' },
      })
    );
  }, 15000);

  it('clears secrets and submit state when returning to the setup choice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    let rejectSubmit: ((reason: Error) => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSubmit = reject;
        })
    );
    renderForm(onSubmit);
    await user.click(screen.getByText('Configure manually'));

    await user.type(screen.getByLabelText(/Display Name/), 'Manual Provider');
    await user.type(screen.getByLabelText(/API URL/), 'https://manual.example.com');
    await user.type(screen.getByLabelText(/Available Models/), 'model-a');
    await user.click(screen.getByLabelText('This provider requires an API key'));
    await user.type(screen.getByLabelText(/API Key/), 'manual-secret');
    await addHeader(user, 'Authorization', 'Bearer manual-secret');

    const pendingNames = screen.getAllByPlaceholderText('Header name');
    const pendingValues = screen.getAllByPlaceholderText('Value');
    await user.type(pendingNames[pendingNames.length - 1], 'Authorization');
    await user.type(pendingValues[pendingValues.length - 1], 'Bearer pending-secret');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Create Provider' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    await user.click(screen.getByRole('button', { name: '← Back' }));
    await user.click(screen.getByText('Configure manually'));

    await act(async () => {
      rejectSubmit?.(new Error('save failed'));
      await Promise.resolve();
    });

    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    expect(screen.queryByDisplayValue('Bearer manual-secret')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Bearer pending-secret')).not.toBeInTheDocument();
    expect(screen.queryByText('A header with this name already exists')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to save provider/)).not.toBeInTheDocument();
  }, 15000);

  it.each([
    ['anthropic_compatible', 'anthropic_compatible'],
    ['ollama_compatible', 'ollama_compatible'],
    ['openai_compatible', 'openai_compatible'],
    ['anthropic', 'anthropic_compatible'],
    ['ollama', 'ollama_compatible'],
    ['openai', 'openai_compatible'],
  ])('saves a provider stored as %s with engine %s', async (engine, expectedEngine) => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <CustomProviderForm
        initialData={{
          engine,
          display_name: 'Existing Provider',
          api_url: 'https://existing.example.com',
          api_key: '',
          models: ['model-a'],
          supports_streaming: true,
          requires_auth: true,
          toolshim: false,
        }}
        isEditable
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { wrapper: IntlTestWrapper }
    );

    await user.click(screen.getByRole('button', { name: 'Update Provider' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ engine: expectedEngine }));
  });

  it('clears form validation when returning to the setup choice', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByText('Configure manually'));
    await user.click(screen.getByRole('button', { name: 'Create Provider' }));
    expect(screen.getByText('Display name is required')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← Back' }));
    await user.click(screen.getByText('Configure manually'));

    expect(screen.queryByText('Display name is required')).not.toBeInTheDocument();
  });
});

// The tri-state image-input switch is the only control that has to express three
// values over a wire format that had two. These cases drive it through real
// clicks, because an ACP-layer round trip cannot see a control that never
// updates -- nor one that updates and is then silently reset.
describe('CustomProviderForm image input switch', () => {
  const providerData = () => ({
    engine: 'openai',
    display_name: 'WorkBuddy',
    api_url: 'http://127.0.0.1:7863/v1',
    api_key: '',
    models: ['cn:space-bunny', 'cn:glm-5.3-flash'],
    model_capabilities: null as Record<string, { supports_vision?: boolean | null }> | null,
    supports_streaming: true,
    requires_auth: true,
    headers: undefined,
    toolshim: false,
  });

  const renderWithCapabilities = (onSubmit = vi.fn()) => {
    const view = render(
      <CustomProviderForm
        initialData={providerData()}
        isEditable
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { wrapper: IntlTestWrapper }
    );
    return { onSubmit, view };
  };

  const visionRow = (modelName: string) => {
    const row = screen.getByTitle(modelName).closest('div.flex.items-center.justify-between');
    if (!row) throw new Error(`no image-input switch row for ${modelName}`);
    return row as HTMLElement;
  };

  const clickVision = async (
    user: ReturnType<typeof userEvent.setup>,
    modelName: string,
    label: 'Auto' | 'On' | 'Off'
  ) => {
    await user.click(within(visionRow(modelName)).getByRole('button', { name: label }));
  };

  const submittedCapabilities = (onSubmit: ReturnType<typeof vi.fn>) =>
    onSubmit.mock.calls.at(-1)?.[0]?.model_capabilities;

  it('writes the chosen state for the clicked model only', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWithCapabilities();

    await clickVision(user, 'cn:space-bunny', 'On');
    await user.click(screen.getByRole('button', { name: 'Update Provider' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    expect(submittedCapabilities(onSubmit)).toEqual({
      'cn:space-bunny': { supports_vision: true },
    });
  });

  it('resets to auto as an explicit null rather than by dropping the key', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWithCapabilities();

    await clickVision(user, 'cn:space-bunny', 'On');
    await clickVision(user, 'cn:space-bunny', 'Auto');
    await user.click(screen.getByRole('button', { name: 'Update Provider' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    const capabilities = submittedCapabilities(onSubmit);
    // The form hands over `undefined`; `providers.ts:updateRequestToCreate`
    // turns it into an explicit `null` on the wire. What matters here is that
    // the key survives: dropping it is indistinguishable from never touching
    // the model, which is exactly the bug this switch had.
    expect(Object.keys(capabilities)).toEqual(['cn:space-bunny']);
    expect(capabilities['cn:space-bunny'].supports_vision).toBeUndefined();
  });

  it('keeps a click made before an unrelated parent re-render', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { view } = renderWithCapabilities(onSubmit);

    await clickVision(user, 'cn:space-bunny', 'On');

    // Both call sites that mount this form build `initialData` as an object
    // literal inside their own render body, so any re-render of the owner hands
    // the form a brand-new object with identical contents. The form used to key
    // its initialisation effect on that object, re-running on every one of them
    // and silently discarding the click above -- which is what "the switch does
    // nothing" looks like from the outside.
    // `rerender` re-applies the render options' wrapper, so this is the same
    // tree with a different `initialData` object -- a re-render, not a remount.
    view.rerender(
      <CustomProviderForm
        initialData={providerData()}
        isEditable
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    expect(
      within(visionRow('cn:space-bunny')).getByRole('button', { name: 'On' })
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Update Provider' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    expect(submittedCapabilities(onSubmit)).toEqual({
      'cn:space-bunny': { supports_vision: true },
    });
  });

  it('renders the stored state so a reload shows what was chosen', async () => {
    const data = providerData();
    data.model_capabilities = { 'cn:space-bunny': { supports_vision: true } };

    render(
      <CustomProviderForm
        initialData={data}
        isEditable
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: IntlTestWrapper }
    );

    expect(within(visionRow('cn:space-bunny')).getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      within(visionRow('cn:space-bunny')).getByRole('button', { name: 'Auto' })
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
