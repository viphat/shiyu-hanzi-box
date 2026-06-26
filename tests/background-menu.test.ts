import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Browser } from 'wxt/browser';
import background from '../entrypoints/background/index';
import {
  MENU_OPEN_DASHBOARD,
  MENU_SAVE_QUOTE,
  MENU_SAVE_WORD,
} from '../entrypoints/background/capture-handler';

type InstalledListener = () => void;
type MenuClickListener = (
  info: Browser.contextMenus.OnClickData,
  tab?: Browser.tabs.Tab,
) => void;

describe('background context menus', () => {
  let installedListener: InstalledListener | undefined;
  let menuClickListener: MenuClickListener | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    fakeBrowser.reset();
    installedListener = undefined;
    menuClickListener = undefined;

    vi.spyOn(fakeBrowser.runtime.onInstalled, 'addListener').mockImplementation((listener) => {
      installedListener = listener as InstalledListener;
    });
    vi.spyOn(fakeBrowser.contextMenus, 'removeAll').mockResolvedValue(undefined);
    vi.spyOn(fakeBrowser.contextMenus, 'create').mockImplementation(() => '' as any);
    vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation((listener) => {
      menuClickListener = listener as MenuClickListener;
    });
    vi.spyOn(fakeBrowser.commands.onCommand, 'addListener').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.runtime, 'getURL').mockImplementation((path) => `chrome-extension://id${path}`);
    vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({ id: 9 } as Browser.tabs.Tab);
  });

  it('clears existing menus before registering, so reload never duplicates ids', async () => {
    background.main?.();
    expect(installedListener).toBeDefined();

    await installedListener?.();
    // Re-firing onInstalled (reload/update) must not throw a duplicate-id error.
    await installedListener?.();

    expect(fakeBrowser.contextMenus.removeAll).toHaveBeenCalledTimes(2);
    // removeAll runs before create on each registration.
    const removeOrder = (fakeBrowser.contextMenus.removeAll as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    const createOrder = (fakeBrowser.contextMenus.create as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    expect(removeOrder).toBeLessThan(createOrder);
  });

  it('registers selection capture menus and action dashboard menu', async () => {
    background.main?.();
    expect(installedListener).toBeDefined();

    await installedListener?.();

    expect(fakeBrowser.contextMenus.create).toHaveBeenCalledWith({
      id: MENU_SAVE_WORD,
      title: 'Save as word (拾语汉字box)',
      contexts: ['selection'],
    });
    expect(fakeBrowser.contextMenus.create).toHaveBeenCalledWith({
      id: MENU_SAVE_QUOTE,
      title: 'Save as quote (拾语汉字box)',
      contexts: ['selection'],
    });
    expect(fakeBrowser.contextMenus.create).toHaveBeenCalledWith({
      id: MENU_OPEN_DASHBOARD,
      title: 'Open dashboard (拾语汉字box)',
      contexts: ['action'],
    });
  });

  it('opens dashboard.html from the action context menu', () => {
    background.main?.();
    expect(menuClickListener).toBeDefined();

    menuClickListener?.({ menuItemId: MENU_OPEN_DASHBOARD } as Browser.contextMenus.OnClickData);

    expect(fakeBrowser.runtime.getURL).toHaveBeenCalledWith('/dashboard.html');
    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://id/dashboard.html',
    });
  });
});
