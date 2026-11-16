"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import "./analyze-my-crops.css";

/* ---------------- Configuration ---------------- */

type Place = { name: string; lat: number; lon: number };

const INITIAL_PLACE: Place = {
  name: "Apaneca-Ilamatepec, El Salvador",
  lat: 13.85,
  lon: -89.8,
};

const YEARS_BACK = 20;
const MIN_YEARS = 8; // fewer complete years than this = "not enough data"
const YES_THRESHOLD = 0.8; // 80 % of years or more -> good to plant
const CAUTION_THRESHOLD = 0.5; // between 50 % and 80 % -> caution; below -> not recommended
const DRY_MONTH_MM = 50; // a month with less rain than this counts as "dry" (warning only)
const ET0_WARNING_RATIO = 0.5; // if cycle rainfall covers less than this share of ET0, warn (no weight)

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---------------- Crop icons ---------------- */
// Matches by keyword in the crop name (Spanish names from ecocrop.json plus English ones).
const ICONS: [string[], string][] = [
  [["maíz", "maiz", "maize", "corn"], "🌽"],
  [["frijol", "haba", "soja", "soya", "bean", "soy"], "🫘"],
  [["arroz", "trigo", "sorgo", "cebada", "avena", "rice", "wheat", "sorghum", "barley", "oat"], "🌾"],
  [["café", "cafe", "coffee"], "☕"],
  [["tomate", "tomato"], "🍅"],
  [["chile", "pimiento", "ají", "pepper", "chili"], "🌶️"],
  [["papa", "yuca", "camote", "potato", "cassava", "sweet potato"], "🥔"],
  [["plátano", "banano", "banana", "plantain"], "🍌"],
  [["cacao", "cocoa"], "🍫"],
  [["caña", "sugarcane", "sugar cane"], "🎋"],
  [["aguacate", "avocado"], "🥑"],
  [["piña", "pineapple"], "🍍"],
  [["naranja", "limón", "limon", "mandarina", "orange", "lemon", "lime", "mandarin"], "🍊"],
  [["cebolla", "onion"], "🧅"],
  [["zanahoria", "carrot"], "🥕"],
  [["ayote", "calabaza", "zapallo", "squash", "pumpkin"], "🎃"],
  [["sandía", "sandia", "watermelon"], "🍉"],
  [["mango"], "🥭"],
  [["coco", "coconut"], "🥥"],
];

function cropIcon(name: string): string {
  const n = name.toLowerCase();
  return ICONS.find(([keys]) => keys.some((k) => n.includes(k)))?.[1] ?? "🌱";
}

/* ---------------- Types ---------------- */

// NASA POWER (monthly mean temperature)
type MonthlySeries = Record<string, number>;
type PowerData = Record<string, MonthlySeries>;
type PowerVariable = "T2M";
type PowerResult = { key: string; data: PowerData | null; error: string | null };

// ERA5 via Open-Meteo (rainfall, ET0 and daily minimum, aggregated by month)
type EraMonth = { rain: number; et0: number | null; tMinAbs: number };
type EraData = Record<string, EraMonth>; // key "YYYYMM"

// NOTE: the field names of Range / CropEco match ecocrop.json, so they stay as they are.
type Range = {
  min: number | null;
  optMin: number | null;
  optMax: number | null;
  max: number | null;
};
type CropEco = {
  cientifico: string;
  temperatura: Range;
  tLetal?: number | null; // lethal temperature (KTMP), optional: requires re-running the script
  ph?: Range;
  lluviaAnual?: Range; // mm during the crop cycle (this is how EcoCrop defines it)
  cicloDias: { min: number | null; max: number | null };
};
type EcoCrop = { fuente: string; cultivos: Record<string, CropEco> };

type Curve = { sowYear: number; values: number[] };
type Class = "optimal" | "absolute" | "outside";
type Verdict = "yes" | "caution" | "no" | "none";
type MonthLevel = "good" | "fair" | "risk";
type GeoResult = { id: number; name: string; lat: number; lon: number };

type SoilPh = { mean: number; p5: number; p95: number };
type Extra<T> = { key: string; value: T | null; error: string | null };

type MonthStat = {
  n: number;
  ok: number; // years with that month inside the absolute limits
  low: number; // years below the minimum
  high: number; // years above the maximum
  median: number;
};
type Analysis = {
  n: number;
  curves: Curve[];
  byMonth: MonthStat[];
  cycleOk: number; // years with ALL cycle months inside the limits
  critical: { month: number; fails: number } | null;
};

type RainSummary = {
  n: number;
  median: number; // total cycle rainfall, typical year
  p10: number;
  p90: number;
  ok: number; // years with cycle rainfall inside what the crop tolerates
  dry: number; // cycle months whose typical rainfall is below DRY_MONTH_MM
};

type RotationStep = { crop: string; month: number };

/* ---------------- Utilities ---------------- */

function fmt(value: number, decimals = 0) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function hasRange(r: Range | undefined | null): r is Range {
  return !!r && (r.min !== null || r.optMin !== null || r.optMax !== null || r.max !== null);
}

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ---------------- Temperature: NASA POWER ---------------- */

async function fetchPowerData(
  p: Place,
  from: number,
  to: number,
  signal: AbortSignal
): Promise<PowerData> {
  const params = new URLSearchParams({
    parameters: "T2M",
    community: "AG",
    latitude: String(p.lat),
    longitude: String(p.lon),
    start: String(from),
    end: String(to),
    format: "JSON",
  });
  const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("NASA POWER took more than 30 seconds to respond. Please try again.");
    }
    throw e;
  }
  if (!res.ok) throw new Error(`NASA POWER responded with error ${res.status}`);
  const json = await res.json();
  const data = json?.properties?.parameter;
  if (!data) throw new Error("The NASA POWER response does not have the expected format");
  return data as PowerData;
}

// Raw monthly POWER value (key "YYYYMM"). null if missing (-999 = no data).
function monthlyValue(data: PowerData, variable: PowerVariable, year: number, month: number): number | null {
  const raw = data[variable]?.[`${year}${String(month).padStart(2, "0")}`];
  return typeof raw === "number" && raw > -900 ? raw : null;
}

// One curve per sowing year. Only years with ALL cycle months published are included.
function monthlyCurves(data: PowerData, sowMonth: number, nMonths: number, years: number[]): Curve[] {
  const complete: Curve[] = [];
  for (const sowYear of years) {
    const values: number[] = [];
    let isComplete = true;
    for (let i = 0; i < nMonths; i++) {
      const idx = sowMonth - 1 + i;
      const v = monthlyValue(data, "T2M", sowYear + Math.floor(idx / 12), (idx % 12) + 1);
      if (v === null) {
        isComplete = false;
        break;
      }
      values.push(v);
    }
    if (isComplete) complete.push({ sowYear, values });
  }
  return complete;
}

/* ---------------- Rainfall, ET0 and daily minimum: ERA5 via Open-Meteo ---------------- */

// Cache by coordinates so 20 years of daily data are not downloaded again.
const eraCache = new Map<string, EraData>();

// The "era5" model is used, not "era5_land": with era5_land rainfall comes back empty.
async function fetchEraData(
  p: Place,
  from: number,
  to: number,
  signal: AbortSignal
): Promise<EraData> {
  const cacheKey = `${p.lat},${p.lon},${from},${to}`;
  const cached = eraCache.get(cacheKey);
  if (cached) return cached;

  // ERA5 is published with ~5 days of delay
  const limit = new Date(Date.now() - 7 * 864e5);
  const end = to >= limit.getFullYear() ? limit.toISOString().slice(0, 10) : `${to}-12-31`;

  const params = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    start_date: `${from}-01-01`,
    end_date: end,
    daily: "precipitation_sum,temperature_2m_min,et0_fao_evapotranspiration",
    models: "era5",
    timezone: "auto",
  });

  let res: Response;
  try {
    res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("Open-Meteo (ERA5) took more than 45 seconds to respond. Please try again.");
    }
    throw e;
  }
  if (!res.ok) throw new Error(`Open-Meteo (ERA5) responded with error ${res.status}`);

  const json = await res.json();
  const d = json?.daily;
  if (!d?.time || !d?.precipitation_sum || !d?.temperature_2m_min) {
    throw new Error("The ERA5 response does not have the expected format");
  }
  const dailyEt0: (number | null)[] | undefined = d.et0_fao_evapotranspiration;

  const acc: Record<string, { n: number; p: number; tmin: number; nE: number; e: number }> = {};
  (d.time as string[]).forEach((day, i) => {
    const p = d.precipitation_sum[i];
    const tm = d.temperature_2m_min[i];
    if (p == null || tm == null) return;
    const k = day.slice(0, 4) + day.slice(5, 7);
    const a = (acc[k] ??= { n: 0, p: 0, tmin: Infinity, nE: 0, e: 0 });
    a.n++;
    a.p += p;
    a.tmin = Math.min(a.tmin, tm);
    const e = dailyEt0?.[i];
    if (e != null) {
      a.nE++;
      a.e += e;
    }
  });

  const out: EraData = {};
  for (const [k, a] of Object.entries(acc)) {
    const days = daysInMonth(Number(k.slice(0, 4)), Number(k.slice(4)));
    if (a.n < days) continue; // complete months only
    out[k] = { rain: a.p, et0: a.nE >= days ? a.e : null, tMinAbs: a.tmin };
  }
  if (Object.keys(out).length === 0) throw new Error("ERA5 returned no complete months for this point.");

  eraCache.set(cacheKey, out);
  return out;
}

function eraMonth(data: EraData, year: number, month: number): EraMonth | null {
  return data[`${year}${String(month).padStart(2, "0")}`] ?? null;
}

// Monthly values (mm) for each sowing year with a complete cycle: one array of nMonths per year.
function eraCycles(
  data: EraData,
  field: "rain" | "et0",
  sowMonth: number,
  nMonths: number,
  years: number[]
): number[][] {
  const cycles: number[][] = [];
  for (const sowYear of years) {
    const monthly: number[] = [];
    let complete = true;
    for (let i = 0; i < nMonths; i++) {
      const idx = sowMonth - 1 + i;
      const m = eraMonth(data, sowYear + Math.floor(idx / 12), (idx % 12) + 1);
      const v = m ? m[field] : null;
      if (v === null || v === undefined) {
        complete = false;
        break;
      }
      monthly.push(v);
    }
    if (complete) cycles.push(monthly);
  }
  return cycles;
}

// Lowest daily minimum temperature of each complete cycle (for lethal temperature).
function cycleMinimums(data: EraData, sowMonth: number, nMonths: number, years: number[]): number[] {
  const minimums: number[] = [];
  for (const sowYear of years) {
    let minimum = Infinity;
    let complete = true;
    for (let i = 0; i < nMonths; i++) {
      const idx = sowMonth - 1 + i;
      const m = eraMonth(data, sowYear + Math.floor(idx / 12), (idx % 12) + 1);
      if (!m) {
        complete = false;
        break;
      }
      minimum = Math.min(minimum, m.tMinAbs);
    }
    if (complete) minimums.push(minimum);
  }
  return minimums;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function classifyRange(v: number, r: Range): Class {
  const min = r.min ?? -Infinity;
  const max = r.max ?? Infinity;
  const optMin = r.optMin ?? min;
  const optMax = r.optMax ?? max;
  if (v < min || v > max) return "outside";
  if (v >= optMin && v <= optMax) return "optimal";
  return "absolute";
}

// Cycle length in days: FAO minimum + 30 (Recocrop criterion), unless min = max.
function cycleDays(c: CropEco): number | null {
  const { min, max } = c.cicloDias;
  if (min === null) return max;
  if (max !== null && max === min) return min;
  return min + 30;
}

function niceTicks(min: number, max: number, approx = 5): number[] {
  const raw = (max - min) / approx;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
  const marks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    marks.push(Number(v.toFixed(6)));
  }
  return marks;
}

/* ---------------- Analysis and criteria ---------------- */

function analyze(curves: Curve[], range: Range, nMonths: number): Analysis | null {
  if (curves.length === 0) return null;
  const n = curves.length;

  const byMonth: MonthStat[] = [];
  for (let i = 0; i < nMonths; i++) {
    const vals = curves.map((c) => c.values[i]);
    const classes = vals.map((v) => classifyRange(v, range));
    byMonth.push({
      n,
      ok: classes.filter((c) => c !== "outside").length,
      low: range.min !== null ? vals.filter((v) => v < range.min!).length : 0,
      high: range.max !== null ? vals.filter((v) => v > range.max!).length : 0,
      median: median(vals),
    });
  }

  const cycleOk = curves.filter((c) => c.values.every((v) => classifyRange(v, range) !== "outside")).length;

  let critical: Analysis["critical"] = null;
  let maxFails = 0;
  for (let i = 0; i < byMonth.length; i++) {
    const fails = n - byMonth[i].ok;
    if (fails > maxFails) {
      maxFails = fails;
      critical = { month: i, fails };
    }
  }

  return { n, curves, byMonth, cycleOk, critical };
}

function summarizeRain(cycles: number[][], range: Range, nMonths: number): RainSummary | null {
  if (cycles.length === 0) return null;
  const totals = cycles.map((c) => c.reduce((s, v) => s + v, 0));
  let dry = 0;
  for (let i = 0; i < nMonths; i++) {
    if (median(cycles.map((c) => c[i])) < DRY_MONTH_MM) dry++;
  }
  return {
    n: totals.length,
    median: median(totals),
    p10: percentile(totals, 10),
    p90: percentile(totals, 90),
    ok: totals.filter((t) => classifyRange(t, range) !== "outside").length,
    dry,
  };
}

// Typical cycle ET0 (median of the totals). Informational only: it does not enter the verdict.
function cycleEt0(cycles: number[][]): number | null {
  if (cycles.length < MIN_YEARS) return null;
  return median(cycles.map((c) => c.reduce((s, v) => s + v, 0)));
}

function temperatureVerdict(a: Analysis | null, range: Range): Verdict {
  if (!a || a.n < MIN_YEARS) return "none";
  const medianOutside = a.byMonth.some((m) => classifyRange(m.median, range) === "outside");
  if (medianOutside) return "no";
  const share = a.cycleOk / a.n;
  if (share >= YES_THRESHOLD) return "yes";
  if (share >= CAUTION_THRESHOLD) return "caution";
  return "no";
}

const VERDICT_OF_CLASS: Record<Class, Verdict> = { optimal: "yes", absolute: "caution", outside: "no" };

const GRAVITY: Record<Verdict, number> = { none: -1, yes: 0, caution: 1, no: 2 };

// Law of the minimum: the worst evaluated factor rules.
function worst(vs: Verdict[]): Verdict {
  const ev = vs.filter((v) => v !== "none");
  if (ev.length === 0) return "none";
  return ev.reduce((a, b) => (GRAVITY[b] > GRAVITY[a] ? b : a));
}

// Cycle rainfall: the typical value rules (median vs range) and it is lowered if few years comply.
function rainVerdict(r: RainSummary | null, range: Range): Verdict {
  if (!r || r.n < MIN_YEARS) return "none";
  const byMedian = VERDICT_OF_CLASS[classifyRange(r.median, range)];
  const share = r.ok / r.n;
  const byYears: Verdict = share >= YES_THRESHOLD ? "yes" : share >= CAUTION_THRESHOLD ? "caution" : "no";
  return worst([byMedian, byYears]);
}

// Temperature decides whether there is enough data: if it could not be evaluated,
// the overall result is only shown when another factor already gives a sure "no".
function combine(vTemp: Verdict, ...others: Verdict[]): Verdict {
  const g = worst([vTemp, ...others]);
  if (vTemp === "none" && g !== "no") return "none";
  return g;
}

function monthLevel(m: MonthStat): MonthLevel {
  const share = m.ok / m.n;
  if (share >= YES_THRESHOLD) return "good";
  if (share >= CAUTION_THRESHOLD) return "fair";
  return "risk";
}

// Evaluates any crop sown in a given month (same logic as the main analysis).
// Used by the rotation suggestions.
function evaluateCrop(
  c: CropEco,
  month: number,
  power: PowerData | null,
  era: EraData | null,
  ph: SoilPh | null,
  years: number[]
): { nMonths: number; verdict: Verdict } | null {
  const d = cycleDays(c);
  if (!d || (!power && !era)) return null;
  const nMonths = Math.max(1, Math.round(d / 30));

  const a = power ? analyze(monthlyCurves(power, month, nMonths, years), c.temperatura, nMonths) : null;
  const rainRange = hasRange(c.lluviaAnual) ? c.lluviaAnual : null;
  const rain =
    era && rainRange ? summarizeRain(eraCycles(era, "rain", month, nMonths, years), rainRange, nMonths) : null;
  const phRange = hasRange(c.ph) ? c.ph : null;

  const vT = temperatureVerdict(a, c.temperatura);
  const vR: Verdict = rainRange ? rainVerdict(rain, rainRange) : "none";
  const vP: Verdict = phRange && ph ? VERDICT_OF_CLASS[classifyRange(ph.mean, phRange)] : "none";
  return { nMonths, verdict: combine(vT, vP, vR) };
}

/* ---------------- Soil (SoilGrids) ---------------- */

// Thickness (cm) of the SoilGrids layers used for pH (0–30 cm)
const LAYER_THICKNESS: Record<string, number> = { "0-5cm": 5, "5-15cm": 10, "15-30cm": 15 };

async function fetchPh(p: Place, signal: AbortSignal): Promise<SoilPh> {
  const params = new URLSearchParams();
  params.append("lon", String(p.lon));
  params.append("lat", String(p.lat));
  params.append("property", "phh2o");
  for (const d of Object.keys(LAYER_THICKNESS)) params.append("depth", d);
  for (const v of ["mean", "Q0.05", "Q0.95"]) params.append("value", v);

  let res: Response;
  try {
    res = await fetch(`https://rest.isric.org/soilgrids/v2.0/properties/query?${params.toString()}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("SoilGrids took more than 30 seconds to respond.");
    }
    throw e;
  }
  if (!res.ok) throw new Error(`SoilGrids responded with error ${res.status}`);

  const json = await res.json();
  const layer = (json?.properties?.layers ?? []).find((l: { name?: string }) => l.name === "phh2o");
  if (!layer) throw new Error("The SoilGrids response does not have the expected format");

  const factor: number = layer.unit_measure?.d_factor ?? 10; // pH comes multiplied by 10
  // Thickness-weighted average of the 0–30 cm layers (an approximation for the percentiles).
  const weigh = (key: string): number | null => {
    let sum = 0;
    let weight = 0;
    for (const depth of layer.depths ?? []) {
      const e = LAYER_THICKNESS[depth.label as string];
      const v = depth.values?.[key];
      if (e && typeof v === "number") {
        sum += v * e;
        weight += e;
      }
    }
    return weight > 0 ? sum / weight / factor : null;
  };

  const mean = weigh("mean");
  const p5 = weigh("Q0.05");
  const p95 = weigh("Q0.95");
  if (mean === null || p5 === null || p95 === null) {
    throw new Error("SoilGrids has no pH for this point.");
  }
  return { mean: round2(mean), p5: round2(p5), p95: round2(p95) };
}

/* ---------------- SVG colors (keep in sync with analyze-my-crops.css) ---------------- */

const C = {
  ink: "#243522",
  soft: "#71806d",
  line: "#dfe8d7",
  ideal: "#cfe5a3",
  tolerated: "#eaf3dc",
  years: "#397da4",
  yes: "#4f8f1f",
  caution: "#bf8120",
  no: "#b3402a",
  none: "#8a9683",
};

const VERDICT_COLOR: Record<Verdict, string> = { yes: C.yes, caution: C.caution, no: C.no, none: C.none };
const LEVEL_COLOR: Record<MonthLevel, string> = { good: C.yes, fair: C.caution, risk: C.no };
const CLASS_COLOR: Record<Class, string> = { optimal: C.yes, absolute: C.caution, outside: C.no };

const VERDICT_LABEL: Record<Verdict, string> = {
  yes: "Good to plant",
  caution: "Plant with caution",
  no: "Not recommended",
  none: "Not enough data",
};

/* ---------------- Temperature chart: every year + the typical year ---------------- */

// Same rendered height as VerticalGauge (300 * 200 / 180), so the three charts line up.
const CHART_HEIGHT = 333;

function TemperatureChart({ a, names, range }: { a: Analysis; names: string[]; range: Range }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);

  // The chart adapts its width to the column, but keeps a fixed height.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setW(Math.max(280, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = names.length;
  const H = CHART_HEIGHT;
  const M = { left: 40, right: 14, top: 14, bottom: 32 };

  const values = a.curves.flatMap((c) => c.values);
  const refs = [range.optMin, range.optMax].filter((v): v is number => v !== null);
  const low = Math.min(...values, ...refs);
  const high = Math.max(...values, ...refs);
  const pad = (high - low) * 0.12 || 1;
  const yMin = low - pad;
  const yMax = high + pad;

  const width = W - M.left - M.right;
  const height = H - M.top - M.bottom;
  const x = (i: number) => M.left + ((i + 0.5) / n) * width;
  const y = (v: number) => M.top + height - ((v - yMin) / (yMax - yMin)) * height;
  const clip = (v: number) => y(Math.min(Math.max(v, yMin), yMax));

  const trace = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const topAbs = range.max !== null ? clip(range.max) : M.top;
  const botAbs = range.min !== null ? clip(range.min) : M.top + height;
  const topOpt = range.optMax !== null ? clip(range.optMax) : M.top;
  const botOpt = range.optMin !== null ? clip(range.optMin) : M.top + height;

  const ticks = niceTicks(yMin, yMax, 5);
  const visibleLimit = (v: number | null) => v !== null && v > yMin && v < yMax;

  return (
    <div ref={box} style={{ width: "100%" }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Month-by-month temperature during the cycle in each past year, against the range the crop tolerates"
        style={{ display: "block", maxWidth: "100%" }}
      >
        <rect x={M.left} y={topAbs} width={width} height={Math.max(0, botAbs - topAbs)} fill={C.tolerated} />
        <rect x={M.left} y={topOpt} width={width} height={Math.max(0, botOpt - topOpt)} fill={C.ideal} />

        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + width} y1={y(t)} y2={y(t)} stroke={C.line} strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.soft}>
              {fmt(t)}°
            </text>
          </g>
        ))}

        {visibleLimit(range.max) && (
          <g>
            <line x1={M.left} x2={M.left + width} y1={y(range.max!)} y2={y(range.max!)} stroke={C.no} strokeDasharray="5 4" />
            <text x={M.left + width - 4} y={y(range.max!) - 5} textAnchor="end" fontSize={11} fill={C.no}>
              max tolerated: {fmt(range.max!)} °C
            </text>
          </g>
        )}
        {visibleLimit(range.min) && (
          <g>
            <line x1={M.left} x2={M.left + width} y1={y(range.min!)} y2={y(range.min!)} stroke={C.no} strokeDasharray="5 4" />
            <text x={M.left + width - 4} y={y(range.min!) + 14} textAnchor="end" fontSize={11} fill={C.no}>
              min tolerated: {fmt(range.min!)} °C
            </text>
          </g>
        )}

        {names.map((name, i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={C.soft}>
            {name.slice(0, 3)}
          </text>
        ))}

        {/* every past year, faint */}
        {a.curves.map((c) => (
          <path
            key={c.sowYear}
            d={trace(c.values)}
            fill="none"
            stroke={C.years}
            strokeOpacity={0.22}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <title>{`Sown in ${c.sowYear}`}</title>
          </path>
        ))}

        {/* the typical year */}
        <path d={trace(a.byMonth.map((m) => m.median))} fill="none" stroke={C.ink} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        {a.byMonth.map((m, i) => (
          <circle key={i} cx={x(i)} cy={y(m.median)} r={5} fill={LEVEL_COLOR[monthLevel(m)]} stroke="#fff" strokeWidth={2}>
            <title>{`${names[i]}: typically ${fmt(m.median, 1)} °C`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

/* ---------------- Vertical gauge: one value of the place against the crop range ---------------- */
/* Used for pH and for cycle rainfall: they have no time axis. */
function VerticalGauge({
  value,
  low,
  high,
  range,
  dec,
  fromZero,
  aria,
  valueTooltip,
  rangeTooltip,
}: {
  value: number;
  low: number;
  high: number;
  range: Range;
  dec: number;
  fromZero?: boolean;
  aria: string;
  valueTooltip: string;
  rangeTooltip: string;
}) {
  const W = 180;
  const H = 300;
  const M = { left: 46, top: 14, bottom: 14 };
  const barX = M.left;
  const barW = 60;
  const height = H - M.top - M.bottom;

  const points = [value, low, high, range.min, range.optMin, range.optMax, range.max].filter(
    (v): v is number => v !== null
  );
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo) * 0.08 || 0.5;
  const a = fromZero ? Math.max(0, lo - pad) : lo - pad;
  const b = hi + pad;

  const y = (v: number) => M.top + height - ((v - a) / (b - a)) * height;
  const clip = (v: number) => y(Math.min(Math.max(v, a), b));

  const topAbs = range.max !== null ? clip(range.max) : M.top;
  const botAbs = range.min !== null ? clip(range.min) : M.top + height;
  const topOpt = range.optMax !== null ? clip(range.optMax) : M.top;
  const botOpt = range.optMin !== null ? clip(range.optMin) : M.top + height;
  const color = CLASS_COLOR[classifyRange(value, range)];
  const ticks = niceTicks(a, b, 5);
  const cx = barX + barW / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={aria}
      style={{ width: "100%", maxWidth: 200, height: "auto", display: "block", margin: "0 auto" }}
    >
      <rect x={barX} y={topAbs} width={barW} height={Math.max(0, botAbs - topAbs)} fill={C.tolerated} />
      <rect x={barX} y={topOpt} width={barW} height={Math.max(0, botOpt - topOpt)} fill={C.ideal} />

      {ticks.map((t) => (
        <g key={t}>
          <line x1={barX - 5} x2={barX} y1={y(t)} y2={y(t)} stroke={C.soft} />
          <text x={barX - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.soft}>
            {fmt(t, dec)}
          </text>
        </g>
      ))}

      {range.max !== null && (
        <g>
          <line x1={barX - 4} x2={barX + barW + 4} y1={clip(range.max)} y2={clip(range.max)} stroke={C.no} strokeDasharray="5 4" />
          <text x={barX + barW + 8} y={clip(range.max) + 4} fontSize={11} fill={C.no}>
            max. {fmt(range.max, dec)}
          </text>
        </g>
      )}
      {range.min !== null && (
        <g>
          <line x1={barX - 4} x2={barX + barW + 4} y1={clip(range.min)} y2={clip(range.min)} stroke={C.no} strokeDasharray="5 4" />
          <text x={barX + barW + 8} y={clip(range.min) + 4} fontSize={11} fill={C.no}>
            min. {fmt(range.min, dec)}
          </text>
        </g>
      )}

      <line x1={cx} x2={cx} y1={y(high)} y2={y(low)} stroke={color} strokeWidth={5} strokeOpacity={0.55} strokeLinecap="round">
        <title>{rangeTooltip}</title>
      </line>
      <circle cx={cx} cy={y(value)} r={9} fill={color} stroke="#fff" strokeWidth={3}>
        <title>{valueTooltip}</title>
      </circle>
    </svg>
  );
}

/* ---------------- Water balance: rainfall (bars) vs ET0 (line), typical year ---------------- */

function WaterBalanceChart({ rain, et0, names }: { rain: number[]; et0: number[] | null; names: string[] }) {
  const n = names.length;
  const W = 460;
  const H = 150;
  const M = { left: 36, right: 8, top: 8, bottom: 22 };
  const width = W - M.left - M.right;
  const height = H - M.top - M.bottom;
  const top = Math.max(...rain, ...(et0 ?? [0]), 1) * 1.1;
  const y = (v: number) => M.top + height - (v / top) * height;
  const step = width / n;
  const bw = Math.min(30, step * 0.6);
  const x = (i: number) => M.left + step * (i + 0.5);
  const ticks = niceTicks(0, top, 3);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Monthly rainfall against potential evaporation during the cycle"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={M.left + width} y1={y(t)} y2={y(t)} stroke={C.line} />
          <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.soft}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {rain.map((v, i) => (
        <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx={3} fill={C.years} fillOpacity={0.75}>
          <title>{`${names[i]}: ${fmt(v)} mm of rain`}</title>
        </rect>
      ))}
      {et0 && (
        <>
          <path
            d={et0.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={C.caution}
            strokeWidth={2.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {et0.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={C.caution} stroke="#fff" strokeWidth={2}>
              <title>{`${names[i]}: ${fmt(v)} mm of ET0`}</title>
            </circle>
          ))}
        </>
      )}
      {names.map((name, i) => (
        <text key={i} x={x(i)} y={H - 9} textAnchor="middle" fontSize={11} fill={C.soft}>
          {name.slice(0, 3)}
        </text>
      ))}
    </svg>
  );
}

/* ---------------- Place search (Open-Meteo Geocoding) ---------------- */

async function searchPlaces(text: string, signal: AbortSignal): Promise<GeoResult[]> {
  const params = new URLSearchParams({ name: text, count: "6", language: "en", format: "json" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!res.ok) throw new Error(`The place search responded with error ${res.status}`);
  const json = await res.json();
  const list: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    admin1?: string;
    country?: string;
  }[] = Array.isArray(json?.results) ? json.results : [];
  return list.map((r) => ({
    id: r.id,
    name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    lat: round2(r.latitude),
    lon: round2(r.longitude),
  }));
}

/* ---------------- Search box with suggestions while typing ---------------- */

function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setNoResults(false);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const wait = setTimeout(() => {
      setSearching(true);
      setError(null);
      searchPlaces(q, controller.signal)
        .then((r) => {
          setSuggestions(r);
          setNoResults(r.length === 0);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setSuggestions([]);
          setError(e instanceof Error ? e.message : "Could not search for the place.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(wait);
      controller.abort();
    };
  }, [text]);

  function pick(r: GeoResult) {
    onPick({ name: r.name, lat: r.lat, lon: r.lon });
    setText("");
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="cm-searchbox">
      <input
        type="text"
        value={text}
        placeholder="Search for a town or place"
        aria-label="Search for a town or place"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && suggestions[0]) pick(suggestions[0]);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && text.trim().length >= 2 && (
        <ul className="cm-sug" role="listbox">
          {searching && suggestions.length === 0 && <li className="cm-sug-info">Searching…</li>}
          {noResults && !searching && <li className="cm-sug-info">Place not found.</li>}
          {error && <li className="cm-sug-info cm-error">{error}</li>}
          {suggestions.map((r) => (
            <li key={r.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Map: realistic globe that turns into a sketch map when zoomed in ---------------- */
/* MapLibre GL is loaded from a CDN the first time; nothing to install.
   From far away you see the real Earth (NASA Blue Marble). At country scale that layer
   fades out and the light sketch map (OpenFreeMap / OpenStreetMap) remains. */

const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css";
// Light, minimalist sketch map (OpenFreeMap + OpenStreetMap), no API key
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
// Realistic Earth (NASA GIBS, public domain), no API key.
// In epsg3857 the tile matrix set of this layer is GoogleMapsCompatible_Level8 (zoom 0–8).
const REAL_EARTH =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";

const INITIAL_ZOOM = 0.9; // almost the whole globe
const PLACE_ZOOM = 5.5; // when a place is picked, zoom in to the sketch map
const REAL_UNTIL_ZOOM = 3.5; // up to here only the real Earth is visible
const SKETCH_FROM_ZOOM = 5.5; // from here only the sketch map is visible (both blend in between)

const MAP_TEXTS = {
  "CooperativeGesturesHandler.WindowsHelpText": "Use Ctrl + scroll to zoom",
  "CooperativeGesturesHandler.MacHelpText": "Use ⌘ + scroll to zoom",
  "CooperativeGesturesHandler.MobileHelpText": "Use two fingers to move the map",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let maplibrePromise: Promise<any> | null = null;

function loadMapLibre(): Promise<any> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (maplibrePromise) return maplibrePromise;

  maplibrePromise = new Promise((resolve, reject) => {
    if (!document.getElementById("maplibre-css")) {
      const css = document.createElement("link");
      css.id = "maplibre-css";
      css.rel = "stylesheet";
      css.href = MAPLIBRE_CSS;
      document.head.appendChild(css);
    }
    const s = document.createElement("script");
    s.src = MAPLIBRE_JS;
    s.async = true;
    s.onload = () => resolve((window as any).maplibregl);
    s.onerror = () => {
      maplibrePromise = null;
      s.remove();
      reject(new Error("Could not load the map. Check your connection; you can still search for the place by name."));
    };
    document.head.appendChild(s);
  });
  return maplibrePromise;
}

function GlobeMap({ place, onPick }: { place: Place; onPick: (p: Place) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const placeRef = useRef(place);
  const onPickRef = useRef(onPick);
  const lastClick = useRef<string | null>(null);
  placeRef.current = place;
  onPickRef.current = onPick;
  const [mapError, setMapError] = useState<string | null>(null);

  // Create the map only once
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    loadMapLibre()
      .then((ml) => {
        if (cancelled || !container.current) return;
        const p = placeRef.current;
        // On touch screens two fingers are required to move the map, so page scrolling is not blocked.
        const isTouch = window.matchMedia("(pointer: coarse)").matches;

        const map = new ml.Map({
          container: container.current,
          style: MAP_STYLE,
          center: [p.lon, p.lat],
          zoom: INITIAL_ZOOM,
          minZoom: 0,
          maxZoom: 16,
          attributionControl: false, // the credit is shown outside the circle
          cooperativeGestures: isTouch,
          locale: MAP_TEXTS,
        });

        map.on("style.load", () => {
          map.setProjection({ type: "globe" });

          // Real Earth layer above the sketch map and below the labels.
          // It fades out at country scale and reveals the sketch map.
          if (!map.getSource("real-earth")) {
            map.addSource("real-earth", {
              type: "raster",
              tiles: [REAL_EARTH],
              tileSize: 256,
              maxzoom: 8,
            });
            const firstLabel = (map.getStyle().layers as any[]).find((l) => l.type === "symbol")?.id;
            map.addLayer(
              {
                id: "real-earth",
                type: "raster",
                source: "real-earth",
                maxzoom: SKETCH_FROM_ZOOM + 0.2,
                paint: {
                  "raster-opacity": ["interpolate", ["linear"], ["zoom"], REAL_UNTIL_ZOOM, 1, SKETCH_FROM_ZOOM, 0],
                  "raster-fade-duration": 150,
                },
              },
              firstLabel
            );
          }
        });

        // A failed tile of the real Earth layer must not break or flood the console:
        // the sketch map underneath keeps working.
        map.on("error", (e: any) => {
          if (e?.sourceId === "real-earth") return;
          console.error(e?.error ?? e);
        });

        map.scrollZoom?.setWheelZoomRate?.(1 / 250); // slightly more responsive wheel

        const pin = document.createElement("div");
        pin.className = "cm-pin";
        const marker = new ml.Marker({ element: pin }).setLngLat([p.lon, p.lat]).addTo(map);

        map.on("click", (e: any) => {
          const lng = ((((e.lngLat.lng + 180) % 360) + 360) % 360) - 180;
          const picked = { name: "Point picked on the map", lat: round2(e.lngLat.lat), lon: round2(lng) };
          lastClick.current = `${picked.lat},${picked.lon}`;
          onPickRef.current(picked);
        });

        mapRef.current = map;
        markerRef.current = marker;
        cleanup = () => {
          map.remove();
          mapRef.current = null;
          markerRef.current = null;
        };
      })
      .catch((e: unknown) => {
        if (!cancelled) setMapError(e instanceof Error ? e.message : "Could not load the map.");
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Move the marker when the place changes (search, GPS or click)
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([place.lon, place.lat]);
    // if it came from a click on the map, do not recenter (the user is already looking there)
    if (lastClick.current === `${place.lat},${place.lon}`) {
      lastClick.current = null;
      return;
    }
    map.easeTo({
      center: [place.lon, place.lat],
      zoom: Math.max(map.getZoom(), PLACE_ZOOM),
      duration: 1400,
    });
  }, [place.lat, place.lon]);

  if (mapError) {
    return (
      <div className="cm-globe-wrap">
        <div className="cm-globe-error">
          <p className="cm-error">{mapError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cm-globe-wrap">
      <div ref={container} className="cm-globe" role="application" aria-label="Globe to pick the planting location" />
      <div className="cm-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          −
        </button>
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------------- Status badge inside the title of each chart ---------------- */

const FACTOR_LABEL: Record<Verdict, string> = {
  yes: "Ideal",
  caution: "Tolerable",
  no: "Out of range",
  none: "No data",
};

function Badge({ v, text }: { v: Verdict; text: string }) {
  return (
    <span className="cm-badge">
      <span className="cm-dot" style={{ background: VERDICT_COLOR[v] }} />
      {text}
    </span>
  );
}

/* ---------------- Page ---------------- */

export default function AnalyzeMyCropsPage() {
  const [place, setPlace] = useState<Place>(INITIAL_PLACE);
  const [attempt, setAttempt] = useState(0);
  const [powerResult, setPowerResult] = useState<PowerResult | null>(null); // NASA POWER
  const [eraRes, setEraRes] = useState<Extra<EraData> | null>(null); // ERA5
  const [phRes, setPhRes] = useState<Extra<SoilPh> | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [eco, setEco] = useState<EcoCrop | null>(null);
  const [ecoError, setEcoError] = useState<string | null>(null);

  // Base crop + base month (what the user picks), plus the rotation chain built on top of it.
  const [baseCrop, setBaseCrop] = useState("Maíz");
  const [baseMonth, setBaseMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [chain, setChain] = useState<RotationStep[]>([]);

  // The active step is the last one of the chain, or the base if the chain is empty.
  const lastStep = chain[chain.length - 1];
  const cropName = lastStep ? lastStep.crop : baseCrop;
  const sowMonth = lastStep ? lastStep.month : baseMonth;

  const yearEnd = new Date().getFullYear();
  const yearStart = yearEnd - YEARS_BACK;
  const key = `${place.lat},${place.lon},${yearStart},${yearEnd},${attempt}`;
  const extraKey = `${place.lat},${place.lon},${attempt}`;

  // Monthly mean temperature: NASA POWER
  useEffect(() => {
    const controller = new AbortController();
    fetchPowerData(place, yearStart, yearEnd, controller.signal)
      .then((data) => setPowerResult({ key, data, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPowerResult({
          key,
          data: null,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      });
    return () => controller.abort();
  }, [key, place, yearStart, yearEnd]);

  // Rainfall, ET0 and daily minimum: ERA5 via Open-Meteo
  useEffect(() => {
    const controller = new AbortController();
    fetchEraData(place, yearStart, yearEnd, controller.signal)
      .then((data) => setEraRes({ key, value: data, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setEraRes({
          key,
          value: null,
          error: e instanceof Error ? e.message : "Unknown error while requesting ERA5",
        });
      });
    return () => controller.abort();
  }, [key, place, yearStart, yearEnd]);

  // Soil pH: SoilGrids
  useEffect(() => {
    const controller = new AbortController();
    fetchPh(place, controller.signal)
      .then((v) => setPhRes({ key: extraKey, value: v, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPhRes({
          key: extraKey,
          value: null,
          error: e instanceof Error ? e.message : "Unknown error while requesting pH",
        });
      });
    return () => controller.abort();
  }, [extraKey, place]);

  useEffect(() => {
    fetch("/datos/ecocrop.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Could not read ecocrop.json (error ${r.status})`);
        return r.json();
      })
      .then((j: EcoCrop) => {
        setEco(j);
        // if the default crop does not exist in the file, fall back to the first one
        setBaseCrop((prev) => (j.cultivos[prev] ? prev : Object.keys(j.cultivos)[0] ?? prev));
      })
      .catch((e: unknown) =>
        setEcoError(e instanceof Error ? e.message : "Unknown error while reading ecocrop.json")
      );
  }, []);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setGpsError("Your browser cannot provide your location.");
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        setPlace({
          name: "My location",
          lat: round2(pos.coords.latitude),
          lon: round2(pos.coords.longitude),
        });
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. You can search for the place or tap the map."
            : "Could not get your location. Try searching for the place or tapping the map."
        );
      },
      { timeout: 15000 }
    );
  }

  const years = useMemo(
    () => Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => yearStart + i),
    [yearStart, yearEnd]
  );

  const powerCur = powerResult && powerResult.key === key ? powerResult : null;
  const powerData = powerCur?.data ?? null;
  const eraCur = eraRes && eraRes.key === key ? eraRes : null;
  const eraData = eraCur?.value ?? null;
  const phCur = phRes && phRes.key === extraKey ? phRes : null;
  const phValue = phCur?.value ?? null;

  const crop = eco?.cultivos[cropName] ?? null;
  const days = crop ? cycleDays(crop) : null;
  const nMonths = days ? Math.max(1, Math.round(days / 30)) : 1;
  const cropLower = cropName.toLowerCase();

  // pH: does not depend on the month, so it is evaluated only once
  const phRange = crop && hasRange(crop.ph) ? crop.ph : null;
  const vPh: Verdict = phRange && phValue ? VERDICT_OF_CLASS[classifyRange(phValue.mean, phRange)] : "none";

  // Rainfall: the EcoCrop range is for the cycle, so it depends on the sowing month
  const rainRange = crop && hasRange(crop.lluviaAnual) ? crop.lluviaAnual : null;

  // One analysis for each of the 12 possible sowing months:
  // temperature (POWER) and rainfall + ET0 (ERA5), each from its own source.
  const byStartMonth = useMemo(() => {
    if (!crop || !days || (!powerData && !eraData)) return [];
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const a = powerData
        ? analyze(monthlyCurves(powerData, month, nMonths, years), crop.temperatura, nMonths)
        : null;
      const rain =
        eraData && rainRange
          ? summarizeRain(eraCycles(eraData, "rain", month, nMonths, years), rainRange, nMonths)
          : null;
      const et0 = eraData ? cycleEt0(eraCycles(eraData, "et0", month, nMonths, years)) : null;
      return {
        month,
        a,
        rain,
        et0,
        vT: temperatureVerdict(a, crop.temperatura),
        vR: rainRange ? rainVerdict(rain, rainRange) : ("none" as Verdict),
      };
    });
  }, [powerData, eraData, crop, days, nMonths, years, rainRange]);

  const sel = byStartMonth[sowMonth - 1] ?? null;
  const vTemp: Verdict = sel?.vT ?? "none";
  const rainSummary = sel?.rain ?? null;
  const et0Cycle = sel?.et0 ?? null;
  const vRain: Verdict = sel?.vR ?? "none";
  const overall = combine(vTemp, vPh, vRain);
  const cycleNames = Array.from({ length: nMonths }, (_, i) => MONTHS[(sowMonth - 1 + i) % 12]);
  const endMonthName = cycleNames[cycleNames.length - 1];
  const bestMonths = byStartMonth
    .filter((m) => combine(m.vT, vPh, m.vR) === "yes")
    .map((m) => MONTHS[m.month - 1]);

  // Month in which a following crop would be sown (right after this cycle ends)
  const nextMonth = ((sowMonth - 1 + nMonths) % 12) + 1;

  // Crop rotation: every other crop, evaluated for the month that follows the current cycle.
  const rotationOptions = useMemo(() => {
    if (!eco || (!powerData && !eraData)) return [];
    const list: { name: string; verdict: Verdict; nMonths: number }[] = [];
    for (const [name, c] of Object.entries(eco.cultivos)) {
      if (name === cropName) continue;
      const r = evaluateCrop(c, nextMonth, powerData, eraData, phValue, years);
      if (r && (r.verdict === "yes" || r.verdict === "caution")) {
        list.push({ name, verdict: r.verdict, nMonths: r.nMonths });
      }
    }
    list.sort((a, b) => GRAVITY[a.verdict] - GRAVITY[b.verdict]);
    return list;
  }, [eco, cropName, nextMonth, powerData, eraData, phValue, years]);

  const climateLoading = !powerData && !powerCur?.error && !eraData && !eraCur?.error;
  const climateFailed = !powerData && !eraData && (!!powerCur?.error || !!eraCur?.error);
  const rotationSteps: RotationStep[] = [{ crop: baseCrop, month: baseMonth }, ...chain];

  function pickCrop(name: string) {
    setBaseCrop(name);
    setChain([]);
  }
  function pickMonth(m: number) {
    setBaseMonth(m);
    setChain([]);
  }
  function addRotation(name: string) {
    setChain((prev) => [...prev, { crop: name, month: nextMonth }]);
  }

  // Lethal temperature (optional): lowest daily minimum of each cycle (ERA5)
  const tLethal = crop?.tLetal ?? null;
  const frost = useMemo(() => {
    if (!eraData || tLethal === null || !crop) return null;
    const minimums = cycleMinimums(eraData, sowMonth, nMonths, years);
    if (minimums.length === 0) return null;
    return { n: minimums.length, below: minimums.filter((m) => m < tLethal).length };
  }, [eraData, tLethal, crop, sowMonth, nMonths, years]);

  // Rainfall and ET0 per cycle month (typical year), for the water balance chart
  const monthlyCycle = useMemo(() => {
    if (!eraData) return null;
    const rain = eraCycles(eraData, "rain", sowMonth, nMonths, years);
    if (rain.length < MIN_YEARS) return null;
    const et = eraCycles(eraData, "et0", sowMonth, nMonths, years);
    const med = (c: number[][]) => Array.from({ length: nMonths }, (_, i) => median(c.map((r) => r[i])));
    return { rain: med(rain), et0: et.length >= MIN_YEARS ? med(et) : null };
  }, [eraData, sowMonth, nMonths, years]);

  // How much of the ET0 is covered by rainfall (informational only)
  const coverage = rainSummary && et0Cycle && et0Cycle > 0 ? rainSummary.median / et0Cycle : null;
  const coverageText =
    coverage === null
      ? null
      : coverage >= 1
      ? `${fmt(coverage, 1)}× the ET0`
      : `${fmt(coverage * 100)} % of the ET0`;
  const deficitMonths =
    monthlyCycle?.et0 ? monthlyCycle.rain.filter((v, i) => v < monthlyCycle.et0![i]).length : null;

  function temperatureExplanation(): string {
    if (!sel || !sel.a || !crop) return "";
    const a = sel.a;
    if (sel.vT === "none") {
      return `Only ${a.n} years have complete temperature data for this cycle; at least ${MIN_YEARS} are needed to give an opinion.`;
    }
    if (!a.critical) return "In no year did the temperature leave the range the crop tolerates during the cycle.";
    const m = a.byMonth[a.critical.month];
    const r = crop.temperatura;
    const cold = m.low >= m.high;
    const limit = cold ? r.min : r.max;
    return `The most delicate month is ${cycleNames[a.critical.month]}: in ${a.critical.fails} of ${a.n} years it was ${
      cold ? "colder than the minimum" : "hotter than the maximum"
    } that ${cropLower} tolerates (${limit !== null ? fmt(limit) : "?"} °C).`;
  }

  function rainExplanation(): string {
    if (!rainSummary || !rainRange) return "";
    const r = rainRange;
    const med = rainSummary.median;
    const medText = fmt(med);
    const n = (v: number | null) => (v !== null ? fmt(v) : "?");
    if (vRain === "none") {
      return `Only ${rainSummary.n} years have complete rainfall data for this cycle; at least ${MIN_YEARS} are needed to give an opinion.`;
    }
    const belowIdeal = r.optMin !== null && med < r.optMin;
    const aboveIdeal = r.optMax !== null && med > r.optMax;
    if (vRain === "no") {
      if (r.min !== null && med < r.min) {
        return `Sowing in ${MONTHS[sowMonth - 1]} brings about ${medText} mm of rain during the cycle, less than ${cropLower} tolerates (minimum ${n(r.min)} mm). It would need irrigation.`;
      }
      if (r.max !== null && med > r.max) {
        return `Sowing in ${MONTHS[sowMonth - 1]} brings about ${medText} mm of rain during the cycle, more than ${cropLower} tolerates (maximum ${n(r.max)} mm).`;
      }
      return `In ${rainSummary.n - rainSummary.ok} of ${rainSummary.n} years the cycle rainfall was outside what ${cropLower} tolerates (${n(r.min)}–${n(r.max)} mm).`;
    }
    if (belowIdeal) {
      return `About ${medText} mm of rain falls during the cycle: ${cropLower} tolerates it, but it is below the ideal (${n(r.optMin)}–${n(r.optMax)} mm). Supplemental irrigation would help.`;
    }
    if (aboveIdeal) {
      return `About ${medText} mm of rain falls during the cycle: ${cropLower} tolerates it, but it is above the ideal (${n(r.optMin)}–${n(r.optMax)} mm).`;
    }
    return `In ${rainSummary.n - rainSummary.ok} of ${rainSummary.n} years the cycle rainfall was outside what ${cropLower} tolerates (${n(r.min)}–${n(r.max)} mm).`;
  }

  function phExplanation(): string {
    if (!phValue || !phRange) return "";
    return vPh === "no"
      ? `Soil pH at this point (${fmt(phValue.mean, 1)}) is outside what ${cropLower} tolerates (${phRange.min ?? "?"}–${phRange.max ?? "?"}).`
      : `Soil pH at this point (${fmt(phValue.mean, 1)}) is tolerable, but not ideal for ${cropLower} (${phRange.optMin ?? "?"}–${phRange.optMax ?? "?"}).`;
  }

  function explanation(): string {
    if (!crop) return "";
    if (overall === "yes") {
      const parts = ["temperature"];
      if (vRain !== "none") parts.push("cycle rainfall");
      if (vPh !== "none") parts.push("soil pH");
      const list = joinList(parts);
      const base = `${list.charAt(0).toUpperCase()}${list.slice(1)} ${
        parts.length === 1 ? "is" : "are"
      } within what the crop tolerates.`;
      return vPh === "none" ? `${base} (Soil pH could not be evaluated yet.)` : base;
    }
    const gT = GRAVITY[vTemp];
    const gP = GRAVITY[vPh];
    const gR = GRAVITY[vRain];
    const worstG = Math.max(gT, gP, gR);
    if (gT === worstG) return temperatureExplanation();
    if (gP === worstG) return phExplanation();
    return rainExplanation();
  }

  const monthLower = MONTHS[sowMonth - 1].toLowerCase();
  const TITLE: Record<Verdict, string> = {
    yes: `Planting ${cropLower} in ${monthLower} is a good idea`,
    caution: `You can plant ${cropLower} in ${monthLower}, with caution`,
    no: `Planting ${cropLower} in ${monthLower} is not recommended`,
    none: "Not enough data to give an opinion yet",
  };

  return (
    <main className="cm">
      {/* ---------- Fixed top bar: logo + home ---------- */}
      <div className="cm-topbar">
        <Link href="/" className="cm-logo" aria-label="Farmer Query home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/farmer-query-logo.svg" alt="Farmer Query" />
        </Link>
        <Link href="/" className="cm-home">
          ← Home
        </Link>
      </div>

      {/* ---------- Header: verdict | location ---------- */}
      <header className="cm-head">
        <div className="cm-head-left">
          <div className="cm-head-title">
            <h1>Should I plant?</h1>
            <span className="cm-head-sub">
              Analyzing yearly patterns of the last {YEARS_BACK} years using NASA POWER, ERA5 (Open-Meteo),
              SoilGrids and FAO EcoCrop criteria
            </span>
          </div>
          {ecoError && <p className="cm-error">{ecoError}</p>}

          <section className={`cm-verdict ${overall}`} role="status">
            {!powerData && !powerCur?.error ? (
              <>
                <h2>Calculating…</h2>
                <p>Fetching the climate of recent years.</p>
              </>
            ) : powerCur?.error ? (
              <>
                <h2>Could not load the data</h2>
                <p className="cm-error">{powerCur.error}</p>
                <div>
                  <button type="button" className="cm-btn" onClick={() => setAttempt((n) => n + 1)}>
                    Retry
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>{TITLE[overall]}</h2>
                <p>{explanation()}</p>
                {overall !== "yes" && bestMonths.length > 0 && (
                  <p className="cm-best">
                    <strong>Best months for it:</strong> {bestMonths.join(", ")}.
                  </p>
                )}
                {eraCur?.error && <p className="cm-error">Could not load rainfall (ERA5): {eraCur.error}</p>}
              </>
            )}
          </section>
        </div>

        <div className="cm-head-right">
          <div className="cm-loc">
            <h2 className="cm-label">Where to plant</h2>
            <p className="cm-loc-name">{place.name}</p>
            <p className="cm-loc-coords">
              {place.lat}°, {place.lon}°
            </p>
            <div className="cm-search">
              <PlaceSearch onPick={setPlace} />
              <button type="button" className="cm-btn" onClick={useMyLocation} disabled={gpsLoading}>
                {gpsLoading ? "Locating…" : "My location"}
              </button>
            </div>
            {gpsError && <p className="cm-error">{gpsError}</p>}
            <p className="cm-note">Use the wheel to zoom the globe; up close it becomes a sketch map. Tap to mark your field.</p>
            <p className="cm-credit">Map: © OpenStreetMap · OpenFreeMap · NASA GIBS · MapLibre</p>
          </div>
          <GlobeMap place={place} onPick={setPlace} />
        </div>
      </header>

      <div className="cm-body">
        {/* ---------- Left: crops as a fixed vertical list, no scroll ---------- */}
        <nav className="cm-side" aria-label="Crops">
          <h2 className="cm-label">What to plant</h2>
          {!eco && !ecoError && <span className="cm-loading">Loading crops…</span>}
          {eco && (
            <div className="cm-crop-list" role="radiogroup" aria-label="Crop">
              {Object.keys(eco.cultivos).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={name === cropName}
                  className="cm-crop"
                  onClick={() => pickCrop(name)}
                >
                  <span className="cm-emoji">{cropIcon(name)}</span>
                  <span className="cm-crop-name">{name}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* ---------- Main column: fixed month strip + scrolling charts ---------- */}
        <div className="cm-main">
          <section className="cm-strip">
            <div className="cm-strip-head">
              <h2 className="cm-label" title="The dot shows how it would have gone sowing in that month">
                When to plant
              </h2>
            </div>

            <div className="cm-months">
              {MONTHS.map((name, i) => {
                const month = i + 1;
                const p = byStartMonth[i];
                const v = p ? combine(p.vT, vPh, p.vR) : "none";
                return (
                  <button
                    key={name}
                    type="button"
                    className="cm-month"
                    aria-pressed={month === sowMonth}
                    onClick={() => pickMonth(month)}
                    title={`${name}: ${VERDICT_LABEL[v].toLowerCase()}`}
                  >
                    {name.slice(0, 3)}
                    <span className="cm-dot" style={{ background: VERDICT_COLOR[v] }} />
                  </button>
                );
              })}
            </div>

            <div className="cm-cycle">
              <span className="cm-cycle-label">Cycle</span>
              <strong>
                {nMonths} {nMonths === 1 ? "month" : "months"}
              </strong>
              <span className="cm-cycle-range">
                {MONTHS[sowMonth - 1]} → {endMonthName}
              </span>
            </div>
          </section>

          <div className="cm-scroll">
            {/* ---------- Three main charts: pH, rainfall, temperature ---------- */}
            {crop && (
              <section className="cm-panel cm-charts">
                {/* pH */}
                <div className="cm-s3 cm-chart">
                  <div className="cm-chart-head">
                    <h3 className="cm-h3">Soil pH</h3>
                    {phRange && phValue && (
                      <Badge v={vPh} text={`${fmt(phValue.mean, 1)} · ${FACTOR_LABEL[vPh]}`} />
                    )}
                  </div>
                  {phRange && (
                    <p className="cm-range">
                      Ideal {phRange.optMin ?? "?"}–{phRange.optMax ?? "?"} · Tolerates {phRange.min ?? "?"}–{phRange.max ?? "?"}
                    </p>
                  )}
                  {!phRange && <p className="cm-empty">EcoCrop has no pH range for this crop.</p>}
                  {phRange && !phCur && <p className="cm-empty">Querying SoilGrids…</p>}
                  {phRange && phCur?.error && (
                    <div>
                      <p className="cm-error">{phCur.error}</p>
                      <p style={{ marginTop: 8 }}>
                        <button type="button" className="cm-btn sec" onClick={() => setAttempt((n) => n + 1)}>
                          Retry
                        </button>
                      </p>
                    </div>
                  )}
                  {phRange && phValue && (
                    <>
                      <VerticalGauge
                        value={phValue.mean}
                        low={phValue.p5}
                        high={phValue.p95}
                        range={phRange}
                        dec={1}
                        aria={`Soil pH ${phValue.mean} against the range the crop tolerates`}
                        valueTooltip={`Estimated pH: ${fmt(phValue.mean, 1)}`}
                        rangeTooltip={`Model uncertainty: ${fmt(phValue.p5, 1)} to ${fmt(phValue.p95, 1)}`}
                      />
                      <p className="cm-small">
                        Between {fmt(phValue.p5, 1)} and {fmt(phValue.p95, 1)} (0–30 cm). Satellite-based estimate.
                      </p>
                    </>
                  )}
                </div>

                {/* Rainfall */}
                <div className="cm-s3 cm-chart">
                  <div className="cm-chart-head">
                    <h3 className="cm-h3">Cycle rainfall</h3>
                    {rainRange && rainSummary && (
                      <Badge v={vRain} text={`${fmt(rainSummary.median)} mm · ${FACTOR_LABEL[vRain]}`} />
                    )}
                  </div>
                  {rainRange && (
                    <p className="cm-range">
                      Ideal {rainRange.optMin !== null ? fmt(rainRange.optMin) : "?"}–
                      {rainRange.optMax !== null ? fmt(rainRange.optMax) : "?"} · Tolerates{" "}
                      {rainRange.min !== null ? fmt(rainRange.min) : "?"}–
                      {rainRange.max !== null ? fmt(rainRange.max) : "?"} mm
                    </p>
                  )}
                  {!rainRange && <p className="cm-empty">EcoCrop has no rainfall range for this crop.</p>}
                  {rainRange && !eraData && !eraCur?.error && <p className="cm-empty">Querying ERA5…</p>}
                  {rainRange && eraCur?.error && (
                    <div>
                      <p className="cm-error">{eraCur.error}</p>
                      <p style={{ marginTop: 8 }}>
                        <button type="button" className="cm-btn sec" onClick={() => setAttempt((n) => n + 1)}>
                          Retry
                        </button>
                      </p>
                    </div>
                  )}
                  {rainRange && eraData && !rainSummary && (
                    <p className="cm-empty">There are no complete cycles with rainfall data for this month.</p>
                  )}
                  {rainRange && rainSummary && (
                    <>
                      <VerticalGauge
                        value={rainSummary.median}
                        low={rainSummary.p10}
                        high={rainSummary.p90}
                        range={rainRange}
                        dec={0}
                        fromZero
                        aria={`Typical cycle rainfall of ${fmt(rainSummary.median)} mm against the range the crop tolerates`}
                        valueTooltip={`Typical cycle rainfall: ${fmt(rainSummary.median)} mm`}
                        rangeTooltip={`Typical years: ${fmt(rainSummary.p10)} to ${fmt(rainSummary.p90)} mm`}
                      />
                      <p className="cm-small">
                        {nMonths} {nMonths === 1 ? "month" : "months"} from {monthLower}. Most years:{" "}
                        {fmt(rainSummary.p10)}–{fmt(rainSummary.p90)} mm.
                      </p>
                    </>
                  )}
                </div>

                {/* Temperature */}
                <div className="cm-s6 cm-chart">
                  <div className="cm-chart-head">
                    <h3 className="cm-h3">Temperature during the cycle</h3>
                    {sel?.a && <Badge v={vTemp} text={`${sel.a.cycleOk} of ${sel.a.n} years fine`} />}
                  </div>
                  <p className="cm-range">
                    Ideal {crop.temperatura.optMin ?? "?"}–{crop.temperatura.optMax ?? "?"} °C · Tolerates{" "}
                    {crop.temperatura.min ?? "?"}–{crop.temperatura.max ?? "?"} °C
                  </p>
                  {!powerData && !powerCur?.error && <p className="cm-empty">Fetching the climate of recent years…</p>}
                  {powerCur?.error && <p className="cm-empty">No temperature data (see above).</p>}
                  {powerData && !sel?.a && (
                    <p className="cm-empty">
                      There are no complete cycles with data for this window (NASA publishes with a delay and the cycle
                      may include future months).
                    </p>
                  )}
                  {powerData && sel?.a && (
                    <>
                      <TemperatureChart a={sel.a} names={cycleNames} range={crop.temperatura} />
                      <p className="cm-small">
                        {sel.a.critical
                          ? `Most delicate month: ${cycleNames[sel.a.critical.month]}.`
                          : "In no year did it leave the range the crop tolerates."}
                      </p>
                    </>
                  )}
                </div>

                <ul className="cm-legend cm-s12">
                  <li>
                    <span className="cm-swatch" style={{ background: C.ideal }} /> Ideal
                  </li>
                  <li>
                    <span className="cm-swatch" style={{ background: C.tolerated }} /> Tolerated range
                  </li>
                  <li>
                    <span className="cm-swatch" style={{ background: "rgba(57,125,164,.45)", height: 3 }} /> Each past
                    year
                  </li>
                  <li>
                    <span className="cm-swatch" style={{ background: C.ink, height: 3 }} /> Typical year
                  </li>
                </ul>
              </section>
            )}

            {/* ---------- Crop rotation panel: always visible ---------- */}
            {crop && (
              <section className="cm-panel cm-rotation">
                <div className="cm-rotation-head">
                  <h2 className="cm-label">Crop rotation</h2>
                  {chain.length > 0 && (
                    <button type="button" className="cm-btn sec cm-reset" onClick={() => setChain([])}>
                      Start over
                    </button>
                  )}
                </div>

                <p className="cm-note">
                  Plan what to sow after this crop. When the current cycle ends, you get the crops that would fit
                  in the following month (same climate and soil criteria). Pick one to add it to the path, and keep
                  chaining steps. The charts above show the last step of the path.
                </p>

                <ol className="cm-path" aria-label="Rotation path">
                  {rotationSteps.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="cm-path-step"
                        aria-current={i === rotationSteps.length - 1 ? "step" : undefined}
                        onClick={() => setChain(chain.slice(0, i))}
                        title={i === rotationSteps.length - 1 ? "Current step" : "Go back to this step"}
                      >
                        <span className="cm-emoji-sm">{cropIcon(s.crop)}</span>
                        {s.crop}
                        <span className="cm-path-month">{MONTHS[s.month - 1].slice(0, 3)}</span>
                      </button>
                    </li>
                  ))}
                </ol>

                <div className="cm-next">
                  <span className="cm-rot-lead">Next, in {MONTHS[nextMonth - 1]}:</span>
                  <div className="cm-chips">
                    {!eco || climateLoading ? (
                      <span className="cm-loading">Loading…</span>
                    ) : climateFailed ? (
                      <span className="cm-loading">No climate data available.</span>
                    ) : rotationOptions.length === 0 ? (
                      <span className="cm-loading">
                        No other crop fits well in {MONTHS[nextMonth - 1]} here. Go back a step or pick another crop.
                      </span>
                    ) : (
                      rotationOptions.map((o) => (
                        <button
                          key={o.name}
                          type="button"
                          className="cm-chip"
                          onClick={() => addRotation(o.name)}
                          title={`${o.name}: ${VERDICT_LABEL[o.verdict].toLowerCase()} · ${o.nMonths} ${
                            o.nMonths === 1 ? "month" : "months"
                          } cycle`}
                        >
                          <span className="cm-emoji-sm">{cropIcon(o.name)}</span>
                          {o.name}
                          <span className="cm-dot" style={{ background: VERDICT_COLOR[o.verdict] }} />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ---------- Secondary row: water balance and reading ---------- */}
            {crop && (
              <section className="cm-panel cm-support">
                <div className="cm-support-title cm-s12">
                  <h2 className="cm-label">Supporting data</h2>
                  <p className="cm-note">They do not change the result.</p>
                </div>

                <div className="cm-s7">
                  <h3 className="cm-h3">Water balance (typical year)</h3>
                  <p className="cm-range">Rainfall of each month against potential evaporation (ET0)</p>
                  {monthlyCycle ? (
                    <WaterBalanceChart rain={monthlyCycle.rain} et0={monthlyCycle.et0} names={cycleNames} />
                  ) : (
                    <p className="cm-empty">
                      {eraCur?.error
                        ? "No ERA5 data."
                        : !eraData
                        ? "Querying ERA5…"
                        : "There are no complete cycles with data."}
                    </p>
                  )}
                  <ul className="cm-legend">
                    <li>
                      <span className="cm-swatch" style={{ background: C.years }} /> Monthly rainfall
                    </li>
                    <li>
                      <span className="cm-swatch" style={{ background: C.caution, height: 3 }} /> Monthly ET0
                    </li>
                  </ul>
                </div>

                <div className="cm-s5 cm-reading">
                  <h3 className="cm-h3">What the water says</h3>
                  {monthlyCycle ? (
                    <ul>
                      {et0Cycle !== null && coverageText && (
                        <li>
                          Cycle ET0: <b>{fmt(et0Cycle)} mm</b>. Rainfall equals <b>{coverageText}</b>.
                        </li>
                      )}
                      {deficitMonths !== null && (
                        <li>
                          {deficitMonths === 0
                            ? "No month of the typical cycle has more evaporation than rainfall."
                            : `${deficitMonths} of ${nMonths} months have more evaporation than rainfall.`}
                        </li>
                      )}
                      {rainSummary && rainSummary.dry > 0 && (
                        <li>
                          {rainSummary.dry} {rainSummary.dry === 1 ? "month" : "months"} with less than {DRY_MONTH_MM} mm.
                        </li>
                      )}
                      {coverage !== null && coverage < ET0_WARNING_RATIO && <li>Irrigation may be needed.</li>}
                      {frost && frost.below > 0 && tLethal !== null && (
                        <li>
                          In {frost.below} of {frost.n} years the daily minimum dropped below {fmt(tLethal)} °C (lethal
                          temperature).
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="cm-empty">No data yet.</p>
                  )}
                </div>
              </section>
            )}

            <details className="cm-details">
              <summary>How it is decided</summary>
              <p>
                <strong>Temperature.</strong> Each month of the cycle is compared against the temperature range FAO
                EcoCrop gives for the crop, using the monthly mean temperature from NASA POWER. A year passes if every
                month of its cycle stayed within what the crop tolerates. If that happened in{" "}
                {Math.round(YES_THRESHOLD * 100)} % of years or more, the answer is yes; between{" "}
                {Math.round(CAUTION_THRESHOLD * 100)} % and {Math.round(YES_THRESHOLD * 100)} %, caution; below that,
                no. If the typical temperature of any month is already outside the range, it is also a no. These
                percentages are this tool&apos;s own criterion, not FAO data.
              </p>
              <p>
                <strong>Cycle rainfall.</strong> ERA5 provides daily rainfall. It is summed by month and, for each past
                year, over the months of the cycle that starts in the chosen sowing month. The typical value (median)
                is compared with the EcoCrop rainfall range, which refers to the crop cycle and not the calendar year:
                ideal if it falls in the optimal range, tolerable if it falls in the absolute range, not recommended
                if it falls outside. In addition, if fewer than {Math.round(YES_THRESHOLD * 100)} % of years fall
                within what the crop tolerates, the result is lowered. Since a total does not say when it rains, the
                tool also reports how many months of the typical cycle have less than {DRY_MONTH_MM} mm (this warning
                does not change the result). If rainfall is below the minimum, the crop could still be grown with
                irrigation.
              </p>
              <p>
                <strong>Potential evaporation (ET0).</strong> ERA5 also gives daily ET0 (FAO Penman-Monteith). It is
                summed over the cycle and compared with rainfall only as information and a warning (when rainfall
                covers less than {Math.round(ET0_WARNING_RATIO * 100)} %). EcoCrop has no evapotranspiration range and
                ET0 is not the real crop demand (that would need the Kc coefficient of each stage), so it does not
                weigh on the result.
              </p>
              <p>
                <strong>Soil pH.</strong> Ideal if it falls in the EcoCrop optimal range, tolerable if it falls in the
                absolute range, not recommended if it falls outside. It is a fixed value of the place: it does not
                change with the month or the years. It is a satellite-based estimate: a soil test is more reliable.
              </p>
              <p>
                <strong>Crop rotation.</strong> After the current cycle ends, every other crop in the list is
                evaluated for the month that follows, using the same criteria (temperature, cycle rainfall and soil
                pH). Crops rated good or caution are suggested, and you can chain several steps. This only considers
                climate and soil: it does not take into account crop families, pests, diseases or soil nutrients,
                which matter in a real rotation.
              </p>
              <p>
                <strong>Final result.</strong> The worst of the factors rules (law of the minimum), not an average. It
                is not a forecast: it describes what happened in those same months during past years. For temperature
                the monthly mean is used, so a frost or heat wave lasting a few days is not visible in the verdict; if
                the crop has a lethal temperature in EcoCrop, a warning is shown with the daily minimum from ERA5.
                Altitude and other soil properties are not evaluated. It is a guide to get oriented: consult an
                agricultural technician before deciding.
              </p>
              <p>
                Data: mean temperature, NASA POWER (AG community, T2M, low-resolution grid) · Rainfall, ET0 and daily
                minimum: ERA5 (ECMWF/Copernicus) served by Open-Meteo (~25 km; in mountain areas a nearby point can
                give different values) · Soil: ISRIC SoilGrids (pH in water, 0–30 cm) · Ranges and cycle length: FAO
                EcoCrop (OpenCLIM copy; cycle = minimum + 1 month, with 1 month = 30 days) · Place search: Open-Meteo ·
                Map: MapLibre GL, OpenFreeMap sketch map with OpenStreetMap data and NASA GIBS Earth imagery (Blue
                Marble).
              </p>
            </details>
          </div>
        </div>
      </div>
    </main>
  );
}