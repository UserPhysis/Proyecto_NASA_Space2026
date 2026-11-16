"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import "./explore.css";
import CropFinder from "../_cultivos/CropFinder";
import GlobeDecor from "../_cultivos/GlobeDecor";
import { lugar, nombreCultivo, type Cultivo } from "../_cultivos/datos";

export default function ExplorePage() {
  const [coords, setCoords] = useState<string>("Click the globe to see coordinates.");
  const [entrando, setEntrando] = useState<boolean>(true); // transición de entrada
  const [ficha, setFicha] = useState<Cultivo | null>(null);

  const timersRef = useRef<number[]>([]);
  const activoRef = useRef<boolean>(false);
  const globoCargadoRef = useRef<boolean>(false);

  const detener = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  // ---------- Cargar el MISMO globo de la home (three.js + /globe.js) ----------
  // Al navegar con Link los <Script> de la home no se vuelven a ejecutar y el nuevo
  // #globo quedaría vacío, por eso se cargan a mano al entrar.
  useEffect(() => {
    activoRef.current = true;
    if (!globoCargadoRef.current) {
      globoCargadoRef.current = true;
      const cargar = (src: string) =>
        new Promise<void>((ok, fallo) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = () => ok();
          s.onerror = () => fallo();
          document.body.appendChild(s);
        });
      (async () => {
        try {
          if (!(window as any).THREE) {
            await cargar("https://unpkg.com/three@0.160.0/build/three.min.js");
          }
          if (!activoRef.current) {
            globoCargadoRef.current = false;
            return;
          }
          // &e= fuerza a que globe.js se ejecute de nuevo sobre el nuevo #globo
          await cargar(`/globe.js?v=4&e=${Date.now()}`);
        } catch {
          globoCargadoRef.current = false;
        }
      })();
    }
    return () => {
      activoRef.current = false;
      detener();
      (window as any).earthGlobe?.destroy?.(); // solo si tu globe.js lo define
    };
  }, []);

  // Transición de entrada: el globo "aterriza" y desaparece el aviso
  useEffect(() => {
    const t = window.setTimeout(() => setEntrando(false), 1300);
    return () => clearTimeout(t);
  }, []);

  // Clic en el globo: globe.js avisa con este evento (el mismo que usa la home)
  useEffect(() => {
    const onPick = (event: Event) => {
      const { lat, lng } = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      detener();
      setFicha(null);
      setCoords(`Lat: ${lat.toFixed(4)}°, Lon: ${lng.toFixed(4)}°`);
    };
    window.addEventListener("earth:pick", onPick);
    return () => window.removeEventListener("earth:pick", onPick);
  }, []);

  // ---------- Animaciones de cultivos (usan earthGlobe.setPin, que ya existe) ----------
  // Si más adelante globe.js define setPins/clearPins, se dibujan también todos los pines acumulados.
  const recorrer = (lista: Cultivo[]) => {
    detener();
    setFicha(null);
    const globo = (window as any).earthGlobe;
    globo?.clearPins?.();
    const paradas = lista.slice(0, 15); // máximo 15 paradas
    paradas.forEach((c, i) => {
      timersRef.current.push(
        window.setTimeout(() => {
          globo?.setPin?.(c.lat, c.lon, true);
          globo?.setPins?.(
            paradas.slice(0, i + 1).map((s) => ({ lat: s.lat, lng: s.lon, label: s.emoji }))
          );
          setFicha(c);
        }, 300 + i * 1400)
      );
    });
  };

  const irAlMejor = (c: Cultivo) => {
    detener();
    const globo = (window as any).earthGlobe;
    globo?.clearPins?.();
    globo?.setPin?.(c.lat, c.lon, true);
    setFicha(c);
  };

  return (
    <div className="contenedor-mapa">
      <div className="barra">
        <Link href="/" className="volver">
          &larr; Home
        </Link>
        <span id="coords">{coords}</span>
      </div>

      <div className={`vista-globo ${entrando ? "entrando" : ""}`}>
        {entrando && (
          <div className="launch-feedback">
            OPENING EXPLORE
            <span />
            <small>Loading regions and crops</small>
          </div>
        )}

        <div className="globe-wrap">
          <GlobeDecor />
          <div className="globe" id="globo" />
        </div>

        {ficha && (
          <div className="location-card">
            <div className="location-card-top">
              <span>SELECTED REGION</span>
              <b>REGION DATA</b>
            </div>
            <h2>
              {ficha.emoji} {nombreCultivo(ficha.cultivo, "en")}
            </h2>
            <p>{lugar(ficha, "en")}</p>
            <p>
              Lat. {ficha.lat.toFixed(2)}° · Lon. {ficha.lon.toFixed(2)}°
            </p>
            <div className="metrics">
              <div>
                <span className="metric-icon warm">♨</span>
                <strong>{ficha.temp} °C</strong>
                <small>Average annual temperature</small>
              </div>
              <div>
                <span className="metric-icon rain">♢</span>
                <strong>{ficha.lluvia} mm</strong>
                <small>Annual rainfall</small>
              </div>
            </div>
          </div>
        )}
      </div>

      <CropFinder lang="en" overlay onShow={recorrer} onBest={irAlMejor} />
    </div>
  );
}
