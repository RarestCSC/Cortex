import React, { useState } from 'react';
import { Bot, LoaderCircle } from 'lucide-react';
import type { Message } from '../../../../types/message';
import { useModelAndProvider } from '../../../ModelAndProviderContext';
import { getModelDisplayName } from '../predefinedModelsUtils';
import { ModelSettingsPanel } from '../../localInference/ModelSettingsPanel';
import { ScrollArea } from '../../../ui/scroll-area';
import { defineMessages, useIntl } from '../../../../i18n';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { ComposerModelPopover } from './ComposerModelPopover';
import type Model from '../modelInterface';

const i18n = defineMessages({
  selectModel: { id: 'modelsBottomBar.selectModel', defaultMessage: 'Select Model' },
  loadingModel: { id: 'modelsBottomBar.loadingModel', defaultMessage: 'Loading model...' },
  localModelSettingsTitle: {
    id: 'modelsBottomBar.localModelSettingsTitle',
    defaultMessage: 'Local Model Settings — {modelName}',
  },
  resolvedModel: { id: 'modelsBottomBar.resolvedModel', defaultMessage: 'Resolved model' },
});

interface ModelsBottomBarProps {
  sessionId: string | null;
  onPrepareSessionModel?: (model: Model) => Promise<void>;
  dropdownRef: React.RefObject<HTMLDivElement>;
  sessionModel?: string | null;
  sessionProvider?: string | null;
  latestInference?: Message['metadata']['inference'] | null;
  sessionLoaded?: boolean;
}

export default function ModelsBottomBar({
  sessionId,
  onPrepareSessionModel,
  dropdownRef,
  sessionModel,
  sessionProvider,
  latestInference,
  sessionLoaded,
}: ModelsBottomBarProps) {
  const { currentModel: configModel, currentProvider: configProvider } = useModelAndProvider();
  const currentModel = sessionId ? (sessionModel ?? null) : configModel;
  const currentProvider = sessionId ? (sessionProvider ?? null) : configProvider;
  const intl = useIntl();
  const [isLocalModelSettingsOpen, setIsLocalModelSettingsOpen] = useState(false);
  const isModelLoading = Boolean(sessionId && !sessionLoaded);

  const resolvedModel = latestInference?.resolvedModel ?? null;
  const shouldShowResolvedModel = Boolean(
    !isModelLoading &&
    resolvedModel &&
    latestInference?.provider === currentProvider &&
    latestInference?.requestedModel === currentModel &&
    resolvedModel !== currentModel
  );
  const triggerLabel = isModelLoading
    ? intl.formatMessage(i18n.loadingModel)
    : currentModel
      ? getModelDisplayName(currentModel)
      : intl.formatMessage(i18n.selectModel);

  return (
    <div className="relative flex min-w-0 items-center gap-2" ref={dropdownRef}>
      {isModelLoading ? (
        <div
          data-testid="model-loading-state"
          className="inline-flex min-w-0 items-center gap-1 text-xs"
        >
          <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
          <span className="truncate">{triggerLabel}</span>
        </div>
      ) : (
        <Bot className="h-4 w-4 shrink-0 text-text-primary/70" />
      )}
      <ComposerModelPopover
        sessionId={sessionId}
        onPrepareSessionModel={onPrepareSessionModel}
        currentModel={currentModel}
        currentProvider={currentProvider}
        disabled={isModelLoading}
        onLocalSettings={() => setIsLocalModelSettingsOpen(true)}
      />
      {shouldShowResolvedModel && resolvedModel && (
        <span
          className="hidden max-w-32 truncate text-xs text-text-secondary xl:inline"
          title={resolvedModel}
        >
          {intl.formatMessage(i18n.resolvedModel)}: {getModelDisplayName(resolvedModel)}
        </span>
      )}
      <ThinkingEffortControl
        sessionId={sessionId}
        modelLabel={currentModel ? getModelDisplayName(currentModel) : undefined}
        compact
      />

      {isLocalModelSettingsOpen && currentModel && currentProvider === 'local' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex max-h-[80vh] w-[min(480px,calc(100vw-2rem))] flex-col rounded-lg border border-border-primary bg-background-primary shadow-lg">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h3 className="text-sm font-medium text-text-default">
                {intl.formatMessage(i18n.localModelSettingsTitle, {
                  modelName: getModelDisplayName(currentModel),
                })}
              </h3>
              <button
                onClick={() => setIsLocalModelSettingsOpen(false)}
                className="text-lg leading-none text-text-muted hover:text-text-default"
              >
                ×
              </button>
            </div>
            <ScrollArea className="max-h-[calc(80vh-52px)] flex-1 overflow-y-auto px-4 py-3">
              <ModelSettingsPanel modelId={currentModel} />
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
