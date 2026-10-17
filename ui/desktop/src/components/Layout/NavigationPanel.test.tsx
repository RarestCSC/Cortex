import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntlTestWrapper } from '../../i18n/test-utils';
import { Navigation } from './NavigationPanel';
import type { SessionListItem } from '../../acp/sessions';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetch: vi.fn(),
  deleteSession: vi.fn(),
}));
let appsEnabled = true;
let recentSessions: SessionListItem[] = [];
let archivedSessions: SessionListItem[] = [];

const asProjectGroups = (sessions: SessionListItem[]) =>
  sessions.map((session) => ({
    path: session.workingDir ?? '',
    label: session.workingDir ?? '',
    sessions: [session],
    lastActivityAt: session.updatedAt ?? '',
  }));

vi.mock('./NavigationContext', () => ({
  useNavigationContext: () => ({ isNavExpanded: true }),
}));
vi.mock('../ConfigContext', () => ({
  useConfig: () => ({ extensionsList: [{ name: 'apps', enabled: appsEnabled }] }),
}));
vi.mock('../../hooks/useNavigationSessions', () => ({
  useNavigationSessions: () => ({
    recentSessions,
    recentSessionsByProject: asProjectGroups(recentSessions),
    archivedSessions,
    isLoadingSessions: false,
    activeSessionId: null,
    fetchSessions: mocks.fetch,
    handleNavClick: mocks.navigate,
    handleSessionClick: vi.fn(),
    handleArchiveSession: vi.fn(),
    handleUnarchiveSession: vi.fn(),
    handleDeleteSession: mocks.deleteSession,
    handleAddWorkspace: vi.fn(),
    startSessionInWorkspace: vi.fn(),
  }),
}));
vi.mock('../../acp/sessions', () => ({ acpRenameSession: vi.fn() }));

function renderNavigation() {
  return render(
    <IntlTestWrapper>
      <MemoryRouter>
        <Navigation activeLiveVoiceSessionId={null} />
      </MemoryRouter>
    </IntlTestWrapper>
  );
}

describe('NavigationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appsEnabled = true;
    recentSessions = [];
    archivedSessions = [];
  });

  it('hides recipes and scheduler while keeping the other navigation entries working', () => {
    renderNavigation();
    expect(screen.queryByRole('button', { name: 'Recipes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scheduler' })).not.toBeInTheDocument();
    for (const [name, path] of [
      ['New Chat', '/'],
      ['Skills', '/skills'],
      ['Apps', '/apps'],
      ['Extensions', '/extensions'],
      ['Session History', '/sessions'],
      ['Settings', '/settings'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(mocks.navigate).toHaveBeenLastCalledWith(path);
    }
  });

  it('still hides Apps when its extension is disabled', () => {
    appsEnabled = false;
    renderNavigation();
    expect(screen.queryByRole('button', { name: 'Apps' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extensions' })).toBeInTheDocument();
  });

  it('offers archive and delete side by side on a recent session', () => {
    recentSessions = [
      {
        id: 'session-1',
        name: 'Design review',
        updatedAt: '2026-10-16T10:00:00Z',
        messageCount: 4,
      } as SessionListItem,
    ];
    renderNavigation();
    expect(screen.getByRole('button', { name: 'Archive session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete session' })).toBeInTheDocument();
  });

  it('deletes a recent session only after the confirmation is accepted', async () => {
    recentSessions = [
      {
        id: 'session-1',
        name: 'Design review',
        updatedAt: '2026-10-16T10:00:00Z',
        messageCount: 4,
      } as SessionListItem,
    ];
    renderNavigation();

    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    expect(await screen.findByText('Delete Session')).toBeInTheDocument();
    expect(mocks.deleteSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    await waitFor(() =>
      expect(screen.queryByText('Delete Session')).not.toBeInTheDocument()
    );
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it('hard-deletes an archived session through the same confirmation', async () => {
    archivedSessions = [
      {
        id: 'session-archived',
        name: 'Old thread',
        updatedAt: '2026-10-15T10:00:00Z',
        archivedAt: '2026-10-15T11:00:00Z',
        messageCount: 9,
      } as SessionListItem,
    ];
    renderNavigation();

    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore session' }));
    expect(mocks.deleteSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));

    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('session-archived'));
  });
});
