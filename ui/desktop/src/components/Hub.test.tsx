/**
 * @vitest-environment jsdom
 */
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import Hub from './Hub';
import { IntlTestWrapper } from '../i18n/test-utils';
import { createSession } from '../sessions';
import { UserInput } from '../types/message';
import { acpGetLiveVoiceAvailability } from '../acp/liveVoice';
import { subscribeToAcpRecovery } from '../acp/acpConnection';
import type { LiveVoiceController } from '../liveVoice/useLiveVoice';
import { acpSetSessionModel } from '../acp/providers';
import type Model from './settings/models/modelInterface';

type ChatInputCapture = {
  sessionId?: string | null;
  onPrepareSessionModel?: (model: Model, getDraft: () => UserInput) => Promise<void>;
  draftRef?: { current: string };
  handleSubmit: (input: UserInput) => void;
  liveVoice?: {
    availability: { status: string; message: string } | null;
    start: () => Promise<void>;
  };
  onNextChatExtensionDraftChange?: (draft: { selectedNames: Set<string> }) => void;
  onWorkingDirChange?: (dir: string) => void;
};

let mockCurrentModel: string | null = null;
let mockCurrentProvider: string | null = null;
vi.mock('./ModelAndProviderContext', () => ({
  useModelAndProvider: () => ({
    currentModel: mockCurrentModel,
    currentProvider: mockCurrentProvider,
  }),
}));

type Session = Awaited<ReturnType<typeof createSession>>;

const liveVoice: LiveVoiceController = {
  activeSessionId: null,
  liveVoiceSessionId: null,
  phase: 'idle',
  muted: false,
  start: vi.fn(),
  stop: vi.fn(),
  toggleMute: vi.fn(),
};

const captured = vi.hoisted(() => ({ chatInput: null as ChatInputCapture | null }));

vi.mock('./ChatInput', () => ({
  default: (props: ChatInputCapture) => {
    captured.chatInput = props;
    return <div data-testid="chat-input" />;
  },
}));

vi.mock('./LoadingIndicator', () => ({ default: () => <div /> }));

vi.mock('./ConfigContext', () => ({
  useConfig: () => ({ extensionsList: [] }),
}));

vi.mock('../sessions', () => ({ createSession: vi.fn() }));

vi.mock('../utils/workingDir', () => ({
  getInitialWorkingDir: () => '/tmp/goose',
  getEffectiveWorkingDir: () => Promise.resolve('/tmp/goose'),
}));

vi.mock('../utils/nextChatExtensions', () => ({
  createNextChatExtensionDraft: () => ({}),
  selectNextChatExtensions: () => [],
}));

vi.mock('../acp/errors', () => ({ formatAcpError: (error: unknown) => String(error) }));

vi.mock('../toasts', () => ({ toastError: vi.fn() }));

vi.mock('../acp/liveVoice', () => ({ acpGetLiveVoiceAvailability: vi.fn() }));

vi.mock('../acp/acpConnection', () => ({ subscribeToAcpRecovery: vi.fn() }));
vi.mock('../acp/providers', () => ({ acpSetSessionModel: vi.fn() }));
vi.mock('../acp/chatSessionStore', () => ({ useAcpChatSessionSnapshot: () => undefined }));

const DRAFT = 'a half-written thought';
const TYPED_WHILE_STARTING = 'and one more thought';

/** Holds session creation open, so the test can edit the draft while it is pending. */
function pendingSession() {
  const settle: { started?: () => void; failed?: () => void } = {};
  vi.mocked(createSession).mockImplementation(
    () =>
      new Promise<Session>((resolve, reject) => {
        settle.started = () => resolve({ id: 'session-1' } as Session);
        settle.failed = () => reject(new Error('no agent'));
      })
  );
  return settle;
}

function renderHub(draftRef: { current: string }, setView = vi.fn()) {
  return render(
    <IntlTestWrapper>
      <MemoryRouter>
        <Hub setView={setView} draftRef={draftRef} liveVoice={liveVoice} />
      </MemoryRouter>
    </IntlTestWrapper>
  );
}

async function submit() {
  await act(async () => {
    captured.chatInput?.handleSubmit({ msg: DRAFT, images: [] });
  });
}

describe('Hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveVoice.activeSessionId = null;
    liveVoice.liveVoiceSessionId = null;
    liveVoice.phase = 'idle';
    captured.chatInput = null;
    mockCurrentModel = null;
    mockCurrentProvider = null;
    vi.mocked(acpGetLiveVoiceAvailability).mockRejectedValue(new Error('ACP unavailable'));
    vi.mocked(subscribeToAcpRecovery).mockReturnValue(() => undefined);
    vi.mocked(acpSetSessionModel).mockResolvedValue({
      providerId: 'alpha',
      modelId: 'alpha-model',
    });
  });

  it('requests Live voice availability again after ACP recovers', async () => {
    let recoveryChanged: ((recovering: boolean) => void) | undefined;
    const available = { status: 'ready' as const, message: 'Start Live voice' };
    vi.mocked(acpGetLiveVoiceAvailability)
      .mockRejectedValueOnce(new Error('ACP disconnected'))
      .mockResolvedValueOnce(available);
    vi.mocked(subscribeToAcpRecovery).mockImplementation((listener) => {
      recoveryChanged = listener;
      return () => undefined;
    });

    renderHub({ current: '' });
    await waitFor(() => expect(acpGetLiveVoiceAvailability).toHaveBeenCalledTimes(1));

    act(() => recoveryChanged?.(true));
    act(() => recoveryChanged?.(false));

    await waitFor(() => {
      expect(acpGetLiveVoiceAvailability).toHaveBeenCalledTimes(2);
      expect(captured.chatInput?.liveVoice?.availability).toEqual(available);
    });
  });

  it('returns to the session with the active Live voice interaction', async () => {
    const setView = vi.fn();
    liveVoice.activeSessionId = 'session-with-live-voice';
    renderHub({ current: '' }, setView);

    await act(async () => captured.chatInput?.liveVoice?.start?.());

    expect(setView).toHaveBeenCalledWith('pair', {
      resumeSessionId: 'session-with-live-voice',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('starts a chat with no extensions when the user cleared the picker', async () => {
    vi.mocked(createSession).mockResolvedValue({ id: 'session-1' } as Session);
    renderHub({ current: '' });

    // Touching the picker is what turns "not specified" into a real choice, and
    // clearing it is the case the composer already promises in a toast.
    await act(async () => {
      captured.chatInput?.onNextChatExtensionDraftChange?.({ selectedNames: new Set() });
    });
    await submit();

    expect(createSession).toHaveBeenCalledWith('/tmp/goose', { extensionConfigs: [] });
  });

  it('leaves the set unspecified when the picker was never touched', async () => {
    vi.mocked(createSession).mockResolvedValue({ id: 'session-1' } as Session);
    renderHub({ current: '' });

    await submit();

    expect(createSession).toHaveBeenCalledWith('/tmp/goose', { allExtensions: [] });
  });

  it('creates the session in the newly selected working directory', async () => {
    mockCurrentModel = 'alpha-model';
    mockCurrentProvider = 'alpha';
    vi.mocked(createSession).mockImplementation(
      async (dir) => ({ id: `session-${dir}`, working_dir: dir }) as Session
    );
    renderHub({ current: DRAFT });
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      captured.chatInput?.onWorkingDirChange?.('/home/rarestcsc/project');
    });
    await submit();

    await waitFor(() =>
      expect(createSession).toHaveBeenLastCalledWith(
        '/home/rarestcsc/project',
        expect.anything()
      )
    );
  });

  it('hands the draft to the input', () => {
    const draftRef = { current: DRAFT };
    renderHub(draftRef);

    expect(captured.chatInput?.draftRef).toBe(draftRef);
  });

  it('drops the draft once the chat starts', async () => {
    const session = pendingSession();
    const draftRef = { current: DRAFT };
    renderHub(draftRef);

    await submit();
    await act(async () => session.started?.());

    expect(draftRef.current).toBe('');
  });

  it('keeps the draft when the chat fails to start', async () => {
    const session = pendingSession();
    const draftRef = { current: DRAFT };
    renderHub(draftRef);

    await submit();
    await act(async () => session.failed?.());

    expect(draftRef.current).toBe(DRAFT);
  });

  // The input stays editable while the session is being created, so what is in the
  // draft when creation ends is not necessarily what was submitted.
  it('keeps text typed while the chat was starting', async () => {
    const session = pendingSession();
    const draftRef = { current: DRAFT };
    renderHub(draftRef);

    await submit();
    draftRef.current = TYPED_WHILE_STARTING;
    await act(async () => session.started?.());

    expect(draftRef.current).toBe(TYPED_WHILE_STARTING);
  });

  it('keeps text typed while a failing chat was starting', async () => {
    const session = pendingSession();
    const draftRef = { current: DRAFT };
    renderHub(draftRef);

    await submit();
    draftRef.current = TYPED_WHILE_STARTING;
    await act(async () => session.failed?.());

    expect(draftRef.current).toBe(TYPED_WHILE_STARTING);
  });

  it('leaves the draft empty when the input was cleared while the chat was starting', async () => {
    const session = pendingSession();
    const draftRef = { current: DRAFT };
    renderHub(draftRef);

    await submit();
    draftRef.current = '';
    await act(async () => session.failed?.());

    expect(draftRef.current).toBe('');
  });

  it('creates a session on model selection and transfers the draft without sending the first task', async () => {
    vi.mocked(createSession).mockResolvedValue({ id: 'session-1' } as Session);
    const draftRef = { current: DRAFT };
    const setView = vi.fn();
    const images = [{ data: 'aW1hZ2U=', mimeType: 'image/png' }];
    renderHub(draftRef, setView);
    const events: CustomEvent[] = [];
    const capture = (event: Event) => events.push(event as CustomEvent);
    const { AppEvents } = await import('../constants/events');
    window.addEventListener(AppEvents.ADD_ACTIVE_SESSION, capture);
    await act(async () =>
      captured.chatInput?.onPrepareSessionModel?.(
        { name: 'alpha-model', provider: 'alpha' },
        () => ({ msg: DRAFT, images })
      )
    );
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(acpSetSessionModel).toHaveBeenCalledExactlyOnceWith('session-1', 'alpha', 'alpha-model');
    expect(captured.chatInput?.sessionId).toBe('session-1');
    expect(draftRef.current).toBe('');
    expect(events[0].detail).toEqual({
      sessionId: 'session-1',
      initialMessage: { msg: DRAFT, images },
      noAutoSubmit: true,
    });
    expect(setView).toHaveBeenCalledWith('pair', {
      disableAnimation: true,
      resumeSessionId: 'session-1',
    });
    window.removeEventListener(AppEvents.ADD_ACTIVE_SESSION, capture);
  });

  it('keeps the created session and draft when applying the selected model fails', async () => {
    vi.mocked(createSession).mockResolvedValue({ id: 'session-1' } as Session);
    vi.mocked(acpSetSessionModel).mockRejectedValueOnce(new Error('model rejected'));
    const draftRef = { current: DRAFT };
    const setView = vi.fn();
    renderHub(draftRef, setView);
    await act(async () => {
      await expect(
        captured.chatInput?.onPrepareSessionModel?.(
          { name: 'bad-model', provider: 'alpha' },
          () => ({ msg: DRAFT, images: [] })
        )
      ).rejects.toThrow('model rejected');
    });
    expect(captured.chatInput?.sessionId).toBe('session-1');
    expect(draftRef.current).toBe(DRAFT);
    expect(setView).not.toHaveBeenCalled();
    await act(async () =>
      captured.chatInput?.onPrepareSessionModel?.(
        { name: 'alpha-model', provider: 'alpha' },
        () => ({ msg: DRAFT, images: [] })
      )
    );
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('initializes the default-model session on entry without selecting a model or sending a task', async () => {
    mockCurrentModel = 'alpha-model';
    mockCurrentProvider = 'alpha';
    vi.mocked(createSession).mockResolvedValue({ id: 'session-1' } as Session);
    const draftRef = { current: DRAFT };
    const setView = vi.fn();
    const { rerender } = renderHub(draftRef, setView);
    await waitFor(() => expect(captured.chatInput?.sessionId).toBe('session-1'));
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(acpSetSessionModel).not.toHaveBeenCalled();
    expect(setView).not.toHaveBeenCalled();
    expect(draftRef.current).toBe(DRAFT);
    rerender(
      <IntlTestWrapper>
        <MemoryRouter>
          <Hub setView={setView} draftRef={draftRef} liveVoice={liveVoice} />
        </MemoryRouter>
      </IntlTestWrapper>
    );
    await submit();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setView).toHaveBeenCalledWith(
      'pair',
      expect.objectContaining({ resumeSessionId: 'session-1' })
    );
  });

  it('shares pending automatic creation with a first task instead of creating two sessions', async () => {
    mockCurrentModel = 'alpha-model';
    mockCurrentProvider = 'alpha';
    const session = pendingSession();
    const setView = vi.fn();
    renderHub({ current: DRAFT }, setView);
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    await submit();
    await act(async () => session.started?.());
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setView).toHaveBeenCalledWith(
      'pair',
      expect.objectContaining({ resumeSessionId: 'session-1' })
    );
  });
});
