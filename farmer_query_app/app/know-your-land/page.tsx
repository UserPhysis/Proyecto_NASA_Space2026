"use client";

import { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import "./know-your-land.css";

export default function KnowYourLandPage() {
  const [leafletListo, setLeafletListo] = useState(false);
  const [chartListo, setChartListo] = useState(false);

  return (
    <div className="contenedor-modulo1">
      {/* CSS oficial de Leaflet */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />

      <header className="header">
        <Link href="/" className="volver">
          &larr; Inicio
        </Link>
        <h1>Módulo 1 · Variables ambientales</h1>
        <span id="coords">Sin punto seleccionado</span>
      </header>

      <main className="contenido">
        <aside className="menu" aria-label="Variables">
          <p className="menu-titulo">Mapas</p>
          <button
            type="button"
            className="opcion activa"
            data-vista="mapa"
            data-capa="temp"
          >
            Temperatura superficial
          </button>
          <button
            type="button"
            className="opcion"
            data-vista="mapa"
            data-capa="imerg"
          >
            Precipitación diaria
          </button>
          <button
            type="button"
            className="opcion"
            data-vista="mapa"
            data-capa="merra"
          >
            Precipitación mensual
          </button>
          <button
            type="button"
            className="opcion"
            data-vista="mapa"
            data-capa="evi"
          >
            Vegetación (EVI)
          </button>
          <button
            type="button"
            className="opcion"
            data-vista="mapa"
            data-capa="smap"
          >
            Humedad del suelo
          </button>

          <p className="menu-titulo">Gráficas</p>
          <button type="button" className="opcion" data-vista="grafica">
            Climograma del punto
          </button>

          <div className="descripcion" id="descripcion"></div>
        </aside>

        <section className="vista">
          <div id="vista-mapa" className="vista-mapa">
            <div id="mapa"></div>
            <div className="tiempo">
              <button type="button" id="play" className="boton">
                ▶ Reproducir
              </button>
              <input
                type="range"
                id="slider"
                min="0"
                max="0"
                defaultValue="0"
                aria-label="Fecha"
              />
              <strong id="etiqueta">--</strong>
            </div>
          </div>

          <div id="vista-grafica" className="vista-grafica" hidden>
            <h2 id="grafica-titulo">Climograma</h2>
            <div className="lienzo">
              <canvas id="climograma"></canvas>
            </div>
            <p id="grafica-nota" className="nota"></p>
          </div>
        </section>
      </main>

      {/* 1. Cargar Leaflet y Chart.js primero */}
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        strategy="afterInteractive"
        onLoad={() => setLeafletListo(true)}
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js@4"
        strategy="afterInteractive"
        onLoad={() => setChartListo(true)}
      />

      {/* Run the module script after both libraries are ready. */}
      {leafletListo && chartListo && (
        <Script src="/know-your-land.js" strategy="afterInteractive" />
      )}
    </div>
  );
}
