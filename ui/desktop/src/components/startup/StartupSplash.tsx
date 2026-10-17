import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { CortexMark } from '../icons/CortexMark';
import { defineMessages, useIntl } from '../../i18n';
import { STARTUP_STEP_COUNT } from '../../hooks/useStartupProgress';

const i18n = defineMessages({
  stepConfig: {
    id: 'startupSplash.stepConfig',
    defaultMessage: 'Load configuration',
  },
  stepSessions: {
    id: 'startupSplash.stepSessions',
    defaultMessage: 'Restore sessions',
  },
  stepWorkspace: {
    id: 'startupSplash.stepWorkspace',
    defaultMessage: 'Prepare workspace',
  },
  footer: {
    id: 'startupSplash.footer',
    defaultMessage: 'v{version} · Local-first by design',
  },
});

interface StartupSplashProps {
  /** Number of finished steps; `STARTUP_STEP_COUNT` means the splash is on its way out. */
  completedSteps: number;
  /** Empty before the Electron bridge answers, in which case the footer stays hidden. */
  version: string;
}

export default function StartupSplash({ completedSteps, version }: StartupSplashProps) {
  const intl = useIntl();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (completedSteps < STARTUP_STEP_COUNT) return undefined;
    const timer = setTimeout(() => setVisible(false), 320);
    return () => clearTimeout(timer);
  }, [completedSteps]);

  if (!visible) return null;

  const steps = [
    intl.formatMessage(i18n.stepConfig),
    intl.formatMessage(i18n.stepSessions),
    intl.formatMessage(i18n.stepWorkspace),
  ];

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-background-primary transition-opacity duration-300 ${
        completedSteps >= STARTUP_STEP_COUNT ? 'opacity-0' : 'opacity-100'
      }`}
      data-testid="startup-splash"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-32 top-1/4 h-96 w-96 rounded-full bg-background-primary/5 blur-3xl" />
        <div className="absolute -left-24 bottom-1/4 h-80 w-80 rounded-full bg-background-primary/5 blur-3xl" />
      </div>

      <div className="relative flex flex-col items-center px-8">
        <CortexMark className="h-48 w-48 -translate-y-16" />

        <ol className="mt-14 flex w-full max-w-lg items-start">
          {steps.map((label, index) => {
            const state = index < completedSteps ? 'done' : index === completedSteps ? 'active' : 'pending';
            return (
              <li key={label} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full items-center">
                  <span
                    className={`h-px flex-1 ${index === 0 ? 'opacity-0' : ''} ${
                      index < completedSteps ? 'bg-background-primary' : 'bg-border-secondary'
                    }`}
                  />
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      state === 'done'
                        ? 'border-border-primary bg-background-primary text-background-primary'
                        : state === 'active'
                          ? 'border-border-primary bg-background-primary'
                          : 'border-border-secondary bg-background-primary'
                    }`}
                  >
                    {state === 'done' ? (
                      <Check className="h-3 w-3" strokeWidth={3} />
                    ) : state === 'active' ? (
                      <span className="h-2 w-2 rounded-full bg-background-primary" />
                    ) : null}
                  </span>
                  <span
                    className={`h-px flex-1 ${index === steps.length - 1 ? 'opacity-0' : ''} ${
                      index < completedSteps - 1 ? 'bg-background-primary' : 'bg-border-secondary'
                    }`}
                  />
                </div>
                <span
                  className={`text-center text-xs transition-colors ${
                    state === 'pending' ? 'text-text-tertiary' : 'text-text-secondary'
                  }`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {version ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pb-6 text-xs text-text-tertiary">
          <span>{intl.formatMessage(i18n.footer, { version })}</span>
        </div>
      ) : null}
    </div>
  );
}
