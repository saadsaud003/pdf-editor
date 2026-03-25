/**
 * PDFEditorApp - Main Application Controller
 */
const App = (() => {
  let currentProjectId = null;
  let currentFileName = 'document.pdf';
  let currentPageIndex = 0;
  let zoomLevel = 1;
  let autoSaveTimer = null;
  let pwaInstallPrompt = null;
  let selectedExportFormat = 'pdf';
  let mergeFiles = [];

  // ========== Initialization ==========
  async function init() {
    PDFEngine.init();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('sw.js');
      } catch (e) { /* silent */ }
    }

    // PWA Install
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      pwaInstallPrompt = e;
      document.getElementById('btn-install-pwa')?.classList.remove('hidden');
    });

    setupEventListeners();
    await loadRecentProjects();

    // Hide loading screen
    setTimeout(() => {
      document.getElementById('loading-screen').classList.add('fade-out');
      document.getElementById('upload-screen').classList.remove('hidden');
      setTimeout(() => {
        document.getElementById('loading-screen').style.display = 'none';
      }, 500);
    }, 800);
  }

  // ========== Event Listeners ==========
  function setupEventListeners() {
    // Upload Screen
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') handleFile(file);
      else toast('يرجى اختيار ملف PDF', 'error');
    });
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    // PWA Install
    document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
      if (pwaInstallPrompt) {
        pwaInstallPrompt.prompt();
        await pwaInstallPrompt.userChoice;
        pwaInstallPrompt = null;
        document.getElementById('btn-install-pwa')?.classList.add('hidden');
      }
    });

    // Quick Actions
    document.getElementById('btn-merge-files')?.addEventListener('click', () => openMergeModal());
    document.getElementById('btn-convert-action')?.addEventListener('click', () => {
      fileInput.click();
      fileInput._convertMode = true;
    });
    document.getElementById('btn-ocr-action')?.addEventListener('click', () => {
      fileInput.click();
      fileInput._ocrMode = true;
    });

    // Editor Toolbar
    document.getElementById('btn-back')?.addEventListener('click', backToUpload);
    document.getElementById('btn-undo')?.addEventListener('click', () => PDFHistory.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => PDFHistory.redo());
    document.getElementById('btn-save')?.addEventListener('click', saveProject);
    document.getElementById('btn-export')?.addEventListener('click', openExportModal);

    // Tools
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'image') {
          openImagePicker();
          return;
        }
        if (tool === 'signature') {
          openSignatureModal();
          return;
        }
        if (tool === 'form-menu') {
          const dropdown = document.getElementById('forms-dropdown');
          dropdown?.classList.toggle('hidden');
          return;
        }
        // Close forms dropdown when selecting another tool
        document.getElementById('forms-dropdown')?.classList.add('hidden');
        CanvasEditor.setTool(tool);
        CanvasEditor.updateToolButtons(tool);
      });
    });

    // FAB items (mobile)
    document.querySelectorAll('.fab-item[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        toggleFab(false);
        if (tool === 'image') { openImagePicker(); return; }
        if (tool === 'signature') { openSignatureModal(); return; }
        CanvasEditor.setTool(tool);
        CanvasEditor.updateToolButtons(tool);
      });
    });

    // FAB toggle
    document.getElementById('fab-toggle')?.addEventListener('click', () => {
      const menu = document.querySelector('.fab-menu');
      const btn = document.getElementById('fab-toggle');
      const isOpen = !menu.classList.contains('hidden');
      toggleFab(!isOpen);
    });

    // OCR & Convert tools (editor)
    document.getElementById('btn-ocr-tool')?.addEventListener('click', openOCRModal);
    document.getElementById('btn-convert-tool')?.addEventListener('click', openExportModal);

    // Properties
    document.getElementById('prop-font')?.addEventListener('change', (e) =>
      CanvasEditor.updateActiveObject('font', e.target.value));
    document.getElementById('prop-size')?.addEventListener('change', (e) =>
      CanvasEditor.updateActiveObject('size', e.target.value));
    document.getElementById('prop-color')?.addEventListener('input', (e) => {
      CanvasEditor.updateActiveObject('color', e.target.value);
      if (CanvasEditor.getCurrentTool() === 'draw') {
        CanvasEditor.getCanvas().freeDrawingBrush.color = e.target.value;
      }
    });
    document.getElementById('prop-fill')?.addEventListener('input', (e) =>
      CanvasEditor.updateActiveObject('fill', e.target.value));
    document.getElementById('prop-opacity')?.addEventListener('input', (e) =>
      CanvasEditor.updateActiveObject('opacity', e.target.value));
    document.getElementById('prop-stroke-width')?.addEventListener('change', (e) =>
      CanvasEditor.updateActiveObject('strokeWidth', e.target.value));
    document.getElementById('prop-bold')?.addEventListener('click', () =>
      CanvasEditor.updateActiveObject('bold'));
    document.getElementById('prop-italic')?.addEventListener('click', () =>
      CanvasEditor.updateActiveObject('italic'));
    document.getElementById('prop-underline')?.addEventListener('click', () =>
      CanvasEditor.updateActiveObject('underline'));
    document.getElementById('prop-delete')?.addEventListener('click', () =>
      CanvasEditor.deleteSelected());
    document.getElementById('prop-duplicate')?.addEventListener('click', () =>
      CanvasEditor.duplicateSelected());

    // Page Navigation
    document.getElementById('btn-prev-page')?.addEventListener('click', () => goToPage(currentPageIndex - 1));
    document.getElementById('btn-next-page')?.addEventListener('click', () => goToPage(currentPageIndex + 1));
    document.getElementById('current-page-input')?.addEventListener('change', (e) => {
      goToPage(parseInt(e.target.value) - 1);
    });

    // Zoom
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => setZoom(zoomLevel + 0.25));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => setZoom(zoomLevel - 0.25));
    document.getElementById('btn-fit-page')?.addEventListener('click', fitToPage);

    // Sidebar
    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', toggleSidebar);
    document.getElementById('btn-toggle-pages')?.addEventListener('click', toggleSidebar);

    // Page Actions
    document.getElementById('btn-add-blank')?.addEventListener('click', addBlankPage);
    document.getElementById('btn-delete-page')?.addEventListener('click', deleteCurrentPage);
    document.getElementById('btn-rotate-page')?.addEventListener('click', rotateCurrentPage);
    document.getElementById('btn-merge-tool')?.addEventListener('click', openMergeModal);
    document.getElementById('btn-split-tool')?.addEventListener('click', openSplitModal);

    // Modal close handlers
    document.querySelectorAll('.modal-close, .modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal')?.classList.add('hidden');
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', () => {
        bd.closest('.modal')?.classList.add('hidden');
      });
    });

    // Signature Modal
    setupSignatureModal();

    // Note Modal
    document.getElementById('btn-note-add')?.addEventListener('click', () => {
      const modal = document.getElementById('note-modal');
      const text = document.getElementById('note-text').value;
      const color = document.querySelector('.note-color.active')?.dataset.color || '#fef08a';
      CanvasEditor.addStickyNote(modal._x || 100, modal._y || 100, text, color);
      modal.classList.add('hidden');
      CanvasEditor.setTool('select');
      CanvasEditor.updateToolButtons('select');
    });

    document.querySelectorAll('.note-color').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.note-color').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Forms Dropdown Items
    document.querySelectorAll('#forms-dropdown button[data-form]').forEach(btn => {
      btn.addEventListener('click', () => {
        const formType = btn.dataset.form;
        document.getElementById('forms-dropdown')?.classList.add('hidden');
        openFormModal(formType);
      });
    });

    // Close forms dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-group="forms"]')) {
        document.getElementById('forms-dropdown')?.classList.add('hidden');
      }
    });

    // Link Modal
    document.getElementById('btn-link-add')?.addEventListener('click', () => {
      const modal = document.getElementById('link-modal');
      const text = document.getElementById('link-text').value || 'رابط';
      const url = document.getElementById('link-url').value;
      const color = document.getElementById('link-color').value || '#1d4ed8';

      if (!url) {
        toast('يرجى إدخال عنوان URL', 'error');
        return;
      }

      if (modal._editTarget) {
        CanvasEditor.updateLink(modal._editTarget, text, url, color);
      } else {
        CanvasEditor.addLink(modal._x || 100, modal._y || 100, text, url, color);
      }
      modal.classList.add('hidden');
    });

    // Form Element Modal
    document.getElementById('btn-form-add')?.addEventListener('click', () => {
      const modal = document.getElementById('form-modal');
      const formType = modal._formType;
      const label = document.getElementById('form-label').value;
      const options = document.getElementById('form-options').value;
      const width = parseInt(document.getElementById('form-width').value) || 200;
      const height = parseInt(document.getElementById('form-height').value) || 36;

      CanvasEditor.addFormElement(formType, null, null, label, options, width, height);
      modal.classList.add('hidden');
    });

    // Merge Modal
    setupMergeModal();

    // Split Modal
    document.getElementById('btn-split-execute')?.addEventListener('click', executeSplit);

    // Export Modal
    setupExportModal();

    // OCR Modal
    document.getElementById('btn-ocr-execute')?.addEventListener('click', executeOCR);
    document.getElementById('btn-ocr-copy')?.addEventListener('click', () => {
      const text = document.getElementById('ocr-text').value;
      navigator.clipboard.writeText(text).then(() => toast('تم النسخ', 'success'));
    });

    // Context Menu
    document.addEventListener('click', () => {
      document.getElementById('context-menu')?.classList.add('hidden');
    });

    document.querySelectorAll('#context-menu button').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'duplicate') CanvasEditor.duplicateSelected();
        else if (action === 'delete') CanvasEditor.deleteSelected();
        else if (action === 'bring-front') CanvasEditor.bringToFront();
        else if (action === 'send-back') CanvasEditor.sendToBack();
        document.getElementById('context-menu')?.classList.add('hidden');
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // History callback
    PDFHistory.setCallback((state) => CanvasEditor.restoreState(state));

    // Window resize
    window.addEventListener('resize', debounce(() => {
      if (PDFEngine.getPageCount() > 0) {
        renderCurrentPage();
      }
    }, 300));
  }

  // ========== File Handling ==========
  async function handleFile(file) {
    if (file.size > 50 * 1024 * 1024) {
      toast('حجم الملف يتجاوز 50 ميجابايت', 'error');
      return;
    }

    currentFileName = file.name;
    showProgress('جاري تحميل الملف...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      await loadDocument(arrayBuffer, file.name);
    } catch (err) {
      hideProgress();
      toast('فشل في فتح الملف: ' + err.message, 'error');
      console.error(err);
    }
  }

  async function loadDocument(arrayBuffer, fileName) {
    showProgress('جاري معالجة الملف...');

    try {
      // Clone the buffer before PDF.js detaches it
      const bufferCopy = arrayBuffer.slice(0);

      const result = await PDFEngine.loadPDF(arrayBuffer, (p) => {
        updateProgress(p * 80, 'جاري قراءة الصفحات...');
      });

      currentProjectId = PDFStorage.generateId();
      currentFileName = fileName || 'document.pdf';
      currentPageIndex = 0;
      zoomLevel = 1;

      CanvasEditor.clearPageObjects();
      PDFHistory.clear();

      // Initialize editor
      CanvasEditor.init('fabric-canvas');
      showEditor();

      document.getElementById('file-name').textContent = currentFileName;
      document.getElementById('total-pages').textContent = result.pageCount;

      // Render first page
      updateProgress(85, 'جاري عرض الصفحة...');
      await renderCurrentPage();

      // Render thumbnails
      updateProgress(90, 'جاري إنشاء المصغرات...');
      await renderThumbnails();

      // Save to storage using the cloned buffer
      await PDFStorage.saveFile(currentProjectId, bufferCopy);
      await saveProject();

      hideProgress();
      toast('تم فتح الملف بنجاح', 'success');

      // Start auto-save
      startAutoSave();

    } catch (err) {
      hideProgress();
      toast('خطأ في معالجة الملف', 'error');
      console.error(err);
    }
  }

  // ========== Page Rendering ==========
  async function renderCurrentPage() {
    const scale = PDFEngine.getRenderScale() * zoomLevel;
    const result = await PDFEngine.renderPage(currentPageIndex + 1, scale);

    CanvasEditor.switchPage(currentPageIndex, result.dataUrl, result.width, result.height);

    document.getElementById('current-page-input').value = currentPageIndex + 1;

    // Update thumbnail active state
    document.querySelectorAll('.thumbnail-item').forEach((item, i) => {
      item.classList.toggle('active', i === currentPageIndex);
    });
  }

  async function renderThumbnails() {
    const container = document.getElementById('thumbnails-container');
    container.innerHTML = '';

    const pageCount = PDFEngine.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      const thumb = document.createElement('div');
      thumb.className = 'thumbnail-item' + (i === currentPageIndex ? ' active' : '');
      thumb.dataset.page = i;

      const dataUrl = await PDFEngine.renderThumbnail(i + 1, 150);
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = `صفحة ${i + 1}`;
      thumb.appendChild(img);

      const num = document.createElement('span');
      num.className = 'thumbnail-number';
      num.textContent = i + 1;
      thumb.appendChild(num);

      thumb.addEventListener('click', () => goToPage(i));

      container.appendChild(thumb);
    }

    // Enable drag-and-drop reordering
    if (typeof Sortable !== 'undefined') {
      Sortable.create(container, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        onEnd: async (evt) => {
          if (evt.oldIndex !== evt.newIndex) {
            await reorderPages(evt.oldIndex, evt.newIndex);
          }
        }
      });
    }
  }

  // ========== Navigation ==========
  function goToPage(index) {
    const pageCount = PDFEngine.getPageCount();
    if (index < 0 || index >= pageCount) return;

    CanvasEditor.saveCurrentPageObjects();
    currentPageIndex = index;
    renderCurrentPage();
    // Close sidebar on mobile after page selection
    if (window.innerWidth < 768) {
      document.getElementById('pages-panel').classList.remove('open');
    }
  }

  // ========== Zoom ==========
  function setZoom(level) {
    zoomLevel = Math.max(0.25, Math.min(4, level));
    document.getElementById('zoom-level').textContent = Math.round(zoomLevel * 100) + '%';
    renderCurrentPage();
  }

  function fitToPage() {
    const area = document.getElementById('canvas-area');
    const pages = PDFEngine.getPages();
    if (!pages[currentPageIndex]) return;

    const pw = pages[currentPageIndex].width * PDFEngine.getRenderScale();
    const ph = pages[currentPageIndex].height * PDFEngine.getRenderScale();
    const aw = area.clientWidth - 40;
    const ah = area.clientHeight - 40;

    zoomLevel = Math.min(aw / pw, ah / ph);
    document.getElementById('zoom-level').textContent = Math.round(zoomLevel * 100) + '%';
    renderCurrentPage();
  }

  // ========== Sidebar ==========
  function toggleSidebar() {
    const panel = document.getElementById('pages-panel');
    panel.classList.toggle('open');
  }

  // ========== Page Management ==========
  async function addBlankPage() {
    showProgress('جاري إضافة صفحة...');
    try {
      await PDFEngine.addBlankPage(currentPageIndex);
      currentPageIndex++;
      CanvasEditor.init('fabric-canvas');
      await renderCurrentPage();
      await renderThumbnails();
      document.getElementById('total-pages').textContent = PDFEngine.getPageCount();
      hideProgress();
      toast('تم إضافة صفحة فارغة', 'success');
    } catch (err) {
      hideProgress();
      toast('خطأ: ' + err.message, 'error');
    }
  }

  async function deleteCurrentPage() {
    if (PDFEngine.getPageCount() <= 1) {
      toast('لا يمكن حذف الصفحة الوحيدة', 'error');
      return;
    }

    showProgress('جاري حذف الصفحة...');
    try {
      await PDFEngine.deletePage(currentPageIndex);
      if (currentPageIndex >= PDFEngine.getPageCount()) {
        currentPageIndex = PDFEngine.getPageCount() - 1;
      }
      CanvasEditor.init('fabric-canvas');
      await renderCurrentPage();
      await renderThumbnails();
      document.getElementById('total-pages').textContent = PDFEngine.getPageCount();
      hideProgress();
      toast('تم حذف الصفحة', 'success');
    } catch (err) {
      hideProgress();
      toast('خطأ: ' + err.message, 'error');
    }
  }

  async function rotateCurrentPage() {
    showProgress('جاري تدوير الصفحة...');
    try {
      await PDFEngine.rotatePage(currentPageIndex, 90);
      CanvasEditor.init('fabric-canvas');
      await renderCurrentPage();
      await renderThumbnails();
      hideProgress();
      toast('تم تدوير الصفحة', 'success');
    } catch (err) {
      hideProgress();
      toast('خطأ: ' + err.message, 'error');
    }
  }

  async function reorderPages(oldIndex, newIndex) {
    const pageCount = PDFEngine.getPageCount();
    const order = Array.from({ length: pageCount }, (_, i) => i);
    const [removed] = order.splice(oldIndex, 1);
    order.splice(newIndex, 0, removed);

    showProgress('جاري إعادة ترتيب الصفحات...');
    try {
      await PDFEngine.reorderPages(order);
      currentPageIndex = newIndex;
      CanvasEditor.init('fabric-canvas');
      await renderCurrentPage();
      await renderThumbnails();
      hideProgress();
    } catch (err) {
      hideProgress();
      toast('خطأ: ' + err.message, 'error');
    }
  }

  // ========== Image Picker ==========
  function openImagePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        CanvasEditor.addImage(ev.target.result);
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  // ========== Signature Modal ==========
  function openSignatureModal() {
    document.getElementById('signature-modal').classList.remove('hidden');
    setTimeout(() => CanvasEditor.initSignaturePad(), 100);
  }

  function setupSignatureModal() {
    // Tab switching
    document.querySelectorAll('.sig-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sig-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.sig-content').forEach(c => c.classList.add('hidden'));
        document.getElementById(`sig-${tab.dataset.tab}-tab`)?.classList.remove('hidden');
        if (tab.dataset.tab === 'draw') {
          setTimeout(() => CanvasEditor.initSignaturePad(), 50);
        }
      });
    });

    // Colors
    document.querySelectorAll('.sig-color').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sig-color').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        CanvasEditor.setSignatureColor(btn.dataset.color);
      });
    });

    // Upload
    const sigUploadZone = document.querySelector('.sig-upload-zone');
    const sigFileInput = document.getElementById('sig-file-input');
    sigUploadZone?.addEventListener('click', () => sigFileInput.click());
    sigFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('sig-preview').src = ev.target.result;
        document.getElementById('sig-preview').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });

    // Clear
    document.getElementById('sig-clear')?.addEventListener('click', () => {
      CanvasEditor.clearSignaturePad();
      document.getElementById('sig-preview').classList.add('hidden');
      document.getElementById('sig-text-input').value = '';
    });

    // Apply
    document.getElementById('sig-apply')?.addEventListener('click', () => {
      const activeTab = document.querySelector('.sig-tab.active').dataset.tab;
      let dataUrl = null;

      if (activeTab === 'draw') {
        dataUrl = CanvasEditor.getSignatureDataUrl();
        if (!dataUrl) { toast('يرجى رسم التوقيع أولاً', 'error'); return; }
      } else if (activeTab === 'upload') {
        const preview = document.getElementById('sig-preview');
        if (preview.classList.contains('hidden')) { toast('يرجى رفع صورة التوقيع', 'error'); return; }
        dataUrl = preview.src;
      } else if (activeTab === 'type') {
        const text = document.getElementById('sig-text-input').value.trim();
        if (!text) { toast('يرجى كتابة التوقيع', 'error'); return; }
        const font = document.getElementById('sig-font-select').value;
        dataUrl = textToSignature(text, font);
      }

      if (dataUrl) {
        CanvasEditor.addSignature(dataUrl);
        document.getElementById('signature-modal').classList.add('hidden');
        toast('تم إضافة التوقيع', 'success');
      }
    });
  }

  function textToSignature(text, font) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `36px ${font}`;
    const metrics = ctx.measureText(text);
    canvas.width = metrics.width + 40;
    canvas.height = 60;
    ctx.font = `36px ${font}`;
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 20, 30);
    return canvas.toDataURL('image/png');
  }

  // ========== Merge Modal ==========
  function openMergeModal() {
    document.getElementById('merge-modal').classList.remove('hidden');
    mergeFiles = [];
    renderMergeList();
  }

  function setupMergeModal() {
    const dropZone = document.getElementById('merge-drop-zone');
    const fileInput = document.getElementById('merge-file-input');

    dropZone?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
    dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '';
      addMergeFiles(Array.from(e.dataTransfer.files));
    });
    fileInput?.addEventListener('change', (e) => {
      addMergeFiles(Array.from(e.target.files));
      e.target.value = '';
    });

    document.getElementById('btn-merge-execute')?.addEventListener('click', executeMerge);
  }

  function addMergeFiles(files) {
    files.forEach(f => {
      if (f.type === 'application/pdf') {
        mergeFiles.push(f);
      }
    });
    renderMergeList();
  }

  function renderMergeList() {
    const list = document.getElementById('merge-file-list');
    list.innerHTML = '';

    mergeFiles.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'merge-file-item';
      item.innerHTML = `
        <i class="fas fa-grip-vertical drag-handle"></i>
        <div class="file-info">
          <strong>${f.name}</strong>
          <small>${(f.size / 1024 / 1024).toFixed(2)} MB</small>
        </div>
        <button class="remove-file" data-index="${i}"><i class="fas fa-times"></i></button>
      `;
      list.appendChild(item);
    });

    // Enable reordering
    if (typeof Sortable !== 'undefined' && list.children.length > 0) {
      Sortable.create(list, {
        handle: '.drag-handle',
        animation: 200,
        onEnd: (evt) => {
          const [item] = mergeFiles.splice(evt.oldIndex, 1);
          mergeFiles.splice(evt.newIndex, 0, item);
        }
      });
    }

    // Remove buttons
    list.querySelectorAll('.remove-file').forEach(btn => {
      btn.addEventListener('click', () => {
        mergeFiles.splice(parseInt(btn.dataset.index), 1);
        renderMergeList();
      });
    });

    const execBtn = document.getElementById('btn-merge-execute');
    if (execBtn) execBtn.disabled = mergeFiles.length < 2;
  }

  async function executeMerge() {
    if (mergeFiles.length < 2) return;

    document.getElementById('merge-modal').classList.add('hidden');
    showProgress('جاري دمج الملفات...');

    try {
      const buffers = [];
      for (const f of mergeFiles) {
        buffers.push(await f.arrayBuffer());
      }

      await PDFEngine.mergePDFs(buffers, (p) => {
        updateProgress(p * 100, `جاري الدمج... ${Math.round(p * 100)}%`);
      });

      currentPageIndex = 0;
      currentFileName = 'merged.pdf';
      CanvasEditor.clearPageObjects();
      CanvasEditor.init('fabric-canvas');

      showEditor();
      document.getElementById('file-name').textContent = currentFileName;
      document.getElementById('total-pages').textContent = PDFEngine.getPageCount();

      await renderCurrentPage();
      await renderThumbnails();

      hideProgress();
      toast('تم دمج الملفات بنجاح', 'success');
    } catch (err) {
      hideProgress();
      toast('خطأ في الدمج: ' + err.message, 'error');
    }
  }

  // ========== Split Modal ==========
  function openSplitModal() {
    const modal = document.getElementById('split-modal');
    modal.classList.remove('hidden');

    const container = document.getElementById('split-thumbnails');
    container.innerHTML = '';

    const pages = PDFEngine.getPages();
    pages.forEach((page, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'split-thumb';
      thumb.dataset.page = i;

      if (page.thumbDataUrl) {
        const img = document.createElement('img');
        img.src = page.thumbDataUrl;
        thumb.appendChild(img);
      }

      const num = document.createElement('span');
      num.textContent = i + 1;
      thumb.appendChild(num);

      thumb.addEventListener('click', () => {
        thumb.classList.toggle('selected');
        updateSplitInput();
      });

      container.appendChild(thumb);
    });
  }

  function updateSplitInput() {
    const selected = document.querySelectorAll('.split-thumb.selected');
    const pages = Array.from(selected).map(t => parseInt(t.dataset.page) + 1);
    document.getElementById('split-pages-input').value = pages.join(',');
  }

  async function executeSplit() {
    const input = document.getElementById('split-pages-input').value.trim();
    if (!input) { toast('يرجى تحديد الصفحات', 'error'); return; }

    const indices = parsePageRange(input);
    if (indices.length === 0) { toast('صيغة غير صحيحة', 'error'); return; }

    document.getElementById('split-modal').classList.add('hidden');
    showProgress('جاري استخراج الصفحات...');

    try {
      const pdfBytes = await PDFEngine.extractPages(indices);
      ExportHandler.download(pdfBytes, `extracted_${currentFileName}`);
      hideProgress();
      toast('تم استخراج الصفحات بنجاح', 'success');
    } catch (err) {
      hideProgress();
      toast('خطأ: ' + err.message, 'error');
    }
  }

  function parsePageRange(input) {
    const indices = [];
    const maxPage = PDFEngine.getPageCount();

    input.split(',').forEach(part => {
      part = part.trim();
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        for (let i = start; i <= end && i <= maxPage; i++) {
          if (i >= 1) indices.push(i - 1);
        }
      } else {
        const n = parseInt(part);
        if (n >= 1 && n <= maxPage) indices.push(n - 1);
      }
    });

    return [...new Set(indices)].sort((a, b) => a - b);
  }

  // ========== Export Modal ==========
  function openExportModal() {
    document.getElementById('export-modal').classList.remove('hidden');
    selectedExportFormat = 'pdf';
    document.querySelectorAll('.export-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.format === 'pdf');
    });
  }

  function setupExportModal() {
    document.querySelectorAll('.export-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.export-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedExportFormat = opt.dataset.format;
      });
    });

    document.getElementById('btn-export-execute')?.addEventListener('click', executeExport);
  }

  async function executeExport() {
    document.getElementById('export-modal').classList.add('hidden');
    const quality = parseFloat(document.getElementById('export-quality-select')?.value || 1.5);
    const baseName = currentFileName.replace('.pdf', '');

    showProgress('جاري التصدير...');

    try {
      switch (selectedExportFormat) {
        case 'pdf': {
          const pdfBytes = await ExportHandler.exportPDF((p) => {
            updateProgress(p * 100, `جاري تصدير PDF... ${Math.round(p * 100)}%`);
          });
          ExportHandler.download(pdfBytes, `${baseName}_edited.pdf`);
          break;
        }
        case 'images': {
          const images = await ExportHandler.exportAsImages(quality, (p) => {
            updateProgress(p * 100, `جاري تصدير الصور... ${Math.round(p * 100)}%`);
          });
          ExportHandler.downloadImages(images, baseName);
          break;
        }
        case 'word': {
          const wordBlob = await ExportHandler.exportToWord((p) => {
            updateProgress(p * 100, `جاري التحويل... ${Math.round(p * 100)}%`);
          });
          ExportHandler.download(wordBlob, `${baseName}.doc`);
          break;
        }
        case 'excel': {
          const csvBlob = await ExportHandler.exportToExcel((p) => {
            updateProgress(p * 100, `جاري الاستخراج... ${Math.round(p * 100)}%`);
          });
          ExportHandler.download(csvBlob, `${baseName}.csv`);
          break;
        }
      }

      hideProgress();
      toast('تم التصدير بنجاح', 'success');
    } catch (err) {
      hideProgress();
      toast('خطأ في التصدير: ' + err.message, 'error');
      console.error(err);
    }
  }

  // ========== OCR ==========
  function openOCRModal() {
    document.getElementById('ocr-modal').classList.remove('hidden');
    document.getElementById('ocr-result').classList.add('hidden');
    document.getElementById('btn-ocr-copy').classList.add('hidden');
    document.getElementById('ocr-progress').classList.add('hidden');
  }

  async function executeOCR() {
    const lang = document.getElementById('ocr-language').value;
    const scope = document.querySelector('input[name="ocr-scope"]:checked').value;

    document.getElementById('ocr-progress').classList.remove('hidden');
    document.getElementById('btn-ocr-execute').disabled = true;

    try {
      // Dynamically load Tesseract.js
      if (typeof Tesseract === 'undefined') {
        await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
      }

      const worker = await Tesseract.createWorker(lang, 1, {
        logger: (m) => {
          if (m.progress) {
            document.getElementById('ocr-progress-fill').style.width = (m.progress * 100) + '%';
            document.getElementById('ocr-progress-text').textContent =
              `${m.status === 'recognizing text' ? 'جاري التعرف' : m.status}... ${Math.round(m.progress * 100)}%`;
          }
        }
      });

      let allText = '';

      if (scope === 'current') {
        const result = await PDFEngine.renderPage(currentPageIndex + 1, 2);
        const { data } = await worker.recognize(result.dataUrl);
        allText = data.text;
      } else {
        const pageCount = PDFEngine.getPageCount();
        for (let i = 1; i <= pageCount; i++) {
          document.getElementById('ocr-progress-text').textContent = `صفحة ${i} من ${pageCount}...`;
          const result = await PDFEngine.renderPage(i, 2);
          const { data } = await worker.recognize(result.dataUrl);
          allText += `--- صفحة ${i} ---\n${data.text}\n\n`;
        }
      }

      await worker.terminate();

      document.getElementById('ocr-text').value = allText;
      document.getElementById('ocr-result').classList.remove('hidden');
      document.getElementById('btn-ocr-copy').classList.remove('hidden');
      toast('تم التعرف على النص بنجاح', 'success');

    } catch (err) {
      toast('خطأ في OCR: ' + err.message, 'error');
      console.error(err);
    }

    document.getElementById('btn-ocr-execute').disabled = false;
  }

  // ========== Form Elements ==========
  function openFormModal(formType) {
    const modal = document.getElementById('form-modal');
    modal._formType = formType;
    document.getElementById('form-label').value = '';
    document.getElementById('form-options').value = '';
    document.getElementById('form-width').value = '200';
    document.getElementById('form-height').value = '36';

    // Show options field only for dropdown, listbox, radio
    const optionsGroup = document.getElementById('form-options-group');
    if (['dropdown', 'listbox', 'radio'].includes(formType)) {
      optionsGroup.style.display = '';
    } else {
      optionsGroup.style.display = 'none';
    }

    modal.classList.remove('hidden');
  }

  // ========== Project Storage ==========
  async function saveProject() {
    if (!currentProjectId) return;

    CanvasEditor.saveCurrentPageObjects();
    const project = {
      id: currentProjectId,
      name: currentFileName,
      pageCount: PDFEngine.getPageCount(),
      currentPage: currentPageIndex,
      fabricData: CanvasEditor.getAllPageObjects(),
      createdAt: Date.now()
    };

    try {
      await PDFStorage.saveProject(project);
      showSaveStatus();
    } catch (e) {
      console.error('Save failed:', e);
    }
  }

  function showSaveStatus() {
    const status = document.getElementById('save-status');
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2000);
  }

  function startAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => saveProject(), 30000);
  }

  async function loadRecentProjects() {
    try {
      const projects = await PDFStorage.getRecentProjects(5);
      const container = document.getElementById('recent-projects');
      const list = document.getElementById('recent-list');

      if (projects.length === 0) return;

      container.classList.remove('hidden');
      list.innerHTML = '';

      projects.forEach(proj => {
        const item = document.createElement('div');
        item.className = 'recent-item';
        const date = new Date(proj.updatedAt).toLocaleDateString('ar-SA');
        item.innerHTML = `
          <div class="recent-item-info" data-id="${proj.id}">
            <i class="fas fa-file-pdf"></i>
            <div>
              <div class="recent-item-name">${proj.name}</div>
              <div class="recent-item-date">${date} - ${proj.pageCount} صفحات</div>
            </div>
          </div>
          <button class="recent-item-delete" data-id="${proj.id}"><i class="fas fa-trash"></i></button>
        `;

        item.querySelector('.recent-item-info').addEventListener('click', () => loadProject(proj.id));
        item.querySelector('.recent-item-delete').addEventListener('click', async (e) => {
          e.stopPropagation();
          await PDFStorage.deleteProject(proj.id);
          item.remove();
          if (list.children.length === 0) container.classList.add('hidden');
          toast('تم حذف المشروع', 'info');
        });

        list.appendChild(item);
      });
    } catch (e) {
      console.error('Error loading projects:', e);
    }
  }

  async function loadProject(id) {
    showProgress('جاري تحميل المشروع...');
    try {
      const project = await PDFStorage.getProject(id);
      const fileData = await PDFStorage.getFile(id);

      if (!project || !fileData) {
        hideProgress();
        toast('المشروع غير موجود', 'error');
        return;
      }

      currentProjectId = id;
      currentFileName = project.name;

      await PDFEngine.loadPDF(fileData, (p) => {
        updateProgress(p * 80, 'جاري تحميل الملف...');
      });

      CanvasEditor.setPageObjectsData(project.fabricData || {});
      currentPageIndex = project.currentPage || 0;

      CanvasEditor.init('fabric-canvas');
      showEditor();

      document.getElementById('file-name').textContent = currentFileName;
      document.getElementById('total-pages').textContent = PDFEngine.getPageCount();

      await renderCurrentPage();
      await renderThumbnails();

      hideProgress();
      toast('تم تحميل المشروع', 'success');
      startAutoSave();

    } catch (err) {
      hideProgress();
      toast('خطأ في التحميل', 'error');
      console.error(err);
    }
  }

  // ========== Keyboard Shortcuts ==========
  function handleKeyboard(e) {
    // Don't intercept when typing in input fields
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.target.isContentEditable) return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 'z') {
      e.preventDefault();
      PDFHistory.undo();
    } else if (ctrl && e.key === 'y') {
      e.preventDefault();
      PDFHistory.redo();
    } else if (ctrl && e.key === 's') {
      e.preventDefault();
      saveProject();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (CanvasEditor.getCanvas()?.getActiveObject()) {
        e.preventDefault();
        CanvasEditor.deleteSelected();
      }
    } else if (e.key === 'v' || e.key === 'V') {
      CanvasEditor.setTool('select');
      CanvasEditor.updateToolButtons('select');
    } else if (e.key === 'h' || e.key === 'H') {
      CanvasEditor.setTool('hand');
      CanvasEditor.updateToolButtons('hand');
    } else if (e.key === 't' || e.key === 'T') {
      CanvasEditor.setTool('text');
      CanvasEditor.updateToolButtons('text');
    } else if (e.key === 'Escape') {
      CanvasEditor.setTool('select');
      CanvasEditor.updateToolButtons('select');
      document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
      document.getElementById('properties-panel')?.classList.add('hidden');
    } else if (e.key === 'ArrowRight') {
      goToPage(currentPageIndex - 1);
    } else if (e.key === 'ArrowLeft') {
      goToPage(currentPageIndex + 1);
    } else if (e.key === '+' || e.key === '=') {
      if (ctrl) { e.preventDefault(); setZoom(zoomLevel + 0.25); }
    } else if (e.key === '-') {
      if (ctrl) { e.preventDefault(); setZoom(zoomLevel - 0.25); }
    }
  }

  // ========== UI Helpers ==========
  function showEditor() {
    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('editor-screen').classList.remove('hidden');
    // Open sidebar on desktop only
    const panel = document.getElementById('pages-panel');
    if (window.innerWidth >= 768) {
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
    }
  }

  function backToUpload() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    saveProject();
    document.getElementById('editor-screen').classList.add('hidden');
    document.getElementById('upload-screen').classList.remove('hidden');
    loadRecentProjects();
  }

  function toggleFab(show) {
    const menu = document.querySelector('.fab-menu');
    const btn = document.getElementById('fab-toggle');
    if (show) {
      menu.classList.remove('hidden');
      btn.classList.add('active');
    } else {
      menu.classList.add('hidden');
      btn.classList.remove('active');
    }
  }

  function showProgress(text) {
    const overlay = document.getElementById('progress-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('global-progress-text').textContent = text || 'جاري المعالجة...';
    document.getElementById('global-progress-fill').style.width = '0%';
  }

  function updateProgress(percent, text) {
    document.getElementById('global-progress-fill').style.width = percent + '%';
    if (text) document.getElementById('global-progress-text').textContent = text;
  }

  function hideProgress() {
    document.getElementById('progress-overlay').classList.add('hidden');
  }

  function toast(message, type) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type || 'info'}`;

    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'exclamation-circle';

    t.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
    container.appendChild(t);

    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(-10px)';
      t.style.transition = 'all 0.3s';
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  // Start the app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    goToPage,
    setZoom,
    toast
  };
})();
