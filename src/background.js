const VIEWER_PATH = 'src/viewer/index.html';

function openViewer(url) {
  const viewerUrl = url
    ? chrome.runtime.getURL(`${VIEWER_PATH}?url=${encodeURIComponent(url)}`)
    : chrome.runtime.getURL(VIEWER_PATH);
  chrome.tabs.create({ url: viewerUrl });
}

chrome.action.onClicked.addListener(() => {
  openViewer();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-pdf-read',
    title: '用 PDF Read 打开',
    contexts: ['link'],
    targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-pdf-read' && info.linkUrl) {
    openViewer(info.linkUrl);
  }
});
