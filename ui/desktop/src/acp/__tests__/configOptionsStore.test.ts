import { afterEach, describe, expect, it } from 'vitest';
import { configOptionsStore } from '../configOptionsStore';

const sessionId = 'config-options-store-test';
const options = [
  {
    id: 'thinking_effort',
    name: 'Thinking effort',
    type: 'select' as const,
    currentValue: 'high',
    options: [{ value: 'high', name: 'High' }],
  },
  {
    id: 'mode',
    name: 'Mode',
    type: 'select' as const,
    currentValue: 'plan',
    options: [{ value: 'plan', name: 'Plan' }],
  },
];

afterEach(() => configOptionsStore.delete(sessionId));

describe('config options store', () => {
  it('replaces the full confirmed option set and notifies subscribers', () => {
    let changes = 0;
    const unsubscribe = configOptionsStore.subscribe(sessionId, () => changes++);
    configOptionsStore.replaceConfirmed(sessionId, options);
    configOptionsStore.replaceConfirmed(sessionId, [options[0]]);

    expect(configOptionsStore.getSnapshot(sessionId)).toMatchObject({
      options: [options[0]],
      status: 'confirmed',
    });
    expect(changes).toBe(2);
    unsubscribe();
  });

  it('retains the last confirmed values while an operation is pending or fails', () => {
    configOptionsStore.replaceConfirmed(sessionId, options);
    const operationId = configOptionsStore.beginOperation(sessionId);
    expect(configOptionsStore.getSnapshot(sessionId)).toMatchObject({
      options,
      status: 'pending',
    });
    configOptionsStore.failOperation(sessionId, operationId, 'request failed');
    expect(configOptionsStore.getSnapshot(sessionId)).toMatchObject({
      options,
      status: 'error',
      error: 'request failed',
    });
  });

  it('buffers push snapshots during an operation and publishes only its final response', () => {
    configOptionsStore.replaceConfirmed(sessionId, options);
    const operationId = configOptionsStore.beginOperation(sessionId);
    configOptionsStore.replaceConfirmed(sessionId, [options[0]]);

    expect(configOptionsStore.getSnapshot(sessionId)).toMatchObject({ options, status: 'pending' });
    expect(() => configOptionsStore.beginOperation(sessionId)).toThrow(/already pending/);

    configOptionsStore.finishOperation(sessionId, operationId, [options[0]]);
    expect(configOptionsStore.getSnapshot(sessionId)).toMatchObject({
      options: [options[0]],
      status: 'confirmed',
    });
  });

  it('keeps a late operation result scoped to its original session', () => {
    const operationId = configOptionsStore.beginOperation(sessionId);
    configOptionsStore.replaceConfirmed('another-session', [options[1]]);
    configOptionsStore.finishOperation(sessionId, operationId, options);

    expect(configOptionsStore.getSnapshot(sessionId)?.options).toEqual(options);
    expect(configOptionsStore.getSnapshot('another-session')?.options).toEqual([options[1]]);
    configOptionsStore.delete('another-session');
  });
});
