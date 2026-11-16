import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { api, ApiError } from "./api";
import { clearToken, loadSession, saveSession, type Session } from "./store";
import { tracker, type TrackerState } from "./tracker";
import "./style.css";

interface Me {
  id: number;
  name: string;
  status: "offline" | "available" | "on_break";
  shift: null | { id: number; started_at: string; vehicle: null | { id: number; plate: string }; points: number };
}
interface Vehicle {
  id: number;
  plate: string;
  label: string;
}

// In the Android app the default comes from the build; opened in a browser, use the site it came from.
const DEMO_SERVER = "https://taxi-platform-demo.onrender.com";
const DEFAULT_SERVER =
  import.meta.env.VITE_DEFAULT_SERVER || (Capacitor.isNativePlatform() ? DEMO_SERVER : window.location.origin);
const root = document.getElementById("app")!;

let me: Me | null = null;
let vehicles: Vehicle[] = [];
let pendingPhone = "";
let demoCode = "";
let notice = "";
let lastSummary: null | { hours: number; points: number } = null;
let busy = false;

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function ago(ms: number | null | undefined): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

// ---------- screens ----------

function render() {
  const s = loadSession();
  if (!s?.server || !s.company) return renderSetup(s);
  if (!s.token) return renderLogin(s);
  renderHome(s, tracker.state);
}

function renderSetup(s: Session | null) {
  root.innerHTML = `
    <main class="screen">
      <h1>Driver setup</h1>
      <p class="muted">Your office gives you these two details once.</p>
      <form id="setup" class="stack">
        <label>Server address<input name="server" type="url" inputmode="url" required
          placeholder="https://..." value="${esc(s?.server || DEFAULT_SERVER)}"></label>
        <label>Company code<input name="company" required autocapitalize="none" value="${esc(s?.company || "")}"></label>
        ${notice ? `<p class="error">${esc(notice)}</p>` : ""}
        <button class="primary">Continue</button>
      </form>
    </main>`;
  form("setup", (f) => {
    saveSession({ server: f.server.trim(), company: f.company.trim().toLowerCase() });
    notice = "";
    render();
  });
}

function renderLogin(s: Session) {
  const step = pendingPhone ? "code" : "phone";
  root.innerHTML = `
    <main class="screen">
      <h1>Driver login</h1>
      <p class="muted">Company: <b>${esc(s.company)}</b> · <a href="#" id="change">change</a></p>
      ${
        step === "phone"
          ? `<form id="phone" class="stack">
               <label>Mobile number<input name="phone" type="tel" inputmode="tel" required placeholder="5800 0000" autocomplete="tel"></label>
               ${notice ? `<p class="error">${esc(notice)}</p>` : ""}
               <button class="primary" ${busy ? "disabled" : ""}>Send me a code</button>
             </form>`
          : `<form id="code" class="stack">
               <p>We sent a 6-digit code to <b>${esc(pendingPhone)}</b>.</p>
               ${demoCode ? `<p class="demo">Demo mode: your code is <b>${esc(demoCode)}</b></p>` : ""}
               <label>Code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
               ${notice ? `<p class="error">${esc(notice)}</p>` : ""}
               <button class="primary" ${busy ? "disabled" : ""}>Log in</button>
               <button type="button" class="link" id="back">Use a different number</button>
             </form>`
      }
    </main>`;
  on("change", () => {
    saveSession({ server: s.server, company: "" });
    render();
  });
  on("back", () => {
    pendingPhone = "";
    demoCode = "";
    notice = "";
    render();
  });
  form("phone", async (f) => {
    await run(async () => {
      const r = await api<{ sent_to: string; demo_code?: string }>("/api/auth/driver/request-code", {
        company: s.company,
        phone: f.phone,
      });
      pendingPhone = r.sent_to;
      demoCode = r.demo_code || "";
    });
  });
  form("code", async (f) => {
    await run(async () => {
      const r = await api<any>("/api/auth/driver/verify", { company: s.company, phone: pendingPhone, code: f.code });
      saveSession({
        ...s,
        token: r.token,
        driverName: r.driver.name,
        companyName: r.company.name,
        officePhone: r.company.office_phone,
      });
      pendingPhone = "";
      demoCode = "";
      await loadMe();
    });
  });
}

function renderHome(s: Session, t: TrackerState) {
  const onShift = !!me?.shift;
  const status = me?.status ?? "offline";
  const label = { offline: "Off shift", available: "Available for rides", on_break: "On break" }[status];
  const gpsOk = t.lastFix && Date.now() - t.lastFix.time < 90_000;

  root.innerHTML = `
    <header class="bar">
      <div><b>${esc(s.companyName || s.company)}</b><br><span class="muted">${esc(s.driverName || "")}</span></div>
      <button class="link" id="logout">Log out</button>
    </header>
    <main class="screen">
      <section class="status ${status}">
        <div class="big">${label}</div>
        ${onShift ? `<div>Shift started ${esc(new Date(me!.shift!.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}${me!.shift!.vehicle ? " · " + esc(me!.shift!.vehicle.plate) : ""}</div>` : ""}
      </section>

      ${notice ? `<p class="error">${esc(notice)}</p>` : ""}
      ${t.error ? `<p class="warn">${esc(t.error)}</p>` : ""}

      ${
        onShift
          ? `<div class="row">
               ${status === "available"
                 ? `<button class="secondary" id="break" ${busy ? "disabled" : ""}>Take a break</button>`
                 : `<button class="primary" id="avail" ${busy ? "disabled" : ""}>Back to available</button>`}
               <button class="danger" id="end" ${busy ? "disabled" : ""}>End shift</button>
             </div>
             <section class="card">
               <div class="line"><span class="dot ${gpsOk ? "ok" : "bad"}"></span>
                 GPS: ${t.lastFix ? `${esc(ago(t.lastFix.time))} · ±${Math.round(t.lastFix.accuracy ?? 0)} m` : "waiting for a fix…"}</div>
               <div class="line"><span class="dot ${t.queued < 5 ? "ok" : "bad"}"></span>
                 Sent to office: ${esc(ago(t.lastUploadAt))}${t.queued ? ` · ${t.queued} waiting` : ""}</div>
             </section>
             <details class="card tips">
               <summary>Keep tracking working</summary>
               <ul>
                 <li>Leave the "On shift" notification in place. Swiping the app away is fine.</li>
                 <li>Allow location <b>"All the time"</b> or <b>"While using the app"</b>.</li>
                 <li>Set this app's battery use to <b>Unrestricted</b> (Settings › Apps › Driver › Battery).</li>
                 <li>Keep the phone charging in the car where you can.</li>
               </ul>
               ${Capacitor.isNativePlatform() ? `<button class="secondary" id="settings">Fix permissions</button>` : ""}
             </details>`
          : `<form id="start" class="stack">
               ${lastSummary ? `<p class="card">Last shift: ${lastSummary.hours} h · ${lastSummary.points} positions sent.</p>` : ""}
               <label>Vehicle today
                 <select name="vehicle_id">
                   <option value="">Choose…</option>
                   ${vehicles.map((v) => `<option value="${v.id}">${esc(v.plate)}${v.label ? " — " + esc(v.label) : ""}</option>`).join("")}
                 </select>
               </label>
               <button class="primary big-btn" ${busy ? "disabled" : ""}>Start shift</button>
               <p class="muted">Starting a shift shares your location with the office until you end it.</p>
             </form>`
      }
    </main>`;

  on("logout", async () => {
    if (onShift && !confirm("You're on shift. End the shift and log out?")) return;
    if (onShift) await api("/api/driver/shift/end", {}).catch(() => {});
    await tracker.stop();
    tracker.clearQueue();
    clearToken();
    me = null;
    render();
  });
  on("break", () => run(() => setStatus("on_break")));
  on("avail", () => run(() => setStatus("available")));
  on("settings", () => tracker.openSettings());
  on("end", async () => {
    if (!confirm("End your shift? You'll stop getting rides.")) return;
    await run(async () => {
      await tracker.flush();
      const r = await api<{ summary: { hours: number; points: number } | null; driver: Me }>("/api/driver/shift/end", {});
      await tracker.stop();
      tracker.clearQueue();
      lastSummary = r.summary;
      me = r.driver;
    });
  });
  form("start", async (f) => {
    await run(async () => {
      me = await api<Me>("/api/driver/shift/start", { vehicle_id: f.vehicle_id ? Number(f.vehicle_id) : null });
      lastSummary = null;
      await tracker.start();
    });
  });
}

// ---------- actions ----------

async function setStatus(status: "available" | "on_break") {
  me = await api<Me>("/api/driver/status", { status });
}

async function loadMe() {
  try {
    me = await api<Me>("/api/driver/me");
    if (!me.shift) vehicles = await api<Vehicle[]>("/api/driver/vehicles");
    if (me.shift && !tracker.state.running) await tracker.start();
    if (!me.shift && tracker.state.running) await tracker.stop();
    notice = "";
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) clearToken();
    else notice = err.message;
  }
  render();
}

async function run(fn: () => Promise<void>) {
  busy = true;
  notice = "";
  render();
  try {
    await fn();
  } catch (e) {
    notice = (e as Error).message;
  } finally {
    busy = false;
    render();
  }
}

// ---------- tiny DOM helpers ----------

function on(id: string, fn: () => void) {
  const el = document.getElementById(id);
  if (el)
    el.addEventListener("click", (e) => {
      e.preventDefault();
      fn();
    });
}

function form(id: string, fn: (values: Record<string, string>) => void | Promise<void>) {
  const el = document.getElementById(id) as HTMLFormElement | null;
  if (!el) return;
  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(el).entries()) as Record<string, string>;
    fn(values);
  });
}

// ---------- start up ----------

tracker.onStopped = (reason) => {
  if (reason === "logged_out") clearToken();
  if (reason === "no_shift") notice = "Your shift was ended by the office.";
  loadMe();
};

// Re-render on tracker updates, but not while the driver is typing in a form.
tracker.subscribe(() => {
  if (!document.activeElement || !["INPUT", "SELECT"].includes(document.activeElement.tagName)) render();
});

App.addListener("resume", () => {
  if (loadSession()?.token) loadMe();
  tracker.flush();
});

// Refresh the "x seconds ago" labels while the screen is visible.
setInterval(() => {
  if (document.visibilityState === "visible" && me?.shift) render();
}, 5000);

render();
if (loadSession()?.token) loadMe();
