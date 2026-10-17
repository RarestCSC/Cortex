import { defineMessages } from '../../../../i18n';
import type { MessageDescriptor } from '@formatjs/intl';

/**
 * Descriptions shown on the extensions page. The names stay in English on purpose —
 * they are the identifiers users copy into config.yaml — but the descriptions follow
 * the UI language so the page is readable without opening the config file.
 *
 * Descriptions from config.yaml are the backend's, and stay authoritative: this map
 * only takes over when the user has not written their own.
 */
const descriptions = defineMessages({
  analyze: {
    id: 'extensionDescriptions.analyze',
    defaultMessage:
      'Analyze code structure with tree-sitter: directory overviews, file details, symbol call graphs',
  },
  apps: {
    id: 'extensionDescriptions.apps',
    defaultMessage:
      'Create and manage custom Cortex apps through chat. Apps are HTML/CSS/JavaScript and run in sandboxed windows.',
  },
  autovisualiser: {
    id: 'extensionDescriptions.autovisualiser',
    defaultMessage: 'Automatically see your data with this UI generation extension.',
  },
  chatrecall: {
    id: 'extensionDescriptions.chatrecall',
    defaultMessage:
      'Search past conversations and load session summaries for contextual memory',
  },
  codeexecution: {
    id: 'extensionDescriptions.codeexecution',
    defaultMessage: 'Make extension calls through code execution, saving tokens',
  },
  computercontroller: {
    id: 'extensionDescriptions.computercontroller',
    defaultMessage:
      "General computer control tools that don't require you to be a developer or engineer.",
  },
  developer: {
    id: 'extensionDescriptions.developer',
    defaultMessage: 'Write and edit files, and execute shell commands',
  },
  extensionmanager: {
    id: 'extensionDescriptions.extensionmanager',
    defaultMessage:
      'Enable extension management tools for discovering, enabling, and disabling extensions',
  },
  memory: {
    id: 'extensionDescriptions.memory',
    defaultMessage: 'Teach the agent your preferences as you go.',
  },
  scheduler: {
    id: 'extensionDescriptions.scheduler',
    defaultMessage: 'Create and manage scheduled recipe execution',
  },
  skills: {
    id: 'extensionDescriptions.skills',
    defaultMessage: 'Discover and provide skill instructions from filesystem and builtins',
  },
  summon: {
    id: 'extensionDescriptions.summon',
    defaultMessage: 'Load knowledge and delegate tasks to subagents',
  },
  summarize: {
    id: 'extensionDescriptions.summarize',
    defaultMessage: 'Load files/directories and get an LLM summary in a single call',
  },
  todo: {
    id: 'extensionDescriptions.todo',
    defaultMessage: 'Enable a todo list so the agent can keep track of what it is doing',
  },
  tom: {
    id: 'extensionDescriptions.tom',
    defaultMessage:
      'Inject custom context into every turn via GOOSE_MOIM_MESSAGE_TEXT and GOOSE_MOIM_MESSAGE_FILE environment variables',
  },
  tutorial: {
    id: 'extensionDescriptions.tutorial',
    defaultMessage: 'Access interactive tutorials and guides',
  },
});

export type IntlLike = {
  formatMessage: (
    descriptor: MessageDescriptor,
    values?: Record<string, string | number>
  ) => string;
};

// Names arrive as ids ("code_execution"), display names ("Extension Manager") or
// anything the user typed in config.yaml, so match on a squashed key.
function descriptionKey(name: string): keyof typeof descriptions | null {
  const squashed = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const key of Object.keys(descriptions) as (keyof typeof descriptions)[]) {
    if (key.toLowerCase() === squashed) return key;
  }
  return null;
}

export function getExtensionDescription(
  name: string,
  intl: IntlLike,
  fallback: string | null | undefined
): string | null {
  const key = descriptionKey(name);
  if (key) return intl.formatMessage(descriptions[key]);
  return fallback ?? null;
}