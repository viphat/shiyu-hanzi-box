import {
  handleCapture,
  handleContextMenuCapture,
  MENU_OPEN_DASHBOARD,
  MENU_SAVE_WORD,
  MENU_SAVE_QUOTE,
} from './capture-handler';
import { registerSyncMutationHandler } from './sync-mutation-handler';
import { reconcileOnStartup } from '../../lib/sync/mutations';

export default defineBackground(() => {
  registerSyncMutationHandler();
  void reconcileOnStartup();
  // Context-menu items persist across service-worker restarts, and onInstalled
  // fires again on reload/update. Clear existing items first so re-registration
  // never fails with "Cannot create item with duplicate id".
  async function registerContextMenus() {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_SAVE_WORD,
      title: 'Save as word (拾语汉字box)',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: MENU_SAVE_QUOTE,
      title: 'Save as quote (拾语汉字box)',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: MENU_OPEN_DASHBOARD,
      title: 'Open dashboard (拾语汉字box)',
      contexts: ['action'],
    });
  }

  browser.runtime.onInstalled.addListener(() => registerContextMenus());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SAVE_WORD) {
      void handleContextMenuCapture('word', info, tab);
    } else if (info.menuItemId === MENU_SAVE_QUOTE) {
      void handleContextMenuCapture('quote', info, tab);
    } else if (info.menuItemId === MENU_OPEN_DASHBOARD) {
      void browser.tabs.create({
        url: browser.runtime.getURL('/dashboard.html'),
      });
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'save-word') void handleCapture('word');
    else if (command === 'save-quote') void handleCapture('quote');
  });
});
