const VIEWER_PATH = 'src/viewer/index.html';

/** @type {Map<number, { url: string, pdf?: ArrayBuffer, ready: Promise<ArrayBuffer|null> }>} */
const pendingByTab = new Map();

function getViewerBaseUrl() {
  return chrome.runtime.getURL(VIEWER_PATH);
}

function buildViewerUrl(pdfUrl) {
  return `${getViewerBaseUrl()}?url=${encodeURIComponent(pdfUrl)}`;
}

function isViewerUrl(url) {
  return typeof url === 'string' && url.startsWith(getViewerBaseUrl());
}

function isPdfUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (isViewerUrl(url)) return false;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('devtools://')) {
    return false;
  }
  if (url.startsWith('blob:') || url.startsWith('data:')) return false;

  try {
    const { pathname, searchParams } = new URL(url);
    if (/\.pdf$/i.test(pathname)) return true;
    if (searchParams.get('format')?.toLowerCase() === 'pdf') return true;
    return /\.pdf(?:[?#]|$)/i.test(url);
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(url);
  }
}

async function prefetchPdf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

function queuePendingPdf(tabId, pdfUrl) {
  const ready = prefetchPdf(pdfUrl)
    .then((pdf) => {
      const entry = pendingByTab.get(tabId);
      if (entry) pendingByTab.set(tabId, { ...entry, pdf });
      return pdf;
    })
    .catch(() => null);

  pendingByTab.set(tabId, { url: pdfUrl, ready });
}

function openViewer(pdfUrl) {
  const viewerUrl = pdfUrl ? buildViewerUrl(pdfUrl) : getViewerBaseUrl();
  return chrome.tabs.create({ url: viewerUrl });
}

function redirectTabToViewer(tabId, pdfUrl) {
  queuePendingPdf(tabId, pdfUrl);
  return chrome.tabs.update(tabId, { url: buildViewerUrl(pdfUrl) });
}

function maybeInterceptPdfNavigation(details) {
  if (details.frameId !== 0) return;
  if (!isPdfUrl(details.url)) return;
  redirectTabToViewer(details.tabId, details.url);
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

chrome.webNavigation.onBeforeNavigate.addListener(maybeInterceptPdfNavigation, {
  url: [{ schemes: ['http', 'https', 'file'] }],
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (isViewerUrl(details.url)) return;
  if (!isPdfUrl(details.url)) return;
  redirectTabToViewer(details.tabId, details.url);
}, {
  url: [{ schemes: ['http', 'https', 'file'] }],
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'consume-pending-pdf') {
    (async () => {
      const tabId = sender.tab?.id;
      const entry = tabId != null ? pendingByTab.get(tabId) : null;
      if (!entry) {
        sendResponse({ ok: false });
        return;
      }

      let pdf = entry.pdf;
      if (!pdf) pdf = await entry.ready;

      pendingByTab.delete(tabId);
      sendResponse({ ok: true, url: entry.url, pdf: pdf ?? undefined });
    })();
    return true;
  }

  if (message?.type === 'fetch-pdf' && message.url) {
    prefetchPdf(message.url)
      .then((pdf) => sendResponse({ ok: true, pdf }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});
