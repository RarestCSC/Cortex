import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  setFeedURL: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler),
  },
  app: {},
  BrowserWindow: {},
  nativeImage: {},
  Tray: {},
  Menu: {},
  Notification: {},
}));
vi.mock('electron-updater', () => ({ autoUpdater: mocks }));
vi.mock('./githubUpdater', () => ({ githubUpdater: mocks }));
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./analytics', () => ({}));
vi.mock('./recentDirs', () => ({ loadRecentDirs: vi.fn() }));

import { registerUpdateIpcHandlers, setupAutoUpdater } from './autoUpdater';

describe('Cortex without a release feed', () => {
  it('blocks automatic and manual update operations before reaching the inherited feed', async () => {
    setupAutoUpdater();
    registerUpdateIpcHandlers();

    await expect(mocks.handlers.get('check-for-updates')!()).resolves.toEqual({
      updateInfo: null,
      error: 'Cortex updates are not configured.',
    });
    for (const name of ['download-update', 'install-update']) {
      await expect(mocks.handlers.get(name)!()).resolves.toEqual({
        success: false,
        error: 'Cortex updates are not configured.',
      });
    }
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.setFeedURL).not.toHaveBeenCalled();
  });
});
