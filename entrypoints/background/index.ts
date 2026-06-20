import {
  handleCapture,
  handleContextMenuCapture,
  MENU_SAVE_WORD,
  MENU_SAVE_QUOTE,
} from './capture-handler';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
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
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SAVE_WORD) {
      void handleContextMenuCapture('word', info, tab);
    } else if (info.menuItemId === MENU_SAVE_QUOTE) {
      void handleContextMenuCapture('quote', info, tab);
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'save-word') void handleCapture('word');
    else if (command === 'save-quote') void handleCapture('quote');
  });
});
