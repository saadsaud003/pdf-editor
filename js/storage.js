/**
 * PDFStorage - IndexedDB storage for auto-save and project recovery
 */
const PDFStorage = (() => {
  const DB_NAME = 'pdf-editor-db';
  const DB_VERSION = 1;
  const STORES = {
    projects: 'projects',
    files: 'files'
  };

  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORES.projects)) {
          const store = d.createObjectStore(STORES.projects, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!d.objectStoreNames.contains(STORES.files)) {
          d.createObjectStore(STORES.files, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveProject(project) {
    await open();
    project.updatedAt = Date.now();
    return promisify(tx(STORES.projects, 'readwrite').put(project));
  }

  async function getProject(id) {
    await open();
    return promisify(tx(STORES.projects, 'readonly').get(id));
  }

  async function getAllProjects() {
    await open();
    return promisify(tx(STORES.projects, 'readonly').getAll());
  }

  async function deleteProject(id) {
    await open();
    const store = tx(STORES.projects, 'readwrite');
    store.delete(id);
    // Also delete the file
    const fileStore = db.transaction(STORES.files, 'readwrite').objectStore(STORES.files);
    fileStore.delete(id);
    return true;
  }

  async function saveFile(id, arrayBuffer) {
    await open();
    return promisify(tx(STORES.files, 'readwrite').put({ id, data: arrayBuffer }));
  }

  async function getFile(id) {
    await open();
    const result = await promisify(tx(STORES.files, 'readonly').get(id));
    return result ? result.data : null;
  }

  async function getRecentProjects(limit = 10) {
    await open();
    const all = await promisify(tx(STORES.projects, 'readonly').getAll());
    return all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  // Generate a unique project ID
  function generateId() {
    return 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  return {
    open,
    saveProject,
    getProject,
    getAllProjects,
    deleteProject,
    saveFile,
    getFile,
    getRecentProjects,
    generateId
  };
})();
