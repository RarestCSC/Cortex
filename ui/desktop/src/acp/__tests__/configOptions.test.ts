import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAcpClient } from '../acpConnection';
import {
  replaceSessionConfigOptions,
  setSessionModel,
  setSessionConfigOption,
} from '../configOptions';
import { configOptionsStore } from '../configOptionsStore';

vi.mock('../acpConnection', () => ({ getAcpClient: vi.fn() }));

const sessionId = 'config-options-coordinator-test';
const option = (id: string, currentValue: string) => ({
  id,
  name: id,
  type: 'select' as const,
  currentValue,
  options: [{ value: currentValue, name: currentValue }],
});

afterEach(() => configOptionsStore.delete(sessionId));

describe('config option coordinator', () => {
  it('buffers the push before response, rejects duplicate writes, and commits the response snapshot', async () => {
    let resolveResponse!: (value: { configOptions: ReturnType<typeof option>[] }) => void;
    const request = vi.fn(
      () => new Promise<{ configOptions: ReturnType<typeof option>[] }>((resolve) => {
        resolveResponse = resolve;
      })
    );
    vi.mocked(getAcpClient).mockResolvedValue({
      connection: { agent: { request } },
    } as unknown as Awaited<ReturnType<typeof getAcpClient>>);

    const original = [option('provider', 'old'), option('model', 'old-model')];
    const pushedIntermediate = [option('provider', 'new'), option('model', 'default-model')];
    const responseOptions = [option('provider', 'new'), option('model', 'selected-model')];
    configOptionsStore.replaceConfirmed(sessionId, original);
    const operation = setSessionConfigOption(sessionId, 'model', 'selected-model');
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

    replaceSessionConfigOptions(sessionId, pushedIntermediate);
    expect(configOptionsStore.getSnapshot(sessionId)).toMatchObject({
      options: original,
      status: 'pending',
    });
    await expect(setSessionConfigOption(sessionId, 'model', 'another-model')).rejects.toThrow(
      /already pending/
    );
    expect(request).toHaveBeenCalledOnce();

    resolveResponse({ configOptions: responseOptions });
    await expect(operation).resolves.toEqual(responseOptions);
    expect(configOptionsStore.getSnapshot(sessionId)).toMatchObject({
      options: responseOptions,
      status: 'confirmed',
    });
  });

  it('keeps pending results scoped to their session', async () => {
    const response = { configOptions: [option('thinking_effort', 'low')] };
    vi.mocked(getAcpClient).mockResolvedValue({
      connection: { agent: { request: vi.fn().mockResolvedValue(response) } },
    } as unknown as Awaited<ReturnType<typeof getAcpClient>>);

    const otherSession = `${sessionId}-other`;
    configOptionsStore.replaceConfirmed(otherSession, [option('model', 'other-model')]);
    await setSessionConfigOption(sessionId, 'thinking_effort', 'low');

    expect(configOptionsStore.getSnapshot(sessionId)?.options).toEqual(response.configOptions);
    expect(configOptionsStore.getSnapshot(otherSession)?.options).toEqual([option('model', 'other-model')]);
    configOptionsStore.delete(otherSession);
  });

  it('sets only model on the same provider and provider then model across providers', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ configOptions: [option('provider', 'alpha'), option('model', 'alpha-2')] })
      .mockResolvedValueOnce({ configOptions: [option('provider', 'beta'), option('model', 'beta-default')] })
      .mockResolvedValueOnce({ configOptions: [option('provider', 'beta'), option('model', 'beta-2')] });
    vi.mocked(getAcpClient).mockResolvedValue({
      connection: { agent: { request } },
    } as unknown as Awaited<ReturnType<typeof getAcpClient>>);
    configOptionsStore.replaceConfirmed(sessionId, [option('provider', 'alpha'), option('model', 'alpha-1')]);

    await setSessionModel(sessionId, 'alpha', 'alpha-2');
    await setSessionModel(sessionId, 'beta', 'beta-2');

    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map((call) => call[1])).toEqual([
      { sessionId, configId: 'model', value: 'alpha-2' },
      { sessionId, configId: 'provider', value: 'beta' },
      { sessionId, configId: 'model', value: 'beta-2' },
    ]);
  });
});
