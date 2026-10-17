import { defineMessages } from '../../i18n';
import type { MessageDescriptor } from '@formatjs/intl';

/**
 * Descriptions shown on the skills page. The names stay as authored — they are the
 * identifiers the agent matches on and the user installs them by — but the
 * descriptions follow the UI language so the page reads like the rest of the app.
 *
 * Each description comes from its SKILL.md frontmatter and stays authoritative:
 * this map only takes over for the skills listed here, everything else renders as
 * the user authored it.
 */
const descriptions = defineMessages({
  'context-compression-fast-workflow': {
    id: 'skillDescriptions.contextCompressionFastWorkflow',
    defaultMessage:
      'Keep long coding work efficient with bounded context, batched edits, focused verification, and compact handoffs.',
  },
  'session-task-scheduling': {
    id: 'skillDescriptions.sessionTaskScheduling',
    defaultMessage:
      'Decide whether to keep work in one session or split it into bounded parallel tasks, and define scopes and acceptance criteria.',
  },
  'web-search': {
    id: 'skillDescriptions.webSearch',
    defaultMessage:
      'Search the web and read page content. Works with or without a proxy.',
  },
});

export type IntlLike = {
  formatMessage: (
    descriptor: MessageDescriptor,
    values?: Record<string, string | number>
  ) => string;
};

function descriptionKey(name: string): keyof typeof descriptions | null {
  const squashed = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const key of Object.keys(descriptions) as (keyof typeof descriptions)[]) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === squashed) return key;
  }
  return null;
}

export function getSkillDescription(
  name: string,
  intl: IntlLike,
  fallback: string
): string {
  const key = descriptionKey(name);
  return key ? intl.formatMessage(descriptions[key]) : fallback;
}