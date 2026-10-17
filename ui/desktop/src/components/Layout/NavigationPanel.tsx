import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  AudioLines,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Plus,
  Trash2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigationContext } from './NavigationContext';
import { useConfig } from '../ConfigContext';
import { useNavigationSessions } from '../../hooks/useNavigationSessions';
import {
  NAV_ITEMS,
  SETTINGS_NAV_ITEM,
  getNavItemLabel,
  type NavItem,
} from '../../hooks/useNavigationItems';
import { AppEvents } from '../../constants/events';
import { InlineEditText } from '../common/InlineEditText';
import { SessionIndicators } from '../SessionIndicators';
import { acpRenameSession, type SessionListItem } from '../../acp/sessions';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';
import { ConfirmationModal } from '../ui/ConfirmationModal';
import { formatMessageTimestamp } from '../../utils/timeUtils';
import { errorMessage } from '../../utils/conversionUtils';
import { toast } from 'react-toastify';
import { cn } from '../../utils';
import type { ProjectGroup } from '../../utils/projectSessions';
import { defineMessages, useIntl } from '../../i18n';

type StreamState = 'idle' | 'loading' | 'streaming' | 'error';

interface SessionStatus {
  streamState: StreamState;
  hasUnreadActivity: boolean;
}

const i18n = defineMessages({
  chats: {
    id: 'navigationPanel.chats',
    defaultMessage: 'Chats',
  },
  addWorkspace: {
    id: 'navigationPanel.addWorkspace',
    defaultMessage: 'Add working directory',
  },
  newSessionIn: {
    id: 'navigationPanel.newSessionIn',
    defaultMessage: 'New session',
  },
  archived: {
    id: 'navigationPanel.archived',
    defaultMessage: 'Archived',
  },
  noArchived: {
    id: 'navigationPanel.noArchived',
    defaultMessage: 'No archived sessions',
  },
  archiveSession: {
    id: 'navigationPanel.archiveSession',
    defaultMessage: 'Archive session',
  },
  unarchiveSession: {
    id: 'navigationPanel.unarchiveSession',
    defaultMessage: 'Restore session',
  },
  // Reuses the ids already translated for the session history page.
  deleteSession: { id: 'sessions.action.delete', defaultMessage: 'Delete session' },
  deleteTitle: { id: 'sessions.delete.title', defaultMessage: 'Delete Session' },
  deleteMessage: {
    id: 'sessions.delete.message',
    defaultMessage:
      'Are you sure you want to delete the session "{name}"? This action cannot be undone.',
  },
  deleteSuccess: { id: 'sessions.toast.deleted', defaultMessage: 'Session deleted successfully' },
  deleteFailed: {
    id: 'sessions.toast.deleteFailed',
    defaultMessage: 'Failed to delete session "{name}": {error}',
  },
  noDirectory: {
    id: 'navigationPanel.noDirectory',
    defaultMessage: 'No working directory',
  },
  noChats: {
    id: 'navigationPanel.noChats',
    defaultMessage: 'No recent chats',
  },
  loadingChats: {
    id: 'navigationPanel.loadingChats',
    defaultMessage: 'Loading chats…',
  },
  untitledSession: {
    id: 'navigationPanel.untitledSession',
    defaultMessage: 'Untitled session',
  },
  metaModel: {
    id: 'navigationPanel.metaModel',
    defaultMessage: 'Model',
  },
  metaDirectory: {
    id: 'navigationPanel.metaDirectory',
    defaultMessage: 'Directory',
  },
  metaStatus: {
    id: 'navigationPanel.metaStatus',
    defaultMessage: 'Status',
  },
  metaCreated: {
    id: 'navigationPanel.metaCreated',
    defaultMessage: 'Created',
  },
  metaUpdated: {
    id: 'navigationPanel.metaUpdated',
    defaultMessage: 'Updated',
  },
  statusStreaming: {
    id: 'navigationPanel.statusStreaming',
    defaultMessage: 'Streaming',
  },
  statusError: {
    id: 'navigationPanel.statusError',
    defaultMessage: 'Error',
  },
  statusUnread: {
    id: 'navigationPanel.statusUnread',
    defaultMessage: 'Unread activity',
  },
  statusIdle: {
    id: 'navigationPanel.statusIdle',
    defaultMessage: 'Idle',
  },
  returnToActiveLiveVoice: {
    id: 'liveVoice.returnToActive',
    defaultMessage: 'Return to active Live voice',
  },
});

const navItemClass = (active: boolean) =>
  cn(
    'flex flex-row items-center gap-3 outline-none no-drag w-full',
    'rounded-full px-3 py-2 text-sm font-medium transition-colors',
    active
      ? 'bg-background-tertiary text-text-primary'
      : 'text-text-primary hover:bg-background-tertiary/60'
  );

interface NavRowProps {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}

const NavRow: React.FC<NavRowProps> = ({ item, active, onClick }) => {
  const intl = useIntl();
  const Icon = item.icon;
  return (
    <button onClick={onClick} className={navItemClass(active)}>
      <Icon className="w-5 h-5 flex-shrink-0 text-text-secondary" />
      <span className="text-left flex-1 truncate">{getNavItemLabel(item, intl)}</span>
      {item.getTag && (
        <span className="text-xs font-mono text-text-secondary">{item.getTag()}</span>
      )}
    </button>
  );
};

interface SessionRowProps {
  session: SessionListItem;
  active: boolean;
  isLiveVoiceActive: boolean;
  status: SessionStatus | undefined;
  onClick: () => void;
  onRenamed: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
}

const formatTimestamp = (value?: string): string | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return formatMessageTimestamp(parsed / 1000);
};

const MetaRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex gap-2">
    <span className="text-text-inverse/60 flex-shrink-0">{label}</span>
    <span className="text-right ml-auto break-all">{value}</span>
  </div>
);

interface SessionTooltipContentProps {
  session: SessionListItem;
  statusLabel: string;
}

const SessionTooltipContent: React.FC<SessionTooltipContentProps> = ({ session, statusLabel }) => {
  const intl = useIntl();
  const model = session.modelId
    ? session.providerId
      ? `${session.modelId} (${session.providerId})`
      : session.modelId
    : session.providerId;
  const created = formatTimestamp(session.createdAt);
  const updated = formatTimestamp(session.lastMessageAt ?? session.updatedAt);

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="font-medium break-words">
        {session.name || intl.formatMessage(i18n.untitledSession)}
      </div>
      <div className="flex flex-col gap-0.5">
        {model && <MetaRow label={intl.formatMessage(i18n.metaModel)} value={model} />}
        {session.workingDir && (
          <MetaRow label={intl.formatMessage(i18n.metaDirectory)} value={session.workingDir} />
        )}
        <MetaRow label={intl.formatMessage(i18n.metaStatus)} value={statusLabel} />
        {created && <MetaRow label={intl.formatMessage(i18n.metaCreated)} value={created} />}
        {updated && <MetaRow label={intl.formatMessage(i18n.metaUpdated)} value={updated} />}
      </div>
    </div>
  );
};

const SessionRow: React.FC<SessionRowProps> = ({
  session,
  active,
  isLiveVoiceActive,
  status,
  onClick,
  onRenamed,
  onArchive,
  onUnarchive,
  onDelete,
}) => {
  const intl = useIntl();
  const [isEditing, setIsEditing] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const isStreaming = status?.streamState === 'streaming';
  const hasError = status?.streamState === 'error';
  const hasUnread = status?.hasUnreadActivity ?? false;
  const rowActions = useMemo(() => {
    const actions: {
      icon: React.ComponentType<{ className?: string }>;
      label: string;
      onClick: () => void;
      destructive?: boolean;
    }[] = [];

    if (onUnarchive) {
      actions.push({
        icon: ArchiveRestore,
        label: intl.formatMessage(i18n.unarchiveSession),
        onClick: onUnarchive,
      });
    }
    if (onArchive) {
      actions.push({
        icon: Archive,
        label: intl.formatMessage(i18n.archiveSession),
        onClick: onArchive,
      });
    }
    actions.push({
      icon: Trash2,
      label: intl.formatMessage(i18n.deleteSession),
      onClick: onDelete,
      destructive: true,
    });

    return actions;
  }, [onArchive, onUnarchive, onDelete, intl]);

  const statusLabel = isStreaming
    ? intl.formatMessage(i18n.statusStreaming)
    : hasError
      ? intl.formatMessage(i18n.statusError)
      : hasUnread
        ? intl.formatMessage(i18n.statusUnread)
        : intl.formatMessage(i18n.statusIdle);

  return (
    <Tooltip open={tooltipOpen && !isEditing} onOpenChange={setTooltipOpen} delayDuration={400}>
      <TooltipTrigger asChild>
        <div
          onClick={() => !isEditing && onClick()}
          className={cn(
            'group/session flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer text-sm',
            'hover:bg-background-tertiary/60 transition-colors',
            active && 'bg-background-tertiary'
          )}
        >
          <InlineEditText
            value={session.name}
            onSave={async (newName) => {
              await acpRenameSession(session.id, newName);
              window.dispatchEvent(
                new CustomEvent(AppEvents.SESSION_RENAMED, {
                  detail: { sessionId: session.id, newName, userInitiated: true },
                })
              );
              onRenamed();
            }}
            placeholder={intl.formatMessage(i18n.untitledSession)}
            disabled={isStreaming}
            singleClickEdit={false}
            className="truncate text-text-primary flex-1 !px-0 !py-0 hover:bg-transparent"
            editClassName="!text-sm"
            onEditStart={() => setIsEditing(true)}
            onEditEnd={() => setIsEditing(false)}
          />
          {isLiveVoiceActive && (
            <AudioLines
              className="w-3.5 h-3.5 flex-shrink-0 text-blue-500"
              aria-label={intl.formatMessage(i18n.returnToActiveLiveVoice)}
            />
          )}
          {!isEditing && (
            <div className="flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/session:opacity-100">
              {rowActions.map((action) => (
                <button
                  key={action.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    action.onClick();
                  }}
                  aria-label={action.label}
                  title={action.label}
                  className={cn(
                    'rounded-full p-0.5 text-text-secondary transition-colors hover:bg-background-tertiary hover:text-text-primary',
                    action.destructive && 'hover:text-red-500'
                  )}
                >
                  <action.icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          )}
          <SessionIndicators isStreaming={isStreaming} hasUnread={hasUnread} hasError={hasError} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-xs text-left">
        <SessionTooltipContent session={session} statusLabel={statusLabel} />
      </TooltipContent>
    </Tooltip>
  );
};

export const Navigation: React.FC<{
  className?: string;
  activeLiveVoiceSessionId: string | null;
}> = ({ className, activeLiveVoiceSessionId }) => {
  const intl = useIntl();
  const { isNavExpanded } = useNavigationContext();
  const location = useLocation();
  const { extensionsList } = useConfig();

  const appsExtensionEnabled = !!extensionsList?.find((ext) => ext.name === 'apps')?.enabled;

  const visibleItems = useMemo<NavItem[]>(() => {
    return NAV_ITEMS.filter((item) => {
      if (item.id === 'recipes' || item.id === 'scheduler') return false;
      if (item.path === '/apps') return appsExtensionEnabled;
      return true;
    });
  }, [appsExtensionEnabled]);

  const isActive = useCallback((path: string) => location.pathname === path, [location.pathname]);

  const {
    recentSessions,
    recentSessionsByProject,
    archivedSessions,
    isLoadingSessions,
    activeSessionId,
    fetchSessions,
    handleNavClick,
    handleSessionClick,
    handleArchiveSession,
    handleUnarchiveSession,
    handleDeleteSession,
    handleAddWorkspace,
    startSessionInWorkspace,
  } = useNavigationSessions();

  const [sessionStatuses, setSessionStatuses] = useState<Map<string, SessionStatus>>(new Map());

  useEffect(() => {
    const handleStatusUpdate = (event: Event) => {
      const { sessionId, streamState } = (event as CustomEvent).detail;
      setSessionStatuses((prev) => {
        const existing = prev.get(sessionId);
        const shouldMarkUnread = existing?.streamState === 'streaming' && streamState === 'idle';
        const next = new Map(prev);
        next.set(sessionId, {
          streamState,
          hasUnreadActivity: existing?.hasUnreadActivity || shouldMarkUnread,
        });
        return next;
      });
    };

    window.addEventListener(AppEvents.SESSION_STATUS_UPDATE, handleStatusUpdate);
    return () => window.removeEventListener(AppEvents.SESSION_STATUS_UPDATE, handleStatusUpdate);
  }, []);

  const clearUnread = useCallback((sessionId: string) => {
    setSessionStatuses((prev) => {
      const status = prev.get(sessionId);
      if (status?.hasUnreadActivity) {
        const next = new Map(prev);
        next.set(sessionId, { ...status, hasUnreadActivity: false });
        return next;
      }
      return prev;
    });
  }, []);

  const navFocusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isNavExpanded) {
      fetchSessions();
      requestAnimationFrame(() => navFocusRef.current?.focus());
    }
  }, [isNavExpanded, fetchSessions]);

  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [sessionToDelete, setSessionToDelete] = useState<SessionListItem | null>(null);

  const handleConfirmDelete = useCallback(async () => {
    if (!sessionToDelete) return;

    const { id, name } = sessionToDelete;
    setSessionToDelete(null);

    try {
      await handleDeleteSession(id);
      toast.success(intl.formatMessage(i18n.deleteSuccess));
    } catch (error) {
      console.error('Failed to delete session:', error);
      toast.error(
        intl.formatMessage(i18n.deleteFailed, {
          name,
          error: errorMessage(error, 'Unknown error'),
        })
      );
    }
  }, [sessionToDelete, handleDeleteSession, intl]);

  const toggleProjectCollapsed = useCallback((path: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (!isNavExpanded) return null;

  return (
    <motion.div
      ref={navFocusRef}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={cn('bg-background-primary outline-none flex flex-col h-full', className)}
    >
      <div className="h-[48px] no-drag" />

      <div className="px-2 flex flex-col gap-0.5">
        {visibleItems.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            active={isActive(item.path)}
            onClick={() => handleNavClick(item.path)}
          />
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col mt-3">
        <button
          onClick={() => void handleAddWorkspace()}
          className="mx-2 mb-1 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-background-tertiary/60"
        >
          <FolderPlus className="w-5 h-5 flex-shrink-0 text-text-secondary" />
          <span className="text-left flex-1 truncate">
            {intl.formatMessage(i18n.addWorkspace)}
          </span>
        </button>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 mt-1">
            {recentSessions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-secondary">
                {intl.formatMessage(isLoadingSessions ? i18n.loadingChats : i18n.noChats)}
              </div>
            ) : (
              recentSessionsByProject.map((group: ProjectGroup) => {
                const isCollapsed = collapsedProjects.has(group.path);
                const groupLabel = group.path
                  ? group.label
                  : intl.formatMessage(i18n.noDirectory);
                return (
                  <React.Fragment key={group.path}>
                    <div className="flex items-center w-full pl-3 pr-3 pt-2 pb-0.5 text-sm text-text-tertiary">
                      <button
                        onClick={() => toggleProjectCollapsed(group.path)}
                        aria-expanded={!isCollapsed}
                        className="flex items-center gap-1 min-w-0 flex-1 text-left transition-colors hover:text-text-primary"
                        title={group.path || undefined}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                        )}
                        <span className="truncate">{groupLabel}</span>
                      </button>
                      <button
                        onClick={() => startSessionInWorkspace(group.path)}
                        disabled={!group.path}
                        aria-label={intl.formatMessage(i18n.newSessionIn)}
                        title={intl.formatMessage(i18n.newSessionIn)}
                        className="flex-shrink-0 p-0.5 rounded text-text-tertiary transition-colors hover:text-text-secondary disabled:opacity-40"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="pl-4">
                        {group.sessions.map((session) => (
                          <SessionRow
                            key={session.id}
                            session={session}
                            active={session.id === activeSessionId}
                            isLiveVoiceActive={session.id === activeLiveVoiceSessionId}
                            status={sessionStatuses.get(session.id)}
                            onClick={() => {
                              clearUnread(session.id);
                              handleSessionClick(session.id);
                            }}
                            onRenamed={fetchSessions}
                            onArchive={() => void handleArchiveSession(session.id)}
                            onDelete={() => setSessionToDelete(session)}
                          />
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </div>

        <div className="border-t border-border-secondary px-2 pt-2 pb-1">
          <button
            onClick={() => setIsArchivedExpanded((v) => !v)}
            aria-expanded={isArchivedExpanded}
            className="flex w-full items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary transition-colors hover:text-text-primary"
          >
            {isArchivedExpanded ? (
              <ChevronDown className="w-3 h-3 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
            )}
            <span className="truncate">{intl.formatMessage(i18n.archived)}</span>
            {archivedSessions.length > 0 && (
              <span className="ml-auto text-[10px] font-normal text-text-tertiary">
                {archivedSessions.length}
              </span>
            )}
          </button>
          {isArchivedExpanded && (
            <div className="max-h-56 overflow-y-auto">
              {archivedSessions.length === 0 ? (
                <p className="px-3 py-1.5 text-xs text-text-secondary">
                  {intl.formatMessage(i18n.noArchived)}
                </p>
              ) : (
                archivedSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    isLiveVoiceActive={false}
                    status={sessionStatuses.get(session.id)}
                    onClick={() => handleSessionClick(session.id)}
                    onRenamed={fetchSessions}
                    onUnarchive={() => void handleUnarchiveSession(session.id)}
                    onDelete={() => setSessionToDelete(session)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-2 pt-2 pb-2 border-t border-border-secondary">
        <NavRow
          item={SETTINGS_NAV_ITEM}
          active={isActive(SETTINGS_NAV_ITEM.path)}
          onClick={() => handleNavClick(SETTINGS_NAV_ITEM.path)}
        />
      </div>

      <ConfirmationModal
        isOpen={!!sessionToDelete}
        title={intl.formatMessage(i18n.deleteTitle)}
        message={
          sessionToDelete
            ? intl.formatMessage(i18n.deleteMessage, { name: sessionToDelete.name })
            : ''
        }
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setSessionToDelete(null)}
        confirmVariant="destructive"
      />
    </motion.div>
  );
};
