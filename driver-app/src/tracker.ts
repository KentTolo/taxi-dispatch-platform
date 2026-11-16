import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin, Location } from "@capacitor-community/background-geolocation";
import { Device } from "@capacitor/device";
import { LocalNotifications } from "@capacitor/local-notifications";
import { api, ApiError } from "./api";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

// Sampling rules: GPS reports every second, but we only keep a point when the car
// has moved MIN_MOVE_M (at most every MIN_GAP_MS), or every HEARTBEAT_MS when parked,
// so the office knows a parked driver is still online.
const MIN_MOVE_M = 15;
const MIN_GAP_MS = 4_000;
const HEARTBEAT_MS = 30_000;
const FLUSH_EVERY_MS = 5_000;
const MAX_BATCH = 200;
const MAX_QUEUE = 3_000; // ~25 hours of heartbeats; oldest dropped beyond this
const QUEUE_KEY = "driver.queue";
const DIST_KEY = "driver.distance";

export interface QueuedPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  time: number;
}

export interface TrackerState {
  running: boolean;
  lastFix: QueuedPoint | null;
  lastUploadAt: number | null;
  queued: number;
  error: string | null;
  serverStatus: string | null;
  /** Metres driven since the shift started on this phone (from kept GPS points). */
  distanceM: number;
}

type Listener = (s: TrackerState) => void;

class Tracker {
  private watcherId: string | null = null;
  private webWatchId: number | null = null;
  private queue: QueuedPoint[] = loadQueue();
  private lastKept: QueuedPoint | null = null;
  private lastFlushAt = 0;
  private flushing = false;
  private retryTimer: number | null = null;
  private listeners = new Set<Listener>();
  /** Called when the server says the shift is over or the login is no longer valid. */
  onStopped: ((reason: "no_shift" | "logged_out") => void) | null = null;

  state: TrackerState = {
    running: false,
    lastFix: null,
    lastUploadAt: null,
    queued: this.queue.length,
    error: null,
    serverStatus: null,
    distanceM: Number(localStorage.getItem(DIST_KEY) || 0),
  };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<TrackerState>) {
    this.state = { ...this.state, ...patch, queued: this.queue.length };
    this.listeners.forEach((fn) => fn(this.state));
  }

  async start(): Promise<void> {
    if (this.state.running) return;
    this.emit({ running: true, error: null });

    if (Capacitor.isNativePlatform()) {
      // Android 13+ needs this to show the "tracking" notification that keeps us alive.
      try {
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== "granted") await LocalNotifications.requestPermissions();
      } catch {
        /* older Android: nothing to ask */
      }
      this.watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: "On shift — location sharing on",
          backgroundMessage: "The office can see your car while you're on shift.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 0,
        },
        (loc, err) => {
          if (err) {
            if (err.code === "NOT_AUTHORIZED") {
              this.emit({ error: "Location permission is off. Tap 'Fix permissions' and allow location." });
            } else {
              this.emit({ error: err.message });
            }
            return;
          }
          if (loc) this.onFix(fromPlugin(loc));
        },
      );
    } else if ("geolocation" in navigator) {
      // Browser fallback for testing on a computer. Stops when the tab is hidden.
      this.webWatchId = navigator.geolocation.watchPosition(
        (p) =>
          this.onFix({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy,
            speed: p.coords.speed,
            heading: p.coords.heading,
            time: p.timestamp,
          }),
        (e) => this.emit({ error: e.message }),
        { enableHighAccuracy: true, maximumAge: 0 },
      );
    } else {
      this.emit({ error: "This device has no location support." });
    }

    // Retries uploads of queued points even if GPS goes quiet.
    this.retryTimer = window.setInterval(() => this.flush(), 15_000);
  }

  async stop(): Promise<void> {
    if (this.watcherId) await BackgroundGeolocation.removeWatcher({ id: this.watcherId }).catch(() => {});
    if (this.webWatchId != null) navigator.geolocation.clearWatch(this.webWatchId);
    if (this.retryTimer != null) clearInterval(this.retryTimer);
    this.watcherId = null;
    this.webWatchId = null;
    this.retryTimer = null;
    this.lastKept = null;
    this.emit({ running: false });
  }

  resetDistance() {
    localStorage.setItem(DIST_KEY, "0");
    this.emit({ distanceM: 0 });
  }

  /** Drop unsent points, e.g. after a shift has ended on the server. */
  clearQueue() {
    this.queue = [];
    saveQueue(this.queue);
    this.emit({});
  }

  openSettings() {
    if (Capacitor.isNativePlatform()) BackgroundGeolocation.openSettings();
  }

  private onFix(p: QueuedPoint) {
    this.emit({ lastFix: p, error: null });
    const prev = this.lastKept;
    const gap = prev ? p.time - prev.time : Infinity;
    const moved = prev ? distanceM(prev, p) : Infinity;
    const keep = gap >= HEARTBEAT_MS || (gap >= MIN_GAP_MS && moved >= MIN_MOVE_M);
    if (!keep) return;
    // Count distance only for accurate fixes, and ignore GPS jumps (> 300 m in one step).
    if (prev && moved < 300 && (p.accuracy ?? 99) <= 50) {
      this.state.distanceM += moved;
      localStorage.setItem(DIST_KEY, String(Math.round(this.state.distanceM)));
    }
    this.lastKept = p;
    this.queue.push(p);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    saveQueue(this.queue);
    this.emit({});
    if (Date.now() - this.lastFlushAt >= FLUSH_EVERY_MS) this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    this.lastFlushAt = Date.now();
    try {
      while (this.queue.length) {
        const batch = this.queue.slice(0, MAX_BATCH);
        const res = await api<{ status: string }>("/api/driver/locations", {
          points: batch,
          battery: await batteryPercent(),
        });
        this.queue.splice(0, batch.length);
        saveQueue(this.queue);
        this.emit({ lastUploadAt: Date.now(), serverStatus: res.status, error: null });
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        this.clearQueue();
        await this.stop();
        this.onStopped?.("logged_out");
      } else if (err.status === 409) {
        this.clearQueue();
        await this.stop();
        this.onStopped?.("no_shift");
      } else {
        // Offline or server down: keep the points and try again later.
        this.emit({ error: err.status === 0 ? "No signal — positions saved and will be sent later." : err.message });
      }
    } finally {
      this.flushing = false;
    }
  }
}

function fromPlugin(l: Location): QueuedPoint {
  return {
    lat: l.latitude,
    lng: l.longitude,
    accuracy: l.accuracy ?? null,
    speed: l.speed ?? null,
    heading: l.bearing ?? null,
    time: l.time ?? Date.now(),
  };
}

function distanceM(a: QueuedPoint, b: QueuedPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function batteryPercent(): Promise<number | undefined> {
  try {
    const b = await Device.getBatteryInfo();
    return b.batteryLevel == null ? undefined : Math.round(b.batteryLevel * 100);
  } catch {
    return undefined;
  }
}

function loadQueue(): QueuedPoint[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedPoint[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export const tracker = new Tracker();
