import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { loadSession } from "./store";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * JSON request to the platform server.
 * On the phone this uses native HTTP, because Android throttles WebView requests
 * after a few minutes in the background, which would stop location uploads.
 */
export async function api<T = any>(path: string, body?: unknown, method?: "GET" | "POST"): Promise<T> {
  const s = loadSession();
  if (!s?.server) throw new ApiError(0, "Server address not set");
  const url = s.server.replace(/\/+$/, "") + path;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (s.token) headers.Authorization = "Bearer " + s.token;
  const verb = method ?? (body === undefined ? "GET" : "POST");

  let status: number;
  let data: any;
  try {
    if (Capacitor.isNativePlatform()) {
      const r = await CapacitorHttp.request({
        url,
        method: verb,
        headers,
        data: body,
        connectTimeout: 15000,
        readTimeout: 15000,
      });
      status = r.status;
      data = typeof r.data === "string" ? safeJson(r.data) : r.data;
    } else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, {
        method: verb,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      status = r.status;
      data = safeJson(await r.text());
    }
  } catch {
    throw new ApiError(0, "No connection to the server");
  }
  if (status >= 400) {
    const detail = data?.detail;
    const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : `Error ${status}`;
    throw new ApiError(status, msg || `Error ${status}`);
  }
  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
