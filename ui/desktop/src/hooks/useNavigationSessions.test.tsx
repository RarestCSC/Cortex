import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.hoisted(() => vi.fn());
const routerState = vi.hoisted(() => ({ searchParams: new URLSearchParams() }));
const acpMocks = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  cancelPermission: vi.fn(),
  cancelElicitation: vi.fn(),
  deleteSnapshot: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/pair', search: routerState.searchParams.toString() }),
  useSearchParams: () => [routerState.searchParams, vi.fn()],
}));

vi.mock('../acp/sessions', () => ({
  acpGetSessionListItem: vi.fn(() => new Promise(() => {})),
  acpListRecentSessions: vi.fn().mockResolvedValue([]),
  acpListArchivedSessions: vi.fn().mockResolvedValue([]),
  acpDeleteSession: acpMocks.deleteSession,
}));

vi.mock('../acp/chatSessionStore', () => ({
  acpChatSessionActions: { deleteSnapshot: acpMocks.deleteSnapshot },
}));

vi.mock('../acp/permissionRequests', () => ({
  cancelAcpPermissionRequestsForSession: acpMocks.cancelPermission,
}));

vi.mock('../acp/elicitationRequests', () => ({
  cancelAcpElicitationRequestsForSession: acpMocks.cancelElicitation,
}));

vi.mock('../contexts/ChatContext', () => ({
  useChatContext: () => ({ chat: { sessionId: undefined } }),
}));

import { useNavigationSessions } from './useNavigationSessions';
import { AppEvents } from '../constants/events';

const injectedSessionId = 'session-1&shouldStartAgent=true';

function expectSingleSessionParameter(target: string) {
  const url = new URL(target, 'http://localhost');
  expect(url.searchParams.get('resumeSessionId')).toBe(injectedSessionId);
  expect(url.searchParams.get('shouldStartAgent')).toBeNull();
}

describe('useNavigationSessions', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    routerState.searchParams = new URLSearchParams();
    acpMocks.deleteSession.mockReset().mockResolvedValue(undefined);
    acpMocks.cancelPermission.mockReset();
    acpMocks.cancelElicitation.mockReset();
    acpMocks.deleteSnapshot.mockReset();
  });

  it('keeps a selected session ID in one query parameter', () => {
    const { result } = renderHook(() => useNavigationSessions());

    act(() => result.current.handleSessionClick(injectedSessionId));

    expectSingleSessionParameter(navigateMock.mock.calls[0][0]);
  });

  it('keeps a retained session ID in one query parameter', () => {
    routerState.searchParams = new URLSearchParams({ resumeSessionId: injectedSessionId });
    const { result } = renderHook(() => useNavigationSessions());

    act(() => result.current.handleNavClick('/pair'));

    expectSingleSessionParameter(navigateMock.mock.calls[0][0]);
  });

  it('hard-deletes a session and releases everything held for it', async () => {
    const deleted: string[] = [];
    const trackDeleted = (event: Event) =>
      deleted.push((event as CustomEvent<{ sessionId: string }>).detail.sessionId);
    window.addEventListener(AppEvents.SESSION_DELETED, trackDeleted);

    const { result } = renderHook(() => useNavigationSessions());
    await act(async () => {
      await result.current.handleDeleteSession('session-1');
    });

    expect(acpMocks.deleteSession).toHaveBeenCalledWith('session-1');
    expect(deleted).toEqual(['session-1']);
    expect(acpMocks.cancelPermission).toHaveBeenCalledWith('session-1');
    expect(acpMocks.cancelElicitation).toHaveBeenCalledWith('session-1');
    expect(acpMocks.deleteSnapshot).toHaveBeenCalledWith('session-1');

    window.removeEventListener(AppEvents.SESSION_DELETED, trackDeleted);
  });

  it('leaves the active session when deleting the one being viewed', async () => {
    routerState.searchParams = new URLSearchParams({ resumeSessionId: 'session-1' });
    const { result } = renderHook(() => useNavigationSessions());

    await act(async () => {
      await result.current.handleDeleteSession('session-1');
    });

    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('reports a failed deletion instead of clearing local state silently', async () => {
    acpMocks.deleteSession.mockRejectedValue(new Error('storage locked'));

    const { result } = renderHook(() => useNavigationSessions());
    let caught: unknown;
    await act(async () => {
      caught = await result.current.handleDeleteSession('session-1').catch((error) => error);
    });

    expect((caught as Error).message).toBe('storage locked');
    expect(acpMocks.deleteSnapshot).not.toHaveBeenCalled();
  });
});
