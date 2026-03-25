/**
 * CanvasEditor - Fabric.js based editing layer for PDF pages
 */
const CanvasEditor = (() => {
  let fabricCanvas = null;
  let currentTool = 'select';
  let isDrawingShape = false;
  let shapeStart = null;
  let tempShape = null;
  let currentPage = 0;
  let pageObjects = {};  // Store objects per page: { pageIndex: fabricJSON }
  let signaturePadCtx = null;
  let sigDrawing = false;
  let sigPoints = [];
  let sigColor = '#000000';

  function init(canvasId) {
    fabricCanvas = new fabric.Canvas(canvasId, {
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: true
    });

    fabricCanvas.on('object:modified', saveState);
    fabricCanvas.on('object:added', saveState);
    fabricCanvas.on('object:removed', saveState);
    fabricCanvas.on('selection:created', onSelectionChange);
    fabricCanvas.on('selection:updated', onSelectionChange);
    fabricCanvas.on('selection:cleared', onSelectionClear);
    fabricCanvas.on('mouse:down', onMouseDown);
    fabricCanvas.on('mouse:move', onMouseMove);
    fabricCanvas.on('mouse:up', onMouseUp);
    fabricCanvas.on('mouse:dblclick', onDoubleClick);

    return fabricCanvas;
  }

  function setPageBackground(dataUrl, width, height) {
    fabricCanvas.setDimensions({ width, height });
    fabric.Image.fromURL(dataUrl, (img) => {
      fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas), {
        scaleX: width / img.width,
        scaleY: height / img.height,
        originX: 'left',
        originY: 'top'
      });
    });
  }

  function saveCurrentPageObjects() {
    if (fabricCanvas && currentPage >= 0) {
      const json = fabricCanvas.toJSON(['customType', 'noteText', 'noteColor', '_linkText', '_linkUrl', '_formType', '_formLabel', '_formOptions']);
      pageObjects[currentPage] = json;
    }
  }

  function loadPageObjects(pageIndex) {
    saveCurrentPageObjects();
    currentPage = pageIndex;

    // Clear only objects, keep background
    const bg = fabricCanvas.backgroundImage;
    fabricCanvas.clear();
    fabricCanvas.setBackgroundImage(bg, fabricCanvas.renderAll.bind(fabricCanvas));

    if (pageObjects[pageIndex]) {
      PDFHistory.pause();
      fabricCanvas.loadFromJSON(pageObjects[pageIndex], () => {
        fabricCanvas.renderAll();
        PDFHistory.resume();
      });
    }
  }

  function switchPage(pageIndex, dataUrl, width, height) {
    saveCurrentPageObjects();
    currentPage = pageIndex;
    fabricCanvas.clear();
    setPageBackground(dataUrl, width, height);

    if (pageObjects[pageIndex]) {
      setTimeout(() => {
        PDFHistory.pause();
        const objects = pageObjects[pageIndex].objects || [];
        fabric.util.enlivenObjects(objects, (enlivened) => {
          enlivened.forEach(obj => fabricCanvas.add(obj));
          fabricCanvas.renderAll();
          PDFHistory.resume();
        });
      }, 100);
    }
  }

  function setTool(tool) {
    currentTool = tool;
    fabricCanvas.isDrawingMode = (tool === 'draw');
    fabricCanvas.selection = (tool === 'select');

    // Remove eraser cursor class
    const wrapperEl = fabricCanvas.wrapperEl;
    if (wrapperEl) wrapperEl.classList.remove('eraser-cursor');

    if (tool === 'draw') {
      fabricCanvas.freeDrawingBrush.width = 2;
      fabricCanvas.freeDrawingBrush.color = document.getElementById('prop-color')?.value || '#000000';
    }

    if (tool === 'eraser') {
      if (wrapperEl) wrapperEl.classList.add('eraser-cursor');
      fabricCanvas.defaultCursor = 'default';
      fabricCanvas.hoverCursor = 'pointer';
    } else if (tool === 'hand') {
      fabricCanvas.defaultCursor = 'grab';
      fabricCanvas.hoverCursor = 'grab';
    } else if (tool === 'text' || tool === 'note' || tool === 'link') {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'crosshair';
    } else if (['rect', 'circle', 'line', 'arrow', 'highlight'].includes(tool)) {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'crosshair';
    } else {
      fabricCanvas.defaultCursor = 'default';
      fabricCanvas.hoverCursor = 'move';
    }

    // Disable object selection for drawing tools
    fabricCanvas.forEachObject(obj => {
      obj.selectable = (tool === 'select');
      obj.evented = (tool === 'select');
    });

    fabricCanvas.renderAll();
  }

  function onMouseDown(opt) {
    const pointer = fabricCanvas.getPointer(opt.e);

    if (currentTool === 'eraser') {
      if (opt.target && opt.target !== fabricCanvas.backgroundImage) {
        fabricCanvas.remove(opt.target);
        fabricCanvas.renderAll();
      }
      return;
    }

    if (currentTool === 'text') {
      addText(pointer.x, pointer.y);
      return;
    }

    if (currentTool === 'link') {
      showLinkModal(pointer.x, pointer.y);
      return;
    }

    if (currentTool === 'note') {
      showNoteModal(pointer.x, pointer.y);
      return;
    }

    if (['rect', 'circle', 'line', 'arrow', 'highlight'].includes(currentTool)) {
      isDrawingShape = true;
      shapeStart = { x: pointer.x, y: pointer.y };
      const color = document.getElementById('prop-color')?.value || '#000000';
      const strokeW = parseInt(document.getElementById('prop-stroke-width')?.value || 2);

      if (currentTool === 'rect') {
        tempShape = new fabric.Rect({
          left: pointer.x, top: pointer.y,
          width: 0, height: 0,
          fill: 'transparent',
          stroke: color, strokeWidth: strokeW,
          customType: 'rect'
        });
      } else if (currentTool === 'circle') {
        tempShape = new fabric.Ellipse({
          left: pointer.x, top: pointer.y,
          rx: 0, ry: 0,
          fill: 'transparent',
          stroke: color, strokeWidth: strokeW,
          customType: 'circle'
        });
      } else if (currentTool === 'line') {
        tempShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: color, strokeWidth: strokeW,
          customType: 'line'
        });
      } else if (currentTool === 'arrow') {
        tempShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: color, strokeWidth: strokeW,
          customType: 'arrow'
        });
      } else if (currentTool === 'highlight') {
        tempShape = new fabric.Rect({
          left: pointer.x, top: pointer.y,
          width: 0, height: 30,
          fill: 'rgba(255, 235, 59, 0.4)',
          stroke: '', strokeWidth: 0,
          customType: 'highlight'
        });
      }

      if (tempShape) {
        tempShape.selectable = false;
        tempShape.evented = false;
        fabricCanvas.add(tempShape);
      }
    }

    // Right-click context menu
    if (opt.button === 3 && opt.target) {
      showContextMenu(opt.e, opt.target);
    }
  }

  function onMouseMove(opt) {
    if (!isDrawingShape || !tempShape) return;
    const pointer = fabricCanvas.getPointer(opt.e);

    if (currentTool === 'rect' || currentTool === 'highlight') {
      const w = pointer.x - shapeStart.x;
      const h = currentTool === 'highlight' ? 30 : pointer.y - shapeStart.y;
      tempShape.set({
        left: w > 0 ? shapeStart.x : pointer.x,
        top: currentTool === 'highlight' ? shapeStart.y : (h > 0 ? shapeStart.y : pointer.y),
        width: Math.abs(w),
        height: Math.abs(h)
      });
    } else if (currentTool === 'circle') {
      tempShape.set({
        rx: Math.abs(pointer.x - shapeStart.x) / 2,
        ry: Math.abs(pointer.y - shapeStart.y) / 2,
        left: Math.min(shapeStart.x, pointer.x),
        top: Math.min(shapeStart.y, pointer.y)
      });
    } else if (currentTool === 'line' || currentTool === 'arrow') {
      tempShape.set({ x2: pointer.x, y2: pointer.y });
    }

    fabricCanvas.renderAll();
  }

  function onMouseUp() {
    if (!isDrawingShape || !tempShape) return;
    isDrawingShape = false;

    // If arrow, add arrowhead
    if (currentTool === 'arrow') {
      const line = tempShape;
      const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
      const headLen = 15;
      const headAngle = Math.PI / 6;

      const arrowHead = new fabric.Triangle({
        left: line.x2,
        top: line.y2,
        width: headLen,
        height: headLen,
        fill: line.stroke,
        angle: (angle * 180 / Math.PI) + 90,
        originX: 'center',
        originY: 'center',
        customType: 'arrowHead'
      });

      const group = new fabric.Group([line, arrowHead], {
        customType: 'arrow'
      });

      fabricCanvas.remove(line);
      fabricCanvas.add(group);
      tempShape = null;
      return;
    }

    tempShape.selectable = true;
    tempShape.evented = true;
    tempShape = null;
    fabricCanvas.renderAll();
  }

  function onDoubleClick(opt) {
    if (opt.target && opt.target.type === 'i-text') {
      opt.target.enterEditing();
    }
    // Double-click link to open edit modal
    if (opt.target && opt.target.customType === 'link') {
      const modal = document.getElementById('link-modal');
      modal.classList.remove('hidden');
      document.getElementById('link-text').value = opt.target._linkText || '';
      document.getElementById('link-url').value = opt.target._linkUrl || '';
      modal._editTarget = opt.target;
      modal._x = opt.target.left;
      modal._y = opt.target.top;
    }
  }

  function addText(x, y) {
    const font = document.getElementById('prop-font')?.value || 'Tajawal';
    const size = parseInt(document.getElementById('prop-size')?.value || 16);
    const color = document.getElementById('prop-color')?.value || '#000000';

    const text = new fabric.IText('اكتب هنا...', {
      left: x,
      top: y,
      fontFamily: font,
      fontSize: size,
      fill: color,
      direction: 'rtl',
      textAlign: 'right',
      customType: 'text',
      editable: true
    });

    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    setTool('select');
    updateToolButtons('select');
  }

  function addImage(dataUrl) {
    fabric.Image.fromURL(dataUrl, (img) => {
      const maxW = fabricCanvas.width * 0.5;
      const maxH = fabricCanvas.height * 0.5;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);

      img.set({
        left: fabricCanvas.width / 2,
        top: fabricCanvas.height / 2,
        scaleX: scale,
        scaleY: scale,
        originX: 'center',
        originY: 'center',
        customType: 'image'
      });

      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      fabricCanvas.renderAll();
      setTool('select');
      updateToolButtons('select');
    });
  }

  function addSignature(dataUrl) {
    fabric.Image.fromURL(dataUrl, (img) => {
      const maxW = fabricCanvas.width * 0.3;
      const scale = Math.min(maxW / img.width, 1);

      img.set({
        left: fabricCanvas.width / 2,
        top: fabricCanvas.height * 0.75,
        scaleX: scale,
        scaleY: scale,
        originX: 'center',
        originY: 'center',
        customType: 'signature'
      });

      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      fabricCanvas.renderAll();
      setTool('select');
      updateToolButtons('select');
    });
  }

  function addStickyNote(x, y, text, color) {
    const noteWidth = 160;
    const padding = 10;

    const bg = new fabric.Rect({
      width: noteWidth,
      height: 80,
      fill: color || '#fef08a',
      rx: 4, ry: 4,
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.15)', blur: 6, offsetX: 2, offsetY: 2 })
    });

    const noteText = new fabric.Textbox(text || 'ملاحظة', {
      width: noteWidth - padding * 2,
      fontSize: 13,
      fontFamily: 'Tajawal',
      fill: '#1a1a1a',
      left: padding,
      top: padding,
      textAlign: 'right',
      direction: 'rtl'
    });

    const group = new fabric.Group([bg, noteText], {
      left: x,
      top: y,
      customType: 'note',
      noteText: text,
      noteColor: color
    });

    fabricCanvas.add(group);
    fabricCanvas.setActiveObject(group);
    fabricCanvas.renderAll();
  }

  function showNoteModal(x, y) {
    const modal = document.getElementById('note-modal');
    modal.classList.remove('hidden');
    modal._x = x;
    modal._y = y;
    document.getElementById('note-text').value = '';
    document.getElementById('note-text').focus();
  }

  function showLinkModal(x, y) {
    const modal = document.getElementById('link-modal');
    modal.classList.remove('hidden');
    modal._x = x;
    modal._y = y;
    modal._editTarget = null;
    document.getElementById('link-text').value = 'اضغط هنا';
    document.getElementById('link-url').value = '';
    document.getElementById('link-url').focus();
  }

  function addLink(x, y, text, url, color) {
    const linkText = new fabric.IText(text || 'رابط', {
      left: x,
      top: y,
      fontFamily: 'Tajawal',
      fontSize: 16,
      fill: color || '#1d4ed8',
      underline: true,
      direction: 'rtl',
      textAlign: 'right',
      customType: 'link',
      editable: true,
      _linkText: text,
      _linkUrl: url,
      hoverCursor: 'pointer'
    });

    fabricCanvas.add(linkText);
    fabricCanvas.setActiveObject(linkText);
    fabricCanvas.renderAll();
    setTool('select');
    updateToolButtons('select');
  }

  function updateLink(target, text, url, color) {
    if (!target) return;
    target.set({
      text: text,
      fill: color || '#1d4ed8',
      _linkText: text,
      _linkUrl: url
    });
    fabricCanvas.renderAll();
  }

  function addFormElement(type, x, y, label, options, width, height) {
    x = x || fabricCanvas.width / 2 - width / 2;
    y = y || fabricCanvas.height / 2 - height / 2;
    width = width || 200;
    height = height || 36;
    const padding = 6;
    let group;

    if (type === 'text-field') {
      const border = new fabric.Rect({
        width: width, height: height,
        fill: '#ffffff', stroke: '#94a3b8', strokeWidth: 1.5,
        rx: 4, ry: 4
      });
      const placeholder = new fabric.Text(label || 'حقل نصي', {
        fontSize: 13, fontFamily: 'Tajawal', fill: '#94a3b8',
        left: padding, top: padding + 2,
        direction: 'rtl'
      });
      group = new fabric.Group([border, placeholder], {
        left: x, top: y, customType: 'form-text-field', _formType: type, _formLabel: label
      });

    } else if (type === 'checkbox') {
      const box = new fabric.Rect({
        width: 20, height: 20,
        fill: '#ffffff', stroke: '#64748b', strokeWidth: 2, rx: 3, ry: 3
      });
      const check = new fabric.Text('\u2713', {
        fontSize: 16, fontFamily: 'Arial', fill: '#3b82f6',
        left: 3, top: 0
      });
      const lbl = new fabric.Text(label || 'خانة اختيار', {
        fontSize: 14, fontFamily: 'Tajawal', fill: '#1e293b',
        left: 28, top: 2, direction: 'rtl'
      });
      group = new fabric.Group([box, check, lbl], {
        left: x, top: y, customType: 'form-checkbox', _formType: type, _formLabel: label
      });

    } else if (type === 'radio') {
      const circle = new fabric.Circle({
        radius: 10, fill: '#ffffff', stroke: '#64748b', strokeWidth: 2
      });
      const dot = new fabric.Circle({
        radius: 5, fill: '#3b82f6', left: 5, top: 5
      });
      const lbl = new fabric.Text(label || 'نقطة اختيار', {
        fontSize: 14, fontFamily: 'Tajawal', fill: '#1e293b',
        left: 28, top: 2, direction: 'rtl'
      });
      group = new fabric.Group([circle, dot, lbl], {
        left: x, top: y, customType: 'form-radio', _formType: type, _formLabel: label
      });

    } else if (type === 'dropdown') {
      const border = new fabric.Rect({
        width: width, height: height,
        fill: '#ffffff', stroke: '#94a3b8', strokeWidth: 1.5, rx: 4, ry: 4
      });
      const text = new fabric.Text(label || 'اختر...', {
        fontSize: 13, fontFamily: 'Tajawal', fill: '#1e293b',
        left: padding, top: padding + 2, direction: 'rtl'
      });
      const arrow = new fabric.Text('\u25BC', {
        fontSize: 10, fill: '#64748b',
        left: width - 18, top: padding + 4
      });
      group = new fabric.Group([border, text, arrow], {
        left: x, top: y, customType: 'form-dropdown', _formType: type, _formLabel: label, _formOptions: options
      });

    } else if (type === 'listbox') {
      const items = (options || 'خيار 1\nخيار 2\nخيار 3').split('\n');
      const itemH = 24;
      const h = Math.max(height, items.length * itemH + 4);
      const border = new fabric.Rect({
        width: width, height: h,
        fill: '#ffffff', stroke: '#94a3b8', strokeWidth: 1.5, rx: 4, ry: 4
      });
      const objs = [border];
      items.forEach((item, i) => {
        const bg = new fabric.Rect({
          width: width - 4, height: itemH - 2,
          fill: i === 0 ? '#dbeafe' : 'transparent',
          left: 2, top: 2 + i * itemH
        });
        const txt = new fabric.Text(item.trim(), {
          fontSize: 12, fontFamily: 'Tajawal', fill: '#1e293b',
          left: padding, top: 6 + i * itemH, direction: 'rtl'
        });
        objs.push(bg, txt);
      });
      group = new fabric.Group(objs, {
        left: x, top: y, customType: 'form-listbox', _formType: type, _formLabel: label, _formOptions: options
      });

    } else if (type === 'button') {
      const bg = new fabric.Rect({
        width: width, height: height,
        fill: '#3b82f6', stroke: '', strokeWidth: 0, rx: 6, ry: 6
      });
      const text = new fabric.Text(label || 'زر', {
        fontSize: 14, fontFamily: 'Tajawal', fill: '#ffffff',
        originX: 'center', originY: 'center',
        left: width / 2, top: height / 2, direction: 'rtl'
      });
      group = new fabric.Group([bg, text], {
        left: x, top: y, customType: 'form-button', _formType: type, _formLabel: label
      });
    }

    if (group) {
      fabricCanvas.add(group);
      fabricCanvas.setActiveObject(group);
      fabricCanvas.renderAll();
    }
  }

  function showContextMenu(e, target) {
    e.preventDefault();
    const menu = document.getElementById('context-menu');
    menu.classList.remove('hidden');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu._target = target;
  }

  function onSelectionChange(e) {
    const obj = e.selected?.[0];
    if (!obj) return;
    showProperties(obj);
  }

  function onSelectionClear() {
    document.getElementById('properties-panel')?.classList.add('hidden');
  }

  function showProperties(obj) {
    const panel = document.getElementById('properties-panel');
    panel.classList.remove('hidden');

    if (obj.fontFamily !== undefined) {
      document.getElementById('prop-font').value = obj.fontFamily;
    }
    if (obj.fontSize !== undefined) {
      document.getElementById('prop-size').value = obj.fontSize;
    }
    if (obj.fill && typeof obj.fill === 'string' && obj.fill !== 'transparent') {
      document.getElementById('prop-color').value = obj.fill;
    }
    if (obj.stroke) {
      document.getElementById('prop-color').value = obj.stroke;
    }
    if (obj.opacity !== undefined) {
      document.getElementById('prop-opacity').value = obj.opacity;
    }
    if (obj.strokeWidth !== undefined) {
      document.getElementById('prop-stroke-width').value = obj.strokeWidth;
    }
  }

  function updateActiveObject(prop, value) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;

    switch (prop) {
      case 'font': obj.set('fontFamily', value); break;
      case 'size': obj.set('fontSize', parseInt(value)); break;
      case 'color':
        if (obj.type === 'i-text' || obj.type === 'textbox') {
          obj.set('fill', value);
        } else {
          obj.set('stroke', value);
        }
        break;
      case 'fill':
        obj.set('fill', value);
        break;
      case 'opacity': obj.set('opacity', parseFloat(value)); break;
      case 'strokeWidth': obj.set('strokeWidth', parseInt(value)); break;
      case 'bold':
        obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold');
        break;
      case 'italic':
        obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic');
        break;
      case 'underline':
        obj.set('underline', !obj.underline);
        break;
    }

    fabricCanvas.renderAll();
  }

  function deleteSelected() {
    const active = fabricCanvas.getActiveObjects();
    if (active.length > 0) {
      active.forEach(obj => fabricCanvas.remove(obj));
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
    }
  }

  function duplicateSelected() {
    const active = fabricCanvas.getActiveObject();
    if (!active) return;

    active.clone((cloned) => {
      cloned.set({
        left: cloned.left + 20,
        top: cloned.top + 20,
        evented: true
      });
      fabricCanvas.add(cloned);
      fabricCanvas.setActiveObject(cloned);
      fabricCanvas.renderAll();
    });
  }

  function bringToFront() {
    const obj = fabricCanvas.getActiveObject();
    if (obj) { fabricCanvas.bringToFront(obj); fabricCanvas.renderAll(); }
  }

  function sendToBack() {
    const obj = fabricCanvas.getActiveObject();
    if (obj) { fabricCanvas.sendToBack(obj); fabricCanvas.renderAll(); }
  }

  function saveState() {
    const state = {
      page: currentPage,
      objects: fabricCanvas.toJSON(['customType', 'noteText', 'noteColor', '_linkText', '_linkUrl', '_formType', '_formLabel', '_formOptions'])
    };
    PDFHistory.push(state);
  }

  function restoreState(state) {
    if (state.page === currentPage) {
      fabricCanvas.loadFromJSON(state.objects, () => {
        fabricCanvas.renderAll();
      });
    }
    // Also update the stored page objects
    if (state.objects) {
      pageObjects[state.page] = state.objects;
    }
  }

  function getOverlayImage(transparent) {
    const bg = fabricCanvas.backgroundImage;
    fabricCanvas.setBackgroundImage(null, fabricCanvas.renderAll.bind(fabricCanvas));

    const dataUrl = fabricCanvas.toDataURL({
      format: 'png',
      multiplier: 1
    });

    fabricCanvas.setBackgroundImage(bg, fabricCanvas.renderAll.bind(fabricCanvas));
    return dataUrl;
  }

  function getAllPageObjects() {
    saveCurrentPageObjects();
    return pageObjects;
  }

  function setPageObjectsData(data) {
    pageObjects = data || {};
  }

  function hasObjects(pageIndex) {
    if (pageIndex === currentPage) {
      return fabricCanvas.getObjects().length > 0;
    }
    return pageObjects[pageIndex] &&
           pageObjects[pageIndex].objects &&
           pageObjects[pageIndex].objects.length > 0;
  }

  function getCanvas() { return fabricCanvas; }
  function getCurrentTool() { return currentTool; }

  // Signature Pad
  function initSignaturePad() {
    const canvas = document.getElementById('signature-pad');
    if (!canvas) return;
    signaturePadCtx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    clearSignaturePad();

    canvas.addEventListener('pointerdown', sigStart);
    canvas.addEventListener('pointermove', sigMove);
    canvas.addEventListener('pointerup', sigEnd);
    canvas.addEventListener('pointerleave', sigEnd);
  }

  function sigStart(e) {
    sigDrawing = true;
    sigPoints = [];
    const rect = e.target.getBoundingClientRect();
    sigPoints.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function sigMove(e) {
    if (!sigDrawing) return;
    const rect = e.target.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    sigPoints.push(pt);

    signaturePadCtx.beginPath();
    signaturePadCtx.strokeStyle = sigColor;
    signaturePadCtx.lineWidth = 2;
    signaturePadCtx.lineCap = 'round';
    signaturePadCtx.lineJoin = 'round';

    if (sigPoints.length >= 2) {
      const prev = sigPoints[sigPoints.length - 2];
      signaturePadCtx.moveTo(prev.x, prev.y);
      signaturePadCtx.lineTo(pt.x, pt.y);
      signaturePadCtx.stroke();
    }
  }

  function sigEnd() { sigDrawing = false; }

  function clearSignaturePad() {
    if (!signaturePadCtx) return;
    const canvas = document.getElementById('signature-pad');
    signaturePadCtx.clearRect(0, 0, canvas.width, canvas.height);
    signaturePadCtx.fillStyle = '#ffffff';
    signaturePadCtx.fillRect(0, 0, canvas.width, canvas.height);
    sigPoints = [];
  }

  function getSignatureDataUrl() {
    const canvas = document.getElementById('signature-pad');
    // Check if pad is empty
    if (sigPoints.length === 0) return null;
    return canvas.toDataURL('image/png');
  }

  function setSignatureColor(color) {
    sigColor = color;
  }

  function updateToolButtons(tool) {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    document.querySelectorAll('.fab-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  function clearPageObjects() {
    pageObjects = {};
  }

  function zoom(factor) {
    const currentZoom = fabricCanvas.getZoom();
    fabricCanvas.setZoom(currentZoom * factor);
    fabricCanvas.renderAll();
  }

  return {
    init,
    setPageBackground,
    switchPage,
    saveCurrentPageObjects,
    loadPageObjects,
    setTool,
    addText,
    addImage,
    addSignature,
    addStickyNote,
    deleteSelected,
    duplicateSelected,
    bringToFront,
    sendToBack,
    updateActiveObject,
    getOverlayImage,
    getAllPageObjects,
    setPageObjectsData,
    hasObjects,
    getCanvas,
    getCurrentTool,
    restoreState,
    initSignaturePad,
    clearSignaturePad,
    getSignatureDataUrl,
    setSignatureColor,
    updateToolButtons,
    clearPageObjects,
    zoom,
    addLink,
    updateLink,
    addFormElement,
    showLinkModal
  };
})();
