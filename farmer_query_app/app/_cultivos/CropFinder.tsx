"use client";

import { useState } from "react";
import {
  NOMBRES_CULTIVO,
  buscar,
  lugar,
  nombreCultivo,
  type Cultivo,
  type Idioma,
  type Params,
} from "./datos";
import "./cultivos.css";

const T = {
  es: {
    titulo: "Buscar por parámetros",
    cultivo: "Cultivo",
    todos: "Todos los cultivos",
    temp: "Temperatura media",
    lluvia: "Lluvia anual",
    tol: "Tolerancia",
    tolOpts: ["Estricta (±2 °C, ±250 mm)", "Normal (±4 °C, ±500 mm)", "Amplia (±8 °C, ±1000 mm)"],
    mostrar: "Mostrar cultivos",
    mejor: "Ir al mejor lugar",
    coinciden: (n: number) => `${n} lugares coinciden con tus parámetros.`,
    cercanos: "Nada coincide exacto. Te muestro los 5 más cercanos.",
    ninguno: "No hay lugares para ese cultivo.",
    mejorMsg: (c: Cultivo, l: Idioma) =>
      `Mejor coincidencia: ${lugar(c, l)} (${c.temp} °C, ${c.lluvia} mm/año).`,
  },
  en: {
    titulo: "Find by parameters",
    cultivo: "Crop",
    todos: "All crops",
    temp: "Average temperature",
    lluvia: "Annual rainfall",
    tol: "Tolerance",
    tolOpts: ["Strict (±2 °C, ±250 mm)", "Normal (±4 °C, ±500 mm)", "Wide (±8 °C, ±1000 mm)"],
    mostrar: "Show crop regions",
    mejor: "Go to best match",
    coinciden: (n: number) => `${n} regions match your parameters.`,
    cercanos: "No exact match. Showing the 5 closest.",
    ninguno: "No regions for that crop.",
    mejorMsg: (c: Cultivo, l: Idioma) =>
      `Best match: ${lugar(c, l)} (${c.temp} °C, ${c.lluvia} mm/yr).`,
  },
};

const TOLERANCIAS = [0.5, 1, 2];

type Props = {
  lang?: Idioma;
  /** true = flota sobre un mapa (usa position:absolute) y se puede plegar */
  overlay?: boolean;
  onShow: (lista: Cultivo[], p: Params) => void;
  onBest: (mejor: Cultivo, p: Params) => void;
};

export default function CropFinder({ lang = "en", overlay = false, onShow, onBest }: Props) {
  const t = T[lang];
  const [abierto, setAbierto] = useState(true);
  const [tolIdx, setTolIdx] = useState(1);
  const [p, setP] = useState<Params>({ temp: 22, lluvia: 1500, cultivo: "Todos", tolerancia: 1 });
  const [mensaje, setMensaje] = useState("");

  const set = <K extends keyof Params>(k: K, v: Params[K]) =>
    setP((prev) => ({ ...prev, [k]: v }));

  const mostrar = () => {
    const r = buscar(p);
    if (!r.mejor) return setMensaje(t.ninguno);
    setMensaje(r.exacto ? t.coinciden(r.coincidencias.length) : t.cercanos);
    onShow(r.coincidencias, p);
  };

  const irAlMejor = () => {
    const r = buscar(p);
    if (!r.mejor) return setMensaje(t.ninguno);
    setMensaje(t.mejorMsg(r.mejor, lang));
    onBest(r.mejor, p);
  };

  const cabecera = overlay ? (
    <button type="button" className="crop-finder__head" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
      {t.titulo}
      <span>{abierto ? "–" : "+"}</span>
    </button>
  ) : (
    <div className="crop-finder__head">{t.titulo}</div>
  );

  return (
    <section className={`crop-finder ${overlay ? "crop-finder--map" : ""}`}>
      {cabecera}
      {abierto && (
        <div className="crop-finder__body">
          <label>
            {t.cultivo}
            <select value={p.cultivo} onChange={(e) => set("cultivo", e.target.value)}>
              <option value="Todos">{t.todos}</option>
              {NOMBRES_CULTIVO.map((n) => (
                <option key={n} value={n}>
                  {nombreCultivo(n, lang)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t.temp}: <b>{p.temp} °C</b>
            <input type="range" min={-5} max={32} value={p.temp} onChange={(e) => set("temp", Number(e.target.value))} />
          </label>

          <label>
            {t.lluvia}: <b>{p.lluvia} mm</b>
            <input type="range" min={0} max={3500} step={50} value={p.lluvia} onChange={(e) => set("lluvia", Number(e.target.value))} />
          </label>

          <label>
            {t.tol}
            <select
              value={tolIdx}
              onChange={(e) => {
                const i = Number(e.target.value);
                setTolIdx(i);
                set("tolerancia", TOLERANCIAS[i]);
              }}
            >
              {t.tolOpts.map((o, i) => (
                <option key={o} value={i}>
                  {o}
                </option>
              ))}
            </select>
          </label>

          <div className="crop-finder__btns">
            <button type="button" className="cf-primario" onClick={mostrar}>
              {t.mostrar}
            </button>
            <button type="button" className="cf-secundario" onClick={irAlMejor}>
              {t.mejor}
            </button>
          </div>

          {mensaje && <p className="crop-finder__msg">{mensaje}</p>}
        </div>
      )}
    </section>
  );
}
