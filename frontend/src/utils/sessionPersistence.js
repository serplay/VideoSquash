const DB_NAME = 'videosquash-session';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const FILE_KEY = 'selected-video';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open session database'));
  });
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  try {
    return await callback(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
  } finally {
    db.close();
  }
}

export async function saveSessionFile(file) {
  if (!file) return;
  await withStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.put(file, FILE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to save selected file'));
  }));
}

export async function loadSessionFile() {
  return withStore('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.get(FILE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Failed to load selected file'));
  }));
}

export async function clearSessionFile() {
  try {
    await withStore('readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.delete(FILE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to clear selected file'));
    }));
  } catch (err) {
    console.warn('Unable to clear saved file:', err);
  }
}
