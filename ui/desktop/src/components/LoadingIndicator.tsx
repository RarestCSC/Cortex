import CortexIcon from './CortexIcon';
import AnimatedIcons from './AnimatedIcons';
import { CortexMark } from './icons/CortexMark';
import { ChatState } from '../types/chatState';
import { defineMessages, useIntl } from '../i18n';

interface LoadingIndicatorProps {
  message?: string;
  chatState?: ChatState;
}

const i18n = defineMessages({
  loadingConversation: {
    id: 'loadingIndicator.loadingConversation',
    defaultMessage: 'loading conversation...',
  },
  thinking: {
    id: 'loadingIndicator.thinking',
    defaultMessage: 'Cortex is thinking…',
  },
  streaming: {
    id: 'loadingIndicator.streaming',
    defaultMessage: 'Cortex is working on it…',
  },
  waiting: {
    id: 'loadingIndicator.waiting',
    defaultMessage: 'Cortex is waiting…',
  },
  compacting: {
    id: 'loadingIndicator.compacting',
    defaultMessage: 'Cortex is compacting the conversation...',
  },
  idle: {
    id: 'loadingIndicator.idle',
    defaultMessage: 'Cortex is working on it…',
  },
  restartingAgent: {
    id: 'loadingIndicator.restartingAgent',
    defaultMessage: 'restarting session...',
  },
});

const STATE_ICONS: Record<ChatState, React.ReactNode> = {
  [ChatState.LoadingConversation]: <AnimatedIcons className="flex-shrink-0" cycleInterval={600} />,
  [ChatState.Thinking]: <AnimatedIcons className="flex-shrink-0" cycleInterval={600} />,
  [ChatState.Streaming]: <CortexMark className="size-4 flex-shrink-0" />,
  [ChatState.WaitingForUserInput]: (
    <AnimatedIcons className="flex-shrink-0" cycleInterval={600} variant="waiting" />
  ),
  [ChatState.Compacting]: <AnimatedIcons className="flex-shrink-0" cycleInterval={600} />,
  [ChatState.Idle]: <CortexIcon size="small" hover={false} />,
  [ChatState.RestartingAgent]: <AnimatedIcons className="flex-shrink-0" cycleInterval={600} />,
};

const STATE_MESSAGE_KEYS: Record<ChatState, keyof typeof i18n> = {
  [ChatState.LoadingConversation]: 'loadingConversation',
  [ChatState.Thinking]: 'thinking',
  [ChatState.Streaming]: 'streaming',
  [ChatState.WaitingForUserInput]: 'waiting',
  [ChatState.Compacting]: 'compacting',
  [ChatState.Idle]: 'idle',
  [ChatState.RestartingAgent]: 'restartingAgent',
};

const LoadingIndicator = ({ message, chatState = ChatState.Idle }: LoadingIndicatorProps) => {
  const intl = useIntl();
  const displayMessage = message || intl.formatMessage(i18n[STATE_MESSAGE_KEYS[chatState]]);
  const icon = STATE_ICONS[chatState];

  return (
    <div className="w-full animate-fade-slide-up">
      <div
        data-testid="loading-indicator"
        className="flex items-center gap-2 text-xs text-text-primary py-2"
      >
        {icon}
        {displayMessage}
      </div>
    </div>
  );
};

export default LoadingIndicator;
