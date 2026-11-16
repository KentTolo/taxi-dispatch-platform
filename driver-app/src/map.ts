import L from "leaflet";
import "leaflet/dist/leaflet.css";

const MASERU: L.LatLngTuple = [-29.3151, 27.4869];

// Clean, low-noise basemaps so the driver's position stands out.
// Demo only: switch to a paid tile provider before go-live.
const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export class DriverMap {
  private map: L.Map;
  private tiles: L.TileLayer;
  private me: L.Marker | null = null;
  private halo: L.Circle | null = null;
  private follow = true;
  private hasFix = false;
  onFollowChange: ((following: boolean) => void) | null = null;

  constructor(el: HTMLElement) {
    this.map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      center: MASERU,
      zoom: 14,
      zoomSnap: 0.25,
    });
    this.map.attributionControl.setPrefix(false).setPosition("topright");
    this.tiles = L.tileLayer(this.tileUrl(), { maxZoom: 19, subdomains: "abcd", attribution: ATTRIBUTION, detectRetina: true });
    this.tiles.addTo(this.map);

    // Stop following once the driver pans the map themselves.
    this.map.on("dragstart", () => this.setFollow(false));

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", () => this.tiles.setUrl(this.tileUrl()));
  }

  private tileUrl() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? TILES.dark : TILES.light;
  }

  private setFollow(v: boolean) {
    if (this.follow === v) return;
    this.follow = v;
    this.onFollowChange?.(v);
  }

  /** Show the driver's position. `active` = on shift (pulsing), otherwise a calm grey dot. */
  setPosition(lat: number, lng: number, accuracy: number | null, heading: number | null, active: boolean) {
    const ll: L.LatLngTuple = [lat, lng];
    const html = `<div class="me ${active ? "active" : ""}">
        ${heading != null && !Number.isNaN(heading) ? `<div class="me-heading" style="transform:rotate(${heading}deg)"></div>` : ""}
        <div class="me-dot"></div>
      </div>`;
    const ic = L.divIcon({ className: "me-wrap", html, iconSize: [44, 44], iconAnchor: [22, 22] });
    if (!this.me) {
      this.me = L.marker(ll, { icon: ic, interactive: false, keyboard: false }).addTo(this.map);
      this.halo = L.circle(ll, { radius: accuracy ?? 0, className: "me-halo", interactive: false }).addTo(this.map);
    } else {
      this.me.setLatLng(ll).setIcon(ic);
      this.halo!.setLatLng(ll).setRadius(Math.min(accuracy ?? 0, 150));
    }
    if (!this.hasFix) {
      this.hasFix = true;
      this.map.setView(ll, 16, { animate: false });
    } else if (this.follow) {
      this.map.panTo(ll, { animate: true, duration: 0.8 });
    }
  }

  recenter() {
    this.setFollow(true);
    if (this.me) this.map.flyTo(this.me.getLatLng(), Math.max(this.map.getZoom(), 16), { duration: 0.6 });
  }

  /** Keep the map's visual centre above the bottom sheet. */
  setBottomInset(px: number) {
    this.map.getContainer().style.setProperty("--sheet", `${px}px`);
    this.map.invalidateSize({ pan: false });
  }

  destroy() {
    this.map.remove();
  }
}
