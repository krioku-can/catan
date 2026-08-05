// Safe localStorage wrapper — never throws (private browsing / storage blocked),
// and falls back to an in-memory store so the name still works for the session.

const memoryStore: Record<string, string> = {};

function storageAvailable(): boolean {
  try {
    const k = '__catan_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const canStore = storageAvailable();

export function getStored(key: string): string | null {
  if (canStore) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryStore[key] ?? null;
    }
  }
  return memoryStore[key] ?? null;
}

export function setStored(key: string, value: string): void {
  memoryStore[key] = value;
  if (canStore) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // memoryStore already has it
    }
  }
}
