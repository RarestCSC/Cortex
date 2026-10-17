import type { SessionConfigOption } from '@agentclientprotocol/sdk';

export type ConfigOptionsStatus = 'unavailable' | 'confirmed' | 'pending' | 'error';

export interface ConfigOptionsSnapshot {
  sessionId: string;
  options: SessionConfigOption[];
  status: ConfigOptionsStatus;
  error?: string;
  operationId?: number;
}

type Listener = () => void;

const snapshots = new Map<string, ConfigOptionsSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const bufferedUpdates = new Map<string, SessionConfigOption[]>();
const activeOperations = new Map<string, number>();
let nextOperationId = 1;

function publish(sessionId: string, snapshot: ConfigOptionsSnapshot): void {
  snapshots.set(sessionId, snapshot);
  listeners.get(sessionId)?.forEach((listener) => listener());
}

export const configOptionsStore = {
  getSnapshot(sessionId: string): ConfigOptionsSnapshot | undefined {
    return snapshots.get(sessionId);
  },

  subscribe(sessionId: string, listener: Listener): () => void {
    const sessionListeners = listeners.get(sessionId) ?? new Set<Listener>();
    sessionListeners.add(listener);
    listeners.set(sessionId, sessionListeners);
    return () => {
      sessionListeners.delete(listener);
      if (sessionListeners.size === 0) listeners.delete(sessionId);
    };
  },

  replaceConfirmed(sessionId: string, options: SessionConfigOption[]): void {
    if (activeOperations.has(sessionId)) {
      bufferedUpdates.set(sessionId, options);
      return;
    }
    publish(sessionId, { sessionId, options, status: 'confirmed' });
  },

  beginOperation(sessionId: string): number {
    if (activeOperations.has(sessionId)) throw new Error('A config update is already pending');
    const operationId = nextOperationId++;
    activeOperations.set(sessionId, operationId);
    bufferedUpdates.delete(sessionId);
    const current = snapshots.get(sessionId);
    publish(sessionId, {
      sessionId,
      options: current?.options ?? [],
      status: 'pending',
      operationId,
    });
    return operationId;
  },

  finishOperation(sessionId: string, operationId: number, options: SessionConfigOption[]): void {
    if (activeOperations.get(sessionId) !== operationId) return;
    activeOperations.delete(sessionId);
    bufferedUpdates.delete(sessionId);
    publish(sessionId, { sessionId, options, status: 'confirmed' });
  },

  failOperation(sessionId: string, operationId: number, error: string): void {
    if (activeOperations.get(sessionId) !== operationId) return;
    activeOperations.delete(sessionId);
    const buffered = bufferedUpdates.get(sessionId);
    bufferedUpdates.delete(sessionId);
    const current = snapshots.get(sessionId);
    publish(sessionId, {
      sessionId,
      options: buffered ?? current?.options ?? [],
      status: 'error',
      error,
    });
  },

  delete(sessionId: string): void {
    snapshots.delete(sessionId);
    activeOperations.delete(sessionId);
    bufferedUpdates.delete(sessionId);
    listeners.get(sessionId)?.forEach((listener) => listener());
  },

  isPending(sessionId: string): boolean {
    return activeOperations.has(sessionId);
  },
};
