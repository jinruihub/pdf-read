import { PdfEditor } from './pdf-editor.js';
import { fetchPdfBytes, resolveAutoLoadPdf } from './extension-bridge.js';

const editor = new PdfEditor(document.getElementById('app'));

async function bootstrap() {
  const target = await resolveAutoLoadPdf();
  if (!target) return;

  if (target.data) {
    await editor.loadPdfFromBytes(target.data, target.name, target.url);
    return;
  }

  await editor.loadPdfFromUrl(target.url);
}

bootstrap();

window.addEventListener('beforeunload', () => editor.destroy());
