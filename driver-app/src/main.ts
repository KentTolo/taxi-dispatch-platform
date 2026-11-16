import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { StatusBar, Style } from "@capacitor/status-bar";
import { api, ApiError } from "./api";
import { DriverMap } from "./map";
import { clearToken, loadSession, saveSession } from "./store";
import { tracker, type TrackerState } from "./tracker";
import { $, agoShort, duration, esc, haptic, holdToConfirm, icon, km, openSheet, prettyPhone, toast } from "./ui";
import "./style.css";

// ---------- types & state ----------

type Status = "offline" | "available" | "on_break";
interface Me {
  id: number;
  name: string;
  phone: string;
  status: Status;
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
const VEHICLE_KEY = "driver.vehicle";
const SCREENS = ["company", "phone", "code", "home"];

const root = document.getElementById("app")!;
let screen = "";
let me: Me | null = null;
let vehicles: Vehicle[] = [];
let vehicleId: number | null = Number(localStorage.getItem(VEHICLE_KEY)) || null;
let pendingPhone = "";
let demoCode = "";
let battery: number | null = null;
let map: DriverMap | null = null;
let busy = false;
let sheetMode = "";

const initials = (name?: string) =>
  (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// ---------- router ----------

function route() {
  const s = loadSession();
  if (!s?.company) return show("company", renderCompany);
  if (!s.token) return pendingPhone ? show("code", renderCode) : show("phone", renderPhone);
  show("home", renderHome);
}

/** Builds a screen only when it changes, with a short slide-in. Later updates happen in place. */
function show(name: string, build: () => void) {
  if (screen === name) return;
  const forward = SCREENS.indexOf(name) >= SCREENS.indexOf(screen);
  screen = name;
  sheetMode = "";
  if (name !== "home" && map) {
    map.destroy();
    map = null;
  }
  root.className = `screen-${name} ${forward ? "enter-fwd" : "enter-back"}`;
  build();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("entered")));
}

// ---------- sign-in: company ----------

function renderCompany() {
  const s = loadSession();
  root.innerHTML = `
    <main class="auth">
      <div class="auth-body">
        <div class="brand-mark">${icon.car(30)}</div>
        <h1>Ready to drive?</h1>
        <p class="lede">Enter the company code your office gave you. You only do this once.</p>
        <label class="field">
          <span class="field-label">Company code</span>
          <input id="company" autocomplete="organization" autocapitalize="none" spellcheck="false"
                 placeholder="e.g. demo" value="${esc(s?.company || "")}">
        </label>
        <details class="advanced">
          <summary>Server address</summary>
          <input id="server" type="url" inputmode="url" spellcheck="false" aria-label="Server address" value="${esc(s?.server || DEFAULT_SERVER)}">
        </details>
      </div>
      <footer class="auth-foot">
        <button id="next" class="btn primary block" disabled>Continue</button>
      </footer>
    </main>`;
  const input = $<HTMLInputElement>("#company")!;
  const next = $<HTMLButtonElement>("#next")!;
  const sync = () => (next.disabled = input.value.trim().length < 2);
  input.addEventListener("input", sync);
  sync();
  setTimeout(() => input.focus(), 350);
  const go = () => {
    if (next.disabled) return;
    haptic.tap();
    saveSession({
      server: ($<HTMLInputElement>("#server")!.value || DEFAULT_SERVER).trim(),
      company: input.value.trim().toLowerCase(),
    });
    route();
  };
  next.onclick = go;
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
}

// ---------- sign-in: phone ----------

function renderPhone() {
  const s = loadSession()!;
  root.innerHTML = `
    <main class="auth">
      <header class="nav"><button class="icon-btn" id="back" aria-label="Back">${icon.back()}</button></header>
      <div class="auth-body">
        <h1>What's your number?</h1>
        <p class="lede">We'll text you a code to sign in to <b>${esc(s.company)}</b>.</p>
        <div class="phone-field">
          <span class="cc">🇱🇸 +266</span>
          <input id="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="5800 0000" maxlength="9" aria-label="Mobile number">
        </div>
      </div>
      <footer class="auth-foot">
        <button id="send" class="btn primary block" disabled>Send code</button>
      </footer>
    </main>`;
  const input = $<HTMLInputElement>("#phone")!;
  const send = $<HTMLButtonElement>("#send")!;
  const digits = () => input.value.replace(/\D/g, "");
  input.addEventListener("input", () => {
    const d = digits().slice(0, 8);
    input.value = d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
    send.disabled = d.length !== 8;
  });
  setTimeout(() => input.focus(), 350);
  $("#back")!.onclick = () => {
    saveSession({ server: s.server, company: "" });
    route();
  };
  const go = async () => {
    if (send.disabled || busy) return;
    await withBusy(send, async () => {
      const r = await api<{ sent_to: string; demo_code?: string }>("/api/auth/driver/request-code", {
        company: s.company,
        phone: digits(),
      });
      pendingPhone = r.sent_to;
      demoCode = r.demo_code || "";
      haptic.success();
      route();
    });
  };
  send.onclick = go;
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
}

// ---------- sign-in: code ----------

function renderCode() {
  const s = loadSession()!;
  root.innerHTML = `
    <main class="auth">
      <header class="nav"><button class="icon-btn" id="back" aria-label="Back">${icon.back()}</button></header>
      <div class="auth-body">
        <h1>Enter the code</h1>
        <p class="lede">Sent by SMS to <b>${esc(prettyPhone(pendingPhone))}</b>.</p>
        <div class="otp" id="otp">
          <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="6-digit code">
          ${Array.from({ length: 6 }, () => `<span class="otp-box"></span>`).join("")}
        </div>
        ${demoCode ? `<button class="demo-pill" id="demo">Demo code <b>${esc(demoCode)}</b> · tap to fill</button>` : ""}
        <button class="link-btn" id="resend" disabled>Resend code in <span id="count">30</span>s</button>
      </div>
    </main>`;
  const input = $<HTMLInputElement>("#code")!;
  const boxes = [...root.querySelectorAll<HTMLElement>(".otp-box")];
  const paint = () => {
    const v = input.value;
    boxes.forEach((b, i) => {
      b.textContent = v[i] ?? "";
      b.classList.toggle("filled", i < v.length);
      b.classList.toggle("caret", i === Math.min(v.length, 5) && document.activeElement === input);
    });
  };
  const submit = async () => {
    if (busy) return;
    busy = true;
    $("#otp")!.classList.add("checking");
    try {
      const r = await api<any>("/api/auth/driver/verify", { company: s.company, phone: pendingPhone, code: input.value });
      saveSession({
        ...s,
        token: r.token,
        driverName: r.driver.name,
        companyName: r.company.name,
        officePhone: r.company.office_phone,
      });
      pendingPhone = "";
      demoCode = "";
      haptic.success();
      route();
      loadMe();
    } catch (e) {
      const otp = $("#otp");
      otp?.classList.add("shake");
      setTimeout(() => otp?.classList.remove("shake"), 450);
      input.value = "";
      paint();
      toast((e as Error).message, "error");
    } finally {
      busy = false;
      $("#otp")?.classList.remove("checking");
    }
  };
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
    paint();
    if (input.value.length === 6) submit();
  });
  input.addEventListener("focus", paint);
  input.addEventListener("blur", paint);
  $("#otp")!.onclick = () => input.focus();
  $("#demo")?.addEventListener("click", () => {
    haptic.tap();
    input.value = demoCode;
    paint();
    submit();
  });
  $("#back")!.onclick = () => {
    pendingPhone = "";
    route();
  };

  let n = 30;
  const t = setInterval(() => {
    const c = $("#count");
    if (!c || screen !== "code") return clearInterval(t);
    n--;
    c.textContent = String(n);
    if (n > 0) return;
    clearInterval(t);
    const btn = $<HTMLButtonElement>("#resend")!;
    btn.disabled = false;
    btn.textContent = "Resend code";
    btn.onclick = async () => {
      try {
        const r = await api<{ demo_code?: string }>("/api/auth/driver/request-code", { company: s.company, phone: pendingPhone });
        demoCode = r.demo_code || "";
        toast("New code sent", "success");
        screen = "";
        route();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    };
  }, 1000);
  paint();
  setTimeout(() => input.focus(), 350);
}

// ---------- home ----------

function renderHome() {
  const s = loadSession()!;
  root.innerHTML = `
    <div id="map" class="map"></div>
    <header class="topbar">
      <button class="avatar" id="menu" aria-label="Account and settings">${esc(initials(s.driverName))}</button>
      <div class="status-pill" id="pill"><span class="dot"></span><span id="pill-text">Offline</span></div>
      <button class="health-pill idle" id="health" aria-label="Tracking status">${icon.signal(18)}</button>
    </header>
    <button class="fab" id="recenter" aria-label="Centre on my location">${icon.locate(22)}</button>
    <section class="sheet" id="sheet" aria-live="polite"></section>`;

  map = new DriverMap($("#map")!);
  map.onFollowChange = (following) => $("#recenter")?.classList.toggle("visible", !following);
  $("#recenter")!.onclick = () => {
    haptic.tap();
    map?.recenter();
  };
  $("#menu")!.onclick = openAccount;
  $("#health")!.onclick = openHealth;

  // Keep the map's visible area above the sheet as the sheet changes height.
  new ResizeObserver(([e]) => {
    root.style.setProperty("--sheet-h", `${Math.round(e.contentRect.height)}px`);
    map?.setBottomInset(e.contentRect.height);
  }).observe($("#sheet")!);

  // Show where the driver is even before going online (foreground only).
  if (!tracker.state.lastFix && "geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => map?.setPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy, null, false),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  renderSheet();
}

function renderSheet() {
  const sheet = $("#sheet");
  if (!sheet) return;
  const mode = !me ? "loading" : !me.shift ? "offline" : me.status === "on_break" ? "break" : "online";
  if (mode === sheetMode) return updateHome(tracker.state);
  sheetMode = mode;
  sheet.className = `sheet mode-${mode}`;

  if (mode === "loading") {
    sheet.innerHTML = `<div class="grabber"></div><div class="skeleton"></div><div class="skeleton short"></div>`;
  } else if (mode === "offline") {
    const v = vehicles.find((x) => x.id === vehicleId) ?? null;
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="go-wrap"><button class="go-btn" id="go" aria-label="Go online"><span>GO</span></button></div>
      <h2 class="sheet-title center">You're offline</h2>
      <p class="sheet-sub center">Go online to share your location and start receiving rides.</p>
      <button class="row-btn" id="vehicle">
        <span class="row-icon">${icon.car(22)}</span>
        <span class="row-text"><span class="row-label">Vehicle</span>
          <span class="row-value">${v ? `${esc(v.plate)}${v.label ? ` · ${esc(v.label)}` : ""}` : "Choose your car for today"}</span></span>
        <span class="row-chev">${icon.chevron(20)}</span>
      </button>`;
    $("#vehicle")!.onclick = pickVehicle;
    $("#go")!.onclick = goOnline;
  } else {
    const onBreak = mode === "break";
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head">
        <div>
          <h2 class="sheet-title">${onBreak ? "You're on a break" : "You're online"}</h2>
          <p class="sheet-sub">${onBreak ? "No rides will be sent to you." : "Looking for ride requests nearby"}</p>
        </div>
        ${me!.shift!.vehicle ? `<span class="plate">${esc(me!.shift!.vehicle.plate)}</span>` : ""}
      </div>
      ${onBreak ? "" : `<div class="searching" aria-hidden="true"><span></span></div>`}
      <div class="stats">
        <div class="stat"><span class="stat-value" id="st-time">—</span><span class="stat-label">Online</span></div>
        <div class="stat"><span class="stat-value" id="st-dist">—</span><span class="stat-label">Driven</span></div>
        <div class="stat"><span class="stat-value" id="st-sent">—</span><span class="stat-label">Last update</span></div>
      </div>
      <div class="actions">
        <button class="btn ${onBreak ? "primary" : "secondary"}" id="break">
          ${onBreak ? `${icon.play(18)}<span>I'm back</span>` : `${icon.pause(18)}<span>Take a break</span>`}
        </button>
        <button class="btn hold" id="offline" aria-label="Hold to go offline">
          <span class="hold-fill"></span><span class="hold-label">${icon.power(18)}<span>Hold to go offline</span></span>
        </button>
      </div>`;
    $("#break")!.onclick = () => setStatus(onBreak ? "available" : "on_break");
    holdToConfirm($("#offline")!, goOffline);
  }
  updateHome(tracker.state);
}

/** Cheap in-place updates; runs on every GPS fix and every few seconds. */
function updateHome(t: TrackerState) {
  if (screen !== "home") return;
  const status: Status = me?.shift ? me.status : "offline";
  const pill = $("#pill");
  if (pill) {
    pill.className = `status-pill ${status}`;
    $("#pill-text")!.textContent = status === "available" ? "Online" : status === "on_break" ? "On break" : "Offline";
  }

  const gpsOk = !!t.lastFix && Date.now() - t.lastFix.time < 90_000;
  const linkOk = t.queued < 5 && !!t.lastUploadAt && Date.now() - t.lastUploadAt < 90_000;
  const health = $("#health");
  if (health) {
    const level = !me?.shift ? "idle" : gpsOk && linkOk ? "good" : gpsOk || linkOk ? "warn" : "bad";
    health.className = `health-pill ${level}`;
    health.setAttribute("aria-label", `Tracking status: ${level}`);
  }

  if (t.lastFix) map?.setPosition(t.lastFix.lat, t.lastFix.lng, t.lastFix.accuracy, t.lastFix.heading, !!me?.shift);

  if (me?.shift) {
    const set = (id: string, v: string) => {
      const el = $(id);
      if (el && el.textContent !== v) el.textContent = v;
    };
    set("#st-time", duration(Date.now() - Date.parse(me.shift.started_at)));
    set("#st-dist", km(t.distanceM));
    set("#st-sent", t.queued > 5 ? `${t.queued} queued` : agoShort(t.lastUploadAt));
  }
}

// ---------- actions ----------

async function goOnline() {
  if (busy) return;
  if (!vehicleId && vehicles.length) {
    toast("Choose your vehicle first");
    return pickVehicle();
  }
  const btn = $("#go")!;
  haptic.heavy();
  await withBusy(btn, async () => {
    me = await api<Me>("/api/driver/shift/start", { vehicle_id: vehicleId });
    tracker.resetDistance();
    await tracker.start();
    haptic.success();
    renderSheet();
  });
}

async function goOffline() {
  if (busy) return;
  busy = true;
  try {
    await tracker.flush();
    const r = await api<{ summary: { hours: number } | null; driver: Me }>("/api/driver/shift/end", {});
    const dist = tracker.state.distanceM;
    await tracker.stop();
    tracker.clearQueue();
    me = r.driver;
    renderSheet();
    if (r.summary) showSummary(r.summary.hours, dist);
  } catch (e) {
    toast((e as Error).message, "error");
  } finally {
    busy = false;
  }
}

async function setStatus(status: "available" | "on_break") {
  haptic.tap();
  try {
    me = await api<Me>("/api/driver/status", { status });
    renderSheet();
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

function showSummary(hours: number, distanceM: number) {
  haptic.success();
  openSheet({
    body: `
      <div class="summary">
        <div class="summary-check">${icon.check(30)}</div>
        <h2>Shift complete</h2>
        <p class="sheet-sub">Nice work. Here's your shift.</p>
        <div class="stats big">
          <div class="stat"><span class="stat-value">${duration(hours * 3_600_000)}</span><span class="stat-label">Online</span></div>
          <div class="stat"><span class="stat-value">${km(distanceM)}</span><span class="stat-label">Driven</span></div>
        </div>
        <button class="btn primary block" data-close>Done</button>
      </div>`,
    onMount(sheet, close) {
      sheet.querySelector(".summary [data-close]")!.addEventListener("click", close);
    },
  });
}

function pickVehicle() {
  haptic.tap();
  openSheet({
    title: "Your vehicle today",
    body: vehicles.length
      ? `<div class="list">${vehicles
          .map(
            (v) => `<button class="list-row ${v.id === vehicleId ? "selected" : ""}" data-id="${v.id}">
              <span class="row-icon">${icon.car(22)}</span>
              <span class="row-text"><span class="row-value">${esc(v.plate)}</span><span class="row-label">${esc(v.label || "")}</span></span>
              <span class="tick">${icon.check(20)}</span>
            </button>`,
          )
          .join("")}</div>`
      : `<p class="sheet-sub">No vehicles have been added yet. Ask your office to add your car.</p>`,
    onMount(sheet, close) {
      sheet.querySelectorAll<HTMLElement>("[data-id]").forEach((row) =>
        row.addEventListener("click", () => {
          vehicleId = Number(row.dataset.id);
          localStorage.setItem(VEHICLE_KEY, String(vehicleId));
          haptic.tap();
          close();
          sheetMode = "";
          renderSheet();
        }),
      );
    },
  });
}

function openHealth() {
  haptic.tap();
  const t = tracker.state;
  const gpsOk = !!t.lastFix && Date.now() - t.lastFix.time < 90_000;
  const linkOk = t.queued < 5 && !!t.lastUploadAt && Date.now() - t.lastUploadAt < 90_000;
  const row = (ok: boolean | null, ic: string, label: string, value: string) => `
    <div class="check-row"><span class="row-icon">${ic}</span>
      <span class="row-text"><span class="row-value">${label}</span><span class="row-label">${value}</span></span>
      <span class="state ${ok == null ? "idle" : ok ? "ok" : "bad"}">${ok == null ? "Off" : ok ? icon.check(16) : icon.alert(16)}</span></div>`;
  const online = !!me?.shift;
  openSheet({
    title: "Tracking",
    body: `
      <div class="list">
        ${row(online ? gpsOk : null, icon.gps(22), "GPS", t.lastFix ? `Updated ${agoShort(t.lastFix.time)} · ±${Math.round(t.lastFix.accuracy ?? 0)} m` : "Waiting for a fix")}
        ${row(online ? linkOk : null, icon.signal(22), "Connection to office", t.queued ? `${t.queued} updates waiting to send` : `Last sent ${agoShort(t.lastUploadAt)}`)}
        ${row(battery == null ? null : battery > 20, icon.battery(22), "Battery", battery == null ? "Unknown" : `${battery}%${battery <= 20 ? " · plug in your charger" : ""}`)}
      </div>
      ${t.error ? `<p class="note warn">${esc(t.error)}</p>` : ""}
      <h3 class="section">Keep tracking reliable</h3>
      <ol class="tips">
        <li>Leave the <b>“On shift”</b> notification in place.</li>
        <li>Allow location <b>“All the time”</b> or <b>“While using the app”</b>.</li>
        <li>Set battery use for this app to <b>Unrestricted</b>.</li>
        <li>Keep the phone on a charger in the car.</li>
      </ol>
      ${Capacitor.isNativePlatform() ? `<button class="btn secondary block" id="perm">${icon.settings(18)}<span>Open app settings</span></button>` : ""}`,
    onMount(sheet) {
      sheet.querySelector("#perm")?.addEventListener("click", () => tracker.openSettings());
    },
  });
}

function openAccount() {
  haptic.tap();
  const s = loadSession()!;
  openSheet({
    title: "Account",
    body: `
      <div class="profile">
        <div class="avatar big">${esc(initials(s.driverName))}</div>
        <div><div class="row-value">${esc(s.driverName || "")}</div>
          <div class="row-label">${esc(s.companyName || s.company)}${me ? ` · ${esc(prettyPhone(me.phone))}` : ""}</div></div>
      </div>
      <div class="list">
        ${
          s.officePhone
            ? `<a class="list-row" href="tel:${esc(s.officePhone)}"><span class="row-icon">${icon.phone(22)}</span>
                <span class="row-text"><span class="row-value">Call the office</span><span class="row-label">${esc(prettyPhone(s.officePhone))}</span></span>
                <span class="row-chev">${icon.chevron(20)}</span></a>`
            : ""
        }
        <button class="list-row" id="acc-health"><span class="row-icon">${icon.shield(22)}</span>
          <span class="row-text"><span class="row-value">Tracking & permissions</span></span><span class="row-chev">${icon.chevron(20)}</span></button>
        <button class="list-row destructive" id="acc-logout"><span class="row-icon">${icon.logout(22)}</span>
          <span class="row-text"><span class="row-value">Sign out</span></span></button>
      </div>
      <p class="fineprint">Your location is only shared while you're online.</p>`,
    onMount(sheet, close) {
      sheet.querySelector("#acc-health")!.addEventListener("click", () => {
        close();
        setTimeout(openHealth, 250);
      });
      sheet.querySelector("#acc-logout")!.addEventListener("click", async () => {
        if (me?.shift) return toast("Go offline before signing out");
        close();
        await tracker.stop();
        tracker.clearQueue();
        clearToken();
        me = null;
        screen = "";
        route();
      });
    },
  });
}

// ---------- data ----------

async function loadMe() {
  try {
    me = await api<Me>("/api/driver/me");
    if (!vehicles.length) vehicles = await api<Vehicle[]>("/api/driver/vehicles").catch(() => []);
    if (vehicleId && !vehicles.some((v) => v.id === vehicleId)) vehicleId = null;
    if (me.shift && !tracker.state.running) await tracker.start();
    if (!me.shift && tracker.state.running) await tracker.stop();
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) {
      clearToken();
      screen = "";
      route();
      return;
    }
    toast(err.message, "error");
  }
  sheetMode = "";
  renderSheet();
}

async function withBusy(btn: HTMLElement, fn: () => Promise<void>) {
  busy = true;
  btn.classList.add("loading");
  btn.setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (e) {
    toast((e as Error).message, "error");
  } finally {
    busy = false;
    btn.classList.remove("loading");
    btn.removeAttribute("aria-busy");
  }
}

async function readBattery() {
  try {
    const b = await Device.getBatteryInfo();
    battery = b.batteryLevel == null ? null : Math.round(b.batteryLevel * 100);
  } catch {
    battery = null;
  }
}

// ---------- start up ----------

tracker.onStopped = (reason) => {
  if (reason === "logged_out") {
    clearToken();
    toast("Please sign in again", "error");
  } else {
    toast("The office ended your shift");
  }
  screen = "";
  route();
  loadMe();
};

tracker.subscribe((t) => updateHome(t));

App.addListener("resume", () => {
  if (loadSession()?.token) loadMe();
  tracker.flush();
});

setInterval(() => {
  if (document.visibilityState === "visible") updateHome(tracker.state);
}, 5000);
setInterval(readBattery, 60_000);
readBattery();

if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
}

route();
if (loadSession()?.token) loadMe();
