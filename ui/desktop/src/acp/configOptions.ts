import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { methods } from '@agentclientprotocol/sdk';
import { getAcpClient } from './acpConnection';
import { configOptionsStore } from './configOptionsStore';
import { acpChatSessionActions, acpChatSessionStore } from './chatSessionStore';
import type { Session } from '../types/session';

export function replaceSessionConfigOptions(
  sessionId: string,
  options: SessionConfigOption[] | null | undefined
): void {
  if (!options) return;
  if (configOptionsStore.isPending(sessionId)) {
    configOptionsStore.replaceConfirmed(sessionId, options);
    return;
  }
  configOptionsStore.replaceConfirmed(sessionId, options);
  if (acpChatSessionStore.getSnapshot(sessionId)?.session) {
    projectSessionConfigOptions(sessionId, options);
  }
}

export function projectSessionConfigOptions(
  sessionId: string,
  options: SessionConfigOption[]
): void {
  const currentSession = acpChatSessionStore.getSnapshot(sessionId)?.session;
  if (!currentSession) return;

  const valueFor = (id: string) => {
    const option = options.find((candidate) => candidate.id === id);
    return option?.type === 'select' ? option.currentValue : undefined;
  };
  const providerId = valueFor('provider');
  const modelId = valueFor('model');
  const thinkingEffort = valueFor('thinking_effort');
  if (!providerId && !modelId && !thinkingEffort) return;

  acpChatSessionActions.setSessionMetadata(sessionId, {
    ...currentSession,
    ...(providerId ? { provider_name: providerId } : {}),
    model_config: projectModelConfig(currentSession.model_config, modelId, thinkingEffort),
  });
}

function projectModelConfig(
  modelConfig: Session['model_config'],
  modelId: string | undefined,
  thinkingEffort: string | undefined
): Session['model_config'] {
  const next = modelId
    ? { ...(modelConfig ?? { toolshim: false }), model_name: modelId }
    : modelConfig;
  if (!next || !thinkingEffort) return next;
  return {
    ...next,
    request_params: { ...(next.request_params ?? {}), thinking_effort: thinkingEffort },
  };
}

function hasConfigOptionValue(options: SessionConfigOption[], configId: string, value: string): boolean {
  const option = options.find((candidate) => candidate.id === configId);
  if (option?.type !== 'select') return false;
  return option.options.some((entry) =>
    'options' in entry
      ? entry.options.some((choice) => choice.value === value)
      : entry.value === value
  );
}

export async function setSessionConfigOption(
  sessionId: string,
  configId: string,
  value: string
): Promise<SessionConfigOption[]> {
  const operationId = configOptionsStore.beginOperation(sessionId);
  try {
    const client = await getAcpClient();
    const response = await client.connection.agent.request(
      methods.agent.session.setConfigOption,
      { sessionId, configId, value }
    );
    configOptionsStore.finishOperation(sessionId, operationId, response.configOptions);
    projectSessionConfigOptions(sessionId, response.configOptions);
    return response.configOptions;
  } catch (error) {
    configOptionsStore.failOperation(
      sessionId,
      operationId,
      error instanceof Error ? error.message : String(error)
    );
    const latest = configOptionsStore.getSnapshot(sessionId);
    if (latest) projectSessionConfigOptions(sessionId, latest.options);
    throw error;
  }
}

export async function setSessionProviderModel(
  sessionId: string,
  providerId: string,
  modelId?: string | null,
  thinkingEffort?: string | null
): Promise<SessionConfigOption[]> {
  const operationId = configOptionsStore.beginOperation(sessionId);
  try {
    const client = await getAcpClient();
    let response = await client.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId,
      configId: 'provider',
      value: providerId,
    });
    if (modelId) {
      response = await client.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: 'model',
        value: modelId,
      });
    }
    if (thinkingEffort != null) {
      if (!hasConfigOptionValue(response.configOptions, 'thinking_effort', thinkingEffort)) {
        throw new Error(`Thinking effort "${thinkingEffort}" is not available for the selected model`);
      }
      response = await client.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: 'thinking_effort',
        value: thinkingEffort,
      });
    }
    configOptionsStore.finishOperation(sessionId, operationId, response.configOptions);
    projectSessionConfigOptions(sessionId, response.configOptions);
    return response.configOptions;
  } catch (error) {
    configOptionsStore.failOperation(
      sessionId,
      operationId,
      error instanceof Error ? error.message : String(error)
    );
    const latest = configOptionsStore.getSnapshot(sessionId);
    if (latest) projectSessionConfigOptions(sessionId, latest.options);
    throw error;
  }
}

export async function setSessionModel(
  sessionId: string,
  providerId: string,
  modelId: string
): Promise<SessionConfigOption[]> {
  const currentProvider = configOptionsStore
    .getSnapshot(sessionId)
    ?.options.find((option) => option.id === 'provider');
  if (currentProvider?.type === 'select' && currentProvider.currentValue === providerId) {
    return setSessionConfigOption(sessionId, 'model', modelId);
  }
  return setSessionProviderModel(sessionId, providerId, modelId);
}

export function asSessionConfigOptions(value: unknown): SessionConfigOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value as SessionConfigOption[];
}
