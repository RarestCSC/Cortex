import type {
  GooseSessionNotification_unstable,
  ProviderDeviceCodeNotification_unstable,
} from '@cortex/acp-client';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { AppEvents } from '../constants/events';
import { maybeHandlePlatformEvent } from '../utils/platform_events';
import { toolNotificationEvent } from './adapter/toolNotifications';
import { acpChatSessionActions, acpChatSessionStore } from './chatSessionStore';
import { publishLiveVoiceInteractionEnded } from './liveVoiceNotifications';
import { replaceSessionConfigOptions } from './configOptions';

export function handleAcpSessionNotification(notification: SessionNotification): Promise<void> {
  if (notification.update.sessionUpdate === 'config_option_update') {
    replaceSessionConfigOptions(notification.sessionId, notification.update.configOptions);
    return Promise.resolve();
  }
  const sessionNameBeforeNotification = acpChatSessionStore.getSnapshot(notification.sessionId)
    ?.session?.name;
  const updatedName =
    notification.update.sessionUpdate === 'session_info_update'
      ? notification.update.title
      : undefined;
  acpChatSessionActions.applyAcpSessionNotification(notification);
  maybeHandleLivePlatformEvent(notification);

  if (updatedName && updatedName !== sessionNameBeforeNotification) {
    window.dispatchEvent(
      new CustomEvent(AppEvents.SESSION_RENAMED, {
        detail: { sessionId: notification.sessionId, newName: updatedName },
      })
    );
  }

  return Promise.resolve();
}

function maybeHandleLivePlatformEvent(notification: SessionNotification): void {
  const update = notification.update;
  if (
    update.sessionUpdate !== 'tool_call_update' ||
    update.status === 'completed' ||
    update.status === 'failed'
  ) {
    return;
  }

  const event = toolNotificationEvent(update);
  if (event?.message.method === 'platform_event') {
    maybeHandlePlatformEvent(event.message, notification.sessionId);
  }
}

export function handleAcpGooseSessionNotification(
  notification: GooseSessionNotification_unstable
): Promise<void> {
  if (notification.update.sessionUpdate === 'live_voice_interaction_ended') {
    publishLiveVoiceInteractionEnded({
      sessionId: notification.sessionId,
      update: notification.update,
    });
    return Promise.resolve();
  }

  acpChatSessionActions.applyAcpGooseSessionNotification(notification);
  return Promise.resolve();
}

export function handleAcpProviderDeviceCodeNotification(
  notification: ProviderDeviceCodeNotification_unstable
): Promise<void> {
  window.dispatchEvent(new CustomEvent('goose:device-code', { detail: notification }));
  return Promise.resolve();
}
