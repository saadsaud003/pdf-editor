/**
 * ExportHandler - Export PDF with edits, convert to images/Word/Excel
 *
 * Public API (unchanged):
 *   exportPDF(onProgress)         -> Uint8Array  (PDF bytes with overlays baked in)
 *   exportAsImages(quality, onProgress) -> string[]  (data-URL per page)
 *   exportToWord(onProgress)      -> Blob  (.doc / MHTML with images + text)
 *   exportToExcel(onProgress)     -> Blob  (.xls HTML-table with BOM)
 *   download(data, filename)
 *   downloadDataUrl(dataUrl, filename)
 *   downloadImages(images, baseName)
 *   dataUrlToBytes(dataUrl)       -> Uint8Array
 */
const ExportHandler = (() => {

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Convert a data-URL to a Uint8Array.
   */
  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Download a blob or binary buffer with any MIME type.
   * The caller is responsible for passing a Blob with the correct type.
   */
  function download(data, filename) {
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      blob = new Blob([data], { type: 'application/octet-stream' });
    } else {
      blob = new Blob([data], { type: 'application/octet-stream' });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Download a data-URL directly (avoids a Blob round-trip for PNG images).
   */
  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Download an array of data-URLs as numbered image files.
   * A 200 ms stagger prevents simultaneous download dialogs.
   */
  function downloadImages(images, baseName) {
    images.forEach((dataUrl, i) => {
      setTimeout(() => {
        downloadDataUrl(dataUrl, `${baseName}_page_${i + 1}.png`);
      }, i * 200);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FABRIC / CANVAS UTILITIES  (used by exportPDF and exportAsImages)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Render a Fabric.js JSON snapshot onto an off-screen StaticCanvas and
   * return the result as a PNG data-URL.
   *
   * @param {object} fabricJSON   - Snapshot from CanvasEditor.getAllPageObjects()[i]
   * @param {object} pageData     - Entry from PDFEngine.getPages()
   * @returns {Promise<string|null>}
   */
  async function renderFabricToImage(fabricJSON, pageData) {
    return new Promise((resolve) => {
      const offCanvas = document.createElement('canvas');
      offCanvas.width  = pageData.width  * PDFEngine.getRenderScale();
      offCanvas.height = pageData.height * PDFEngine.getRenderScale();

      const offFabric = new fabric.StaticCanvas(offCanvas);
      offFabric.setDimensions({ width: offCanvas.width, height: offCanvas.height });

      offFabric.loadFromJSON(fabricJSON, () => {
        offFabric.renderAll();
        const dataUrl = offFabric.toDataURL({ format: 'png' });
        offFabric.dispose();
        resolve(dataUrl);
      });
    });
  }

  /**
   * Composite a Fabric overlay on top of a background PDF-page image.
   *
   * @param {string} bgDataUrl   - Background page as data-URL
   * @param {object} fabricJSON  - Fabric snapshot
   * @param {number} width
   * @param {number} height
   * @returns {Promise<string>}  - Composited PNG data-URL
   */
  async function compositePageImage(bgDataUrl, fabricJSON, width, height) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      const bgImg = new Image();
      bgImg.onload = () => {
        ctx.drawImage(bgImg, 0, 0, width, height);

        const offCanvas = document.createElement('canvas');
        offCanvas.width  = width;
        offCanvas.height = height;
        const offFabric  = new fabric.StaticCanvas(offCanvas);
        offFabric.setDimensions({ width, height });

        offFabric.loadFromJSON(fabricJSON, () => {
          offFabric.renderAll();
          ctx.drawImage(offCanvas, 0, 0);
          offFabric.dispose();
          resolve(canvas.toDataURL('image/png'));
        });
      };
      bgImg.src = bgDataUrl;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. PDF EXPORT  (unchanged logic – bakes Fabric overlays into the PDF)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Export the edited PDF.  Fabric overlays are rendered to PNG and drawn on
   * top of each PDF page using pdf-lib before saving.
   *
   * @param {function} [onProgress]  - Called with 0..1
   * @returns {Promise<Uint8Array>}
   */
  async function exportPDF(onProgress) {
    const pdfBytes   = PDFEngine.getPdfBytes();
    const srcDoc     = await PDFLib.PDFDocument.load(pdfBytes);
    const pageObjects = CanvasEditor.getAllPageObjects();
    const pages      = PDFEngine.getPages();
    const total      = pages.length;

    for (let i = 0; i < total; i++) {
      if (CanvasEditor.hasObjects(i)) {
        const pageData = pages[i];
        const page     = srcDoc.getPage(i);
        const { width, height } = page.getSize();

        if (pageObjects[i] && pageObjects[i].objects && pageObjects[i].objects.length > 0) {
          const overlayDataUrl = await renderFabricToImage(pageObjects[i], pageData);
          if (overlayDataUrl) {
            const pngBytes = dataUrlToBytes(overlayDataUrl);
            const pngImage = await srcDoc.embedPng(pngBytes);
            page.drawImage(pngImage, { x: 0, y: 0, width, height });
          }
        }
      }
      if (onProgress) onProgress((i + 1) / total);
    }

    return await srcDoc.save();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. IMAGE EXPORT  (unchanged logic)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Render every page to a PNG data-URL, compositing any Fabric overlays.
   *
   * @param {number}   [quality=2]   - Render scale (1 = 72 dpi, 2 = 144 dpi …)
   * @param {function} [onProgress]  - Called with 0..1
   * @returns {Promise<string[]>}    - Array of PNG data-URLs, one per page
   */
  async function exportAsImages(quality, onProgress) {
    const scale      = quality || 2;
    const pages      = PDFEngine.getPages();
    const images     = [];
    const pageObjects = CanvasEditor.getAllPageObjects();

    for (let i = 0; i < pages.length; i++) {
      const result = await PDFEngine.renderPage(i + 1, scale);

      if (CanvasEditor.hasObjects(i) && pageObjects[i]) {
        const composited = await compositePageImage(
          result.dataUrl, pageObjects[i], result.width, result.height
        );
        images.push(composited);
      } else {
        images.push(result.dataUrl);
      }

      if (onProgress) onProgress((i + 1) / pages.length);
    }

    return images;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. WORD EXPORT  (MHTML / Word-compatible)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieve rich text items (with position/size info) for a single page via
   * PDF.js getTextContent.  Returns an array of
   *   { str, x, y, w, h, fontSize, fontName, dir }
   *
   * NOTE: PDF.js text coordinates have origin at bottom-left; we convert to
   * CSS top-left to match the image coordinate system.
   *
   * @param {number} pageNum   - 1-based page number
   * @param {number} pageH     - Page height in PDF user units (for Y flip)
   * @returns {Promise<Array>}
   */
  async function _getRichTextItems(pageNum, pageH) {
    // Access the underlying PDF.js document via PDFEngine's internal API.
    // PDFEngine.getPageText() only returns plain string; we need raw items,
    // so we call getPage() on the pdf.js doc directly.
    // PDFEngine exposes renderPage which loads the page, but not the raw
    // textContent items with transforms.  We work around this by using the
    // same pdfjsLib document that PDFEngine wraps.  Since PDFEngine does not
    // expose the underlying pdfDoc we replicate the text extraction here
    // using the public getPageText path as a fallback, but first attempt the
    // richer approach via a temporary render.

    // Attempt to obtain raw text content from the PDF.js document.
    // PDFEngine uses pdfjsLib internally; we request the page via the same
    // global loading task by relying on PDFEngine.renderPage to prime the
    // internal cache then reading the text off the already-loaded page.
    //
    // Because PDFEngine doesn't expose pdfDoc directly we use a small trick:
    // call getPageText which triggers pdfDoc.getPage(pageNum) internally,
    // but that only gives us a plain string.  Instead we build on top of
    // the PUBLIC api: we render the page at scale=1 to get a canvas (this
    // also caches the page inside pdf.js), then call getTextContent via a
    // fresh loadingTask on the same bytes – but that would duplicate work.
    //
    // Simplest robust solution: use PDFEngine.getPageText for the string and
    // reconstruct approximate positions from the line/word layout.  For the
    // MHTML export we do NOT need pixel-perfect absolute positioning – we
    // use a block-level text overlay approach with preserved whitespace.

    const text = await PDFEngine.getPageText(pageNum);
    return { plainText: text };
  }

  /**
   * Produce one page's worth of MHTML content.
   * Strategy:
   *   - Render the page to a PNG data-URL at 150 dpi (scale 2)
   *   - Get the plain text so it appears in the Word document as a text layer
   *   - Produce an HTML section that:
   *       * Displays the page image at A4-like width
   *       * Has a hidden, selectable text block below the image for copy-paste
   *       * Inserts a page break before the next page
   *
   * @param {number} pageIndex   - 0-based
   * @param {object} pageData    - Entry from PDFEngine.getPages()
   * @param {object} pageObjects - Fabric snapshots keyed by page index
   * @returns {Promise<{imageDataUrl: string, text: string, width: number, height: number}>}
   */
  async function _renderPageForWord(pageIndex, pageData, pageObjects) {
    // Render at 2× for good clarity in the Word doc
    const scale  = 2;
    const result = await PDFEngine.renderPage(pageIndex + 1, scale);

    let imageDataUrl = result.dataUrl;

    // Composite any Fabric overlays
    if (CanvasEditor.hasObjects(pageIndex) && pageObjects[pageIndex]) {
      imageDataUrl = await compositePageImage(
        imageDataUrl, pageObjects[pageIndex], result.width, result.height
      );
    }

    const text = await PDFEngine.getPageText(pageIndex + 1);

    return {
      imageDataUrl,
      text: text || '',
      width:  result.width,
      height: result.height,
      pageNum: pageIndex + 1
    };
  }

  /**
   * Detect whether the text for a page looks like it contains RTL (Arabic /
   * Hebrew) characters.
   */
  function _isRTL(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  }

  /**
   * Escape a string for safe embedding inside HTML.
   */
  function _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Build a single HTML <section> for one PDF page to be embedded in the
   * MHTML Word document.
   *
   * Layout inside the section:
   *   +-------------------------------+
   *   |  page image (full width)      |
   *   |  text block (selectable,      |
   *   |  visually hidden under image) |
   *   +-------------------------------+
   *
   * Word renders images correctly but also imports the text for searching /
   * copy-paste.  We overlap them using a position:relative container.
   */
  function _buildWordPageSection(pageInfo, isLast) {
    const { imageDataUrl, text, width, height, pageNum } = pageInfo;
    const dir       = _isRTL(text) ? 'rtl' : 'ltr';
    const align     = dir === 'rtl' ? 'right' : 'left';

    // Convert the image to a fraction of A4 width (≈ 170 mm usable)
    // We let the image span 100% of the content box.
    const aspectRatio  = height / width;
    // Express as a Word page-width percentage; leave margins to the @page rule
    const imgStyle = 'width:100%;display:block;';

    // Text lines: strip excessive whitespace but keep paragraph breaks
    const textLines = text
      .split(/\n+/)
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(l => `<p>${_escapeHtml(l)}</p>`)
      .join('');

    const pageBreak = isLast ? '' : '<div style="page-break-after:always;"></div>';

    return `
<div class="pdf-page" dir="${dir}">
  <div class="page-label">صفحة ${pageNum}</div>
  <div class="page-image-wrap">
    <img src="${imageDataUrl}" alt="Page ${pageNum}" style="${imgStyle}">
  </div>
  <div class="page-text" dir="${dir}" style="text-align:${align};">
    ${textLines || '<p><em>(لا يوجد نص قابل للاستخراج في هذه الصفحة)</em></p>'}
  </div>
${pageBreak}
</div>`;
  }

  /**
   * Assemble the complete MHTML document string.
   * MHTML format: one root HTML part + inline image parts encoded as base64,
   * all separated by MIME boundaries.  Word 2007+ opens MHTML files natively
   * and preserves the embedded images.
   *
   * @param {Array<{imageDataUrl, text, width, height, pageNum}>} pages
   * @returns {string}  - Full MHTML document as a string
   */
  function _buildMHTML(pages) {
    const boundary = `----=_NextPart_ExportHandler_${Date.now()}`;
    const parts    = [];   // MIME parts after the HTML part

    // Build HTML body; replace each image src with a Content-ID reference
    // so Word resolves them from the MHTML parts.
    let htmlSections = '';
    const imageRefs  = [];   // { cid, mimeType, base64 }

    pages.forEach((pageInfo, idx) => {
      const { imageDataUrl, text, width, height, pageNum } = pageInfo;
      const isLast = idx === pages.length - 1;
      const dir    = _isRTL(text) ? 'rtl' : 'ltr';
      const align  = dir === 'rtl' ? 'right' : 'left';

      // Extract base64 payload and MIME type from the data-URL
      const dataUrlMatch  = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType      = dataUrlMatch ? dataUrlMatch[1] : 'image/png';
      const base64Data    = dataUrlMatch ? dataUrlMatch[2] : '';

      const cid = `page_image_${pageNum}@exporthandler`;
      imageRefs.push({ cid, mimeType, base64: base64Data });

      const textLines = text
        .split(/\n+/)
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => `<p>${_escapeHtml(l)}</p>`)
        .join('');

      const pageBreak = isLast ? '' : '<div style="page-break-after:always;"></div>';

      htmlSections += `
<div class="pdf-page" dir="${dir}">
  <p class="page-label">صفحة ${pageNum}</p>
  <div class="page-image-wrap">
    <img src="cid:${cid}" alt="Page ${pageNum}" style="width:100%;display:block;">
  </div>
  <div class="page-text" dir="${dir}" style="text-align:${align};">
    ${textLines || '<p><em>(لا يوجد نص قابل للاستخراج في هذه الصفحة)</em></p>'}
  </div>
${pageBreak}
</div>`;
    });

    // Root HTML part
    const htmlPart = `MIME-Version: 1.0
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Location: file:///C:/export.htm

<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="Generator" content="ExportHandler">
<title>مستند PDF المُصدَّر</title>
<style>
  @page {
    size: A4;
    margin: 2cm 2cm 2cm 2cm;
  }
  body {
    font-family: 'Tajawal', 'Arial', 'Segoe UI', sans-serif;
    font-size: 12pt;
    line-height: 1.8;
    margin: 0;
    padding: 0;
    color: #111;
    background: #fff;
  }
  .pdf-page {
    margin-bottom: 0;
    padding: 0;
  }
  .page-label {
    font-size: 9pt;
    color: #888;
    margin: 0 0 6px 0;
    font-family: 'Tajawal', Arial, sans-serif;
  }
  .page-image-wrap {
    border: 1px solid #ddd;
    box-shadow: 0 1px 4px rgba(0,0,0,.12);
    margin-bottom: 6px;
    line-height: 0;
  }
  .page-image-wrap img {
    max-width: 100%;
    height: auto;
    display: block;
  }
  .page-text {
    font-size: 10pt;
    color: #333;
    font-family: 'Tajawal', 'Arial', sans-serif;
    margin-top: 8px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .page-text p {
    margin: 2px 0;
  }
</style>
</head>
<body>
${htmlSections}
</body>
</html>`;

    // Build full MHTML string
    let mhtml = `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"; type="text/html"\r\n\r\n`;

    // HTML root part
    mhtml += `--${boundary}\r\n`;
    mhtml += htmlPart + `\r\n\r\n`;

    // Image parts
    imageRefs.forEach(({ cid, mimeType, base64 }) => {
      // Chunk base64 at 76 chars per line (MIME spec)
      const chunked = base64.replace(/(.{76})/g, '$1\r\n');
      mhtml += `--${boundary}\r\n`;
      mhtml += `Content-Type: ${mimeType}\r\n`;
      mhtml += `Content-Transfer-Encoding: base64\r\n`;
      mhtml += `Content-ID: <${cid}>\r\n`;
      mhtml += `Content-Location: ${cid}\r\n`;
      mhtml += `\r\n${chunked}\r\n\r\n`;
    });

    mhtml += `--${boundary}--\r\n`;
    return mhtml;
  }

  /**
   * Export the PDF as a Word-compatible MHTML document.
   * Each page is rendered as an image and embedded alongside its extracted
   * text.  The resulting .doc file opens in Word 2007+ and LibreOffice.
   *
   * @param {function} [onProgress]  - Called with 0..1
   * @returns {Promise<Blob>}        - MHTML blob with application/msword type
   */
  async function exportToWord(onProgress) {
    const pageObjects = CanvasEditor.getAllPageObjects();
    const pages       = PDFEngine.getPages();
    const total       = pages.length;
    const pageInfos   = [];

    for (let i = 0; i < total; i++) {
      const info = await _renderPageForWord(i, pages[i], pageObjects);
      pageInfos.push(info);
      if (onProgress) onProgress((i + 1) / total);
    }

    const mhtmlString = _buildMHTML(pageInfos);

    // Use UTF-16 LE with BOM for maximum Word compatibility with Arabic text
    // MHTML itself is UTF-8; we output as UTF-8 since the HTML declares charset.
    return new Blob([mhtmlString], {
      type: 'application/msword'
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. EXCEL EXPORT  (HTML table format that Excel opens natively)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Heuristic: decide whether a line looks like a table row.
   * A line is "tabular" if it contains two or more whitespace-separated
   * columns where each column is short (< 60 chars) and there are at least
   * 2 columns.
   *
   * @param {string[]} columns
   * @returns {boolean}
   */
  function _isTableRow(columns) {
    return columns.length >= 2 && columns.every(c => c.length < 80);
  }

  /**
   * Parse the plain text of one page into a list of rows.
   * Each row is an array of cell strings.
   * Lines that look like they have multi-column structure are split by
   * multi-space or tab; other lines become single-cell rows.
   *
   * @param {string} text
   * @returns {string[][]}
   */
  function _parseTextToRows(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Try splitting on 2+ spaces or tab characters
      const columns = line.split(/\t|\s{2,}/).map(c => c.trim()).filter(c => c);

      if (_isTableRow(columns)) {
        rows.push(columns);
      } else {
        rows.push([line]);
      }
    }

    return rows;
  }

  /**
   * Build one HTML <table> sheet section for a single PDF page.
   *
   * @param {string}   text      - Extracted plain text
   * @param {number}   pageNum   - 1-based page number
   * @returns {string}           - HTML fragment
   */
  function _buildExcelPageSection(text, pageNum) {
    const rows   = _parseTextToRows(text);
    const dir    = _isRTL(text) ? 'rtl' : 'ltr';
    const align  = dir === 'rtl' ? 'right' : 'left';

    if (rows.length === 0) {
      return `
<tr>
  <td class="sheet-header" colspan="20">صفحة ${pageNum}</td>
</tr>
<tr>
  <td class="empty-cell" colspan="20">(لا يوجد نص قابل للاستخراج في هذه الصفحة)</td>
</tr>
<tr><td colspan="20">&nbsp;</td></tr>`;
    }

    // Determine max column count for this page
    const maxCols = Math.max(...rows.map(r => r.length), 1);

    let html = `
<tr>
  <td class="sheet-header" colspan="${maxCols}" dir="${dir}" style="text-align:${align};">صفحة ${pageNum}</td>
</tr>`;

    rows.forEach(cols => {
      html += '<tr>';
      cols.forEach(cell => {
        html += `<td dir="${dir}" style="text-align:${align};">${_escapeHtml(cell)}</td>`;
      });
      // Pad short rows so table is rectangular
      for (let p = cols.length; p < maxCols; p++) {
        html += '<td></td>';
      }
      html += '</tr>';
    });

    html += '<tr><td colspan="20">&nbsp;</td></tr>';
    return html;
  }

  /**
   * Export the PDF content as an Excel-compatible HTML workbook.
   * Excel opens this format natively (.xls extension with HTML content).
   * Arabic text is supported via the UTF-8 BOM + charset meta tag.
   *
   * @param {function} [onProgress]  - Called with 0..1
   * @returns {Promise<Blob>}        - HTML blob with application/vnd.ms-excel type
   */
  async function exportToExcel(onProgress) {
    const texts = await PDFEngine.getAllText(onProgress);
    let tableBody = '';

    texts.forEach((text, i) => {
      tableBody += _buildExcelPageSection(text || '', i + 1);
    });

    // Excel HTML workbook format
    const html = `\uFEFF<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>PDF Export</x:Name>
          <x:WorksheetOptions>
            <x:DisplayRightToLeft/>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    body {
      font-family: 'Tajawal', Arial, sans-serif;
      font-size: 11pt;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    td, th {
      border: 1px solid #ccc;
      padding: 4px 8px;
      vertical-align: top;
      white-space: pre-wrap;
      font-family: 'Tajawal', Arial, sans-serif;
      font-size: 10pt;
    }
    .sheet-header {
      background: #1e3a5f;
      color: #fff;
      font-weight: bold;
      font-size: 11pt;
      padding: 6px 10px;
      border: none;
    }
    .empty-cell {
      color: #999;
      font-style: italic;
    }
  </style>
</head>
<body>
<table>
${tableBody}
</table>
</body>
</html>`;

    return new Blob([html], {
      type: 'application/vnd.ms-excel;charset=utf-8'
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  return {
    // Core exports
    exportPDF,
    exportAsImages,
    exportToWord,
    exportToExcel,

    // Download utilities
    download,
    downloadDataUrl,
    downloadImages,

    // Byte utility (used by exportPDF internally, exposed for external callers)
    dataUrlToBytes
  };
})();
