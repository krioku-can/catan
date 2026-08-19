// Safe localStorage wrapper — never throws (private browsing / storage blocked),
// and falls back to an in-memory store so the name still works for the session.

const memoryStore: Record<string, string> = {};

function storageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const k = "__catan_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function getStored(key: string): string | null {
  if (storageAvailable()) {
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
  if (storageAvailable()) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // memoryStore already has it
    }
  }
}

export function removeStored(key: string): void {
  delete memoryStore[key];
  if (storageAvailable()) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
