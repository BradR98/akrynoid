export function loadState(storage, key) {
  try { return storage && key ? JSON.parse(storage.getItem(key)) : null; } catch (_) { return null; }
}

export function saveState(storage, key, data) {
  try { if (storage && key) storage.setItem(key, JSON.stringify(data)); } catch (_) {}
}

export function clearState(storage, key) {
  try { if (storage && key) storage.removeItem(key); } catch (_) {}
}
