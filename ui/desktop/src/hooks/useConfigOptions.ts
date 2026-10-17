import { useCallback, useSyncExternalStore } from 'react';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { setSessionConfigOption } from '../acp/configOptions';
import {
  configOptionsStore,
  type ConfigOptionsSnapshot,
} from '../acp/configOptionsStore';

export function useConfigOptions(sessionId: string | null) {
  const subscribe = useCallback(
    (listener: () => void) => (sessionId ? configOptionsStore.subscribe(sessionId, listener) : () => {}),
    [sessionId]
  );
  const getSnapshot = useCallback(
    () => (sessionId ? configOptionsStore.getSnapshot(sessionId) : undefined),
    [sessionId]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as
    | ConfigOptionsSnapshot
    | undefined;

  const setOption = useCallback(
    (configId: string, value: string) => {
      if (!sessionId) return Promise.reject(new Error('No active session'));
      return setSessionConfigOption(sessionId, configId, value);
    },
    [sessionId]
  );

  return {
    options: snapshot?.options ?? ([] as SessionConfigOption[]),
    status: snapshot?.status ?? 'unavailable',
    error: snapshot?.error,
    setOption,
  };
}
