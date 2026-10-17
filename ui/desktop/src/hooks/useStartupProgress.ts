import { useEffect, useState } from 'react';
import { acpListProviderDetails, acpListProviderModels, acpReadDefaults } from '../acp/providers';
import { acpListRecentSessions } from '../acp/sessions';

export const STARTUP_STEP_COUNT = 3;

/** Each stage is a round trip the workspace genuinely needs before it is usable. */
const RECENT_SESSIONS_ON_STARTUP = 50;

export function useStartupProgress(): number {
  const [completed, setCompleted] = useState<boolean[]>(() => [false, false, false]);

  useEffect(() => {
    let active = true;
    const mark = (index: number) => {
      if (!active) return;
      setCompleted((prev) => (prev[index] ? prev : prev.map((done, i) => (i === index ? true : done))));
    };

    const config = acpListProviderDetails().then(
      (details) => details,
      () => undefined
    );
    void config.then(() => mark(0));

    void acpListRecentSessions(RECENT_SESSIONS_ON_STARTUP).then(
      () => mark(1),
      () => mark(1)
    );

    void (async () => {
      try {
        await config;
        const { providerId } = await acpReadDefaults();
        if (providerId) await acpListProviderModels(providerId);
      } finally {
        mark(2);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const firstPending = completed.findIndex((done) => !done);
  return firstPending === -1 ? STARTUP_STEP_COUNT : firstPending;
}