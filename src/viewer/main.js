import { PdfEditor } from './pdf-editor.js';

const editor = new PdfEditor(document.getElementById('app'));

const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get('url');
if (pdfUrl) {
  editor.loadPdfFromUrl(decodeURIComponent(pdfUrl));
}

window.addEventListener('beforeunload', () => editor.destroy());
