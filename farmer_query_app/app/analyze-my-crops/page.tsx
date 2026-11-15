"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

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

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/* ---------------- Tipos ---------------- */

type SerieMensual = Record<string, number>;
type DatosPower = Record<string, SerieMensual>;
type VariablePower = "T2M" | "PRECTOTCORR";
type Resultado = { clave: string; datos: DatosPower | null; error: string | null };

type Rango = {
  min: number | null;
  optMin: number | null;
  optMax: number | null;
  max: number | null;
};
type CultivoEco = {
  cientifico: string;
  temperatura: Rango;
  ph?: Rango;
  precipitacion?: Rango; // mm acumulados
  cicloDias: { min: number | null; max: number | null };
};
type EcoCrop = { fuente: string; cultivos: Record<string, CultivoEco> };

type Curva = { anioSiembra: number; valores: number[] };
type LluviaCiclo = { anioSiembra: number; total: number };
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

async function pedirDatosPower(
  u: Ubicacion,
  desde: number,
  hasta: number,
  signal: AbortSignal
): Promise<DatosPower> {
  const params = new URLSearchParams({
    parameters: "T2M,PRECTOTCORR",
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

const diasEnMes = (anio: number, mes: number) => new Date(anio, mes, 0).getDate();

// Lluvia acumulada del ciclo (mm) por año de siembra. POWER da mm/día promedio de cada mes:
// se multiplica por los días del mes y se suman los meses del ciclo.
function lluviaPorCiclo(datos: DatosPower, mesSiembra: number, nMeses: number, anios: number[]): LluviaCiclo[] {
  const res: LluviaCiclo[] = [];
  for (const anioSiembra of anios) {
    let total = 0;
    let completa = true;
    for (let i = 0; i < nMeses; i++) {
      const idx = mesSiembra - 1 + i;
      const a = anioSiembra + Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const v = valorMensual(datos, "PRECTOTCORR", a, m);
      if (v === null) {
        completa = false;
        break;
      }
      total += v * diasEnMes(a, m);
    }
    if (completa) res.push({ anioSiembra, total });
  }
  return res;
}

function mediana(valores: number[]): number {
  const s = [...valores].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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

function veredictoTemperatura(a: Analisis | null, rango: Rango): Veredicto {
  if (!a || a.n < MIN_ANIOS) return "sin";
  const medianaFuera = a.porMes.some((m) => clasificarRango(m.mediana, rango) === "fuera");
  if (medianaFuera) return "no";
  const parte = a.cicloOk / a.n;
  if (parte >= UMBRAL_SI) return "si";
  if (parte >= UMBRAL_CUIDADO) return "cuidado";
  return "no";
}

// Lluvia: se compara el total acumulado del ciclo de cada año con el rango de EcoCrop.
function veredictoLluvia(totales: number[], rango: Rango): Veredicto {
  if (totales.length < MIN_ANIOS) return "sin";
  if (clasificarRango(mediana(totales), rango) === "fuera") return "no";
  const parte = totales.filter((t) => clasificarRango(t, rango) !== "fuera").length / totales.length;
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

/* ---------------- Colores (también los usa el SVG) ---------------- */

const C = {
  tinta: "#1c2a21",
  suave: "#5d6b61",
  linea: "#dde3d8",
  ideal: "#bfe3cb",
  tolera: "#e7f2e9",
  anios: "#2f5d7c",
  si: "#1f6b43",
  cuidado: "#a06b00",
  no: "#a8321f",
  sin: "#7a857d",
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

/* ---------------- Gráfica de pH: valor del suelo frente al rango del cultivo ---------------- */

function GraficaPh({ ph, rango }: { ph: PhSuelo; rango: Rango }) {
  const W = 640;
  const H = 170;
  const mI = 24;
  const mD = 24;
  const yB = 62;
  const alto = 40;

  const puntos = [ph.media, ph.p5, ph.p95, rango.min, rango.optMin, rango.optMax, rango.max].filter(
    (v): v is number => v !== null
  );
  const lo = Math.min(...puntos);
  const hi = Math.max(...puntos);
  const pad = (hi - lo) * 0.08 || 0.5;
  const a = lo - pad;
  const b = hi + pad;
  const ancho = W - mI - mD;
  const x = (v: number) => mI + ((v - a) / (b - a)) * ancho;
  const rec = (v: number) => x(Math.min(Math.max(v, a), b));

  const izqAbs = rango.min !== null ? rec(rango.min) : x(a);
  const derAbs = rango.max !== null ? rec(rango.max) : x(b);
  const izqOpt = rango.optMin !== null ? rec(rango.optMin) : x(a);
  const derOpt = rango.optMax !== null ? rec(rango.optMax) : x(b);
  const color = COLOR_CLASE[clasificarRango(ph.media, rango)];
  const ticks = ticksBonitos(a, b, 6);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`pH del suelo ${ph.media} frente al rango que tolera el cultivo`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <rect x={izqAbs} y={yB} width={Math.max(0, derAbs - izqAbs)} height={alto} fill={C.tolera} />
      <rect x={izqOpt} y={yB} width={Math.max(0, derOpt - izqOpt)} height={alto} fill={C.ideal} />

      {rango.min !== null && (
        <g>
          <line x1={x(rango.min)} x2={x(rango.min)} y1={yB - 8} y2={yB + alto} stroke={C.no} strokeDasharray="5 4" />
          <text x={x(rango.min)} y={yB + alto + 28} textAnchor="middle" fontSize={11} fill={C.no}>
            mín. {formatear(rango.min, 1)}
          </text>
        </g>
      )}
      {rango.max !== null && (
        <g>
          <line x1={x(rango.max)} x2={x(rango.max)} y1={yB - 8} y2={yB + alto} stroke={C.no} strokeDasharray="5 4" />
          <text x={x(rango.max)} y={yB + alto + 28} textAnchor="middle" fontSize={11} fill={C.no}>
            máx. {formatear(rango.max, 1)}
          </text>
        </g>
      )}

      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={yB + alto} y2={yB + alto + 5} stroke={C.suave} />
          <text x={x(t)} y={yB + alto + 17} textAnchor="middle" fontSize={11} fill={C.suave}>
            {formatear(t, 1)}
          </text>
        </g>
      ))}

      <line x1={x(ph.p5)} x2={x(ph.p95)} y1={yB + alto / 2} y2={yB + alto / 2} stroke={color} strokeWidth={4} strokeOpacity={0.55} strokeLinecap="round">
        <title>{`Incertidumbre del modelo: ${formatear(ph.p5, 1)} a ${formatear(ph.p95, 1)}`}</title>
      </line>
      <circle cx={x(ph.media)} cy={yB + alto / 2} r={9} fill={color} stroke="#fff" strokeWidth={3}>
        <title>{`pH estimado: ${formatear(ph.media, 1)}`}</title>
      </circle>
      <text x={x(ph.media)} y={yB - 16} textAnchor="middle" fontSize={15} fontWeight={700} fill={color}>
        pH {formatear(ph.media, 1)}
      </text>
    </svg>
  );
}

/* ---------------- Gráfica de lluvia: total del ciclo en cada año pasado ---------------- */

function GraficaLluvia({ datos, rango }: { datos: LluviaCiclo[]; rango: Rango }) {
  const W = 640;
  const H = 230;
  const M = { izq: 52, der: 14, arr: 14, abajo: 28 };

  const tope = Math.max(...datos.map((d) => d.total), rango.max ?? 0, rango.optMax ?? 0) * 1.1 || 1;
  const ancho = W - M.izq - M.der;
  const alt = H - M.arr - M.abajo;
  const y = (v: number) => M.arr + alt - (Math.min(Math.max(v, 0), tope) / tope) * alt;
  const bw = ancho / datos.length;

  const banda = (a: number | null, b: number | null, fill: string) => {
    const arriba = y(b ?? tope);
    const abajo = y(a ?? 0);
    return <rect x={M.izq} y={arriba} width={ancho} height={Math.max(0, abajo - arriba)} fill={fill} />;
  };

  const paso = Math.max(1, Math.ceil(datos.length / 7));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Lluvia acumulada durante el ciclo en cada año pasado, frente al rango que tolera el cultivo"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {banda(rango.min, rango.max, C.tolera)}
      {banda(rango.optMin, rango.optMax, C.ideal)}

      {ticksBonitos(0, tope, 4).map((t) => (
        <g key={t}>
          <line x1={M.izq} x2={M.izq + ancho} y1={y(t)} y2={y(t)} stroke={C.linea} strokeWidth={1} />
          <text x={M.izq - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.suave}>
            {formatear(t)}
          </text>
        </g>
      ))}

      {datos.map((d, i) => (
        <g key={d.anioSiembra}>
          <rect
            x={M.izq + i * bw + 2}
            width={Math.max(2, bw - 4)}
            y={y(d.total)}
            height={Math.max(0, M.arr + alt - y(d.total))}
            fill={COLOR_CLASE[clasificarRango(d.total, rango)]}
            fillOpacity={0.8}
          >
            <title>{`Siembra ${d.anioSiembra}: ${formatear(d.total)} mm en el ciclo`}</title>
          </rect>
          {i % paso === 0 && (
            <text x={M.izq + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={C.suave}>
              {d.anioSiembra}
            </text>
          )}
        </g>
      ))}
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

/* ---------------- Estilos ---------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,800&family=Figtree:wght@400;500;600&display=swap');

.cm{
  --fondo:#f2f4ee; --papel:#ffffff; --tinta:${C.tinta}; --suave:${C.suave}; --linea:${C.linea};
  --verde:#1f6b43; --si:${C.si}; --cuidado:${C.cuidado}; --no:${C.no}; --sin:${C.sin};
  background:var(--fondo); color:var(--tinta); min-height:100vh; padding:16px 16px 56px;
  font-family:'Figtree',system-ui,-apple-system,'Segoe UI',sans-serif; line-height:1.45; font-size:15px;
}
.cm *{box-sizing:border-box}
.cm-wrap{max-width:1180px;margin:0 auto}

.cm-cab{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cm h1{
  font-family:'Bricolage Grotesque','Figtree',system-ui,sans-serif;font-weight:800;
  font-size:clamp(26px,4.5vw,36px);line-height:1.05;letter-spacing:-0.02em;margin:0;
}
.cm-top{display:flex;gap:14px;align-items:center;font-size:14px;color:var(--suave)}
.cm-top a{color:var(--verde);font-weight:600;text-decoration:none}
.cm-top a:hover{text-decoration:underline}
.cm-sub{color:var(--suave);margin:4px 0 0}

.cm-card{background:var(--papel);border:1px solid var(--linea);border-radius:14px;padding:14px}
.cm-etiqueta{display:block;font-size:13px;font-weight:600;color:var(--suave);margin-bottom:6px}
.cm select,.cm input[type=text]{
  width:100%;font:inherit;color:var(--tinta);background:#fff;border:1px solid #c9d1c5;border-radius:10px;padding:9px 12px;min-height:42px;
}
.cm select:focus-visible,.cm input:focus-visible,.cm button:focus-visible{outline:3px solid #8ec5a2;outline-offset:2px}

/* fila principal: qué y cuándo · dónde · conviene */
.cm-fila{display:grid;gap:12px;margin-top:14px}
@media(min-width:960px){
  .cm-fila{grid-template-columns:minmax(240px,1fr) minmax(300px,1.3fr) minmax(280px,1.15fr);align-items:stretch}
}

.cm-meses{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
.cm-mes{
  font:inherit;font-size:13px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 0 6px;
  background:#fff;border:1px solid var(--linea);border-radius:9px;cursor:pointer;color:var(--tinta);min-height:48px;
}
.cm-mes:hover{border-color:#9fb3a6}
.cm-mes[aria-pressed=true]{border:2px solid var(--tinta);padding:7px 0 5px;font-weight:600}
.cm-punto{width:11px;height:11px;border-radius:50%;background:var(--sin)}
.cm-nota{margin:8px 0 0;color:var(--suave);font-size:13px}

.cm-ubi-cab{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.cm-ubi-cab .cm-etiqueta{margin:0}
.cm-ubi-nombre{font-weight:600;font-size:14px}
.cm-ubi-coord{font-size:12px;color:var(--suave)}
.cm-buscador{position:relative;z-index:5}
.cm-sug{
  position:absolute;left:0;right:0;top:calc(100% + 4px);list-style:none;margin:0;padding:4px;
  background:#fff;border:1px solid #c9d1c5;border-radius:10px;box-shadow:0 8px 24px rgba(28,42,33,.14);
}
.cm-sug button{width:100%;text-align:left;font:inherit;background:none;border:0;padding:9px 10px;border-radius:8px;cursor:pointer;min-height:42px}
.cm-sug button:hover{background:#eef5f0}
.cm-sug-info{padding:10px;color:var(--suave);font-size:14px}
.cm-mapa{flex:1;min-height:190px;height:210px;margin-top:8px;border-radius:12px;overflow:hidden;isolation:isolate;z-index:0;border:1px solid var(--linea);cursor:crosshair;background:#e9ede8}
.cm-mapa-error{display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;cursor:default}
.cm-mapa-pie{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.cm-mapa-pie p{margin:0;color:var(--suave);font-size:13px}
.cm-boton{font:inherit;font-weight:600;min-height:40px;padding:0 14px;border-radius:10px;border:0;background:var(--verde);color:#fff;cursor:pointer}
.cm-boton.sec{background:#fff;color:var(--verde);border:1px solid #b9c9be}
.cm-boton:disabled{opacity:.6;cursor:default}
.cm-error{margin:0;color:var(--no);font-size:14px}

/* veredicto */
.cm-ver{border-radius:14px;padding:16px;border:1px solid transparent;border-left:8px solid var(--sin);background:#e9ede8;display:flex;flex-direction:column;gap:8px}
.cm-ver.si{background:#dcefe2;border-left-color:var(--si)}
.cm-ver.cuidado{background:#f7ebc6;border-left-color:var(--cuidado)}
.cm-ver.no{background:#f6dad4;border-left-color:var(--no)}
.cm-ver h2{font-family:'Bricolage Grotesque','Figtree',sans-serif;font-weight:800;font-size:clamp(20px,2.6vw,25px);line-height:1.12;letter-spacing:-0.015em;margin:0}
.cm-ver.si h2{color:#134a2e}.cm-ver.cuidado h2{color:#6d4900}.cm-ver.no h2{color:#7c2216}
.cm-ver p{margin:0}
.cm-ver .cm-fino{font-size:13px;color:#3d4a41}
.cm-factores{list-style:none;margin:2px 0 0;padding:0;display:grid;gap:6px}
.cm-factor{
  width:100%;text-align:left;font:inherit;font-size:14px;display:flex;align-items:center;gap:8px;
  background:rgba(255,255,255,.65);border:1px solid rgba(28,42,33,.12);border-radius:9px;padding:7px 10px;color:var(--tinta);min-height:40px;
}
.cm-factor b{font-weight:600}
.cm-factor .cm-punto{flex:none}

/* panel de gráficas: pH a la izquierda, temperatura a la derecha, lluvia abajo */
.cm-graf{margin-top:12px}
.cm-graf-cuerpo{display:grid;gap:20px;grid-template-columns:1fr}
@media(min-width:960px){.cm-graf-cuerpo{grid-template-columns:1fr 1.8fr;align-items:start}}
.cm-h3{font-family:'Bricolage Grotesque','Figtree',sans-serif;font-size:16px;font-weight:800;margin:0 0 4px}
.cm-rango{font-size:12.5px;color:var(--suave);margin:0 0 10px}
.cm-leyenda{display:flex;flex-wrap:wrap;gap:4px 16px;list-style:none;margin:8px 0 0;padding:0;font-size:12.5px;color:var(--suave)}
.cm-leyenda li{display:flex;align-items:center;gap:6px}
.cm-muestra{width:16px;height:11px;border-radius:3px;display:inline-block}

.cm-mesgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-top:12px}
.cm-mescard{border:1px solid var(--linea);border-radius:10px;padding:8px 10px;border-top:4px solid var(--sin);background:#fff}
.cm-mescard b{display:block;font-weight:600;font-size:14px}
.cm-mescard .t{font-size:20px;font-family:'Bricolage Grotesque','Figtree',sans-serif;font-weight:800;line-height:1.2}
.cm-mescard .e{font-size:12.5px;font-weight:600}
.cm-mescard .a{font-size:12px;color:var(--suave)}

.cm-chico{font-size:12.5px;color:var(--suave);margin:8px 0 0}
.cm-dato-grande{font-family:'Bricolage Grotesque','Figtree',sans-serif;font-weight:800;font-size:28px;line-height:1.1;margin:10px 0 0}
.cm-vacio{color:var(--suave);padding:10px 0;margin:0}
.cm-lluvia{margin-top:22px;padding-top:16px;border-top:1px solid var(--linea)}

.cm-det{margin-top:18px;border-top:1px solid var(--linea);padding-top:12px;font-size:13.5px;color:var(--suave)}
.cm-det summary{cursor:pointer;font-weight:600;color:var(--tinta)}
.cm-det p{margin:8px 0 0;max-width:90ch}
.cm-cargando{color:var(--suave);padding:14px 0}

/* Leaflet (cargado por CDN): evitar que los estilos globales deformen el mapa */
.cm .leaflet-container{font:inherit;width:100%;height:100%}
.cm .leaflet-container a{color:#1f6b43}
`;

/* ---------------- Página ---------------- */

export default function AnalyzeMyCropsPage() {
  const [ubicacion, setUbicacion] = useState<Ubicacion>(UBICACION_INICIAL);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
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

  // Clima: NASA POWER (temperatura media y lluvia mensual)
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
  const phActual = phRes && phRes.clave === claveExtra ? phRes : null;

  const cultivo = eco?.cultivos[cultivoNombre] ?? null;
  const dias = cultivo ? diasDelCiclo(cultivo) : null;
  const nMeses = dias ? Math.max(1, Math.round(dias / 30)) : 1;
  const nombreC = cultivoNombre.toLowerCase();

  // pH: no depende del mes, así que se evalúa una sola vez
  const rangoPh = cultivo && tieneRango(cultivo.ph) ? cultivo.ph : null;
  const phValor = phActual?.valor ?? null;
  const vPh: Veredicto = rangoPh && phValor ? VER_DE_CLASE[clasificarRango(phValor.media, rangoPh)] : "sin";

  const rangoLluvia = cultivo && tieneRango(cultivo.precipitacion) ? cultivo.precipitacion : null;

  // Temperatura y lluvia: un análisis por cada uno de los 12 meses posibles de siembra
  const porMesSiembra = useMemo(() => {
    if (!datosPower || !cultivo || !dias) return [];
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const a = analizar(curvasMensuales(datosPower, mes, nMeses, anios), cultivo.temperatura, nMeses);
      const lluvia = lluviaPorCiclo(datosPower, mes, nMeses, anios);
      const vL: Veredicto = rangoLluvia ? veredictoLluvia(lluvia.map((l) => l.total), rangoLluvia) : "sin";
      return { mes, a, lluvia, vT: veredictoTemperatura(a, cultivo.temperatura), vL };
    });
  }, [datosPower, cultivo, dias, nMeses, anios, rangoLluvia]);

  const sel = porMesSiembra[mesSiembra - 1] ?? null;
  const vTemp: Veredicto = sel?.vT ?? "sin";
  const vLluvia: Veredicto = sel?.vL ?? "sin";
  const global = combinar(vTemp, vPh, vLluvia);
  const nombresCiclo = Array.from({ length: nMeses }, (_, i) => MESES[(mesSiembra - 1 + i) % 12]);
  const mesFin = nombresCiclo[nombresCiclo.length - 1];
  const mejores = porMesSiembra
    .filter((m) => combinar(m.vT, vPh, m.vL) === "si")
    .map((m) => MESES[m.mes - 1]);

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
    if (!sel || !rangoLluvia) return "";
    const tot = sel.lluvia.map((l) => l.total);
    if (tot.length < MIN_ANIOS) {
      return `Solo hay ${tot.length} años con lluvia completa para este ciclo; hacen falta al menos ${MIN_ANIOS} para opinar.`;
    }
    const med = mediana(tot);
    const bajos = rangoLluvia.min !== null ? tot.filter((t) => t < rangoLluvia.min!).length : 0;
    const altos = rangoLluvia.max !== null ? tot.filter((t) => t > rangoLluvia.max!).length : 0;
    const fuera = bajos + altos;
    const rangoTxt = `${rangoLluvia.min !== null ? formatear(rangoLluvia.min) : "?"}–${
      rangoLluvia.max !== null ? formatear(rangoLluvia.max) : "?"
    } mm`;
    if (fuera === 0) {
      return `Durante el ciclo suelen caer unos ${formatear(med)} mm, dentro de lo que tolera el ${nombreC} (${rangoTxt}).`;
    }
    return `Durante el ciclo suelen caer unos ${formatear(med)} mm. En ${fuera} de ${tot.length} años ${
      bajos >= altos ? "llovió menos del mínimo (podría hacer falta riego)" : "llovió más del máximo"
    } que tolera el ${nombreC} (${rangoTxt}).`;
  }

  function explicacion(): string {
    if (!cultivo) return "";
    if (global === "si") {
      const partes = ["la temperatura"];
      if (rangoLluvia && vLluvia !== "sin") partes.push("la lluvia");
      if (phValor) partes.push("el pH del suelo");
      return `${partes.join(", ").replace(/, ([^,]*)$/, " y $1")} están dentro de lo que tolera el cultivo.`.replace(/^./, (c) => c.toUpperCase());
    }
    const gT = GRAV[vTemp];
    const gP = GRAV[vPh];
    const gL = GRAV[vLluvia];
    if (gP > gT && gP >= gL && phValor && rangoPh) {
      return vPh === "no"
        ? `El pH del suelo en este punto (${formatear(phValor.media, 1)}) está fuera de lo que tolera el ${nombreC} (${rangoPh.min ?? "?"}–${rangoPh.max ?? "?"}).`
        : `El pH del suelo en este punto (${formatear(phValor.media, 1)}) tolera, pero no es el ideal del ${nombreC} (${rangoPh.optMin ?? "?"}–${rangoPh.optMax ?? "?"}).`;
    }
    if (gL > gT && gL > gP && rangoLluvia) {
      return explicacionLluvia();
    }
    return explicacionTemperatura();
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
    : !datosPower
    ? "consultando…"
    : !sel || sel.lluvia.length === 0
    ? "sin datos"
    : `${formatear(mediana(sel.lluvia.map((l) => l.total)))} mm típicos · ${
        vLluvia === "si" ? "adecuada" : vLluvia === "cuidado" ? "con cuidado" : vLluvia === "no" ? "fuera de rango" : "sin datos suficientes"
      }`;

  return (
    <main className="cm">
      <style>{CSS}</style>
      <div className="cm-wrap">
        <div className="cm-cab">
          <h1>¿Conviene sembrar?</h1>
          <div className="cm-top">
            <Link href="/">← Inicio</Link>
            <span>03 / 05</span>
          </div>
        </div>
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
                const v = porMesSiembra[i] ? combinar(porMesSiembra[i].vT, vPh, porMesSiembra[i].vL) : "sin";
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
                  <li>
                    <div className="cm-factor">
                      <span className="cm-punto" style={{ background: COLOR_VEREDICTO[vTemp] }} />
                      <span>
                        <b>Temperatura</b> · {textoTemp}
                      </span>
                    </div>
                  </li>
                  <li>
                    <div className="cm-factor">
                      <span className="cm-punto" style={{ background: COLOR_VEREDICTO[vLluvia] }} />
                      <span>
                        <b>Lluvia</b> · {textoLluvia}
                      </span>
                    </div>
                  </li>
                  <li>
                    <div className="cm-factor">
                      <span className="cm-punto" style={{ background: COLOR_VEREDICTO[vPh] }} />
                      <span>
                        <b>pH del suelo</b> · {textoPh}
                      </span>
                    </div>
                  </li>
                </ul>

                {global !== "si" && mejores.length > 0 && (
                  <p>
                    <strong>Meses que mejor le irían:</strong> {mejores.join(", ")}.
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

        {/* ---------- Gráficas: pH a la izquierda, temperatura a la derecha, lluvia abajo ---------- */}
        {cultivo && (
          <section className="cm-card cm-graf">
            <div className="cm-graf-cuerpo">
              {/* Izquierda: pH */}
              <div>
                <h3 className="cm-h3">pH del suelo</h3>
                {rangoPh && (
                  <p className="cm-rango">
                    Ideal: {rangoPh.optMin ?? "?"}–{rangoPh.optMax ?? "?"} · Tolera: {rangoPh.min ?? "?"}–{rangoPh.max ?? "?"}
                  </p>
                )}
                {!rangoPh && (
                  <p className="cm-vacio">
                    La copia local de EcoCrop no trae rango de pH para este cultivo, así que no se puede comparar.
                  </p>
                )}
                {rangoPh && !phActual && (
                  <p className="cm-vacio">Consultando SoilGrids… (a veces tarda unos segundos).</p>
                )}
                {rangoPh && phActual?.error && (
                  <div>
                    <p className="cm-error">{phActual.error}</p>
                    <p className="cm-chico">
                      <button type="button" className="cm-boton sec" onClick={() => setIntento((n) => n + 1)}>
                        Reintentar
                      </button>
                    </p>
                  </div>
                )}
                {rangoPh && phValor && (
                  <>
                    <GraficaPh ph={phValor} rango={rangoPh} />
                    <ul className="cm-leyenda">
                      <li>
                        <span className="cm-muestra" style={{ background: C.ideal }} /> Ideal
                      </li>
                      <li>
                        <span className="cm-muestra" style={{ background: C.tolera }} /> Lo que tolera
                      </li>
                      <li>
                        <span className="cm-muestra" style={{ background: C.suave, height: 3 }} /> Incertidumbre del
                        modelo
                      </li>
                    </ul>
                    <p className="cm-dato-grande" style={{ color: COLOR_VEREDICTO[vPh] }}>
                      pH {formatear(phValor.media, 1)}
                    </p>
                    <p style={{ margin: "4px 0 0" }}>
                      {vPh === "si" && `Está dentro del rango ideal del ${nombreC}.`}
                      {vPh === "cuidado" && `El ${nombreC} lo tolera, pero no es el ideal.`}
                      {vPh === "no" && `Queda fuera de lo que tolera el ${nombreC}.`}
                    </p>
                    <p className="cm-chico">
                      El modelo estima entre {formatear(phValor.p5, 1)} y {formatear(phValor.p95, 1)}. Es un promedio de
                      0 a 30 cm de profundidad, calculado por satélite y modelos (SoilGrids), no un análisis de tu
                      terreno. Un análisis de suelo es más confiable. Este valor es el mismo para todos los meses.
                    </p>
                  </>
                )}
              </div>

              {/* Derecha: temperatura */}
              <div>
                <h3 className="cm-h3">Temperatura</h3>
                <p className="cm-rango">
                  Ideal: {cultivo.temperatura.optMin ?? "?"}–{cultivo.temperatura.optMax ?? "?"} °C · Tolera:{" "}
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
                        <span className="cm-muestra" style={{ background: "rgba(47,93,124,.4)", height: 3 }} /> Cada año
                        pasado
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

            {/* Abajo: lluvia */}
            <div className="cm-lluvia">
              <h3 className="cm-h3">Lluvia acumulada del ciclo</h3>
              {rangoLluvia && (
                <p className="cm-rango">
                  Ideal: {rangoLluvia.optMin !== null ? formatear(rangoLluvia.optMin) : "?"}–
                  {rangoLluvia.optMax !== null ? formatear(rangoLluvia.optMax) : "?"} mm · Tolera:{" "}
                  {rangoLluvia.min !== null ? formatear(rangoLluvia.min) : "?"}–
                  {rangoLluvia.max !== null ? formatear(rangoLluvia.max) : "?"} mm
                </p>
              )}
              {!rangoLluvia && (
                <p className="cm-vacio">
                  La copia local de EcoCrop no trae rango de lluvia para este cultivo, así que no se puede comparar.
                </p>
              )}
              {rangoLluvia && !datosPower && !actual?.error && (
                <p className="cm-vacio">Consultando el clima de los últimos años…</p>
              )}
              {rangoLluvia && datosPower && sel && sel.lluvia.length === 0 && (
                <p className="cm-vacio">No hay ciclos completos con datos de lluvia para esta ventana.</p>
              )}
              {rangoLluvia && sel && sel.lluvia.length > 0 && (
                <>
                  <GraficaLluvia datos={sel.lluvia} rango={rangoLluvia} />
                  <ul className="cm-leyenda">
                    <li>
                      <span className="cm-muestra" style={{ background: C.ideal }} /> Ideal
                    </li>
                    <li>
                      <span className="cm-muestra" style={{ background: C.tolera }} /> Lo que tolera
                    </li>
                    <li>
                      <span className="cm-muestra" style={{ background: C.si }} /> Año dentro del ideal
                    </li>
                    <li>
                      <span className="cm-muestra" style={{ background: C.cuidado }} /> Año tolerable
                    </li>
                    <li>
                      <span className="cm-muestra" style={{ background: C.no }} /> Año fuera de rango
                    </li>
                  </ul>
                  <p className="cm-chico">Cada barra es el total de mm que cayó en el ciclo sembrando ese año.</p>
                </>
              )}
            </div>
          </section>
        )}

        <details className="cm-det">
          <summary>Cómo se decide</summary>
          <p>
            <strong>Temperatura.</strong> Cada mes del ciclo se compara con el rango de temperatura que FAO EcoCrop
            da para el cultivo. Un año "cumple" si todos los meses de su ciclo estuvieron dentro de lo que el cultivo
            tolera. Si eso pasó en el {Math.round(UMBRAL_SI * 100)} % de los años o más, la respuesta es sí; entre{" "}
            {Math.round(UMBRAL_CUIDADO * 100)} % y {Math.round(UMBRAL_SI * 100)} %, con cuidado; por debajo, no. Si
            la temperatura típica de algún mes ya queda fuera del rango, también es no. Estos porcentajes son un
            criterio propio de esta herramienta, no un dato de FAO.
          </p>
          <p>
            <strong>Lluvia.</strong> NASA POWER entrega la lluvia como promedio diario de cada mes (mm/día). Se
            multiplica por los días del mes y se suman todos los meses del ciclo para obtener los mm acumulados de cada
            año, que se comparan con el rango de EcoCrop con los mismos umbrales que la temperatura. EcoCrop publica la
            lluvia como valor para todo el ciclo del cultivo, así que en ciclos muy cortos es una aproximación. No se
            considera riego: si llueve menos del mínimo, el cultivo podría sembrarse con riego.
          </p>
          <p>
            <strong>pH del suelo.</strong> Ideal si cae en el rango óptimo de EcoCrop, tolerable si cae en el rango
            absoluto, no conviene si queda fuera. Es un valor fijo del lugar: no cambia con el mes ni con los años.
          </p>
          <p>
            <strong>Resultado final.</strong> Manda el peor de los factores (ley del mínimo), no un promedio. No es un
            pronóstico: describe lo que pasó en esos mismos meses durante los años pasados. Se usa la temperatura media
            mensual, así que una helada o una ola de calor de pocos días no se ve. No se evalúan altitud ni otras
            propiedades del suelo. Es una guía para orientarse: consultá a un técnico agrícola antes de decidir.
          </p>
          <p>
            Datos: NASA POWER (comunidad AG, temperatura media a 2 m y precipitación corregida, grilla de baja
            resolución: puntos cercanos dan resultados casi iguales) · Suelo: ISRIC SoilGrids (pH en agua, 0–30 cm) ·
            Rangos y duración del ciclo: FAO EcoCrop (copia OpenCLIM; ciclo = mínimo + 1 mes, con 1 mes = 30 días) ·
            Búsqueda de lugares: Open-Meteo · Mapa: OpenStreetMap.
          </p>
        </details>
      </div>
    </main>
  );
}