// Small typed wrapper around localStorage. The Android WebView keeps it across restarts.

export interface Session {
  server: string; // e.g. https://demo.example.com
  company: string; // company code, e.g. "demo"
  token?: string;
  driverName?: string;
  companyName?: string;
  officePhone?: string | null;
}

const KEY = "driver.session";

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearToken(): void {
  const s = loadSession();
  if (s) {
    delete s.token;
    saveSession(s);
  }
}
