"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import "./analyze-my-crops.css";

/* ---------------- Configuración ---------------- */

type Ubicacion = { nombre: string; lat: number; lon: number };

const UBICACION_INICIAL: Ubicacion = {
  nombre: "Apaneca-Ilamatepec, El Salvador",
  lat: 13.85,
  lon: -89.8,
};

const ANIOS_ATRAS = 20;
const MIN_ANIOS = 8; // menos años completos que esto = "sin datos suficientes"
const UMBRAL_SI = 0.8; // 80 % de los años o más → Sí conviene
const UMBRAL_CUIDADO = 0.5; // entre 50 % y 80 % → Con cuidado; menos → No conviene
const MES_SECO_MM = 50; // un mes con menos de esto cuenta como "seco" (solo advertencia)
const RATIO_ET0_AVISO = 0.5; // si la lluvia del ciclo cubre menos de este % de la ET0, se avisa (sin peso)

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/* ---------------- Tipos ---------------- */

// NASA POWER (temperatura media mensual)
type SerieMensual = Record<string, number>;
type DatosPower = Record<string, SerieMensual>;
type VariablePower = "T2M";
type Resultado = { clave: string; datos: DatosPower | null; error: string | null };

// ERA5 vía Open-Meteo (lluvia, ET0 y mínima diaria, agregadas por mes)
type MesEra = { lluvia: number; et0: number | null; tMinAbs: number };
type DatosEra = Record<string, MesEra>; // clave "YYYYMM"

type Rango = {
  min: number | null;
  optMin: number | null;
  optMax: number | null;
  max: number | null;
};
type CultivoEco = {
  cientifico: string;
  temperatura: Rango;
  tLetal?: number | null; // temperatura letal (KTMP), opcional: requiere volver a correr el script
  ph?: Rango;
  lluviaAnual?: Rango; // mm durante el ciclo del cultivo (así lo interpreta EcoCrop)
  cicloDias: { min: number | null; max: number | null };
};
type EcoCrop = { fuente: string; cultivos: Record<string, CultivoEco> };

type Curva = { anioSiembra: number; valores: number[] };
type Clase = "optimo" | "absoluto" | "fuera";
type Veredicto = "si" | "cuidado" | "no" | "sin";
type NivelMes = "bien" | "justo" | "riesgo";
type ResultadoGeo = { id: number; nombre: string; lat: number; lon: number };

type PhSuelo = { media: number; p5: number; p95: number };
type Extra<T> = { clave: string; valor: T | null; error: string | null };

type StatMes = {
  n: number;
  ok: number; // años con ese mes dentro de los límites absolutos
  bajos: number; // años por debajo del mínimo
  altos: number; // años por encima del máximo
  mediana: number;
};
type Analisis = {
  n: number;
  curvas: Curva[];
  porMes: StatMes[];
  cicloOk: number; // años con TODOS los meses del ciclo dentro de límites
  critico: { mes: number; fallos: number } | null;
};

type ResumenLluvia = {
  n: number;
  mediana: number; // lluvia total del ciclo, año típico
  p10: number;
  p90: number;
  ok: number; // años con lluvia del ciclo dentro de lo que tolera
  secos: number; // meses del ciclo cuya lluvia típica es menor a MES_SECO_MM
};

/* ---------------- Utilidades ---------------- */

function formatear(valor: number, decimales = 0) {
  return valor.toLocaleString("es-SV", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

function redondear(v: number) {
  return Math.round(v * 100) / 100;
}

function tieneRango(r: Rango | undefined | null): r is Rango {
  return !!r && (r.min !== null || r.optMin !== null || r.optMax !== null || r.max !== null);
}

const diasEnMes = (anio: number, mes: number) => new Date(anio, mes, 0).getDate();

/* ---------------- Temperatura: NASA POWER ---------------- */

async function pedirDatosPower(
  u: Ubicacion,
  desde: number,
  hasta: number,
  signal: AbortSignal
): Promise<DatosPower> {
  const params = new URLSearchParams({
    parameters: "T2M",
    community: "AG",
    latitude: String(u.lat),
    longitude: String(u.lon),
    start: String(desde),
    end: String(hasta),
    format: "JSON",
  });
  const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("NASA POWER tardó más de 30 segundos en responder. Probá de nuevo.");
    }
    throw e;
  }
  if (!res.ok) throw new Error(`NASA POWER respondió con error ${res.status}`);
  const json = await res.json();
  const datos = json?.properties?.parameter;
  if (!datos) throw new Error("La respuesta de NASA POWER no tiene el formato esperado");
  return datos as DatosPower;
}

// Valor mensual crudo de POWER (clave "YYYYMM"). null si falta (-999 = sin dato).
function valorMensual(datos: DatosPower, variable: VariablePower, anio: number, mes: number): number | null {
  const bruto = datos[variable]?.[`${anio}${String(mes).padStart(2, "0")}`];
  return typeof bruto === "number" && bruto > -900 ? bruto : null;
}

// Una curva por año de siembra. Solo entran años con TODOS los meses del ciclo publicados.
function curvasMensuales(datos: DatosPower, mesSiembra: number, nMeses: number, anios: number[]): Curva[] {
  const completas: Curva[] = [];
  for (const anioSiembra of anios) {
    const valores: number[] = [];
    let completa = true;
    for (let i = 0; i < nMeses; i++) {
      const idx = mesSiembra - 1 + i;
      const v = valorMensual(datos, "T2M", anioSiembra + Math.floor(idx / 12), (idx % 12) + 1);
      if (v === null) {
        completa = false;
        break;
      }
      valores.push(v);
    }
    if (completa) completas.push({ anioSiembra, valores });
  }
  return completas;
}

/* ---------------- Lluvia, ET0 y mínima diaria: ERA5 vía Open-Meteo ---------------- */

// Caché por coordenadas para no repetir la descarga de 20 años de datos diarios.
const cacheEra = new Map<string, DatosEra>();

// Se usa el modelo "era5", no "era5_land": con era5_land la lluvia llega vacía.
async function pedirDatosEra(
  u: Ubicacion,
  desde: number,
  hasta: number,
  signal: AbortSignal
): Promise<DatosEra> {
  const claveCache = `${u.lat},${u.lon},${desde},${hasta}`;
  const guardado = cacheEra.get(claveCache);
  if (guardado) return guardado;

  // ERA5 publica con ~5 días de retraso
  const limite = new Date(Date.now() - 7 * 864e5);
  const fin =
    hasta >= limite.getFullYear() ? limite.toISOString().slice(0, 10) : `${hasta}-12-31`;

  const params = new URLSearchParams({
    latitude: String(u.lat),
    longitude: String(u.lon),
    start_date: `${desde}-01-01`,
    end_date: fin,
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
      throw new Error("Open-Meteo (ERA5) tardó más de 45 segundos en responder. Probá de nuevo.");
    }
    throw e;
  }
  if (!res.ok) throw new Error(`Open-Meteo (ERA5) respondió con error ${res.status}`);

  const json = await res.json();
  const d = json?.daily;
  if (!d?.time || !d?.precipitation_sum || !d?.temperature_2m_min) {
    throw new Error("La respuesta de ERA5 no tiene el formato esperado");
  }
  const et0Diaria: (number | null)[] | undefined = d.et0_fao_evapotranspiration;

  const acc: Record<string, { n: number; p: number; tmin: number; nE: number; e: number }> = {};
  (d.time as string[]).forEach((dia, i) => {
    const p = d.precipitation_sum[i];
    const tm = d.temperature_2m_min[i];
    if (p == null || tm == null) return;
    const k = dia.slice(0, 4) + dia.slice(5, 7);
    const a = (acc[k] ??= { n: 0, p: 0, tmin: Infinity, nE: 0, e: 0 });
    a.n++;
    a.p += p;
    a.tmin = Math.min(a.tmin, tm);
    const e = et0Diaria?.[i];
    if (e != null) {
      a.nE++;
      a.e += e;
    }
  });

  const out: DatosEra = {};
  for (const [k, a] of Object.entries(acc)) {
    const dias = diasEnMes(Number(k.slice(0, 4)), Number(k.slice(4)));
    if (a.n < dias) continue; // solo meses completos
    out[k] = { lluvia: a.p, et0: a.nE >= dias ? a.e : null, tMinAbs: a.tmin };
  }
  if (Object.keys(out).length === 0) throw new Error("ERA5 no devolvió meses completos para este punto.");

  cacheEra.set(claveCache, out);
  return out;
}

function mesEra(datos: DatosEra, anio: number, mes: number): MesEra | null {
  return datos[`${anio}${String(mes).padStart(2, "0")}`] ?? null;
}

// Valores mensuales (mm) de cada año de siembra con ciclo completo: un arreglo de nMeses por año.
function ciclosEra(
  datos: DatosEra,
  campo: "lluvia" | "et0",
  mesSiembra: number,
  nMeses: number,
  anios: number[]
): number[][] {
  const ciclos: number[][] = [];
  for (const anioSiembra of anios) {
    const mensual: number[] = [];
    let completo = true;
    for (let i = 0; i < nMeses; i++) {
      const idx = mesSiembra - 1 + i;
      const m = mesEra(datos, anioSiembra + Math.floor(idx / 12), (idx % 12) + 1);
      const v = m ? m[campo] : null;
      if (v === null || v === undefined) {
        completo = false;
        break;
      }
      mensual.push(v);
    }
    if (completo) ciclos.push(mensual);
  }
  return ciclos;
}

// Temperatura mínima diaria más baja de cada ciclo completo (para temperatura letal).
function minimasDelCiclo(datos: DatosEra, mesSiembra: number, nMeses: number, anios: number[]): number[] {
  const minimas: number[] = [];
  for (const anioSiembra of anios) {
    let minimo = Infinity;
    let completo = true;
    for (let i = 0; i < nMeses; i++) {
      const idx = mesSiembra - 1 + i;
      const m = mesEra(datos, anioSiembra + Math.floor(idx / 12), (idx % 12) + 1);
      if (!m) {
        completo = false;
        break;
      }
      minimo = Math.min(minimo, m.tMinAbs);
    }
    if (completo) minimas.push(minimo);
  }
  return minimas;
}

function mediana(valores: number[]): number {
  const s = [...valores].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentil(valores: number[], p: number): number {
  const s = [...valores].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function clasificarRango(v: number, r: Rango): Clase {
  const min = r.min ?? -Infinity;
  const max = r.max ?? Infinity;
  const optMin = r.optMin ?? min;
  const optMax = r.optMax ?? max;
  if (v < min || v > max) return "fuera";
  if (v >= optMin && v <= optMax) return "optimo";
  return "absoluto";
}

// Duración del ciclo en días: mínimo de FAO + 30 (criterio de Recocrop), salvo que min = max.
function diasDelCiclo(c: CultivoEco): number | null {
  const { min, max } = c.cicloDias;
  if (min === null) return max;
  if (max !== null && max === min) return min;
  return min + 30;
}

function ticksBonitos(min: number, max: number, aprox = 5): number[] {
  const crudo = (max - min) / aprox;
  const pot = Math.pow(10, Math.floor(Math.log10(crudo)));
  const f = crudo / pot;
  const paso = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pot;
  const marcas: number[] = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) {
    marcas.push(Number(v.toFixed(6)));
  }
  return marcas;
}

/* ---------------- Análisis y criterio ---------------- */

function analizar(curvas: Curva[], rango: Rango, nMeses: number): Analisis | null {
  if (curvas.length === 0) return null;
  const n = curvas.length;

  const porMes: StatMes[] = [];
  for (let i = 0; i < nMeses; i++) {
    const vals = curvas.map((c) => c.valores[i]);
    const clases = vals.map((v) => clasificarRango(v, rango));
    porMes.push({
      n,
      ok: clases.filter((c) => c !== "fuera").length,
      bajos: rango.min !== null ? vals.filter((v) => v < rango.min!).length : 0,
      altos: rango.max !== null ? vals.filter((v) => v > rango.max!).length : 0,
      mediana: mediana(vals),
    });
  }

  const cicloOk = curvas.filter((c) => c.valores.every((v) => clasificarRango(v, rango) !== "fuera")).length;

  let critico: Analisis["critico"] = null;
  let maxFallos = 0;
  porMes.forEach((m, i) => {
    const fallos = n - m.ok;
    if (fallos > maxFallos) {
      maxFallos = fallos;
      critico = { mes: i, fallos };
    }
  });

  return { n, curvas, porMes, cicloOk, critico };
}

function resumirLluvia(ciclos: number[][], rango: Rango, nMeses: number): ResumenLluvia | null {
  if (ciclos.length === 0) return null;
  const totales = ciclos.map((c) => c.reduce((s, v) => s + v, 0));
  let secos = 0;
  for (let i = 0; i < nMeses; i++) {
    if (mediana(ciclos.map((c) => c[i])) < MES_SECO_MM) secos++;
  }
  return {
    n: totales.length,
    mediana: mediana(totales),
    p10: percentil(totales, 10),
    p90: percentil(totales, 90),
    ok: totales.filter((t) => clasificarRango(t, rango) !== "fuera").length,
    secos,
  };
}

// ET0 típica del ciclo (mediana de los totales). Solo informativa: no entra en el veredicto.
function et0DelCiclo(ciclos: number[][]): number | null {
  if (ciclos.length < MIN_ANIOS) return null;
  return mediana(ciclos.map((c) => c.reduce((s, v) => s + v, 0)));
}

function veredictoTemperatura(a: Analisis | null, rango: Rango): Veredicto {
  if (!a || a.n < MIN_ANIOS) return "sin";
  const medianaFuera = a.porMes.some((m) => clasificarRango(m.mediana, rango) === "fuera");
  if (medianaFuera) return "no";
  const parte = a.cicloOk / a.n;
  if (parte >= UMBRAL_SI) return "si";
  if (parte >= UMBRAL_CUIDADO) return "cuidado";
  return "no";
}

const VER_DE_CLASE: Record<Clase, Veredicto> = { optimo: "si", absoluto: "cuidado", fuera: "no" };

const GRAV: Record<Veredicto, number> = { sin: -1, si: 0, cuidado: 1, no: 2 };

// Ley del mínimo: manda el peor factor evaluado.
function peor(vs: Veredicto[]): Veredicto {
  const ev = vs.filter((v) => v !== "sin");
  if (ev.length === 0) return "sin";
  return ev.reduce((a, b) => (GRAV[b] > GRAV[a] ? b : a));
}

// Lluvia del ciclo: manda lo típico (mediana frente al rango) y se baja si pocos años cumplen.
function veredictoLluvia(r: ResumenLluvia | null, rango: Rango): Veredicto {
  if (!r || r.n < MIN_ANIOS) return "sin";
  const porMediana = VER_DE_CLASE[clasificarRango(r.mediana, rango)];
  const parte = r.ok / r.n;
  const porAnios: Veredicto = parte >= UMBRAL_SI ? "si" : parte >= UMBRAL_CUIDADO ? "cuidado" : "no";
  return peor([porMediana, porAnios]);
}

// La temperatura es la que define si hay datos suficientes: si ella no se pudo evaluar,
// el resultado global solo se muestra si ya hay un "no" seguro por otro factor.
function combinar(vTemp: Veredicto, ...otros: Veredicto[]): Veredicto {
  const g = peor([vTemp, ...otros]);
  if (vTemp === "sin" && g !== "no") return "sin";
  return g;
}

function nivelDeMes(m: StatMes): NivelMes {
  const parte = m.ok / m.n;
  if (parte >= UMBRAL_SI) return "bien";
  if (parte >= UMBRAL_CUIDADO) return "justo";
  return "riesgo";
}

const TEXTO_NIVEL: Record<NivelMes, string> = { bien: "Bien", justo: "Justo", riesgo: "Riesgo" };

/* ---------------- Suelo (SoilGrids) ---------------- */

// Espesor (cm) de las capas de SoilGrids usadas para el pH (0–30 cm)
const ESPESOR_CAPA: Record<string, number> = { "0-5cm": 5, "5-15cm": 10, "15-30cm": 15 };

async function pedirPh(u: Ubicacion, signal: AbortSignal): Promise<PhSuelo> {
  const params = new URLSearchParams();
  params.append("lon", String(u.lon));
  params.append("lat", String(u.lat));
  params.append("property", "phh2o");
  for (const d of Object.keys(ESPESOR_CAPA)) params.append("depth", d);
  for (const v of ["mean", "Q0.05", "Q0.95"]) params.append("value", v);

  let res: Response;
  try {
    res = await fetch(`https://rest.isric.org/soilgrids/v2.0/properties/query?${params.toString()}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("SoilGrids tardó más de 30 segundos en responder.");
    }
    throw e;
  }
  if (!res.ok) throw new Error(`SoilGrids respondió con error ${res.status}`);

  const json = await res.json();
  const capa = (json?.properties?.layers ?? []).find((l: { name?: string }) => l.name === "phh2o");
  if (!capa) throw new Error("La respuesta de SoilGrids no tiene el formato esperado");

  const factor: number = capa.unit_measure?.d_factor ?? 10; // el pH viene multiplicado por 10
  // Promedio ponderado por espesor de las capas 0–30 cm (aproximación para los percentiles).
  const pesar = (clave: string): number | null => {
    let suma = 0;
    let peso = 0;
    for (const prof of capa.depths ?? []) {
      const e = ESPESOR_CAPA[prof.label as string];
      const v = prof.values?.[clave];
      if (e && typeof v === "number") {
        suma += v * e;
        peso += e;
      }
    }
    return peso > 0 ? suma / peso / factor : null;
  };

  const media = pesar("mean");
  const p5 = pesar("Q0.05");
  const p95 = pesar("Q0.95");
  if (media === null || p5 === null || p95 === null) {
    throw new Error("SoilGrids no tiene pH para este punto.");
  }
  return { media: redondear(media), p5: redondear(p5), p95: redondear(p95) };
}

/* ---------------- Colores del SVG (mantener en sync con analyze-my-crops.css) ---------------- */

const C = {
  tinta: "#243522",
  suave: "#71806d",
  linea: "#dfe8d7",
  ideal: "#cfe5a3",
  tolera: "#eaf3dc",
  anios: "#397da4",
  si: "#4f8f1f",
  cuidado: "#bf8120",
  no: "#b3402a",
  sin: "#8a9683",
};

const COLOR_VEREDICTO: Record<Veredicto, string> = { si: C.si, cuidado: C.cuidado, no: C.no, sin: C.sin };
const COLOR_NIVEL: Record<NivelMes, string> = { bien: C.si, justo: C.cuidado, riesgo: C.no };
const COLOR_CLASE: Record<Clase, string> = { optimo: C.si, absoluto: C.cuidado, fuera: C.no };

/* ---------------- Gráfica de temperatura: todos los años + el año típico ---------------- */

function GraficaTemperatura({ a, nombres, rango }: { a: Analisis; nombres: string[]; rango: Rango }) {
  const n = nombres.length;
  const W = 640;
  const H = 280;
  const M = { izq: 40, der: 14, arr: 14, abajo: 32 };

  const valores = a.curvas.flatMap((c) => c.valores);
  const refs = [rango.optMin, rango.optMax].filter((v): v is number => v !== null);
  const bajo = Math.min(...valores, ...refs);
  const alto = Math.max(...valores, ...refs);
  const pad = (alto - bajo) * 0.12 || 1;
  const yMin = bajo - pad;
  const yMax = alto + pad;

  const ancho = W - M.izq - M.der;
  const alt = H - M.arr - M.abajo;
  const x = (i: number) => M.izq + ((i + 0.5) / n) * ancho;
  const y = (v: number) => M.arr + alt - ((v - yMin) / (yMax - yMin)) * alt;
  const recortar = (v: number) => y(Math.min(Math.max(v, yMin), yMax));

  const trazar = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const topAbs = rango.max !== null ? recortar(rango.max) : M.arr;
  const botAbs = rango.min !== null ? recortar(rango.min) : M.arr + alt;
  const topOpt = rango.optMax !== null ? recortar(rango.optMax) : M.arr;
  const botOpt = rango.optMin !== null ? recortar(rango.optMin) : M.arr + alt;

  const ticks = ticksBonitos(yMin, yMax, 4);
  const limiteVisible = (v: number | null) => v !== null && v > yMin && v < yMax;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Temperatura mes a mes durante el ciclo en cada año pasado, frente al rango que tolera el cultivo"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <rect x={M.izq} y={topAbs} width={ancho} height={Math.max(0, botAbs - topAbs)} fill={C.tolera} />
      <rect x={M.izq} y={topOpt} width={ancho} height={Math.max(0, botOpt - topOpt)} fill={C.ideal} />

      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.izq} x2={M.izq + ancho} y1={y(t)} y2={y(t)} stroke={C.linea} strokeWidth={1} />
          <text x={M.izq - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.suave}>
            {formatear(t)}°
          </text>
        </g>
      ))}

      {limiteVisible(rango.max) && (
        <g>
          <line x1={M.izq} x2={M.izq + ancho} y1={y(rango.max!)} y2={y(rango.max!)} stroke={C.no} strokeDasharray="5 4" />
          <text x={M.izq + ancho - 4} y={y(rango.max!) - 5} textAnchor="end" fontSize={11} fill={C.no}>
            máximo que tolera: {formatear(rango.max!)} °C
          </text>
        </g>
      )}
      {limiteVisible(rango.min) && (
        <g>
          <line x1={M.izq} x2={M.izq + ancho} y1={y(rango.min!)} y2={y(rango.min!)} stroke={C.no} strokeDasharray="5 4" />
          <text x={M.izq + ancho - 4} y={y(rango.min!) + 14} textAnchor="end" fontSize={11} fill={C.no}>
            mínimo que tolera: {formatear(rango.min!)} °C
          </text>
        </g>
      )}

      {nombres.map((nom, i) => (
        <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={C.suave}>
          {nom.slice(0, 3)}
        </text>
      ))}

      {/* cada año pasado, tenue */}
      {a.curvas.map((c) => (
        <path
          key={c.anioSiembra}
          d={trazar(c.valores)}
          fill="none"
          stroke={C.anios}
          strokeOpacity={0.22}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <title>{`Siembra ${c.anioSiembra}`}</title>
        </path>
      ))}

      {/* el año típico */}
      <path d={trazar(a.porMes.map((m) => m.mediana))} fill="none" stroke={C.tinta} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      {a.porMes.map((m, i) => (
        <circle key={i} cx={x(i)} cy={y(m.mediana)} r={5} fill={COLOR_NIVEL[nivelDeMes(m)]} stroke="#fff" strokeWidth={2}>
          <title>{`${nombres[i]}: lo típico es ${formatear(m.mediana, 1)} °C`}</title>
        </circle>
      ))}
    </svg>
  );
}

/* ---------------- Medidor vertical: un valor del lugar frente al rango del cultivo ---------------- */
/* Sirve para el pH y para la lluvia del ciclo: no llevan eje de tiempo. */

function MedidorVertical({
  valor,
  bajo,
  alto,
  rango,
  dec,
  desdeCero,
  aria,
  tooltipValor,
  tooltipRango,
}: {
  valor: number;
  bajo: number;
  alto: number;
  rango: Rango;
  dec: number;
  desdeCero?: boolean;
  aria: string;
  tooltipValor: string;
  tooltipRango: string;
}) {
  const W = 180;
  const H = 300;
  const M = { izq: 46, arr: 14, abajo: 14 };
  const barX = M.izq;
  const barW = 60;
  const alt = H - M.arr - M.abajo;

  const puntos = [valor, bajo, alto, rango.min, rango.optMin, rango.optMax, rango.max].filter(
    (v): v is number => v !== null
  );
  const lo = Math.min(...puntos);
  const hi = Math.max(...puntos);
  const pad = (hi - lo) * 0.08 || 0.5;
  const a = desdeCero ? Math.max(0, lo - pad) : lo - pad;
  const b = hi + pad;

  const y = (v: number) => M.arr + alt - ((v - a) / (b - a)) * alt;
  const rec = (v: number) => y(Math.min(Math.max(v, a), b));

  const topAbs = rango.max !== null ? rec(rango.max) : M.arr;
  const botAbs = rango.min !== null ? rec(rango.min) : M.arr + alt;
  const topOpt = rango.optMax !== null ? rec(rango.optMax) : M.arr;
  const botOpt = rango.optMin !== null ? rec(rango.optMin) : M.arr + alt;
  const color = COLOR_CLASE[clasificarRango(valor, rango)];
  const ticks = ticksBonitos(a, b, 5);
  const cx = barX + barW / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={aria}
      style={{ width: "100%", maxWidth: 200, height: "auto", display: "block", margin: "0 auto" }}
    >
      <rect x={barX} y={topAbs} width={barW} height={Math.max(0, botAbs - topAbs)} fill={C.tolera} />
      <rect x={barX} y={topOpt} width={barW} height={Math.max(0, botOpt - topOpt)} fill={C.ideal} />

      {ticks.map((t) => (
        <g key={t}>
          <line x1={barX - 5} x2={barX} y1={y(t)} y2={y(t)} stroke={C.suave} />
          <text x={barX - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.suave}>
            {formatear(t, dec)}
          </text>
        </g>
      ))}

      {rango.max !== null && (
        <g>
          <line x1={barX - 4} x2={barX + barW + 4} y1={rec(rango.max)} y2={rec(rango.max)} stroke={C.no} strokeDasharray="5 4" />
          <text x={barX + barW + 8} y={rec(rango.max) + 4} fontSize={11} fill={C.no}>
            máx. {formatear(rango.max, dec)}
          </text>
        </g>
      )}
      {rango.min !== null && (
        <g>
          <line x1={barX - 4} x2={barX + barW + 4} y1={rec(rango.min)} y2={rec(rango.min)} stroke={C.no} strokeDasharray="5 4" />
          <text x={barX + barW + 8} y={rec(rango.min) + 4} fontSize={11} fill={C.no}>
            mín. {formatear(rango.min, dec)}
          </text>
        </g>
      )}

      <line x1={cx} x2={cx} y1={y(alto)} y2={y(bajo)} stroke={color} strokeWidth={5} strokeOpacity={0.55} strokeLinecap="round">
        <title>{tooltipRango}</title>
      </line>
      <circle cx={cx} cy={y(valor)} r={9} fill={color} stroke="#fff" strokeWidth={3}>
        <title>{tooltipValor}</title>
      </circle>
    </svg>
  );
}

/* ---------------- Búsqueda de lugares (Open-Meteo Geocoding) ---------------- */

async function buscarCiudades(texto: string, signal: AbortSignal): Promise<ResultadoGeo[]> {
  const params = new URLSearchParams({ name: texto, count: "6", language: "es", format: "json" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!res.ok) throw new Error(`El buscador de lugares respondió con error ${res.status}`);
  const json = await res.json();
  const lista: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    admin1?: string;
    country?: string;
  }[] = Array.isArray(json?.results) ? json.results : [];
  return lista.map((r) => ({
    id: r.id,
    nombre: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    lat: redondear(r.latitude),
    lon: redondear(r.longitude),
  }));
}

/* ---------------- Buscador con sugerencias mientras escribís ---------------- */

function BuscadorLugar({ onElegir }: { onElegir: (u: Ubicacion) => void }) {
  const [texto, setTexto] = useState("");
  const [sugerencias, setSugerencias] = useState<ResultadoGeo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [sinResultados, setSinResultados] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setSugerencias([]);
      setSinResultados(false);
      setBuscando(false);
      return;
    }
    const controlador = new AbortController();
    const espera = setTimeout(() => {
      setBuscando(true);
      setError(null);
      buscarCiudades(q, controlador.signal)
        .then((r) => {
          setSugerencias(r);
          setSinResultados(r.length === 0);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setSugerencias([]);
          setError(e instanceof Error ? e.message : "No se pudo buscar el lugar.");
        })
        .finally(() => {
          if (!controlador.signal.aborted) setBuscando(false);
        });
    }, 300);
    return () => {
      clearTimeout(espera);
      controlador.abort();
    };
  }, [texto]);

  function elegir(r: ResultadoGeo) {
    onElegir({ nombre: r.nombre, lat: r.lat, lon: r.lon });
    setTexto("");
    setSugerencias([]);
    setAbierto(false);
  }

  return (
    <div className="cm-buscador">
      <input
        type="text"
        value={texto}
        placeholder="Buscar pueblo o lugar"
        aria-label="Buscar pueblo o lugar"
        autoComplete="off"
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && sugerencias[0]) elegir(sugerencias[0]);
          if (e.key === "Escape") setAbierto(false);
        }}
      />
      {abierto && texto.trim().length >= 2 && (
        <ul className="cm-sug" role="listbox">
          {buscando && sugerencias.length === 0 && <li className="cm-sug-info">Buscando…</li>}
          {sinResultados && !buscando && <li className="cm-sug-info">No se encontró ese lugar.</li>}
          {error && <li className="cm-sug-info cm-error">{error}</li>}
          {sugerencias.map((r) => (
            <li key={r.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(r);
                }}
              >
                {r.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Mapa: tocá un punto para elegir ---------------- */
/* Leaflet se carga desde un CDN la primera vez; no hay que instalar nada. */

const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";

/* eslint-disable @typescript-eslint/no-explicit-any */
let leafletPromesa: Promise<any> | null = null;

function cargarLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromesa) return leafletPromesa;

  leafletPromesa = new Promise((resolve, reject) => {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css";
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => resolve((window as any).L);
    s.onerror = () => {
      leafletPromesa = null;
      s.remove();
      reject(new Error("No se pudo cargar el mapa. Revisá tu conexión; podés seguir buscando el lugar por nombre."));
    };
    document.head.appendChild(s);
  });
  return leafletPromesa;
}

function Mapa({ ubicacion, onElegir }: { ubicacion: Ubicacion; onElegir: (u: Ubicacion) => void }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<any>(null);
  const marcadorRef = useRef<any>(null);
  const ubicacionRef = useRef(ubicacion);
  const onElegirRef = useRef(onElegir);
  ubicacionRef.current = ubicacion;
  onElegirRef.current = onElegir;
  const [errorMapa, setErrorMapa] = useState<string | null>(null);

  // Crear el mapa una sola vez
  useEffect(() => {
    let cancelado = false;
    let limpiar: (() => void) | null = null;

    cargarLeaflet()
      .then((L) => {
        if (cancelado || !contenedor.current) return;
        const u = ubicacionRef.current;

        const mapa = L.map(contenedor.current, {
          center: [u.lat, u.lon],
          zoom: 8,
          scrollWheelZoom: false,
          worldCopyJump: true,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(mapa);

        const marcador = L.circleMarker([u.lat, u.lon], {
          radius: 10,
          color: "#ffffff",
          weight: 3,
          fillColor: C.si,
          fillOpacity: 1,
        }).addTo(mapa);

        mapa.on("click", (e: any) => {
          const p = e.latlng.wrap();
          onElegirRef.current({
            nombre: "Punto elegido en el mapa",
            lat: redondear(p.lat),
            lon: redondear(p.lng),
          });
        });

        mapaRef.current = mapa;
        marcadorRef.current = marcador;
        limpiar = () => {
          mapa.remove();
          mapaRef.current = null;
          marcadorRef.current = null;
        };
      })
      .catch((e: unknown) => {
        if (!cancelado) setErrorMapa(e instanceof Error ? e.message : "No se pudo cargar el mapa.");
      });

    return () => {
      cancelado = true;
      limpiar?.();
    };
  }, []);

  // Mover el marcador cuando cambia la ubicación (búsqueda, GPS o clic)
  useEffect(() => {
    const mapa = mapaRef.current;
    const marcador = marcadorRef.current;
    if (!mapa || !marcador) return;
    marcador.setLatLng([ubicacion.lat, ubicacion.lon]);
    mapa.setView([ubicacion.lat, ubicacion.lon], Math.max(mapa.getZoom(), 8));
  }, [ubicacion.lat, ubicacion.lon]);

  if (errorMapa) {
    return (
      <div className="cm-mapa cm-mapa-error">
        <p className="cm-error">{errorMapa}</p>
      </div>
    );
  }

  return <div ref={contenedor} className="cm-mapa" role="application" aria-label="Mapa para elegir el lugar de siembra" />;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------------- Página ---------------- */

export default function AnalyzeMyCropsPage() {
  const [ubicacion, setUbicacion] = useState<Ubicacion>(UBICACION_INICIAL);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null); // NASA POWER
  const [eraRes, setEraRes] = useState<Extra<DatosEra> | null>(null); // ERA5
  const [phRes, setPhRes] = useState<Extra<PhSuelo> | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [errorGps, setErrorGps] = useState<string | null>(null);

  const [eco, setEco] = useState<EcoCrop | null>(null);
  const [errorEco, setErrorEco] = useState<string | null>(null);
  const [cultivoNombre, setCultivoNombre] = useState("Maíz");
  const [mesSiembra, setMesSiembra] = useState<number>(() => new Date().getMonth() + 1);

  const anioFin = new Date().getFullYear();
  const anioInicio = anioFin - ANIOS_ATRAS;
  const clave = `${ubicacion.lat},${ubicacion.lon},${anioInicio},${anioFin},${intento}`;
  const claveExtra = `${ubicacion.lat},${ubicacion.lon},${intento}`;

  // Temperatura media mensual: NASA POWER
  useEffect(() => {
    const controlador = new AbortController();
    pedirDatosPower(ubicacion, anioInicio, anioFin, controlador.signal)
      .then((datos) => setResultado({ clave, datos, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setResultado({
          clave,
          datos: null,
          error: e instanceof Error ? e.message : "Error desconocido",
        });
      });
    return () => controlador.abort();
  }, [clave, ubicacion, anioInicio, anioFin]);

  // Lluvia, ET0 y mínima diaria: ERA5 vía Open-Meteo
  useEffect(() => {
    const controlador = new AbortController();
    pedirDatosEra(ubicacion, anioInicio, anioFin, controlador.signal)
      .then((datos) => setEraRes({ clave, valor: datos, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setEraRes({
          clave,
          valor: null,
          error: e instanceof Error ? e.message : "Error desconocido al pedir ERA5",
        });
      });
    return () => controlador.abort();
  }, [clave, ubicacion, anioInicio, anioFin]);

  // pH del suelo: SoilGrids
  useEffect(() => {
    const controlador = new AbortController();
    pedirPh(ubicacion, controlador.signal)
      .then((v) => setPhRes({ clave: claveExtra, valor: v, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPhRes({
          clave: claveExtra,
          valor: null,
          error: e instanceof Error ? e.message : "Error desconocido al pedir el pH",
        });
      });
    return () => controlador.abort();
  }, [claveExtra, ubicacion]);

  useEffect(() => {
    fetch("/datos/ecocrop.json")
      .then((r) => {
        if (!r.ok) throw new Error(`No se pudo leer ecocrop.json (error ${r.status})`);
        return r.json();
      })
      .then((j: EcoCrop) => setEco(j))
      .catch((e: unknown) =>
        setErrorEco(e instanceof Error ? e.message : "Error desconocido al leer ecocrop.json")
      );
  }, []);

  function usarMiUbicacion() {
    if (!("geolocation" in navigator)) {
      setErrorGps("Tu navegador no permite obtener la ubicación.");
      return;
    }
    setBuscandoGps(true);
    setErrorGps(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoGps(false);
        setUbicacion({
          nombre: "Mi ubicación",
          lat: redondear(pos.coords.latitude),
          lon: redondear(pos.coords.longitude),
        });
      },
      (err) => {
        setBuscandoGps(false);
        setErrorGps(
          err.code === err.PERMISSION_DENIED
            ? "No diste permiso para usar la ubicación. Podés buscar el lugar o tocar el mapa."
            : "No se pudo obtener la ubicación. Probá buscando el lugar o tocando el mapa."
        );
      },
      { timeout: 15000 }
    );
  }

  const anios = useMemo(
    () => Array.from({ length: anioFin - anioInicio + 1 }, (_, i) => anioInicio + i),
    [anioInicio, anioFin]
  );

  const actual = resultado && resultado.clave === clave ? resultado : null;
  const datosPower = actual?.datos ?? null;
  const eraActual = eraRes && eraRes.clave === clave ? eraRes : null;
  const datosEra = eraActual?.valor ?? null;
  const phActual = phRes && phRes.clave === claveExtra ? phRes : null;

  const cultivo = eco?.cultivos[cultivoNombre] ?? null;
  const dias = cultivo ? diasDelCiclo(cultivo) : null;
  const nMeses = dias ? Math.max(1, Math.round(dias / 30)) : 1;
  const nombreC = cultivoNombre.toLowerCase();

  // pH: no depende del mes, así que se evalúa una sola vez
  const rangoPh = cultivo && tieneRango(cultivo.ph) ? cultivo.ph : null;
  const phValor = phActual?.valor ?? null;
  const vPh: Veredicto = rangoPh && phValor ? VER_DE_CLASE[clasificarRango(phValor.media, rangoPh)] : "sin";

  // Lluvia: el rango de EcoCrop es para el ciclo, así que depende del mes de siembra
  const rangoLluvia = cultivo && tieneRango(cultivo.lluviaAnual) ? cultivo.lluviaAnual : null;

  // Un análisis por cada uno de los 12 meses posibles de siembra:
  // temperatura (POWER) y lluvia + ET0 (ERA5), cada uno con su propia fuente.
  const porMesSiembra = useMemo(() => {
    if (!cultivo || !dias || (!datosPower && !datosEra)) return [];
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const a = datosPower
        ? analizar(curvasMensuales(datosPower, mes, nMeses, anios), cultivo.temperatura, nMeses)
        : null;
      const rain =
        datosEra && rangoLluvia
          ? resumirLluvia(ciclosEra(datosEra, "lluvia", mes, nMeses, anios), rangoLluvia, nMeses)
          : null;
      const et0 = datosEra ? et0DelCiclo(ciclosEra(datosEra, "et0", mes, nMeses, anios)) : null;
      return {
        mes,
        a,
        rain,
        et0,
        vT: veredictoTemperatura(a, cultivo.temperatura),
        vL: rangoLluvia ? veredictoLluvia(rain, rangoLluvia) : ("sin" as Veredicto),
      };
    });
  }, [datosPower, datosEra, cultivo, dias, nMeses, anios, rangoLluvia]);

  const sel = porMesSiembra[mesSiembra - 1] ?? null;
  const vTemp: Veredicto = sel?.vT ?? "sin";
  const resLluvia = sel?.rain ?? null;
  const et0Ciclo = sel?.et0 ?? null;
  const vLluvia: Veredicto = sel?.vL ?? "sin";
  const global = combinar(vTemp, vPh, vLluvia);
  const nombresCiclo = Array.from({ length: nMeses }, (_, i) => MESES[(mesSiembra - 1 + i) % 12]);
  const mesFin = nombresCiclo[nombresCiclo.length - 1];
  const mejores = porMesSiembra
    .filter((m) => combinar(m.vT, vPh, m.vL) === "si")
    .map((m) => MESES[m.mes - 1]);

  // Temperatura letal (opcional): mínima diaria más baja de cada ciclo (ERA5)
  const tLetal = cultivo?.tLetal ?? null;
  const heladas = useMemo(() => {
    if (!datosEra || tLetal === null || !cultivo) return null;
    const minimas = minimasDelCiclo(datosEra, mesSiembra, nMeses, anios);
    if (minimas.length === 0) return null;
    return { n: minimas.length, bajo: minimas.filter((m) => m < tLetal).length };
  }, [datosEra, tLetal, cultivo, mesSiembra, nMeses, anios]);

  // Cobertura de la ET0 por la lluvia (solo informativa)
  const cobertura = resLluvia && et0Ciclo && et0Ciclo > 0 ? resLluvia.mediana / et0Ciclo : null;

  function explicacionTemperatura(): string {
    if (!sel || !sel.a || !cultivo) return "";
    const a = sel.a;
    if (sel.vT === "sin") {
      return `Solo hay ${a.n} años con datos de temperatura completos para este ciclo; hacen falta al menos ${MIN_ANIOS} para opinar.`;
    }
    if (!a.critico) return "En ningún año la temperatura salió de lo que tolera el cultivo durante el ciclo.";
    const m = a.porMes[a.critico.mes];
    const r = cultivo.temperatura;
    const frio = m.bajos >= m.altos;
    const limite = frio ? r.min : r.max;
    return `El mes más delicado es ${nombresCiclo[a.critico.mes]}: en ${a.critico.fallos} de ${a.n} años ${
      frio ? "hizo más frío del mínimo" : "hizo más calor del máximo"
    } que tolera el ${nombreC} (${limite !== null ? formatear(limite) : "?"} °C).`;
  }

  function explicacionLluvia(): string {
    if (!resLluvia || !rangoLluvia) return "";
    const r = rangoLluvia;
    const med = resLluvia.mediana;
    const medTxt = formatear(med);
    const n = (v: number | null) => (v !== null ? formatear(v) : "?");
    if (vLluvia === "sin") {
      return `Solo hay ${resLluvia.n} años con lluvia completa para este ciclo; hacen falta al menos ${MIN_ANIOS} para opinar.`;
    }
    const bajaIdeal = r.optMin !== null && med < r.optMin;
    const altaIdeal = r.optMax !== null && med > r.optMax;
    if (vLluvia === "no") {
      if (r.min !== null && med < r.min) {
        return `Sembrando en ${MESES[mesSiembra - 1].toLowerCase()} llueven unos ${medTxt} mm durante el ciclo, menos de lo que tolera el ${nombreC} (mínimo ${n(r.min)} mm). Necesitaría riego.`;
      }
      if (r.max !== null && med > r.max) {
        return `Sembrando en ${MESES[mesSiembra - 1].toLowerCase()} llueven unos ${medTxt} mm durante el ciclo, más de lo que tolera el ${nombreC} (máximo ${n(r.max)} mm).`;
      }
      return `En ${resLluvia.n - resLluvia.ok} de ${resLluvia.n} años la lluvia del ciclo quedó fuera de lo que tolera el ${nombreC} (${n(r.min)}–${n(r.max)} mm).`;
    }
    if (bajaIdeal) {
      return `Durante el ciclo llueven unos ${medTxt} mm: el ${nombreC} lo tolera, pero queda por debajo del ideal (${n(r.optMin)}–${n(r.optMax)} mm). Un riego de apoyo ayudaría.`;
    }
    if (altaIdeal) {
      return `Durante el ciclo llueven unos ${medTxt} mm: el ${nombreC} lo tolera, pero queda por encima del ideal (${n(r.optMin)}–${n(r.optMax)} mm).`;
    }
    return `En ${resLluvia.n - resLluvia.ok} de ${resLluvia.n} años la lluvia del ciclo quedó fuera de lo que tolera el ${nombreC} (${n(r.min)}–${n(r.max)} mm).`;
  }

  function explicacionPh(): string {
    if (!phValor || !rangoPh) return "";
    return vPh === "no"
      ? `El pH del suelo en este punto (${formatear(phValor.media, 1)}) está fuera de lo que tolera el ${nombreC} (${rangoPh.min ?? "?"}–${rangoPh.max ?? "?"}).`
      : `El pH del suelo en este punto (${formatear(phValor.media, 1)}) tolera, pero no es el ideal del ${nombreC} (${rangoPh.optMin ?? "?"}–${rangoPh.optMax ?? "?"}).`;
  }

  function explicacion(): string {
    if (!cultivo) return "";
    if (global === "si") {
      const partes = ["la temperatura"];
      if (vLluvia !== "sin") partes.push("la lluvia del ciclo");
      if (vPh !== "sin") partes.push("el pH del suelo");
      const lista =
        partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
      const base = `${lista.charAt(0).toUpperCase()}${lista.slice(1)} ${
        partes.length === 1 ? "está" : "están"
      } dentro de lo que tolera el cultivo.`;
      return vPh === "sin" ? `${base} (El pH del suelo todavía no se pudo evaluar.)` : base;
    }
    const gT = GRAV[vTemp];
    const gP = GRAV[vPh];
    const gL = GRAV[vLluvia];
    const peorG = Math.max(gT, gP, gL);
    if (gT === peorG) return explicacionTemperatura();
    if (gP === peorG) return explicacionPh();
    return explicacionLluvia();
  }

  const TITULO: Record<Veredicto, string> = {
    si: `Sí conviene sembrar ${nombreC} en ${MESES[mesSiembra - 1].toLowerCase()}`,
    cuidado: `Se puede sembrar ${nombreC} en ${MESES[mesSiembra - 1].toLowerCase()}, con cuidado`,
    no: `No conviene sembrar ${nombreC} en ${MESES[mesSiembra - 1].toLowerCase()}`,
    sin: "Todavía no se puede opinar",
  };

  const textoTemp =
    !datosPower ? "consultando…" : !sel?.a ? "sin datos" : `${sel.a.cicloOk} de ${sel.a.n} años bien`;
  const textoPh = !rangoPh
    ? "sin rango para este cultivo"
    : phActual?.error
    ? "sin dato"
    : !phValor
    ? "consultando…"
    : `${formatear(phValor.media, 1)} · ${
        vPh === "si" ? "ideal" : vPh === "cuidado" ? "tolerable" : "fuera de rango"
      }`;
  const textoLluvia = !rangoLluvia
    ? "sin rango para este cultivo"
    : !datosEra
    ? eraActual?.error
      ? "sin dato"
      : "consultando…"
    : !resLluvia
    ? "sin datos"
    : `${formatear(resLluvia.mediana)} mm en el ciclo · ${
        vLluvia === "si"
          ? "ideal"
          : vLluvia === "cuidado"
          ? "tolerable"
          : vLluvia === "no"
          ? "fuera de rango"
          : "pocos años"
      }`;

  return (
    <main className="cm">
      <div className="cm-wrap">
        <header className="cm-cab">
          <Link href="/">← Inicio</Link>
          <span className="cm-sutil">03 / 05</span>
        </header>
        <span className="cm-kicker">Analizar mis cultivos</span>
        <h1>¿Conviene sembrar?</h1>
        <p className="cm-sub">
          Elegí cultivo, mes y lugar. Mirá cómo le habría ido en los últimos {ANIOS_ATRAS} años.
        </p>

        {/* ---------- Fila principal: qué y cuándo · dónde · conviene ---------- */}
        <div className="cm-fila">
          <div className="cm-card">
            <label className="cm-etiqueta" htmlFor="cm-cultivo">
              Qué sembrar
            </label>
            <select
              id="cm-cultivo"
              value={cultivoNombre}
              onChange={(e) => setCultivoNombre(e.target.value)}
              disabled={!eco}
            >
              {eco ? (
                Object.keys(eco.cultivos).map((nombre) => (
                  <option key={nombre} value={nombre}>
                    {nombre}
                  </option>
                ))
              ) : (
                <option>Cargando…</option>
              )}
            </select>

            <span className="cm-etiqueta" style={{ marginTop: 14 }}>
              Cuándo sembrar
            </span>
            <div className="cm-meses">
              {MESES.map((nombre, i) => {
                const mes = i + 1;
                const p = porMesSiembra[i];
                const v = p ? combinar(p.vT, vPh, p.vL) : "sin";
                return (
                  <button
                    key={nombre}
                    type="button"
                    className="cm-mes"
                    aria-pressed={mes === mesSiembra}
                    onClick={() => setMesSiembra(mes)}
                    title={`${nombre}: ${
                      v === "si" ? "sí conviene" : v === "cuidado" ? "con cuidado" : v === "no" ? "no conviene" : "sin datos suficientes"
                    }`}
                  >
                    <span className="cm-punto" style={{ background: COLOR_VEREDICTO[v] }} />
                    {nombre.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <p className="cm-nota">El color de cada mes dice cómo le habría ido al cultivo si se sembraba entonces.</p>
          </div>

          <div className="cm-card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="cm-ubi-cab">
              <span className="cm-etiqueta">Dónde sembrar</span>
              <span>
                <span className="cm-ubi-nombre">{ubicacion.nombre}</span>{" "}
                <span className="cm-ubi-coord">
                  ({ubicacion.lat}°, {ubicacion.lon}°)
                </span>
              </span>
            </div>
            <BuscadorLugar onElegir={setUbicacion} />
            <Mapa ubicacion={ubicacion} onElegir={setUbicacion} />
            <div className="cm-mapa-pie">
              <p>Tocá el mapa para marcar tu terreno.</p>
              <button type="button" className="cm-boton sec" onClick={usarMiUbicacion} disabled={buscandoGps}>
                {buscandoGps ? "Obteniendo…" : "Usar mi ubicación"}
              </button>
            </div>
            {errorGps && <p className="cm-error" style={{ marginTop: 6 }}>{errorGps}</p>}
          </div>

          <div className={`cm-ver ${global}`} role="status">
            {!datosPower && !actual?.error ? (
              <>
                <h2>Calculando…</h2>
                <p className="cm-fino">Consultando el clima de los últimos años.</p>
              </>
            ) : actual?.error ? (
              <>
                <h2>No se pudieron cargar los datos</h2>
                <p className="cm-error">{actual.error}</p>
                <div>
                  <button type="button" className="cm-boton" onClick={() => setIntento((n) => n + 1)}>
                    Reintentar
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>{TITULO[global]}</h2>
                <p>{explicacion()}</p>

                <ul className="cm-factores">
                  <li className="cm-factor">
                    <span className="cm-punto" style={{ background: COLOR_VEREDICTO[vTemp] }} />
                    <span>
                      <b>Temperatura</b> · {textoTemp}
                    </span>
                  </li>
                  <li className="cm-factor">
                    <span className="cm-punto" style={{ background: COLOR_VEREDICTO[vLluvia] }} />
                    <span>
                      <b>Lluvia del ciclo</b> · {textoLluvia}
                    </span>
                  </li>
                  <li className="cm-factor">
                    <span className="cm-punto" style={{ background: COLOR_VEREDICTO[vPh] }} />
                    <span>
                      <b>pH del suelo</b> · {textoPh}
                    </span>
                  </li>
                </ul>

                {global !== "si" && mejores.length > 0 && (
                  <p>
                    <strong>Meses que mejor le irían:</strong> {mejores.join(", ")}.
                  </p>
                )}
                {eraActual?.error && (
                  <p className="cm-error">No se pudo cargar la lluvia (ERA5): {eraActual.error}</p>
                )}
                {resLluvia && resLluvia.secos > 0 && (
                  <p className="cm-fino">
                    Aviso: en el año típico, {resLluvia.secos} {resLluvia.secos === 1 ? "mes" : "meses"} del ciclo
                    tienen menos de {MES_SECO_MM} mm de lluvia.
                  </p>
                )}
                {cobertura !== null && cobertura < RATIO_ET0_AVISO && (
                  <p className="cm-fino">
                    Aviso: la lluvia del ciclo cubre cerca del {formatear(cobertura * 100)} % de la evaporación
                    potencial (ET0). Puede hacer falta riego.
                  </p>
                )}
                {heladas && heladas.bajo > 0 && tLetal !== null && (
                  <p className="cm-fino">
                    Aviso: en {heladas.bajo} de {heladas.n} años la temperatura mínima diaria bajó de{" "}
                    {formatear(tLetal)} °C (temperatura letal) durante el ciclo.
                  </p>
                )}
                <p className="cm-fino">
                  Ciclo estimado: {nMeses} {nMeses === 1 ? "mes" : "meses"} ({MESES[mesSiembra - 1]} a {mesFin}).
                </p>
              </>
            )}
          </div>
        </div>

        {errorEco && <p className="cm-error" style={{ marginTop: 12 }}>{errorEco}</p>}
        {!eco && !errorEco && <p className="cm-cargando">Cargando rangos de cultivos…</p>}

        {/* ---------- Gráficas: pH y lluvia a la izquierda, temperatura a la derecha ---------- */}
        {cultivo && (
          <section className="cm-card cm-graf">
            <div className="cm-graf-cuerpo">
              {/* Izquierda: dos medidores verticales */}
              <div>
                <div className="cm-lugar">
                  <div className="cm-vert">
                    <h3 className="cm-h3">pH del suelo</h3>
                    {rangoPh && (
                      <p className="cm-rango">
                        Ideal {rangoPh.optMin ?? "?"}–{rangoPh.optMax ?? "?"} · Tolera {rangoPh.min ?? "?"}–{rangoPh.max ?? "?"}
                      </p>
                    )}
                    {!rangoPh && (
                      <p className="cm-vacio">EcoCrop no trae rango de pH para este cultivo.</p>
                    )}
                    {rangoPh && !phActual && <p className="cm-vacio">Consultando SoilGrids…</p>}
                    {rangoPh && phActual?.error && (
                      <div>
                        <p className="cm-error">{phActual.error}</p>
                        <p style={{ marginTop: 8 }}>
                          <button type="button" className="cm-boton sec" onClick={() => setIntento((n) => n + 1)}>
                            Reintentar
                          </button>
                        </p>
                      </div>
                    )}
                    {rangoPh && phValor && (
                      <>
                        <MedidorVertical
                          valor={phValor.media}
                          bajo={phValor.p5}
                          alto={phValor.p95}
                          rango={rangoPh}
                          dec={1}
                          aria={`pH del suelo ${phValor.media} frente al rango que tolera el cultivo`}
                          tooltipValor={`pH estimado: ${formatear(phValor.media, 1)}`}
                          tooltipRango={`Incertidumbre del modelo: ${formatear(phValor.p5, 1)} a ${formatear(phValor.p95, 1)}`}
                        />
                        <p className="cm-dato-grande" style={{ color: COLOR_VEREDICTO[vPh] }}>
                          pH {formatear(phValor.media, 1)}
                        </p>
                        <p className="cm-chico">
                          El modelo estima entre {formatear(phValor.p5, 1)} y {formatear(phValor.p95, 1)} (0–30 cm).
                          Es una estimación satelital: un análisis de suelo es más confiable.
                        </p>
                      </>
                    )}
                  </div>

                  <div className="cm-vert">
                    <h3 className="cm-h3">Lluvia del ciclo</h3>
                    {rangoLluvia && (
                      <p className="cm-rango">
                        Ideal {rangoLluvia.optMin !== null ? formatear(rangoLluvia.optMin) : "?"}–
                        {rangoLluvia.optMax !== null ? formatear(rangoLluvia.optMax) : "?"} · Tolera{" "}
                        {rangoLluvia.min !== null ? formatear(rangoLluvia.min) : "?"}–
                        {rangoLluvia.max !== null ? formatear(rangoLluvia.max) : "?"} mm
                      </p>
                    )}
                    {!rangoLluvia && (
                      <p className="cm-vacio">EcoCrop no trae rango de lluvia para este cultivo.</p>
                    )}
                    {rangoLluvia && !datosEra && !eraActual?.error && (
                      <p className="cm-vacio">Consultando ERA5…</p>
                    )}
                    {rangoLluvia && eraActual?.error && (
                      <div>
                        <p className="cm-error">{eraActual.error}</p>
                        <p style={{ marginTop: 8 }}>
                          <button type="button" className="cm-boton sec" onClick={() => setIntento((n) => n + 1)}>
                            Reintentar
                          </button>
                        </p>
                      </div>
                    )}
                    {rangoLluvia && datosEra && !resLluvia && (
                      <p className="cm-vacio">No hay ciclos completos con datos de lluvia para este mes.</p>
                    )}
                    {rangoLluvia && resLluvia && (
                      <>
                        <MedidorVertical
                          valor={resLluvia.mediana}
                          bajo={resLluvia.p10}
                          alto={resLluvia.p90}
                          rango={rangoLluvia}
                          dec={0}
                          desdeCero
                          aria={`Lluvia típica del ciclo de ${formatear(resLluvia.mediana)} mm frente al rango que tolera el cultivo`}
                          tooltipValor={`Lluvia típica del ciclo: ${formatear(resLluvia.mediana)} mm`}
                          tooltipRango={`Años típicos: ${formatear(resLluvia.p10)} a ${formatear(resLluvia.p90)} mm`}
                        />
                        <p
                          className="cm-dato-grande"
                          style={{ color: COLOR_VEREDICTO[vLluvia] }}
                        >
                          {formatear(resLluvia.mediana)} mm
                        </p>
                        <p className="cm-chico">
                          Total de {nMeses} {nMeses === 1 ? "mes" : "meses"} desde {MESES[mesSiembra - 1].toLowerCase()}.
                          Mediana de {resLluvia.n} años; la mayoría cae entre {formatear(resLluvia.p10)} y{" "}
                          {formatear(resLluvia.p90)} mm.
                          {resLluvia.secos > 0 &&
                            ` ${resLluvia.secos} ${resLluvia.secos === 1 ? "mes" : "meses"} del ciclo con menos de ${MES_SECO_MM} mm.`}
                        </p>
                        {et0Ciclo !== null && (
                          <p className="cm-chico">
                            Evaporación potencial (ET0) del ciclo: {formatear(et0Ciclo)} mm
                            {cobertura !== null && ` · la lluvia cubre cerca del ${formatear(cobertura * 100)} %`}. Es
                            solo un dato: no cambia el resultado.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <ul className="cm-leyenda">
                  <li>
                    <span className="cm-muestra" style={{ background: C.ideal }} /> Ideal
                  </li>
                  <li>
                    <span className="cm-muestra" style={{ background: C.tolera }} /> Lo que tolera
                  </li>
                  <li>
                    <span className="cm-muestra" style={{ background: C.suave, height: 3 }} /> Rango del dato
                  </li>
                </ul>
                <p className="cm-chico">
                  El pH es del lugar y no cambia con el mes. La lluvia sí cambia: se suma durante el ciclo desde el mes
                  de siembra elegido.
                </p>
              </div>

              {/* Derecha: temperatura */}
              <div>
                <h3 className="cm-h3">Temperatura durante el ciclo</h3>
                <p className="cm-rango">
                  Ideal {cultivo.temperatura.optMin ?? "?"}–{cultivo.temperatura.optMax ?? "?"} °C · Tolera{" "}
                  {cultivo.temperatura.min ?? "?"}–{cultivo.temperatura.max ?? "?"} °C
                </p>
                {!datosPower && !actual?.error && <p className="cm-vacio">Consultando el clima de los últimos años…</p>}
                {actual?.error && <p className="cm-vacio">No hay datos de temperatura (ver arriba).</p>}
                {datosPower && !sel?.a && (
                  <p className="cm-vacio">
                    No hay ciclos completos con datos para esta ventana (NASA publica con retraso y el ciclo puede
                    incluir meses futuros).
                  </p>
                )}
                {datosPower && sel?.a && (
                  <>
                    <GraficaTemperatura a={sel.a} nombres={nombresCiclo} rango={cultivo.temperatura} />
                    <ul className="cm-leyenda">
                      <li>
                        <span className="cm-muestra" style={{ background: C.ideal }} /> Ideal
                      </li>
                      <li>
                        <span className="cm-muestra" style={{ background: C.tolera }} /> Lo que tolera
                      </li>
                      <li>
                        <span className="cm-muestra" style={{ background: "rgba(57,125,164,.45)", height: 3 }} /> Cada
                        año pasado
                      </li>
                      <li>
                        <span className="cm-muestra" style={{ background: C.tinta, height: 3 }} /> Año típico
                      </li>
                    </ul>
                    <div className="cm-mesgrid">
                      {sel.a.porMes.map((m, i) => {
                        const nivel = nivelDeMes(m);
                        return (
                          <div key={i} className="cm-mescard" style={{ borderTopColor: COLOR_NIVEL[nivel] }}>
                            <b>{nombresCiclo[i]}</b>
                            <span className="t">{formatear(m.mediana)} °C</span>
                            <div className="e" style={{ color: COLOR_NIVEL[nivel] }}>
                              {TEXTO_NIVEL[nivel]}
                            </div>
                            <div className="a">
                              {m.ok} de {m.n} años bien
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        <details className="cm-det">
          <summary>Cómo se decide</summary>
          <p>
            <strong>Temperatura.</strong> Cada mes del ciclo se compara con el rango de temperatura que FAO EcoCrop
            da para el cultivo, usando la temperatura media mensual de NASA POWER. Un año "cumple" si todos los meses
            de su ciclo estuvieron dentro de lo que el cultivo tolera. Si eso pasó en el {Math.round(UMBRAL_SI * 100)} %
            de los años o más, la respuesta es sí; entre {Math.round(UMBRAL_CUIDADO * 100)} % y{" "}
            {Math.round(UMBRAL_SI * 100)} %, con cuidado; por debajo, no. Si la temperatura típica de algún mes ya
            queda fuera del rango, también es no. Estos porcentajes son un criterio propio de esta herramienta, no un
            dato de FAO.
          </p>
          <p>
            <strong>Lluvia del ciclo.</strong> ERA5 entrega la lluvia diaria. Se suma por mes y, para cada año pasado,
            se suman los meses del ciclo que empieza en el mes de siembra elegido. La lluvia típica (mediana) se
            compara con el rango de lluvia de EcoCrop, que corresponde al ciclo del cultivo y no al año calendario:
            ideal si cae en el rango óptimo, tolerable si cae en el rango absoluto, no conviene si queda fuera.
            Además, si menos del {Math.round(UMBRAL_SI * 100)} % de los años quedó dentro de lo que tolera, el
            resultado baja. Como el total no dice cuándo llueve, se avisa cuántos meses del ciclo típico tienen menos
            de {MES_SECO_MM} mm (ese aviso no cambia el resultado). Si llueve menos del mínimo, el cultivo podría
            sembrarse con riego.
          </p>
          <p>
            <strong>Evaporación potencial (ET0).</strong> ERA5 también da la ET0 diaria (FAO Penman-Monteith). Se suma
            en el ciclo y se compara con la lluvia solo como dato y aviso (cuando la lluvia cubre menos del{" "}
            {Math.round(RATIO_ET0_AVISO * 100)} %). EcoCrop no tiene un rango de evapotranspiración y la ET0 no es la
            demanda real del cultivo (para eso haría falta el coeficiente Kc de cada etapa), por eso no pesa en el
            resultado.
          </p>
          <p>
            <strong>pH del suelo.</strong> Ideal si cae en el rango óptimo de EcoCrop, tolerable si cae en el rango
            absoluto, no conviene si queda fuera. Es un valor fijo del lugar: no cambia con el mes ni con los años.
          </p>
          <p>
            <strong>Resultado final.</strong> Manda el peor de los factores (ley del mínimo), no un promedio. No es un
            pronóstico: describe lo que pasó en esos mismos meses durante los años pasados. Para la temperatura se usa
            la media mensual, así que una helada o una ola de calor de pocos días no se ve en el veredicto; si el
            cultivo tiene temperatura letal en EcoCrop, se muestra un aviso con la mínima diaria de ERA5. No se
            evalúan altitud ni otras propiedades del suelo. Es una guía para orientarse: consultá a un técnico
            agrícola antes de decidir.
          </p>
          <p>
            Datos: temperatura media, NASA POWER (comunidad AG, T2M, grilla de baja resolución) · Lluvia, ET0 y mínima
            diaria: ERA5 (ECMWF/Copernicus) servido por Open-Meteo (~25 km; en zonas de montaña un punto cercano
            puede dar valores distintos) · Suelo: ISRIC SoilGrids (pH en agua, 0–30 cm) · Rangos y duración del ciclo:
            FAO EcoCrop (copia OpenCLIM; ciclo = mínimo + 1 mes, con 1 mes = 30 días) · Búsqueda de lugares:
            Open-Meteo · Mapa: OpenStreetMap.
          </p>
        </details>
      </div>
    </main>
  );
}