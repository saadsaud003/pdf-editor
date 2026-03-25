/**
 * PDFHistory - Undo/Redo manager
 */
const PDFHistory = (() => {
  const MAX_STATES = 50;
  let undoStack = [];
  let redoStack = [];
  let onChange = null;
  let pauseRecording = false;

  function setCallback(fn) {
    onChange = fn;
  }

  function push(state) {
    if (pauseRecording) return;
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > MAX_STATES) {
      undoStack.shift();
    }
    redoStack = [];
    updateUI();
  }

  function undo() {
    if (undoStack.length === 0) return null;
    const current = undoStack.pop();
    redoStack.push(current);

    const prev = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
    updateUI();
    if (prev && onChange) {
      pauseRecording = true;
      onChange(JSON.parse(prev));
      pauseRecording = false;
    }
    return prev ? JSON.parse(prev) : null;
  }

  function redo() {
    if (redoStack.length === 0) return null;
    const state = redoStack.pop();
    undoStack.push(state);
    updateUI();
    if (onChange) {
      pauseRecording = true;
      onChange(JSON.parse(state));
      pauseRecording = false;
    }
    return JSON.parse(state);
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  function clear() {
    undoStack = [];
    redoStack = [];
    updateUI();
  }

  function updateUI() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = !canUndo();
    if (redoBtn) redoBtn.disabled = !canRedo();
  }

  function pause() { pauseRecording = true; }
  function resume() { pauseRecording = false; }

  return {
    setCallback,
    push,
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
    pause,
    resume
  };
})();
