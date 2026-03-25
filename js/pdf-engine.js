/**
 * PDFEngine - PDF loading, rendering (PDF.js) and manipulation (pdf-lib)
 */
const PDFEngine = (() => {
  let pdfDoc = null;       // PDF.js document
  let pdfBytes = null;     // Original file bytes
  let pages = [];          // Array of page data
  let renderScale = 1.5;

  // Initialize PDF.js worker
  function init() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  /**
   * Load a PDF from ArrayBuffer
   */
  async function loadPDF(arrayBuffer, onProgress) {
    pdfBytes = arrayBuffer.slice(0);
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true
    });

    if (onProgress) {
      loadingTask.onProgress = (p) => {
        if (p.total > 0) onProgress(p.loaded / p.total);
      };
    }

    pdfDoc = await loadingTask.promise;
    pages = [];

    const total = pdfDoc.numPages;
    for (let i = 1; i <= total; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        pageIndex: i,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation || 0,
        fabricJSON: null,
        rendered: false,
        imageDataUrl: null,
        thumbDataUrl: null
      });
      if (onProgress) onProgress(0.5 + (i / total) * 0.5);
    }

    return { pageCount: total, pages };
  }

  /**
   * Render a page to a data URL image
   */
  async function renderPage(pageNum, scale) {
    if (!pdfDoc) throw new Error('No PDF loaded');
    scale = scale || renderScale;

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL('image/png');
    if (pages[pageNum - 1]) {
      pages[pageNum - 1].imageDataUrl = dataUrl;
      pages[pageNum - 1].rendered = true;
    }
    return {
      dataUrl,
      width: viewport.width,
      height: viewport.height
    };
  }

  /**
   * Render a thumbnail
   */
  async function renderThumbnail(pageNum, maxWidth) {
    if (!pdfDoc) return null;
    maxWidth = maxWidth || 150;

    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const scale = maxWidth / vp.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    if (pages[pageNum - 1]) {
      pages[pageNum - 1].thumbDataUrl = dataUrl;
    }
    return dataUrl;
  }

  /**
   * Add a blank page using pdf-lib
   */
  async function addBlankPage(afterIndex) {
    const libDoc = await PDFLib.PDFDocument.load(pdfBytes);
    const refPage = libDoc.getPage(Math.min(afterIndex, libDoc.getPageCount() - 1));
    const { width, height } = refPage.getSize();

    const newPage = libDoc.insertPage(afterIndex + 1, [width, height]);
    pdfBytes = await libDoc.save();

    // Reload
    return await loadPDF(pdfBytes);
  }

  /**
   * Delete a page using pdf-lib
   */
  async function deletePage(pageIndex) {
    if (pages.length <= 1) throw new Error('Cannot delete the only page');
    const libDoc = await PDFLib.PDFDocument.load(pdfBytes);
    libDoc.removePage(pageIndex);
    pdfBytes = await libDoc.save();
    return await loadPDF(pdfBytes);
  }

  /**
   * Rotate a page
   */
  async function rotatePage(pageIndex, degrees) {
    const libDoc = await PDFLib.PDFDocument.load(pdfBytes);
    const page = libDoc.getPage(pageIndex);
    const current = page.getRotation().angle;
    page.setRotation(PDFLib.degrees(current + (degrees || 90)));
    pdfBytes = await libDoc.save();
    return await loadPDF(pdfBytes);
  }

  /**
   * Reorder pages
   */
  async function reorderPages(newOrder) {
    const libDoc = await PDFLib.PDFDocument.load(pdfBytes);
    const newDoc = await PDFLib.PDFDocument.create();

    for (const idx of newOrder) {
      const [copiedPage] = await newDoc.copyPages(libDoc, [idx]);
      newDoc.addPage(copiedPage);
    }

    pdfBytes = await newDoc.save();
    return await loadPDF(pdfBytes);
  }

  /**
   * Merge multiple PDFs
   */
  async function mergePDFs(pdfArrayBuffers, onProgress) {
    const mergedDoc = await PDFLib.PDFDocument.create();
    const total = pdfArrayBuffers.length;

    for (let i = 0; i < total; i++) {
      const srcDoc = await PDFLib.PDFDocument.load(pdfArrayBuffers[i]);
      const indices = srcDoc.getPageIndices();
      const copiedPages = await mergedDoc.copyPages(srcDoc, indices);
      copiedPages.forEach(page => mergedDoc.addPage(page));
      if (onProgress) onProgress((i + 1) / total);
    }

    pdfBytes = await mergedDoc.save();
    return await loadPDF(pdfBytes);
  }

  /**
   * Extract specific pages (split)
   */
  async function extractPages(pageIndices) {
    const srcDoc = await PDFLib.PDFDocument.load(pdfBytes);
    const newDoc = await PDFLib.PDFDocument.create();

    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(page => newDoc.addPage(page));

    return await newDoc.save();
  }

  /**
   * Get text content from a page (for OCR/conversion)
   */
  async function getPageText(pageNum) {
    if (!pdfDoc) return '';
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    return content.items.map(item => item.str).join(' ');
  }

  /**
   * Get all text from all pages
   */
  async function getAllText(onProgress) {
    const texts = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      texts.push(await getPageText(i));
      if (onProgress) onProgress(i / pdfDoc.numPages);
    }
    return texts;
  }

  function getPages() { return pages; }
  function getPageCount() { return pdfDoc ? pdfDoc.numPages : 0; }
  function getPdfBytes() { return pdfBytes; }
  function getRenderScale() { return renderScale; }
  function setRenderScale(s) { renderScale = s; }

  return {
    init,
    loadPDF,
    renderPage,
    renderThumbnail,
    addBlankPage,
    deletePage,
    rotatePage,
    reorderPages,
    mergePDFs,
    extractPages,
    getPageText,
    getAllText,
    getPages,
    getPageCount,
    getPdfBytes,
    getRenderScale,
    setRenderScale
  };
})();
