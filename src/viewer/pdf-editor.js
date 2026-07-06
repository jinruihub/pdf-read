import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Canvas,
  Line,
  Path,
  PencilBrush,
  StaticCanvas,
  Textbox,
} from 'fabric';
import { PDFDocument } from 'pdf-lib';
import { fetchPdfBytes, pdfFileNameFromUrl } from './extension-bridge.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/** @typedef {'hand'|'text'|'draw-free'|'draw-line'|'draw-wave'|'draw-double-line'} ToolMode */
/** @typedef {'page'|'scroll'} ViewMode */
/** @typedef {'light'|'dark'} PreviewTheme */

export class PdfEditor {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.bodyEl = root.querySelector('#body');
    this.emptyEl = root.querySelector('#empty');
    this.loadingEl = root.querySelector('#loading');
    this.pageViewEl = root.querySelector('#page-view');
    this.scrollViewEl = root.querySelector('#scroll-view');
    this.pageInputEl = root.querySelector('#page-input');
    this.totalPagesEl = root.querySelector('#total-pages');
    this.zoomResetBtn = root.querySelector('#btn-zoom-reset');
    this.toastEl = root.querySelector('#toast');
    this.fileInputEl = root.querySelector('#file-input');
    this.strokeColorEl = root.querySelector('#stroke-color');
    this.brushWidthEl = root.querySelector('#brush-width');
    this.brushWidthLabel = root.querySelector('#brush-width-label');
    this.strokeColorDotEl = root.querySelector('#stroke-color-dot');
    this.themeIconEl = root.querySelector('#theme-icon');

    /** @type {pdfjsLib.PDFDocumentProxy|null} */
    this.pdfDoc = null;
    /** @type {File|null} */
    this.pdfFile = null;
    this.pdfLoaded = false;
    this.loading = false;
    this.viewSwitching = false;
    this.saving = false;
    this.exporting = false;
    this.isPanning = false;
    this.currentPage = 1;
    this.totalPages = 0;
    this.fitScale = 1;
    this.userZoom = 1;
    /** @type {ViewMode} */
    this.viewMode = 'scroll';
    /** @type {ToolMode} */
    this.activeTool = 'hand';
    this.strokeColor = '#e74c3c';
    this.brushWidth = 3;
    /** @type {PreviewTheme} */
    this.previewTheme = 'light';
    this.canvasKey = 0;

    /** @type {Canvas|null} */
    this.pageFabricCanvas = null;
    /** @type {Map<number, Canvas>} */
    this.scrollFabricMap = new Map();
    /** @type {Map<number, HTMLElement>} */
    this.pageBlockRefs = new Map();
    /** @type {Map<number, HTMLCanvasElement>} */
    this.scrollPdfCanvasRefs = new Map();
    /** @type {Map<number, HTMLCanvasElement>} */
    this.scrollFabricCanvasRefs = new Map();
    /** @type {Map<number, HTMLDivElement>} */
    this.scrollTextLayerRefs = new Map();
    /** @type {Record<number, {width:number;height:number}>} */
    this.pageSizes = {};
    /** @type {Set<number>} */
    this.renderedScrollPageSet = new Set();
    /** @type {Set<number>} */
    this.renderingScrollPages = new Set();
    /** @type {Record<number, object>} */
    this.pageAnnotations = {};
    /** @type {Record<number, object[]>} */
    this.pageUndoStacks = {};

    this.isRestoringHistory = false;
    /** @type {IntersectionObserver|null} */
    this.pageObserver = null;
    this.isProgrammaticScroll = false;
    this.skipPageInputBlur = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.zoomDebounceTimer = null;
    this.panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
    this.pinchStart = { distance: 0, zoom: 1 };
    /** @type {WeakMap<Canvas, {x:number;y:number}|null>} */
    this.lineDrawState = new WeakMap();

    this._bindUi();
    this._setupViewportGestures();
    this._setupKeyboardShortcuts();
    this._syncStrokeColorDot();
    this.applyDocThemeStyles();
    this._updateToolbarState();
  }

  get pageScale() {
    return this.fitScale * this.userZoom;
  }

  get zoomPercent() {
    return Math.round(this.userZoom * 100);
  }

  get pageThemeClass() {
    return this.previewTheme === 'dark' ? 'is-dark-doc' : 'is-light-doc';
  }

  get isTextLayerActive() {
    return this.activeTool === 'hand';
  }

  get isFabricActive() {
    return this.activeTool !== 'hand';
  }

  get isDrawTool() {
    return (
      this.activeTool === 'draw-free'
      || this.activeTool === 'draw-line'
      || this.activeTool === 'draw-wave'
      || this.activeTool === 'draw-double-line'
    );
  }

  _bindUi() {
    this.fileInputEl.addEventListener('change', (e) => {
      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (file) this.loadPdf(file);
      /** @type {HTMLInputElement} */ (e.target).value = '';
    });

    this.root.querySelector('#empty-open-btn')?.addEventListener('click', () => this._openFilePicker());

    this.bodyEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.bodyEl.classList.add('is-dragover');
    });
    this.bodyEl.addEventListener('dragleave', () => {
      this.bodyEl.classList.remove('is-dragover');
    });
    this.bodyEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this.bodyEl.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file?.type === 'application/pdf' || file?.name.endsWith('.pdf')) {
        this.loadPdf(file);
      }
    });

    this.root.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = /** @type {ToolMode} */ (btn.getAttribute('data-tool'));
        if (tool === this.activeTool) {
          this.setTool('hand');
          return;
        }
        this.setTool(tool);
      });
    });

    this.root.querySelectorAll('[data-pen]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pen = /** @type {ToolMode} */ (btn.getAttribute('data-pen'));
        if (pen === this.activeTool) {
          this.setTool('hand');
        } else {
          this.setTool(pen);
        }
        this._closeDropdowns();
      });
    });

    this.root.querySelectorAll('.tb-dropdown > .tb-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.tb-dropdown');
        const wasOpen = dropdown?.classList.contains('is-open');
        this._closeDropdowns();
        if (!wasOpen) {
          dropdown?.classList.add('is-open');
          this._positionDropdown(dropdown);
        }
      });
    });

    this.root.querySelectorAll('.tb-dropdown').forEach((dropdown) => {
      dropdown.addEventListener('click', (e) => e.stopPropagation());
    });

    document.addEventListener('click', () => this._closeDropdowns());

    this.root.querySelector('#btn-undo')?.addEventListener('click', () => this.undoLastAction());
    this.root.querySelector('#btn-zoom-in')?.addEventListener('click', () => this.zoomIn());
    this.root.querySelector('#btn-zoom-out')?.addEventListener('click', () => this.zoomOut());
    this.root.querySelector('#btn-zoom-reset')?.addEventListener('click', () => this.resetZoom());
    this.root.querySelector('#btn-fit-width')?.addEventListener('click', () => this.fitToWidth());
    this.root.querySelector('#btn-save')?.addEventListener('click', () => this.saveChanges());
    this.root.querySelector('#btn-export')?.addEventListener('click', () => this.exportPdf());
    this.root.querySelector('#btn-delete')?.addEventListener('click', () => this.deleteSelected());
    this.root.querySelector('#btn-toggle-theme')?.addEventListener('click', () => this.togglePreviewTheme());

    this.pageInputEl.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') this.onPageInputConfirm();
    });
    this.pageInputEl.addEventListener('blur', () => this.onPageInputBlur());

    this.root.querySelector('#btn-page-prev')?.addEventListener('click', () => {
      this.goToPage(this.currentPage - 1);
    });
    this.root.querySelector('#btn-page-next')?.addEventListener('click', () => {
      this.goToPage(this.currentPage + 1);
    });

    this.strokeColorEl.addEventListener('input', () => {
      this.strokeColor = this.strokeColorEl.value;
      this._syncStrokeColorDot();
      this.applyToolToAllFabrics();
      this._applyStrokeColorToActiveText();
    });

    this.brushWidthEl.addEventListener('input', () => {
      this.brushWidth = Number(this.brushWidthEl.value);
      this.brushWidthLabel.textContent = String(this.brushWidth);
      this.applyToolToAllFabrics();
    });

    this.root.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = /** @type {ViewMode} */ (btn.getAttribute('data-view'));
        if (mode === this.viewMode) return;
        this.root.querySelectorAll('[data-view]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.viewMode = mode;
        this.onViewModeChange();
      });
    });
  }

  _openFilePicker() {
    this.fileInputEl.click();
  }

  _syncStrokeColorDot() {
    if (this.strokeColorDotEl) {
      this.strokeColorDotEl.style.background = this.strokeColor;
    }
  }

  _positionDropdown(dropdown) {
    const menu = dropdown?.querySelector('.tb-dropdown-menu');
    const trigger = dropdown?.querySelector(':scope > .tb-btn');
    if (!menu || !trigger) return;

    menu.style.visibility = 'hidden';
    menu.style.display = 'block';

    const rect = trigger.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 6;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const menuRect = menu.getBoundingClientRect();
    if (left + menuRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuRect.width - 8);
    }
    if (left < 8) left = 8;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - 6);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = '';
  }

  _resetDropdownMenus() {
    this.root.querySelectorAll('.tb-dropdown-menu').forEach((menu) => {
      menu.style.left = '';
      menu.style.top = '';
      menu.style.visibility = '';
      menu.style.display = '';
    });
  }

  _closeDropdowns() {
    this.root.querySelectorAll('.tb-dropdown.is-open').forEach((el) => el.classList.remove('is-open'));
    this._resetDropdownMenus();
  }

  _updateToolbarState() {
    const disabled = !this.pdfLoaded;
    const toolbar = this.root.querySelector('.pdf-editor__toolbar');
    toolbar?.classList.toggle('is-readonly', disabled);

    this.root.querySelectorAll('.tb-btn:not(label), .tb-page input').forEach((el) => {
      if (el.closest('.tb-no-readonly')) return;
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
        el.disabled = disabled;
      }
    });

    this.root.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tool') === this.activeTool);
    });

    const penTools = ['draw-free', 'draw-line', 'draw-wave', 'draw-double-line'];
    const penBtn = this.root.querySelector('#pen-dropdown > .tb-btn');
    penBtn?.classList.toggle('is-active', penTools.includes(this.activeTool));

    this.zoomResetBtn.textContent = this.pdfLoaded ? `${this.zoomPercent}%` : '100%';
    this.totalPagesEl.textContent = this.pdfLoaded ? String(this.totalPages) : '—';
    this.pageInputEl.value = this.pdfLoaded ? String(this.currentPage) : '—';
    this.pageInputEl.disabled = disabled;

    const showPageNav = this.pdfLoaded && this.viewMode === 'page';
    const prevBtn = this.root.querySelector('#btn-page-prev');
    const nextBtn = this.root.querySelector('#btn-page-next');
    prevBtn?.toggleAttribute('hidden', !showPageNav);
    nextBtn?.toggleAttribute('hidden', !showPageNav);
    if (prevBtn instanceof HTMLButtonElement) {
      prevBtn.disabled = disabled || this.currentPage <= 1;
    }
    if (nextBtn instanceof HTMLButtonElement) {
      nextBtn.disabled = disabled || this.currentPage >= this.totalPages;
    }

    this._updateThemeButton();
    this.bodyEl.classList.toggle('is-hand', this.activeTool === 'hand' && this.pdfLoaded);
  }

  _updateThemeButton() {
    const btn = this.root.querySelector('#btn-toggle-theme');
    const use = this.themeIconEl?.querySelector('use');
    if (!btn || !use) return;

    const isDark = this.previewTheme === 'dark';
    use.setAttribute('href', isDark ? '#icon-sun' : '#icon-moon');
    btn.title = isDark ? '切换浅色文档' : '切换深色文档';
    btn.classList.toggle('is-moon', !isDark);
    btn.classList.toggle('is-sun', isDark);
    btn.classList.remove('is-active');
  }

  _setLoading(on) {
    this.loading = on;
    this.loadingEl.hidden = !on;
    if (on) this.emptyEl.hidden = true;
  }

  _showView() {
    this.emptyEl.hidden = this.pdfLoaded;
    this.pageViewEl.hidden = !this.pdfLoaded || this.viewMode !== 'page';
    this.scrollViewEl.hidden = !this.pdfLoaded || this.viewMode !== 'scroll';
  }

  toast(msg, type = 'info') {
    this.toastEl.textContent = msg;
    this.toastEl.className = 'toast';
    if (type === 'error') this.toastEl.classList.add('is-error');
    if (type === 'success') this.toastEl.classList.add('is-success');
    this.toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.hidden = true;
    }, 2500);
  }

  getTextLayerEl(pageNum) {
    if (this.viewMode === 'page') {
      return this.pageViewEl.querySelector('.pdf-editor__text-layer');
    }
    return this.scrollTextLayerRefs.get(pageNum);
  }

  applyDocThemeStyles() {
    this.root.classList.toggle('theme-dark', this.previewTheme === 'dark');
    const themeClass = this.pageThemeClass;
    this.root.querySelectorAll('.pdf-editor__page-inner, .pdf-editor__page-placeholder').forEach((el) => {
      el.classList.remove('is-light-doc', 'is-dark-doc');
      el.classList.add(themeClass);
    });
    this._updateThemeButton();
  }

  async togglePreviewTheme() {
    this.previewTheme = this.previewTheme === 'light' ? 'dark' : 'light';
    this.strokeColor = this.previewTheme === 'dark' ? '#ffffff' : '#e74c3c';
    if (this.strokeColorEl) this.strokeColorEl.value = this.strokeColor;
    this._syncStrokeColorDot();
    this.applyDocThemeStyles();
    await this.rerenderPdfLayers();
    this.applyToolToAllFabrics();
    this._updateToolbarState();
  }

  getPageStyle(pageNum) {
    const size = this.pageSizes[pageNum];
    if (!size) return {};
    return { width: `${size.width}px`, height: `${size.height}px` };
  }

  saveAllAnnotations() {
    if (this.pageFabricCanvas) {
      this.pageAnnotations[this.currentPage] = this.pageFabricCanvas.toJSON();
    }
    this.scrollFabricMap.forEach((fc, pageNum) => {
      this.pageAnnotations[pageNum] = fc.toJSON();
    });
  }

  disposeFabricCanvas(fc) {
    if (fc) fc.dispose();
  }

  disposePageFabric() {
    this.disposeFabricCanvas(this.pageFabricCanvas);
    this.pageFabricCanvas = null;
  }

  disposeScrollFabrics() {
    this.scrollFabricMap.forEach((fc) => fc.dispose());
    this.scrollFabricMap.clear();
    this.renderedScrollPageSet.clear();
    this.renderingScrollPages.clear();
  }

  disposeAllFabrics() {
    this.disposePageFabric();
    this.disposeScrollFabrics();
  }

  resetCanvasState() {
    this.disposeAllFabrics();
    this.teardownPageObserver();
    this.pageBlockRefs.clear();
    this.scrollPdfCanvasRefs.clear();
    this.scrollFabricCanvasRefs.clear();
    this.scrollTextLayerRefs.clear();
    this.pageSizes = {};
    this.canvasKey += 1;
    this.pageViewEl.innerHTML = '';
    this.scrollViewEl.innerHTML = '';
  }

  getActiveFabricCanvas() {
    if (this.viewMode === 'page') return this.pageFabricCanvas;
    return this.scrollFabricMap.get(this.currentPage) ?? null;
  }

  async ensureActiveFabric() {
    if (this.viewMode === 'scroll') {
      await this.cachePageDimension(this.currentPage);
      if (!this.renderedScrollPageSet.has(this.currentPage)) {
        await this.renderScrollPage(this.currentPage);
      }
    }
    return this.getActiveFabricCanvas();
  }

  isLineDrawTool(tool) {
    return tool === 'draw-line' || tool === 'draw-wave' || tool === 'draw-double-line';
  }

  getBrushCursor() {
    const color = this.previewTheme === 'dark' ? '#e5eaf3' : '#444444';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="${color}" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/><path fill="${color}" d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 22, crosshair`;
  }

  getStrokeWidth() {
    return this.brushWidth;
  }

  getAnnotationColor() {
    return this.strokeColor;
  }

  createStraightLine(x1, y1, x2, y2) {
    return new Line([x1, y1, x2, y2], {
      stroke: this.getAnnotationColor(),
      strokeWidth: this.getStrokeWidth(),
      selectable: true,
    });
  }

  createWaveLine(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return null;

    const amplitude = Math.min(Math.max(this.getStrokeWidth() * 1.5, 4), length / 5);
    const periods = Math.max(2, Math.round(length / 36));
    const steps = periods * 16;
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;

    let pathData = `M ${start.x} ${start.y}`;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const wave = amplitude * Math.sin(t * periods * Math.PI * 2);
      const x = start.x + dx * t + nx * wave;
      const y = start.y + dy * t + ny * wave;
      pathData += ` L ${x} ${y}`;
    }

    return new Path(pathData, {
      fill: '',
      stroke: this.getAnnotationColor(),
      strokeWidth: this.getStrokeWidth(),
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: true,
    });
  }

  createDoubleLines(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return null;

    const gap = this.getStrokeWidth() + 3;
    const nx = -dy / length;
    const ny = dx / length;
    const half = gap / 2;
    const stroke = this.getAnnotationColor();
    const strokeWidth = this.getStrokeWidth();

    return [
      new Line(
        [start.x + nx * half, start.y + ny * half, end.x + nx * half, end.y + ny * half],
        { stroke, strokeWidth, selectable: true },
      ),
      new Line(
        [start.x - nx * half, start.y - ny * half, end.x - nx * half, end.y - ny * half],
        { stroke, strokeWidth, selectable: true },
      ),
    ];
  }

  bindLineDrawingEvents(fc) {
    this.lineDrawState.set(fc, null);
    fc.on('mouse:down', (opt) => {
      if (!this.isLineDrawTool(this.activeTool)) return;
      const point = fc.getScenePoint(opt.e);
      this.lineDrawState.set(fc, { x: point.x, y: point.y });
    });
    fc.on('mouse:up', (opt) => {
      const tool = this.activeTool;
      if (!this.isLineDrawTool(tool)) return;
      const start = this.lineDrawState.get(fc);
      if (!start) return;
      const end = fc.getScenePoint(opt.e);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 2) {
        this.lineDrawState.set(fc, null);
        return;
      }

      if (tool === 'draw-line') {
        fc.add(this.createStraightLine(start.x, start.y, end.x, end.y));
      } else if (tool === 'draw-wave') {
        const wave = this.createWaveLine(start, end);
        if (wave) fc.add(wave);
      } else if (tool === 'draw-double-line') {
        const lines = this.createDoubleLines(start, end);
        if (lines) lines.forEach((line) => fc.add(line));
      }

      this.lineDrawState.set(fc, null);
      fc.requestRenderAll();
    });
  }

  bindTextPlacementEvents(fc) {
    fc.on('mouse:down', (opt) => {
      if (this.activeTool !== 'text') return;
      if (opt.target) {
        if (opt.target.type === 'textbox') {
          fc.setActiveObject(opt.target);
        }
        return;
      }
      const point = fc.getScenePoint(opt.e);
      this.placeTextAt(fc, point.x, point.y);
    });
  }

  bindFabricEvents(fc, pageNum) {
    const persist = () => {
      this.pageAnnotations[pageNum] = fc.toJSON();
      this.recordUndoHistory(fc, pageNum);
    };
    fc.on('object:added', persist);
    fc.on('object:modified', persist);
    fc.on('object:removed', persist);
    this.bindLineDrawingEvents(fc);
    this.bindTextPlacementEvents(fc);
  }

  initUndoStackForPage(pageNum, fc) {
    if (this.pageUndoStacks[pageNum]?.length) return;
    this.pageUndoStacks[pageNum] = [fc.toJSON()];
  }

  recordUndoHistory(fc, pageNum) {
    if (this.isRestoringHistory) return;
    const json = fc.toJSON();
    const stack = [...(this.pageUndoStacks[pageNum] ?? [])];
    const last = stack[stack.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(json)) return;
    stack.push(json);
    if (stack.length > 50) stack.shift();
    this.pageUndoStacks[pageNum] = stack;
  }

  invertImageData(imageData) {
    const { data } = imageData;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  }

  async renderPdfToCanvas(page, canvas, viewport) {
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    ctx.fillStyle = this.previewTheme === 'dark' ? '#000' : '#fff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    if (this.previewTheme === 'dark') {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      this.invertImageData(imageData);
      ctx.putImageData(imageData, 0, 0);
    }
  }

  async renderTextLayerForPage(pageNum, page, viewport) {
    const container = this.getTextLayerEl(pageNum);
    if (!container) return;
    container.innerHTML = '';
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;
    const textContent = await page.getTextContent();
    const layer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });
    await layer.render();
  }

  async rerenderPdfLayers() {
    if (!this.pdfDoc) return;
    if (this.viewMode === 'page') {
      const pdfCanvas = this.pageViewEl.querySelector('.pdf-editor__pdf-layer');
      if (pdfCanvas) {
        const { page, viewport } = await this.getPageViewport(this.currentPage);
        await this.renderPdfToCanvas(page, pdfCanvas, viewport);
        await this.renderTextLayerForPage(this.currentPage, page, viewport);
      }
    } else {
      await Promise.all(
        [...this.renderedScrollPageSet].map(async (pageNum) => {
          const canvas = this.scrollPdfCanvasRefs.get(pageNum);
          if (!canvas) return;
          const { page, viewport } = await this.getPageViewport(pageNum);
          await this.renderPdfToCanvas(page, canvas, viewport);
          await this.renderTextLayerForPage(pageNum, page, viewport);
        }),
      );
    }
  }

  applyToolMode(tool, fc) {
    const canvas = fc ?? this.getActiveFabricCanvas();
    if (!canvas) return;
    const isDrawFree = tool === 'draw-free';
    const isLineDraw = this.isLineDrawTool(tool);
    const isDraw = isDrawFree || isLineDraw;
    const isText = tool === 'text';
    const isHand = tool === 'hand';

    canvas.isDrawingMode = isDrawFree;
    canvas.selection = isText;
    canvas.skipTargetFind = isHand || isDraw;

    if (isDraw) {
      const brushCursor = this.getBrushCursor();
      canvas.defaultCursor = brushCursor;
      canvas.hoverCursor = brushCursor;
      canvas.freeDrawingCursor = brushCursor;
      canvas.setCursor(brushCursor);
    } else if (isText) {
      canvas.defaultCursor = 'text';
      canvas.hoverCursor = 'text';
      canvas.freeDrawingCursor = 'text';
      canvas.setCursor('text');
    } else {
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      canvas.freeDrawingCursor = 'crosshair';
      canvas.setCursor('default');
    }

    if (isDrawFree) {
      if (!canvas.freeDrawingBrush) canvas.freeDrawingBrush = new PencilBrush(canvas);
      const brush = canvas.freeDrawingBrush;
      brush.color = this.getAnnotationColor();
      brush.width = this.getStrokeWidth();
    }
  }

  applyToolToAllFabrics() {
    if (this.pageFabricCanvas) this.applyToolMode(this.activeTool, this.pageFabricCanvas);
    this.scrollFabricMap.forEach((fc) => this.applyToolMode(this.activeTool, fc));
    this._updateFabricHostClasses();
  }

  _updateFabricHostClasses() {
    const updateHost = (host) => {
      if (!host) return;
      host.classList.toggle('is-active', this.isFabricActive);
      host.classList.toggle('is-draw', this.isDrawTool);
      host.classList.toggle('is-text', this.activeTool === 'text');
      if (this.isDrawTool) host.style.cursor = this.getBrushCursor();
      else if (this.activeTool === 'text') host.style.cursor = 'text';
      else host.style.cursor = '';
    };
    this.pageViewEl.querySelectorAll('.pdf-editor__fabric-host').forEach(updateHost);
    this.scrollViewEl.querySelectorAll('.pdf-editor__fabric-host').forEach(updateHost);
    this.pageViewEl.querySelectorAll('.pdf-editor__text-layer').forEach((el) => {
      el.classList.toggle('is-active', this.isTextLayerActive);
    });
    this.scrollViewEl.querySelectorAll('.pdf-editor__text-layer').forEach((el) => {
      el.classList.toggle('is-active', this.isTextLayerActive);
    });
  }

  initFabricCanvas(el, pageNum, width, height, target) {
    const fc = new Canvas(el, { width, height, selection: true, preserveObjectStacking: true });
    this.bindFabricEvents(fc, pageNum);
    const saved = this.pageAnnotations[pageNum];
    const finishInit = () => {
      this.initUndoStackForPage(pageNum, fc);
      this.applyToolMode(this.activeTool, fc);
      this._updateFabricHostClasses();
    };
    if (saved) {
      this.isRestoringHistory = true;
      fc.loadFromJSON(saved).then(() => {
        this.isRestoringHistory = false;
        fc.renderAll();
        finishInit();
      });
    } else {
      finishInit();
    }
    if (target === 'page') {
      this.disposePageFabric();
      this.pageFabricCanvas = fc;
    } else {
      this.scrollFabricMap.get(pageNum)?.dispose();
      this.scrollFabricMap.set(pageNum, fc);
    }
  }

  async cachePageDimension(pageNum) {
    if (!this.pdfDoc || this.pageSizes[pageNum]) return;
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.pageScale });
    this.pageSizes[pageNum] = { width: viewport.width, height: viewport.height };
  }

  async cacheAllPageDimensions() {
    if (!this.pdfDoc) return;
    await Promise.all(
      Array.from({ length: this.totalPages }, (_, i) => this.cachePageDimension(i + 1)),
    );
  }

  async getPageViewport(pageNum) {
    if (!this.pdfDoc) throw new Error('PDF not loaded');
    await this.cachePageDimension(pageNum);
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.pageScale });
    this.pageSizes[pageNum] = { width: viewport.width, height: viewport.height };
    return { page, viewport };
  }

  async calcFitScale(pageNum = 1) {
    if (!this.pdfDoc || !this.bodyEl) return 1;
    const page = await this.pdfDoc.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxWidth = this.bodyEl.clientWidth - 40;
    if (maxWidth <= 0) return 1;
    return Math.min(Math.max(maxWidth / baseViewport.width, 0.4), 4);
  }

  async updateFitScale() {
    this.fitScale = await this.calcFitScale(this.currentPage);
  }

  _createPageInner(pageNum) {
    const style = this.getPageStyle(pageNum);
    const inner = document.createElement('div');
    inner.className = `pdf-editor__page-inner ${this.pageThemeClass}`;
    Object.assign(inner.style, style);

    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-editor__pdf-layer';

    const textLayer = document.createElement('div');
    textLayer.className = 'pdf-editor__text-layer';

    const fabricHost = document.createElement('div');
    fabricHost.className = 'pdf-editor__fabric-host';
    const fabricCanvas = document.createElement('canvas');

    fabricHost.appendChild(fabricCanvas);
    inner.appendChild(pdfCanvas);
    inner.appendChild(textLayer);
    inner.appendChild(fabricHost);

    return { inner, pdfCanvas, textLayer, fabricCanvas, fabricHost };
  }

  async renderPageMode(pageNum) {
    this.pageViewEl.innerHTML = '';
    const { inner, pdfCanvas, fabricCanvas } = this._createPageInner(pageNum);
    this.pageViewEl.appendChild(inner);

    const { page, viewport } = await this.getPageViewport(pageNum);
    await this.renderPdfToCanvas(page, pdfCanvas, viewport);
    await this.renderTextLayerForPage(pageNum, page, viewport);
    this.initFabricCanvas(fabricCanvas, pageNum, viewport.width, viewport.height, 'page');
  }

  _createPageBlockShell(pageNum) {
    const block = document.createElement('div');
    block.className = 'pdf-editor__page-block';
    block.dataset.page = String(pageNum);
    Object.assign(block.style, this.getPageStyle(pageNum));
    return block;
  }

  _mountPagePlaceholder(pageNum) {
    const block = this.pageBlockRefs.get(pageNum);
    if (!block) return;
    block.innerHTML = '';
    Object.assign(block.style, this.getPageStyle(pageNum));
    const placeholder = document.createElement('div');
    placeholder.className = `pdf-editor__page-placeholder ${this.pageThemeClass}`;
    Object.assign(placeholder.style, this.getPageStyle(pageNum));
    placeholder.innerHTML = `<span>第 ${pageNum} 页</span>`;
    block.appendChild(placeholder);
  }

  _mountPageBlockContent(pageNum) {
    const block = this.pageBlockRefs.get(pageNum);
    if (!block) return null;

    this.scrollFabricMap.get(pageNum)?.dispose();
    this.scrollFabricMap.delete(pageNum);

    block.innerHTML = '';
    Object.assign(block.style, this.getPageStyle(pageNum));
    const { inner, pdfCanvas, textLayer, fabricCanvas } = this._createPageInner(pageNum);
    block.appendChild(inner);
    this.scrollPdfCanvasRefs.set(pageNum, pdfCanvas);
    this.scrollFabricCanvasRefs.set(pageNum, fabricCanvas);
    this.scrollTextLayerRefs.set(pageNum, textLayer);
    return { pdfCanvas, fabricCanvas };
  }

  _initScrollList() {
    this.scrollViewEl.innerHTML = '';
    this.pageBlockRefs.clear();
    this.scrollPdfCanvasRefs.clear();
    this.scrollFabricCanvasRefs.clear();
    this.scrollTextLayerRefs.clear();

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum += 1) {
      const block = this._createPageBlockShell(pageNum);
      this.pageBlockRefs.set(pageNum, block);
      this.scrollViewEl.appendChild(block);
      if (this.renderedScrollPageSet.has(pageNum)) {
        this._mountPageBlockContent(pageNum);
      } else {
        this._mountPagePlaceholder(pageNum);
      }
    }
  }

  setPageRendering(pageNum, rendering) {
    if (rendering) this.renderingScrollPages.add(pageNum);
    else this.renderingScrollPages.delete(pageNum);
  }

  async renderScrollPage(pageNum) {
    if (!this.pdfDoc || this.renderedScrollPageSet.has(pageNum)) return;
    await this.cachePageDimension(pageNum);
    this.setPageRendering(pageNum, true);

    const block = this.pageBlockRefs.get(pageNum);
    if (block) Object.assign(block.style, this.getPageStyle(pageNum));

    const mounted = this._mountPageBlockContent(pageNum);
    const pdfCanvas = mounted?.pdfCanvas;
    const fabricEl = mounted?.fabricCanvas;
    if (!pdfCanvas || !fabricEl) {
      this.setPageRendering(pageNum, false);
      return;
    }

    try {
      const { page, viewport } = await this.getPageViewport(pageNum);
      await this.renderPdfToCanvas(page, pdfCanvas, viewport);
      await this.renderTextLayerForPage(pageNum, page, viewport);
      this.initFabricCanvas(fabricEl, pageNum, viewport.width, viewport.height, 'scroll');
      this.renderedScrollPageSet.add(pageNum);
      this._updateFabricHostClasses();
    } catch (err) {
      console.error(err);
      this.toast(`第 ${pageNum} 页渲染失败`, 'error');
    } finally {
      this.setPageRendering(pageNum, false);
    }
  }

  async renderNearbyPages(centerPage) {
    const start = Math.max(1, centerPage - 1);
    const end = Math.min(this.totalPages, centerPage + 1);
    await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) => this.renderScrollPage(start + i)),
    );
  }

  scrollToPage(pageNum) {
    const block = this.pageBlockRefs.get(pageNum);
    if (!block || !this.bodyEl) return;
    this.isProgrammaticScroll = true;
    const bodyTop = this.bodyEl.getBoundingClientRect().top;
    const blockTop = block.getBoundingClientRect().top;
    this.bodyEl.scrollTop += blockTop - bodyTop - 8;
    setTimeout(() => {
      this.isProgrammaticScroll = false;
    }, 300);
  }

  setupPageObserver() {
    this.teardownPageObserver();
    if (!this.bodyEl || this.viewMode !== 'scroll') return;
    this.pageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          this.renderScrollPage(Number(entry.target.dataset.page));
        });
        if (this.isProgrammaticScroll) return;
        let bestPage = this.currentPage;
        let bestRatio = 0;
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const pageNum = Number(entry.target.dataset.page);
          if (entry.intersectionRatio >= bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestPage = pageNum;
          }
        });
        if (bestRatio > 0.1 && bestPage !== this.currentPage) {
          this.currentPage = bestPage;
          this._updateToolbarState();
        }
      },
      { root: this.bodyEl, rootMargin: '160px 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    this.pageBlockRefs.forEach((el) => this.pageObserver.observe(el));
  }

  teardownPageObserver() {
    this.pageObserver?.disconnect();
    this.pageObserver = null;
  }

  async initCurrentView(pageNum) {
    if (this.viewMode === 'page') {
      await this.cachePageDimension(pageNum);
      await this.renderPageMode(pageNum);
      if (this.bodyEl) this.bodyEl.scrollTop = 0;
    } else {
      await this.cacheAllPageDimensions();
      this._initScrollList();
      await this.renderScrollPage(pageNum);
      await this.renderNearbyPages(pageNum);
      this.setupPageObserver();
      this.scrollToPage(pageNum);
    }
    this._showView();
    this._updateFabricHostClasses();
  }

  scheduleZoomRerender() {
    if (this.zoomDebounceTimer) clearTimeout(this.zoomDebounceTimer);
    this.zoomDebounceTimer = setTimeout(() => this.rerenderCurrentView(), 120);
  }

  applyZoomDelta(delta) {
    this.userZoom = Math.min(Math.max(Number((this.userZoom + delta).toFixed(2)), 0.5), 3);
    this.scheduleZoomRerender();
  }

  async rerenderCurrentView() {
    this.saveAllAnnotations();
    const page = this.currentPage;
    this.resetCanvasState();
    this._setLoading(true);
    try {
      if (this.viewMode === 'scroll') await this.cacheAllPageDimensions();
      await this.initCurrentView(page);
    } finally {
      this._setLoading(false);
      this._updateToolbarState();
    }
  }

  async loadPdf(file) {
    this._setLoading(true);
    this.pdfLoaded = false;
    this.resetCanvasState();
    this.pageAnnotations = {};
    this.pageUndoStacks = {};
    this.currentPage = 1;
    this.userZoom = 1;
    this.activeTool = 'hand';
    this._showView();
    try {
      this.pdfDoc?.destroy();
      const data = await file.arrayBuffer();
      this.pdfDoc = await pdfjsLib.getDocument({ data }).promise;
      this.totalPages = this.pdfDoc.numPages;
      this.pdfFile = file;
      this.pdfLoaded = true;
      await this.updateFitScale();
      await this.initCurrentView(1);
    } catch (err) {
      this.toast('PDF 加载失败', 'error');
      console.error(err);
    } finally {
      this._setLoading(false);
      this._updateToolbarState();
    }
  }

  async loadPdfFromBytes(data, name, sourceUrl) {
    this._setLoading(true);
    try {
      const file = new File([data], name || 'document.pdf', { type: 'application/pdf' });
      file.sourceUrl = sourceUrl;
      await this.loadPdf(file);
    } catch (err) {
      this.toast('无法加载 PDF', 'error');
      console.error(err);
      this._setLoading(false);
      this._showView();
      this._updateToolbarState();
    }
  }

  async loadPdfFromUrl(url) {
    this._setLoading(true);
    try {
      const data = await fetchPdfBytes(url);
      const name = pdfFileNameFromUrl(url);
      await this.loadPdfFromBytes(data, name, url);
    } catch (err) {
      this.toast('无法加载 PDF', 'error');
      console.error(err);
      this._setLoading(false);
      this._showView();
      this._updateToolbarState();
    }
  }

  async goToPage(pageNum) {
    if (!this.pdfDoc || pageNum < 1 || pageNum > this.totalPages) return;
    const target = Math.round(pageNum);
    if (target === this.currentPage && this.viewMode === 'page') return;
    this.saveAllAnnotations();
    this.currentPage = target;
    this._updateToolbarState();
    if (this.viewMode === 'page') {
      this._setLoading(true);
      try {
        await this.renderPageMode(target);
      } finally {
        this._setLoading(false);
      }
    } else {
      await this.renderNearbyPages(target);
      this.scrollToPage(target);
    }
  }

  onPageInputConfirm() {
    if (!this.pdfLoaded) return;
    const num = Number.parseInt(this.pageInputEl.value.trim(), 10);
    if (Number.isNaN(num) || num < 1 || num > this.totalPages) {
      this.pageInputEl.value = String(this.currentPage);
      return;
    }
    this.goToPage(num);
  }

  onPageInputBlur() {
    if (this.skipPageInputBlur) {
      this.skipPageInputBlur = false;
      return;
    }
    this.onPageInputConfirm();
  }

  async onViewModeChange() {
    if (!this.pdfLoaded || !this.pdfDoc) return;
    this.viewSwitching = true;
    this.saveAllAnnotations();
    this.resetCanvasState();
    this._setLoading(true);
    try {
      await this.updateFitScale();
      await this.initCurrentView(this.currentPage);
    } finally {
      this.viewSwitching = false;
      this._setLoading(false);
      this._updateToolbarState();
    }
  }

  zoomIn() {
    this.userZoom = Math.min(Number((this.userZoom + 0.1).toFixed(2)), 3);
    this.rerenderCurrentView();
  }

  zoomOut() {
    this.userZoom = Math.max(Number((this.userZoom - 0.1).toFixed(2)), 0.5);
    this.rerenderCurrentView();
  }

  resetZoom() {
    if (this.userZoom === 1) return;
    this.userZoom = 1;
    this.rerenderCurrentView();
  }

  async fitToWidth() {
    this.userZoom = 1;
    await this.updateFitScale();
    this.rerenderCurrentView();
  }

  async setTool(tool) {
    if (tool === this.activeTool && tool !== 'hand') {
      tool = 'hand';
    }

    this._deactivateAllFabrics();

    if (tool !== 'hand') {
      if (!this.pdfLoaded) {
        this.activeTool = 'hand';
        this.applyToolToAllFabrics();
        this._updateToolbarState();
        return;
      }
      const canvas = await this.ensureActiveFabric();
      if (!canvas) {
        this.toast('请等待当前页加载完成', 'error');
        this.activeTool = 'hand';
        this.applyToolToAllFabrics();
        this._updateToolbarState();
        return;
      }
    }

    this.activeTool = tool;
    this.applyToolToAllFabrics();
    this._updateToolbarState();
    this._closeDropdowns();
  }

  _deactivateAllFabrics() {
    const reset = (fc) => {
      if (!fc) return;
      const active = fc.getActiveObject();
      if (active && 'exitEditing' in active && active.isEditing) {
        active.exitEditing();
      }
      fc.discardActiveObject();
      fc.isDrawingMode = false;
      fc.skipTargetFind = false;
      fc.requestRenderAll();
    };
    reset(this.pageFabricCanvas);
    this.scrollFabricMap.forEach(reset);
  }

  _applyStrokeColorToActiveText() {
    const canvas = this.getActiveFabricCanvas();
    const active = canvas?.getActiveObject();
    if (!active || active.type !== 'textbox') return;
    active.set('fill', this.getAnnotationColor());
    canvas.requestRenderAll();
  }

  _styleTextEditor(text) {
    const ta = text.hiddenTextarea;
    if (!ta) return;
    const scale = text.scaleX || 1;
    ta.style.fontSize = `${Math.round(text.fontSize * scale)}px`;
    ta.style.lineHeight = '1.45';
    ta.style.padding = '10px 14px';
    ta.style.minWidth = '260px';
    ta.style.minHeight = '56px';
    ta.style.color = text.fill;
    ta.style.background = 'rgb(255 255 255 / 96%)';
    ta.style.border = '2px solid var(--pe-accent, #2563eb)';
    ta.style.borderRadius = '8px';
    ta.style.boxShadow = '0 8px 24px rgb(0 0 0 / 18%)';
  }

  placeTextAt(canvas, x, y) {
    const text = new Textbox('输入文字', {
      left: x,
      top: y,
      width: 320,
      fontSize: 28,
      fill: this.getAnnotationColor(),
      editable: true,
      splitByGrapheme: true,
      padding: 12,
      lockScalingFlip: true,
      cornerSize: 12,
      transparentCorners: false,
      borderColor: '#2563eb',
      editingBorderColor: '#2563eb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    text.on('editing:entered', () => this._styleTextEditor(text));
    text.on('changed', () => {
      if (text.isEditing) this._styleTextEditor(text);
    });
    text.on('editing:exited', () => {
      const content = text.text?.trim();
      if (!content || content === '输入文字') {
        canvas.remove(text);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.requestRenderAll();
    text.enterEditing();
    text.selectAll();
  }

  async deleteSelected() {
    if (this.activeTool === 'hand') return;
    const canvas = await this.ensureActiveFabric();
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (!active.length) return this.toast('请先选中要删除的元素', 'error');
    active.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  async undoLastAction() {
    const canvas = await this.ensureActiveFabric();
    if (!canvas) return this.toast('请等待当前页加载完成', 'error');
    const pageNum = this.currentPage;
    const stack = this.pageUndoStacks[pageNum];
    if (!stack || stack.length <= 1) return this.toast('没有可撤销的操作', 'error');
    const nextStack = stack.slice(0, -1);
    const prev = nextStack[nextStack.length - 1];
    this.pageUndoStacks[pageNum] = nextStack;
    this.isRestoringHistory = true;
    await canvas.loadFromJSON(prev);
    canvas.renderAll();
    this.pageAnnotations[pageNum] = prev;
    this.isRestoringHistory = false;
  }

  _setupViewportGestures() {
    this.bodyEl.addEventListener('wheel', (e) => {
      if (!this.pdfLoaded) return;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.applyZoomDelta(e.deltaY > 0 ? -0.06 : 0.06);
    }, { passive: false });

    this.bodyEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this.pinchStart = {
          distance: this._getTouchDistance(e.touches),
          zoom: this.userZoom,
        };
      }
    }, { passive: true });

    this.bodyEl.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !this.pinchStart.distance) return;
      e.preventDefault();
      const dist = this._getTouchDistance(e.touches);
      const ratio = dist / this.pinchStart.distance;
      this.userZoom = Math.min(Math.max(this.pinchStart.zoom * ratio, 0.5), 3);
      this.scheduleZoomRerender();
    }, { passive: false });

    this.bodyEl.addEventListener('touchend', () => {
      this.pinchStart = { distance: 0, zoom: this.userZoom };
    });

    this.bodyEl.addEventListener('mousedown', (e) => {
      if (this.activeTool !== 'hand' || !this.bodyEl || e.button !== 0) return;
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.closest('.textLayer') && getSelection()?.toString()) return;
      this.isPanning = true;
      this.bodyEl.classList.add('is-grabbing');
      this.panStart = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: this.bodyEl.scrollLeft,
        scrollTop: this.bodyEl.scrollTop,
      };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning || !this.bodyEl) return;
      this.bodyEl.scrollLeft = this.panStart.scrollLeft - (e.clientX - this.panStart.x);
      this.bodyEl.scrollTop = this.panStart.scrollTop - (e.clientY - this.panStart.y);
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.bodyEl.classList.remove('is-grabbing');
    });
  }

  _getTouchDistance(touches) {
    if (touches.length < 2) return 0;
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  }

  _setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (!this.pdfLoaded || this._isEditableTarget(e.target)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.activeTool === 'hand') return;
        e.preventDefault();
        this.deleteSelected();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undoLastAction();
      }
    });
  }

  _isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return target.isContentEditable;
  }

  async exportPageAnnotationPng(annotationJson, width, height) {
    const tempEl = document.createElement('canvas');
    tempEl.width = width;
    tempEl.height = height;
    const tempCanvas = new StaticCanvas(tempEl, { width, height });
    await tempCanvas.loadFromJSON(annotationJson);
    if (!tempCanvas.getObjects().length) {
      tempCanvas.dispose();
      return null;
    }
    tempCanvas.renderAll();
    const dataUrl = tempCanvas.toDataURL({ format: 'png', multiplier: 1 });
    tempCanvas.dispose();
    return Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  }

  async buildMergedPdfBytes() {
    if (!this.pdfFile || !this.pdfDoc) throw new Error('PDF not loaded');
    this.saveAllAnnotations();
    const outDoc = await PDFDocument.load(await this.pdfFile.arrayBuffer());
    const scale = this.pageScale;
    for (let i = 0; i < outDoc.getPages().length; i += 1) {
      const pageNum = i + 1;
      const annotationJson = this.pageAnnotations[pageNum];
      if (!annotationJson) continue;
      const pdfPage = await this.pdfDoc.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale });
      const pngBytes = await this.exportPageAnnotationPng(
        annotationJson,
        viewport.width,
        viewport.height,
      );
      if (!pngBytes) continue;
      const pdfImg = await outDoc.embedPng(pngBytes);
      const { width, height } = outDoc.getPages()[i].getSize();
      outDoc.getPages()[i].drawImage(pdfImg, { x: 0, y: 0, width, height });
    }
    return outDoc.save();
  }

  downloadPdf(bytes, fileName) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async trySaveToDisk(bytes) {
    if (!('showSaveFilePicker' in window)) return null;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: this.pdfFile.name,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      throw err;
    }
  }

  async reloadFromBytes(bytes, fileName) {
    const keepPage = this.currentPage;
    const keepMode = this.viewMode;
    this.pdfDoc?.destroy();
    this.resetCanvasState();
    this.pageAnnotations = {};
    this.pageUndoStacks = {};
    this.pdfFile = new File([bytes], fileName, { type: 'application/pdf' });
    this.pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    this.totalPages = this.pdfDoc.numPages;
    this.currentPage = Math.min(keepPage, this.totalPages);
    this.viewMode = keepMode;
    await this.updateFitScale();
    await this.initCurrentView(this.currentPage);
    this._updateToolbarState();
  }

  async saveChanges() {
    if (!this.pdfFile || !this.pdfDoc || this.saving) return;
    this.saving = true;
    try {
      const bytes = await this.buildMergedPdfBytes();
      const diskResult = await this.trySaveToDisk(bytes);
      if (diskResult === false) return;
      if (diskResult === null) this.downloadPdf(bytes, this.pdfFile.name);
      await this.reloadFromBytes(bytes, this.pdfFile.name);
      this.toast('保存成功', 'success');
    } catch (err) {
      this.toast('保存失败', 'error');
      console.error(err);
    } finally {
      this.saving = false;
    }
  }

  async exportPdf() {
    if (!this.pdfFile || !this.pdfDoc || this.exporting) return;
    this.exporting = true;
    try {
      this.downloadPdf(
        await this.buildMergedPdfBytes(),
        `${this.pdfFile.name.replace(/\.pdf$/i, '')}_edited.pdf`,
      );
      this.toast('PDF 导出成功', 'success');
    } catch (err) {
      this.toast('PDF 导出失败', 'error');
      console.error(err);
    } finally {
      this.exporting = false;
    }
  }

  destroy() {
    if (this.zoomDebounceTimer) clearTimeout(this.zoomDebounceTimer);
    this.teardownPageObserver();
    this.disposeAllFabrics();
    this.pdfDoc?.destroy();
  }
}
