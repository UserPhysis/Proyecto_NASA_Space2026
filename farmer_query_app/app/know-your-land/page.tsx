"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Script from "next/script";
import "./know-your-land.css";

declare global { interface Window { L: any } }
type LayerId = "altitude" | "temperature" | "wind" | "precipitation" | "soil";
type Place = { name: string; lat: number; lng: number; country: string };
type Environment = { temperature: number; rainfall: number; humidity: number; wind: number; soilPh: number | null; clay: number | null; latestTemperature: number; latestRainfall: number; latestWind: number; lastDate: string; altitude: number | null };

const initialPlace: Place = { name: "Apaneca-Ilamatepec", lat: 13.85, lng: -89.8, country: "El Salvador" };
const initialEnvironment: Environment = { temperature: 22.8, rainfall: 165.5, humidity: 62, wind: 2.4, soilPh: null, clay: null, latestTemperature: 22.8, latestRainfall: 5.4, latestWind: 2.4, lastDate: "reference", altitude: null };
const labels: Record<LayerId, string> = { altitude: "Altitude", temperature: "Temperature", wind: "Wind", precipitation: "Rainfall", soil: "Soil texture" };
type CropMarker = { crop: string; region: string; lat: number; lng: number; source: string; color: string; code: string };
const cropMarkers: CropMarker[] = [
  { crop: "Rice", region: "South and Southeast Asia", lat: 22.8, lng: 90.4, source: "FAOSTAT crop production regions", color: "#f4c95d", code: "RI" },
  { crop: "Maize", region: "United States Corn Belt", lat: 41.5, lng: -93.5, source: "USDA crop production regions", color: "#f6a64b", code: "MZ" },
  { crop: "Coffee", region: "Central America", lat: 14.2, lng: -89.2, source: "FAOSTAT crop production regions", color: "#c98b5b", code: "CF" },
  { crop: "Wheat", region: "North American Great Plains", lat: 39.2, lng: -100.2, source: "USDA crop production regions", color: "#e6d36f", code: "WH" },
  { crop: "Soybean", region: "Brazilian Cerrado", lat: -15.8, lng: -47.9, source: "FAOSTAT crop production regions", color: "#91c96b", code: "SO" },
  { crop: "Cocoa", region: "West Africa", lat: 7.4, lng: -5.5, source: "FAOSTAT crop production regions", color: "#a875d1", code: "CO" },
  { crop: "Potato", region: "Andean highlands", lat: -13.5, lng: -72, source: "FAOSTAT crop production regions", color: "#e28a6d", code: "PO" },
  { crop: "Canola", region: "Canadian Prairies", lat: 51.2, lng: -106.2, source: "USDA crop production regions", color: "#f4d35e", code: "CA" },
];
const legends: Record<LayerId, { min: string; max: string; unit: string; description: string; tone: string }> = {
  altitude: { min: "0", max: "3000", unit: "m", description: "Altitude surface", tone: "altitude" },
  temperature: { min: "0", max: "40", unit: "°C", description: "Temperature surface", tone: "temperature" },
  wind: { min: "0", max: "12", unit: "m/s", description: "Wind surface", tone: "wind" },
  precipitation: { min: "0", max: "240", unit: "mm", description: "Rainfall surface", tone: "precipitation" },
  soil: { min: "Low", max: "High", unit: "clay", description: "Soil texture proxy", tone: "soil" },
};

// ==========================================
// MOTOR DE RECOMENDACIÓN DE CULTIVOS INTEGRADO
// ==========================================
export type Range = [number, number, number, number];
export type Crop = { id: string; name: string; temp: Range; rain: Range; alt: Range; ph: Range; clay?: Range; dryMax: number };

export const CROPS: Crop[] = [
  { id: "maize", name: "Maize", temp: [10, 18, 27, 35], rain: [400, 600, 1200, 2500], alt: [0, 0, 2000, 3000], ph: [5, 5.8, 7, 8], dryMax: 5 },
  { id: "beans", name: "Beans", temp: [8, 16, 24, 30], rain: [300, 500, 1500, 2500], alt: [0, 0, 2000, 3000], ph: [4.5, 5.5, 7, 8], dryMax: 6 },
  { id: "coffee", name: "Coffee (arabica)", temp: [12, 18, 22, 28], rain: [900, 1400, 2200, 3000], alt: [400, 800, 1800, 2400], ph: [4.5, 5.5, 6.5, 7.5], clay: [5, 15, 45, 70], dryMax: 4 },
  { id: "rice", name: "Rice", temp: [15, 22, 30, 36], rain: [900, 1200, 2500, 4000], alt: [0, 0, 800, 2000], ph: [4.5, 5.5, 7, 8.5], clay: [10, 25, 60, 90], dryMax: 2 },
  { id: "sugarcane", name: "Sugarcane", temp: [15, 22, 32, 38], rain: [1000, 1200, 2200, 3500], alt: [0, 0, 1200, 2000], ph: [5, 5.5, 7.5, 8.5], dryMax: 4 },
  { id: "tomato", name: "Tomato", temp: [10, 18, 26, 32], rain: [400, 600, 1400, 2500], alt: [0, 0, 1800, 2800], ph: [5, 5.8, 7, 8], dryMax: 5 },
  { id: "potato", name: "Potato", temp: [5, 10, 18, 25], rain: [400, 600, 1200, 2000], alt: [0, 500, 3000, 4000], ph: [4.5, 5.2, 6.5, 7.5], clay: [0, 5, 25, 45], dryMax: 4 },
  { id: "wheat", name: "Wheat", temp: [3, 10, 20, 28], rain: [250, 400, 900, 1800], alt: [0, 0, 2500, 3500], ph: [5, 5.8, 7.5, 8.5], dryMax: 6 },
  { id: "cassava", name: "Cassava", temp: [14, 20, 30, 36], rain: [500, 800, 1800, 3000], alt: [0, 0, 1200, 2000], ph: [4.5, 5.5, 7, 8.5], clay: [0, 5, 35, 60], dryMax: 6 },
  { id: "banana", name: "Banana", temp: [15, 22, 30, 35], rain: [1000, 1500, 2500, 4000], alt: [0, 0, 1000, 1800], ph: [4.5, 5.5, 7, 8], dryMax: 2 },
  { id: "cocoa", name: "Cocoa", temp: [18, 22, 28, 32], rain: [1000, 1500, 2500, 4000], alt: [0, 0, 700, 1400], ph: [4.5, 5.5, 7, 8], dryMax: 2 },
  { id: "sorghum", name: "Sorghum", temp: [10, 20, 32, 40], rain: [300, 450, 1000, 1800], alt: [0, 0, 1800, 2500], ph: [5, 5.5, 7.5, 8.5], dryMax: 7 },
  { id: "soybean", name: "Soybean", temp: [10, 18, 28, 35], rain: [400, 600, 1200, 2000], alt: [0, 0, 1500, 2500], ph: [5, 5.8, 7, 8], dryMax: 5 },
];

export type Inputs = { tMean: number; rain: number; altitude: number | null; ph: number | null; clay: number | null; dryMonths: number };
export type Factor = { key: string; v: number; dir: "" | "low" | "high" };
export type CropResult = { id: string; name: string; score: number; sd: number; verdict: string; factors: Factor[]; limiting: string };

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const trap = (x: number, [a, b, c, d]: Range) => (x >= b && x <= c ? 1 : x <= a || x >= d ? 0 : x < b ? (x - a) / (b - a) : (d - x) / (d - c));

function scoreCrop(c: Crop, inp: Inputs, dT = 0, dR = 1) {
  const factors: (Factor & { w: number })[] = [];
  const add = (key: string, w: number, range: Range, x: number) => factors.push({ key, w, v: trap(x, range), dir: x < range[1] ? "low" : x > range[2] ? "high" : "" });
  add("temperature", 3, c.temp, inp.tMean + dT);
  add("rainfall", 3, c.rain, inp.rain * dR);
  if (inp.altitude !== null) add("altitude", 2, c.alt, Math.max(0, inp.altitude));
  if (inp.ph !== null) add("soil pH", 1.5, c.ph, inp.ph);
  if (inp.clay !== null && c.clay) add("soil texture", 1, c.clay, inp.clay);
  const over = Math.max(0, inp.dryMonths - c.dryMax);
  factors.push({ key: "dry season", w: 2, v: Math.max(0, 1 - over * 0.25), dir: over ? "high" : "" });
  const hardZero = factors.some((f) => ["temperature", "rainfall", "altitude"].includes(f.key) && f.v === 0);
  const wsum = factors.reduce((a, f) => a + f.w, 0);
  const geo = Math.exp(factors.reduce((a, f) => a + f.w * Math.log(Math.max(f.v, 0.05)), 0) / wsum);
  const weakest = Math.min(...factors.map((f) => f.v));
  return { score: hardZero ? 0 : (0.6 * geo + 0.4 * weakest) * 100, factors };
}

const WORDS: Record<string, [string, string]> = {
  temperature: ["too cold", "too hot"], rainfall: ["too dry", "too wet"], altitude: ["too low", "too high"],
  "soil pH": ["too acidic", "too alkaline"], "soil texture": ["too sandy", "too clayey"], "dry season": ["", "too long"],
};
export const verdictOf = (s: number) => (s >= 80 ? "Excellent" : s >= 60 ? "Good" : s >= 40 ? "Marginal" : s > 0 ? "Poor" : "Not viable");

export function evaluateCrops(inp: Inputs): CropResult[] {
  return CROPS.map((c) => {
    const base = scoreCrop(c, inp);
    const runs = [-1, 0, 1].flatMap((dT) => [0.85, 1, 1.15].map((dR) => scoreCrop(c, inp, dT, dR).score));
    const score = Math.round(mean(runs));
    const worst = [...base.factors].sort((a, b) => a.v - b.v)[0];
    const limiting = worst.v < 0.8 ? `${worst.key} ${(WORDS[worst.key] ?? ["low", "high"])[worst.dir === "low" ? 0 : 1] || "limits it"}` : "no major limit";
    return { id: c.id, name: c.name, score, sd: Math.round(sd(runs)), verdict: verdictOf(score), factors: base.factors.map(({ key, v, dir }) => ({ key, v, dir })), limiting };
  }).sort((a, b) => b.score - a.score);
}
// ==========================================

function normalize(value: number, min: number, max: number) { return Math.max(0, Math.min(100, Math.round(((value - min) / (max - min)) * 100))); }
function getMetrics(environment: Environment) {
  const { temperature: temp, rainfall: rain, humidity } = environment;
  const heat = normalize(temp, 18, 34); const rainScore = normalize(rain, 0, 240); const moisture = Math.round(Math.max(0, Math.min(100, humidity * .72 + rainScore * .28)));
  return [
    ["temperature", "Temperature", `${temp.toFixed(1)} °C`, normalize(temp, 8, 34), "amber", "30-day average"],
    ["heat", "Heat stress", heat > 72 ? "High" : heat > 45 ? "Medium" : "Low", heat, "red", "Heat exposure risk"],
    ["rain", "Rainfall", `${rain.toFixed(0)} mm`, rainScore, "blue", "30-day accumulation"],
    ["soil", "Soil moisture", `${moisture}%`, moisture, "green", "Satellite-informed proxy"],
    ["evaporation", "Evaporation", `${(3.4 + temp * 0.08).toFixed(1)} mm/day`, normalize(temp, 10, 35), "amber", "Atmospheric demand"],
    ["frost", "Frost risk", temp < 12 ? "High" : temp < 17 ? "Medium" : "Low", 100 - normalize(temp, 4, 24), "violet", "Estimated minimum temperature"],
    ["extreme-rain", "Extreme rainfall", rain > 180 ? "High" : "Low", normalize(rain, 60, 260), "cyan", "Intense event signal"],
    ["vegetation", "Vegetation stress", moisture < 35 ? "Medium" : "Low", 100 - moisture, "green", "Water availability proxy"],
    ["altitude", "Altitude", environment.altitude === null ? "—" : `${Math.round(environment.altitude)} m`, normalize(environment.altitude ?? 0, 0, 3000), "green", "Elevation above sea level"],
  ];
}

const altColor = (m: number) => { const t = Math.max(0, Math.min(1, m / 3000)); return `hsl(${130 - t * 105} 55% ${52 - t * 22}%)`; };
const ZOOM = 8;
const dayString = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
const getJson = (url: string, ms: number, signal?: AbortSignal) =>
  fetch(url, { signal: signal ?? AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export default function KnowYourLandPage() {
  const [ready, setReady] = useState(false);
  const [place, setPlace] = useState(initialPlace);
  const [query, setQuery] = useState("El Salvador");
  const [layer, setLayer] = useState<LayerId>("altitude");
  const [environment, setEnvironment] = useState(initialEnvironment);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Reference data loaded");
  const map = useRef<any>(null); const marker = useRef<any>(null); const soilLayer = useRef<any>(null); const cropMarkersLayer = useRef<any>(null); const gridLayer = useRef<any>(null);

  const createPin = useCallback((lat: number, lng: number) => window.L.marker([lat, lng], { icon: window.L.divIcon({ className: "farmer-red-pin", html: "<span></span>", iconSize: [26, 36], iconAnchor: [13, 36] }) }), []);

  const select = useCallback(async (lat: number, lng: number, suppliedName?: string) => {
    setLoading(true);
    setMessage("Loading NASA POWER data...");
    setPlace((p) => ({ ...p, lat, lng, name: suppliedName || "Selected point" }));
    const end = new Date(Date.now() - 3 * 86400000); const start = new Date(end.getTime() - 29 * 86400000);
    const f = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
    const [rev, pow, soil, elev] = await Promise.all([
      suppliedName ? null : getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, 8000),
      getJson(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR,RH2M,WS10M&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${f(start)}&end=${f(end)}&format=JSON`, 20000),
      getJson(`https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lng.toFixed(4)}&lat=${lat.toFixed(4)}&property=phh2o&property=clay&depth=0-5cm&value=mean`, 8000),
      getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`, 8000),
    ]);
    if (!pow?.properties?.parameter) { setMessage("The data source is unavailable for this point."); setLoading(false); return; }
    const P = pow.properties.parameter;
    const vals = (o: Record<string, number>) => Object.values(o).filter((v) => v > -999);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
    const last = (o: Record<string, number>): [string, number] => { const e = Object.entries(o).filter(([, v]) => v > -999); return e[e.length - 1] ?? ["reference", 0]; };
    const sv = (n: string) => soil?.properties?.layers?.find((i: any) => i.name === n)?.depths?.[0]?.values?.mean;
    setEnvironment({
      temperature: avg(vals(P.T2M)), rainfall: vals(P.PRECTOTCORR).reduce((a, b) => a + b, 0), humidity: avg(vals(P.RH2M)), wind: avg(vals(P.WS10M)),
      soilPh: typeof sv("phh2o") === "number" ? sv("phh2o") / 10 : null, clay: typeof sv("clay") === "number" ? sv("clay") / 10 : null,
      latestTemperature: last(P.T2M)[1], latestRainfall: last(P.PRECTOTCORR)[1], latestWind: last(P.WS10M)[1], lastDate: last(P.T2M)[0], altitude: typeof elev?.elevation?.[0] === "number" ? elev.elevation[0] : null,
    });
    setPlace((p) => ({ ...p, name: suppliedName || rev?.display_name?.split(",")[0] || p.name, country: rev?.address?.country || p.country }));
    setMessage("NASA POWER data updated for the selected coordinates");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready || !window.L || map.current) return;
    const instance = window.L.map("land-map", { zoomControl: false }).setView([place.lat, place.lng], ZOOM);
    window.L.control.zoom({ position: "bottomright" }).addTo(instance);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "OpenStreetMap contributors", maxZoom: 19 }).addTo(instance);
    const pane = instance.createPane("heatPane"); pane.style.zIndex = "450"; pane.style.pointerEvents = "none"; pane.style.filter = "blur(10px)";
    instance.on("click", (event: any) => select(event.latlng.lat, event.latlng.lng));
    map.current = instance;
    marker.current = createPin(place.lat, place.lng).addTo(instance);
    const onResize = () => instance.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); instance.remove(); map.current = null; };
  }, [ready, createPin, select]);

  useEffect(() => {
    if (!map.current || !window.L || !ready) return;
    if (cropMarkersLayer.current) { map.current.removeLayer(cropMarkersLayer.current); cropMarkersLayer.current = null; }
    if (layer !== "altitude") return;
    const group = window.L.layerGroup();
    cropMarkers.forEach((crop) => {
      const icon = window.L.divIcon({ className: "crop-map-pin", html: `<span style="background:${crop.color}"><b>${crop.code}</b></span>`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
      window.L.marker([crop.lat, crop.lng], { icon }).bindPopup(`<strong>${crop.crop}</strong><br><small>${crop.region}</small><br><small>Representative production region</small><br><small>${crop.source}</small>`, { className: "crop-data-popup" }).addTo(group);
    });
    group.addTo(map.current); cropMarkersLayer.current = group;
    return () => { if (cropMarkersLayer.current && map.current) { map.current.removeLayer(cropMarkersLayer.current); cropMarkersLayer.current = null; } };
  }, [ready, layer]);

  useEffect(() => {
    if (!map.current || !marker.current) return;
    marker.current.setLatLng([place.lat, place.lng]);
    map.current.flyTo([place.lat, place.lng], Math.max(map.current.getZoom(), ZOOM), { duration: .8 });
  }, [place.lat, place.lng]);

  useEffect(() => {
    if (!ready || !map.current || !window.L) return;
    gridLayer.current?.remove(); gridLayer.current = null;
    if (layer === "altitude" || layer === "soil") return;
    const param = layer === "temperature" ? "T2M" : layer === "wind" ? "WS10M" : "PRECTOTCORR";
    const [min, max] = layer === "temperature" ? [0, 40] : layer === "wind" ? [0, 12] : [0, 240];
    const ctrl = new AbortController();
    const box = (w: number, e: number) => `https://power.larc.nasa.gov/api/temporal/daily/regional?latitude-min=${place.lat - 1.2}&latitude-max=${place.lat + 1.2}&longitude-min=${w}&longitude-max=${e}&parameters=${param}&community=AG&start=${dayString(32)}&end=${dayString(3)}&format=JSON`;
    (async () => {
      const results = await Promise.all([box(place.lng - 4.4, place.lng), box(place.lng, place.lng + 4.4)].map((u) => getJson(u, 30000, ctrl.signal)));
      if (ctrl.signal.aborted || !map.current) return;
      const L = window.L; const group = L.layerGroup();
      let cells = 0;
      for (const json of results) {
        for (const feature of json?.features ?? []) {
          const [lng, lat] = feature.geometry.coordinates;
          const series = feature.properties?.parameter?.[param] as Record<string, number> | undefined;
          const v = Object.values(series ?? {}).filter((x) => x > -999);
          if (!v.length) continue;
          const sum = v.reduce((a, b) => a + b, 0); const value = layer === "precipitation" ? sum : sum / v.length;
          const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
          const color = layer === "precipitation" ? `hsl(${200 + t * 40} 80% ${75 - t * 40}%)` : `hsl(${240 - t * 240} 80% 50%)`;
          L.circle([lat, lng], { pane: "heatPane", radius: 38000, stroke: false, interactive: false, fillOpacity: .42, fillColor: color }).addTo(group);
          cells += 1;
        }
      }
      if (!cells) { setMessage("NASA POWER grid returned no cells for this area."); return; }
      group.addTo(map.current); gridLayer.current = group;
    })();
    return () => { ctrl.abort(); gridLayer.current?.remove(); gridLayer.current = null; };
  }, [ready, layer, place.lat, place.lng]);

  useEffect(() => {
    if (!ready || !map.current || !window.L || layer !== "altitude") return;
    const m = map.current; const L = window.L;
    let ctrl: AbortController | null = null; let timer: any;
    const draw = async () => {
      ctrl?.abort(); const mine = new AbortController(); ctrl = mine;
      const b = m.getBounds(); const cols = 22, rows = 8;
      const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast();
      const dLat = (north - south) / rows, dLng = (east - west) / cols;
      const pts: [number, number][] = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push([south + dLat * (r + .5), west + dLng * (c + .5)]);
      const chunks: [number, number][][] = []; for (let i = 0; i < pts.length; i += 100) chunks.push(pts.slice(i, i + 100));
      const res = await Promise.all(chunks.map((ch) => getJson(`https://api.open-meteo.com/v1/elevation?latitude=${ch.map((q) => q[0].toFixed(4)).join(",")}&longitude=${ch.map((q) => q[1].toFixed(4)).join(",")}`, 15000, mine.signal)));
      if (mine.signal.aborted) return;
      const elev: number[] = res.flatMap((r: any) => r?.elevation ?? []);
      if (!elev.length) { setMessage("Elevation data unavailable for this view."); return; }
      gridLayer.current?.remove();
      const group = L.layerGroup();
      const radius = Math.max(dLat * 111000, dLng * 111000 * Math.cos(((north + south) / 2) * Math.PI / 180)) * .8;
      pts.forEach(([lat, lng], i) => {
        const h = elev[i];
        if (typeof h !== "number" || h <= 0) return;
        L.circle([lat, lng], { pane: "heatPane", radius, stroke: false, interactive: false, fillOpacity: .5, fillColor: altColor(h) }).addTo(group);
      });
      group.addTo(m); gridLayer.current = group;
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 350); };
    m.on("moveend", schedule); draw();
    return () => { clearTimeout(timer); ctrl?.abort(); m.off("moveend", schedule); gridLayer.current?.remove(); gridLayer.current = null; };
  }, [ready, layer]);

  useEffect(() => {
    getJson(`https://api.open-meteo.com/v1/elevation?latitude=${initialPlace.lat}&longitude=${initialPlace.lng}`, 8000)
      .then((r) => { if (typeof r?.elevation?.[0] === "number") setEnvironment((e) => (e.lastDate === "reference" ? { ...e, altitude: r.elevation[0] } : e)); });
  }, []);

  useEffect(() => {
    if (!map.current || !window.L || !ready) return;
    if (soilLayer.current) { map.current.removeLayer(soilLayer.current); soilLayer.current = null; }
    if (layer !== "soil") return;
    const wms = window.L.tileLayer.wms("https://maps.isric.org/mapserv?map=/map/clay.map", { layers: "clay_0-5cm_mean", format: "image/png", transparent: true, opacity: .52, attribution: "SoilGrids / ISRIC" }).addTo(map.current);
    soilLayer.current = wms;
    return () => { if (soilLayer.current && map.current) { map.current.removeLayer(soilLayer.current); soilLayer.current = null; } };
  }, [ready, layer]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true); setMessage("Finding place...");
    try {
      const result = (await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`)).json())[0];
      if (!result) throw new Error();
      const name = result.display_name.split(",")[0];
      const country = result.display_name.split(",").slice(-1)[0].trim();
      setPlace((p) => ({ ...p, country }));
      await select(Number(result.lat), Number(result.lon), name);
    } catch { setMessage("Place not found. Try a country, region or municipality."); setLoading(false); }
  }

  const legend = legends[layer]; 
  const metrics = getMetrics(environment);

  // Ejecución dinámica del motor de cultivos avanzado basado en los inputs actuales
  const evaluatedCrops = evaluateCrops({
    tMean: environment.temperature,
    rain: environment.rainfall * 12, // Anualización aproximada de lluvia para el motor
    altitude: environment.altitude,
    ph: environment.soilPh,
    clay: environment.clay,
    dryMonths: 3, // Estimado por defecto o calculado
  });

  useEffect(() => {
    if (!marker.current || !window.L) return;
    const label = layer === "temperature" ? `${place.name}<br><strong>Latest: ${environment.latestTemperature.toFixed(1)} °C</strong><br><small>30-day mean: ${environment.temperature.toFixed(1)} °C · ${environment.lastDate}</small>`
      : layer === "precipitation" ? `${place.name}<br><strong>Latest: ${environment.latestRainfall.toFixed(1)} mm</strong><br><small>30-day total: ${environment.rainfall.toFixed(1)} mm · ${environment.lastDate}</small>`
      : layer === "wind" ? `${place.name}<br><strong>Latest: ${environment.latestWind.toFixed(1)} m/s</strong><br><small>30-day mean: ${environment.wind.toFixed(1)} m/s · ${environment.lastDate}</small>`
      : layer === "soil" ? `${place.name}<br><strong>Soil texture</strong><br><small>Clay: ${environment.clay === null ? "Unavailable" : `${environment.clay.toFixed(1)}%`} · pH: ${environment.soilPh === null ? "Unavailable" : environment.soilPh.toFixed(1)}</small>`
      : `${place.name}<br><strong>Altitude: ${environment.altitude === null ? "Unavailable" : `${Math.round(environment.altitude)} m`}</strong><br><small>Copernicus DEM · ${place.lat.toFixed(4)}°, ${place.lng.toFixed(4)}°</small>`;
    marker.current.bindPopup(label, { closeButton: false, className: "land-data-popup" }).openPopup();
  }, [ready, layer, place, environment]);

  return (
    <div className="land-module">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <header className="land-header">
        <Link href="/" className="land-back">← Farmer Query</Link>
        <div><h1>KNOW YOUR LAND</h1></div>
        <span className="land-status"><i /> LIVE DATA</span>
      </header>
      <main className="land-content">
        <section className="land-map-panel">
          <div className="map-layer-bar">
            {(Object.keys(labels) as LayerId[]).map((id) => (
              <button key={id} type="button" className={layer === id ? "active" : ""} onClick={() => setLayer(id)}>{labels[id]}</button>
            ))}
          </div>
          <div id="land-map" className="land-map" />
          <div className={`heat-legend ${legend.tone}`}>
            <div className="legend-gradient" style={layer === "altitude" ? { background: "linear-gradient(90deg,hsl(130 55% 52%),hsl(78 55% 41%),hsl(25 55% 30%))" } : undefined} />
            <div className="legend-values"><span>{legend.min}</span><span>{legend.max}</span></div>
            <small>{legend.description} · {legend.unit}</small>
          </div>
        </section>

        <section className="land-search-row">
          <form onSubmit={search} className="land-search">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a country, region or municipality" aria-label="Place" />
            <button type="submit">{loading ? "LOADING..." : "SEARCH PLACE"}</button>
          </form>
          <div className="land-place">
            <span>SELECTED LOCATION</span>
            <strong>{place.name}, {place.country}</strong>
            <small>{message}</small>
            <code>{place.lat.toFixed(4)}°, {place.lng.toFixed(4)}°</code>
          </div>
        </section>

        <section className="land-section-heading">
          <div><span className="land-code">ENVIRONMENTAL READING</span><h2>Place parameters</h2></div>
          <p>Real NASA POWER readings for the selected coordinates, plus clearly labeled proxies.</p>
        </section>

        <section className="metric-grid">
          {metrics.map(([key, label, value, score, tone, note]) => (
            <article className="metric-card" key={key}>
              <div className="metric-card-top">
                <span>{label}</span>
                <b className={`metric-icon ${tone}`}>{String(key).slice(0, 2).toUpperCase()}</b>
              </div>
              <strong className="metric-value">{value}</strong>
              <div className="heat-track"><i className={String(tone)} style={{ width: `${Math.max(8, Number(score))}%` }} /></div>
              <small>{note}</small>
            </article>
          ))}
        </section>

        <section className="recommendation-section">
          <div className="land-section-heading">
            <div><span className="land-code">FARM DECISION SUPPORT (FAO ECO-CROP ENGINE)</span><h2>What can be planted</h2></div>
            <p>Advanced sensitivity analysis scoring based on agroecological limits, climate statistics, and limiting factors.</p>
          </div>
          <div className="recommendation-grid">
            {evaluatedCrops.map((crop) => {
              // Convertimos el puntaje de 0-100 a un sistema de estrellas de 0 a 5
              const stars = Math.round((crop.score / 100) * 5);
              return (
                <article className="recommendation-card" key={crop.id}>
                  <div className="recommendation-title">
                    <h3>{crop.name}</h3>
                    <span className="stars">
                      {"★".repeat(stars)}<em>{"★".repeat(Math.max(0, 5 - stars))}</em>
                    </span>
                  </div>
                  <p><strong>Aptitude: {crop.score}% ({crop.verdict})</strong></p>
                  <p><small>Limiting factor: {crop.limiting}</small></p>
                  <small><strong>SENSITIVITY SD:</strong> ±{crop.sd}% variance across climate scenarios</small>
                </article>
              );
            })}
          </div>
        </section>

        <section className="land-disclaimer">
          <span>◈</span>
          <p><strong>Decision support, not a verdict.</strong> Validate soil conditions, crop variety and field observations before planting.</p>
        </section>
      </main>
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onLoad={() => setReady(true)} />
    </div>
  );
}