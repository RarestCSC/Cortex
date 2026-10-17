/**
 * Hub Component
 *
 * The empty-chat landing screen. Visually it's "Pair with no messages yet" —
 * a Cortex brand + greeting above a centered, narrower ChatInput. Submitting
 * creates a session and navigates to /pair so the rest of the chat lifecycle
 * lives there.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useSearchParams } from 'react-router';
import { AppEvents } from '../constants/events';
import ChatInput from './ChatInput';
import { ChatInputCard } from './ChatInputCard';
import { ChatState } from '../types/chatState';
import 'react-toastify/dist/ReactToastify.css';
import { View, ViewOptions } from '../utils/navigationUtils';
import { useConfig } from './ConfigContext';
import { getEffectiveWorkingDir, getInitialWorkingDir } from '../utils/workingDir';
import { createSession } from '../sessions';
import { UserInput } from '../types/message';
import {
  createNextChatExtensionDraft,
  selectNextChatExtensions,
  type NextChatExtensionDraft,
} from '../utils/nextChatExtensions';
import { formatAcpError } from '../acp/errors';
import { toastError } from '../toasts';
import { acpGetLiveVoiceAvailability } from '../acp/liveVoice';
import type { LiveVoiceAvailabilityResponse_unstable } from '@cortex/acp-client';
import { subscribeToAcpRecovery } from '../acp/acpConnection';
import type { LiveVoiceController } from '../liveVoice/useLiveVoice';
import { acpSetSessionModel } from '../acp/providers';
import { useAcpChatSessionSnapshot } from '../acp/chatSessionStore';
import type Model from './settings/models/modelInterface';
import type { Session } from '../types/session';
import { useModelAndProvider } from './ModelAndProviderContext';
import { WelcomeGreeting } from './WelcomeGreeting';

export default function Hub({
  setView,
  draftRef,
  liveVoice,
}: {
  setView: (view: View, viewOptions?: ViewOptions) => void;
  /** Unsent input of this screen, kept above the route outlet across the unmount. */
  draftRef: RefObject<string>;
  liveVoice: LiveVoiceController;
}) {
  const { extensionsList } = useConfig();
  const { currentModel, currentProvider } = useModelAndProvider();
  const [workingDir, setWorkingDir] = useState(getInitialWorkingDir());
  const workingDirRef = useRef(workingDir);
  const userSelectedWorkingDirRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const preparedSessionRef = useRef<Session | null>(null);
  const creatingSessionRef = useRef<Promise<Session | null> | null>(null);
  const autoPrepareAttemptedRef = useRef(false);
  const [preparedSession, setPreparedSession] = useState<Session | null>(null);
  const preparedSnapshot = useAcpChatSessionSnapshot(preparedSession?.id ?? '');
  const composerSession = preparedSnapshot?.session ?? preparedSession;
  const [liveVoiceAvailability, setLiveVoiceAvailability] =
    useState<LiveVoiceAvailabilityResponse_unstable | null>(null);
  const [nextChatExtensionDraft, setNextChatExtensionDraft] =
    useState<NextChatExtensionDraft | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Re-resolve the working dir on mount: GOOSE_WORKING_DIR is fixed at window
  // creation, so a configured remote directory may have changed since then.
  useEffect(() => {
    let active = true;
    void getEffectiveWorkingDir().then((dir) => {
      if (active && !userSelectedWorkingDirRef.current) {
        workingDirRef.current = dir;
        setWorkingDir(dir);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // The sidebar's "new session in <workspace>" links arrive as a query param.
  // It outranks the window default and is consumed so a later reload of the
  // landing page doesn't silently re-pin the old directory.
  useEffect(() => {
    const requested = searchParams.get('workingDir');
    if (!requested) return;
    userSelectedWorkingDirRef.current = true;
    workingDirRef.current = requested;
    setWorkingDir(requested);
    searchParams.delete('workingDir');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let requestGeneration = 0;
    const requestAvailability = async () => {
      const generation = ++requestGeneration;
      try {
        const availability = await acpGetLiveVoiceAvailability();
        if (generation === requestGeneration) {
          setLiveVoiceAvailability(availability);
        }
      } catch {
        if (generation === requestGeneration) {
          setLiveVoiceAvailability(null);
        }
      }
    };

    void requestAvailability();
    const unsubscribe = subscribeToAcpRecovery((recovering) => {
      if (!recovering) {
        void requestAvailability();
      }
    });

    return () => {
      requestGeneration += 1;
      unsubscribe();
    };
  }, []);

  const draftForMenu = useMemo(
    () => nextChatExtensionDraft ?? createNextChatExtensionDraft(extensionsList),
    [extensionsList, nextChatExtensionDraft]
  );

  // rAF is more reliable than autoFocus across async render boundaries.
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  const handleNextChatExtensionDraftChange = useCallback((draft: NextChatExtensionDraft) => {
    setNextChatExtensionDraft(draft);
  }, []);

  const handleWorkingDirChange = useCallback((dir: string) => {
    userSelectedWorkingDirRef.current = true;
    workingDirRef.current = dir;
    setWorkingDir(dir);
    // The prepared session (created by the automatic probe, or by a previous
    // submit) is bound to the *old* directory. Updating only the label would
    // send the next message into the old cwd, so drop it and let the next
    // submit create a session for the newly selected directory.
    preparedSessionRef.current = null;
    setPreparedSession(null);
  }, []);

  const createHubSession = useCallback((): Promise<Session | null> => {
    if (preparedSessionRef.current) return Promise.resolve(preparedSessionRef.current);
    if (creatingSessionRef.current) return creatingSessionRef.current;
    setIsCreatingSession(true);

    const creation = (async () => {
      try {
        // A draft exists only once the user has opened the picker, so its absence is
        // "not specified" while an empty draft is "start with no extensions".
        const sessionOptions = nextChatExtensionDraft
          ? {
              extensionConfigs: selectNextChatExtensions(extensionsList, nextChatExtensionDraft),
            }
          : { allExtensions: extensionsList };

        // Resolve the effective directory at submit time: the IPC lookup may still
        // be pending when the user submits, and an explicit pick must win.
        const dir = userSelectedWorkingDirRef.current
          ? workingDirRef.current
          : await getEffectiveWorkingDir();
        const session = await createSession(dir, sessionOptions);
        preparedSessionRef.current = session;
        setPreparedSession(session);
        window.dispatchEvent(new CustomEvent(AppEvents.SESSION_CREATED));
        setNextChatExtensionDraft(null);
        return session;
      } catch (error) {
        console.error('Failed to create session:', error);
        toastError({ title: "Couldn't start chat", msg: formatAcpError(error) });
        return null;
      } finally {
        creatingSessionRef.current = null;
        setIsCreatingSession(false);
      }
    })();
    creatingSessionRef.current = creation;
    return creation;
  }, [extensionsList, nextChatExtensionDraft]);

  // A prepared session can outlive a directory change (including one that
  // happens while `createSession` is in flight). Recreate it rather than
  // sending the next message into a cwd the user no longer selected.
  const createHubSessionForCurrentDir = useCallback(async (): Promise<Session | null> => {
    let session = await createHubSession();
    if (!session) return null;
    if (
      userSelectedWorkingDirRef.current &&
      session.working_dir !== workingDirRef.current
    ) {
      preparedSessionRef.current = null;
      setPreparedSession(null);
      session = await createHubSession();
    }
    return session;
  }, [createHubSession]);

  useEffect(() => {
    if (!currentModel || !currentProvider || autoPrepareAttemptedRef.current) return;
    autoPrepareAttemptedRef.current = true;
    void createHubSession();
  }, [currentModel, currentProvider, createHubSession]);

  const prepareSessionModel = async (model: Model, getDraft: () => UserInput) => {
    const session = await createHubSessionForCurrentDir();
    if (!session) throw new Error('Could not create session');
    await acpSetSessionModel(session.id, model.provider, model.name);
    const initialMessage = getDraft();
    window.dispatchEvent(
      new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
        detail: { sessionId: session.id, initialMessage, noAutoSubmit: true },
      })
    );
    draftRef.current = '';
    setView('pair', { disableAnimation: true, resumeSessionId: session.id });
  };

  const handleSubmit = async (input: UserInput) => {
    const { msg: userMessage, images } = input;
    if (!(images.length > 0 || userMessage.trim())) return;

    const draftAtSubmit = draftRef.current;
    const session = await createHubSessionForCurrentDir();
    if (!session) return;

    window.dispatchEvent(new CustomEvent(AppEvents.SESSION_CREATED));
    window.dispatchEvent(
      new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
        detail: { sessionId: session.id, initialMessage: { msg: userMessage, images } },
      })
    );

    // Preserve edits made while the session was being created.
    if (draftRef.current === draftAtSubmit) {
      draftRef.current = '';
    }

    setView('pair', {
      disableAnimation: true,
      resumeSessionId: session.id,
      initialMessage: { msg: userMessage, images },
    });
  };

  const handleStartLiveVoice = async () => {
    if (liveVoice.activeSessionId) {
      setView('pair', { resumeSessionId: liveVoice.activeSessionId });
      return;
    }

    const session = await createHubSessionForCurrentDir();
    if (!session) return;

    window.dispatchEvent(new CustomEvent(AppEvents.SESSION_CREATED));
    window.dispatchEvent(
      new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
        detail: { sessionId: session.id },
      })
    );

    setView('pair', {
      disableAnimation: true,
      resumeSessionId: session.id,
      startLiveVoice: true,
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0 items-center justify-center px-6 relative">
      <div className="w-full max-w-3xl">
        <WelcomeGreeting />

        <ChatInputCard>
          <ChatInput
            sessionId={composerSession?.id ?? null}
            onPrepareSessionModel={prepareSessionModel}
            sessionModel={composerSession?.model_config?.model_name}
            sessionProvider={composerSession?.provider_name}
            sessionLoaded={Boolean(composerSession)}
            draftRef={draftRef}
            handleSubmit={handleSubmit}
            chatState={isCreatingSession ? ChatState.LoadingConversation : ChatState.Idle}
            hasActiveRun={false}
            onStop={() => {}}
            initialValue=""
            totalTokens={0}
            accumulatedInputTokens={0}
            accumulatedOutputTokens={0}
            droppedFiles={[]}
            onFilesProcessed={() => {}}
            messages={[]}
            disableAnimation={false}
            workingDir={workingDir}
            onWorkingDirChange={handleWorkingDirChange}
            inputRef={inputRef}
            nextChatExtensionDraft={draftForMenu}
            onNextChatExtensionDraftChange={handleNextChatExtensionDraftChange}
            liveVoice={{
              availability: isCreatingSession ? null : liveVoiceAvailability,
              phase: 'idle',
              muted: false,
              activeInAnotherSession: liveVoice.activeSessionId !== null,
              start: handleStartLiveVoice,
              stop: liveVoice.stop,
              toggleMute: liveVoice.toggleMute,
            }}
          />
        </ChatInputCard>
      </div>
    </div>
  );
}
