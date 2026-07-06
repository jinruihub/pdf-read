export function isExtensionContext() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

export async function consumePendingPdf() {
  if (!isExtensionContext()) return null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'consume-pending-pdf' });
    if (!response?.ok) return null;
    return { url: response.url, pdf: response.pdf };
  } catch {
    return null;
  }
}

export async function fetchPdfBytes(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  } catch (directError) {
    if (!isExtensionContext()) throw directError;

    const response = await chrome.runtime.sendMessage({ type: 'fetch-pdf', url });
    if (!response?.ok) {
      throw new Error(response?.error || directError?.message || '无法加载 PDF');
    }
    return response.pdf;
  }
}

export function pdfFileNameFromUrl(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (name && name.toLowerCase().endsWith('.pdf')) return name;
  } catch {
    // ignore
  }
  const fallback = url.split('/').pop()?.split('?')[0]?.split('#')[0];
  return fallback && fallback.toLowerCase().endsWith('.pdf') ? fallback : 'document.pdf';
}

export async function resolveAutoLoadPdf() {
  const queryUrl = new URLSearchParams(window.location.search).get('url');

  if (isExtensionContext()) {
    const pending = await consumePendingPdf();
    if (pending?.pdf) {
      return {
        url: pending.url,
        data: pending.pdf,
        name: pdfFileNameFromUrl(pending.url),
      };
    }
    if (pending?.url) {
      return { url: pending.url, name: pdfFileNameFromUrl(pending.url) };
    }
  }

  if (queryUrl) {
    return { url: queryUrl, name: pdfFileNameFromUrl(queryUrl) };
  }

  return null;
}
