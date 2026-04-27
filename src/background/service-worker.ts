const SETTINGS_MENU_ID = 'rue-settings';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: SETTINGS_MENU_ID,
    title: 'Rich Up Enhanced Settings',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === SETTINGS_MENU_ID) {
    void chrome.action.openPopup();
  }
});
