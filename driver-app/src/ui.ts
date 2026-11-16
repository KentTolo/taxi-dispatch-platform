import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

// ---------- icons (24px, 2px stroke, rounded) ----------

const svg = (body: string, size = 24) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icon = {
  back: (s?: number) => svg('<path d="M15 18l-6-6 6-6"/>', s),
  chevron: (s?: number) => svg('<path d="M9 18l6-6-6-6"/>', s),
  close: (s?: number) => svg('<path d="M18 6L6 18M6 6l12 12"/>', s),
  locate: (s?: number) => svg('<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/>', s),
  car: (s?: number) =>
    svg('<path d="M5 17h14M6 17v2M18 17v2M4 13l2-6a2 2 0 0 1 2-1.4h8A2 2 0 0 1 18 7l2 6v4H4z"/><circle cx="8" cy="13.5" r=".8" fill="currentColor"/><circle cx="16" cy="13.5" r=".8" fill="currentColor"/>', s),
  gps: (s?: number) => svg('<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', s),
  signal: (s?: number) => svg('<path d="M5 18v-2M9.5 18v-5M14 18V9M18.5 18V5"/>', s),
  battery: (s?: number) => svg('<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 11v2"/>', s),
  pause: (s?: number) => svg('<path d="M9 6v12M15 6v12"/>', s),
  play: (s?: number) => svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>', s),
  power: (s?: number) => svg('<path d="M12 3v8"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>', s),
  user: (s?: number) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', s),
  settings: (s?: number) =>
    svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', s),
  logout: (s?: number) => svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', s),
  shield: (s?: number) => svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>', s),
  phone: (s?: number) => svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>', s),
  check: (s?: number) => svg('<path d="M20 6L9 17l-5-5"/>', s),
  alert: (s?: number) => svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', s),
};

// ---------- haptics ----------

export const haptic = {
  tap() {
    if (Capacitor.isNativePlatform()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  },
  heavy() {
    if (Capacitor.isNativePlatform()) Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    else navigator.vibrate?.(20);
  },
  success() {
    if (Capacitor.isNativePlatform()) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    else navigator.vibrate?.([12, 60, 12]);
  },
  error() {
    if (Capacitor.isNativePlatform()) Haptics.notification({ type: NotificationType.Error }).catch(() => {});
    else navigator.vibrate?.([30, 50, 30]);
  },
};

// ---------- toast ----------

let toastTimer: number | undefined;

export function toast(message: string, kind: "info" | "error" | "success" = "info") {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  const ic = kind === "error" ? icon.alert(18) : kind === "success" ? icon.check(18) : "";
  el.className = `toast ${kind}`;
  el.innerHTML = `${ic}<span>${esc(message)}</span>`;
  requestAnimationFrame(() => el!.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), kind === "error" ? 4200 : 2600);
  if (kind === "error") haptic.error();
}

// ---------- modal sheet ----------

export interface SheetOptions {
  title?: string;
  body: string;
  onMount?: (sheet: HTMLElement, close: () => void) => void;
}

export function openSheet({ title, body, onMount }: SheetOptions): () => void {
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.innerHTML = `
    <div class="modal-scrim" data-close></div>
    <section class="modal-sheet" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ""}>
      <div class="grabber"></div>
      ${title ? `<header class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon.close(20)}</button></header>` : ""}
      <div class="modal-body">${body}</div>
    </section>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  const close = () => {
    wrap.classList.remove("open");
    setTimeout(() => wrap.remove(), 320);
  };
  wrap.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", close));
  onMount?.(wrap.querySelector(".modal-sheet")!, close);
  return close;
}

// ---------- press-and-hold confirm ----------

/** Fires `onDone` only after the button is held for `ms`. Prevents accidental taps. */
export function holdToConfirm(btn: HTMLElement, onDone: () => void, ms = 1100) {
  let start = 0;
  let raf = 0;
  const reset = () => {
    cancelAnimationFrame(raf);
    btn.style.setProperty("--p", "0");
    btn.classList.remove("holding");
  };
  const tick = () => {
    const p = Math.min(1, (performance.now() - start) / ms);
    btn.style.setProperty("--p", String(p));
    if (p >= 1) {
      reset();
      haptic.heavy();
      onDone();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    start = performance.now();
    btn.classList.add("holding");
    haptic.tap();
    raf = requestAnimationFrame(tick);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, reset));
  // Keyboard users: Enter/Space confirms directly.
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onDone();
    }
  });
}

// ---------- formatting ----------

export function duration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}

export function km(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function agoShort(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

/** "+26658000001" -> "+266 5800 0001" */
export function prettyPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  const local = d.startsWith("266") ? d.slice(3) : d;
  return `+266 ${local.slice(0, 4)} ${local.slice(4)}`.trim();
}
