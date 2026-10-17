import { useEffect, useState } from 'react';
import { CortexLogo } from './CortexLogo';
import { defineMessages, useIntl } from '../i18n';
import './WelcomeGreeting.css';

const i18n = defineMessages({
  morning: { id: 'hub.goodMorning', defaultMessage: "Good morning. What's the task?" },
  afternoon: { id: 'hub.goodAfternoon', defaultMessage: "Good afternoon. What's the task?" },
  evening: { id: 'hub.goodEvening', defaultMessage: "Good evening. What's the task?" },
});

export function greetingPeriodForHour(hour: number): 'morning' | 'afternoon' | 'evening' {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  if (normalized >= 5 && normalized < 12) return 'morning';
  if (normalized >= 12 && normalized < 18) return 'afternoon';
  return 'evening';
}

export function WelcomeGreeting() {
  const intl = useIntl();
  const [hour, setHour] = useState(() => new Date().getHours());

  useEffect(() => {
    const timer = window.setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="cortex-welcome">
      <CortexLogo className="cortex-welcome-brand" />
      <p className="cortex-welcome-text">{intl.formatMessage(i18n[greetingPeriodForHour(hour)])}</p>
    </div>
  );
}
