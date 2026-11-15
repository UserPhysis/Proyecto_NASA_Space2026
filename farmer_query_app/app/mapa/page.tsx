"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import "./mapa.css";

declare global {
  interface Window {
    L: any;
  }
}

const CAPA = "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day";
const MATRIZ = "GoogleMapsCompatible_Level6";
const BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

const INICIO = { y: 2000, m: 3 };
const FIN = { y: 2026, m: 10 };
const MAX_INDICE = (FIN.y - INICIO.y) * 12 + (FIN.m - INICIO.m);

function mesDeIndice(i: number) {
  const n = INICIO.m - 1 + i;
  const y = INICIO.y + Math.floor(n / 12);
  const m = (n % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function urlCapa(mes: string) {
  return `${BASE}/${CAPA}/default/${mes}-01/${MATRIZ}/{z}/{y}/{x}.png`;
}

export default function MapaPage() {
  const [indice, setIndice] = useState<number>(MAX_INDICE);
  const [reproduciendo, setReproduciendo] = useState<boolean>(false);
  const [coords, setCoords] = useState<string>("Haz clic en el mapa para ver coordenadas.");
  const [leafletListo, setLeafletListo] = useState<boolean>(false);

  const mapaRef = useRef<any>(null);
  const capaTempRef = useRef<any>(null);
  const marcadorRef = useRef<any>(null);

  // Inicializar el mapa una vez que Leaflet carga
  useEffect(() => {
    if (!leafletListo || !window.L || mapaRef.current) return;

    const L = window.L;
    const mapa = L.map("mapa").setView([13.7, -88.9], 5);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap",
    }).addTo(mapa);

    const capaTemp = L.tileLayer(urlCapa(mesDeIndice(MAX_INDICE)), {
      maxNativeZoom: 6,
      maxZoom: 12,
      opacity: 0.75,
      attribution: "NASA GIBS / MODIS Terra LST",
    }).addTo(mapa);

    // Leyenda oficial de GIBS
    const leyenda = L.control({ position: "bottomright" });
    leyenda.onAdd = function () {
      const div = L.DomUtil.create("div", "leyenda");
      div.innerHTML =
        '<img src="https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_V.svg" alt="Leyenda de temperatura">' +
        "<small>Temperatura superficial (promedio mensual, diurna)</small>";
      return div;
    };
    leyenda.addTo(mapa);

    // Coordenadas al hacer clic
    mapa.on("click", (e: any) => {
      const { lat, lng } = e.latlng;
      setCoords(`Lat: ${lat.toFixed(4)}°, Lon: ${lng.toFixed(4)}°`);
      if (marcadorRef.current) marcadorRef.current.remove();
      marcadorRef.current = L.circleMarker([lat, lng], {
        radius: 6,
        color: "#d32f2f",
      }).addTo(mapa);
    });

    mapaRef.current = mapa;
    capaTempRef.current = capaTemp;

    return () => {
      mapa.remove();
      mapaRef.current = null;
    };
  }, [leafletListo]);

  // Actualizar la capa satelital cuando cambia el mes en el slider
  useEffect(() => {
    if (!capaTempRef.current) return;
    const mes = mesDeIndice(indice);
    const espera = setTimeout(() => {
      capaTempRef.current.setUrl(urlCapa(mes));
    }, 150);

    return () => clearTimeout(espera);
  }, [indice]);

  // Controlar la reproducción automática
  useEffect(() => {
    if (!reproduciendo) return;

    const timer = setInterval(() => {
      setIndice((prev) => {
        if (prev >= MAX_INDICE) {
          setReproduciendo(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);

    return () => clearInterval(timer);
  }, [reproduciendo]);

  const togglePlay = () => {
    if (reproduciendo) {
      setReproduciendo(false);
    } else {
      if (indice >= MAX_INDICE) setIndice(0);
      setReproduciendo(true);
    }
  };

  return (
    <div className="contenedor-mapa">
      {/* Cargar CSS y JS de Leaflet */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        strategy="afterInteractive"
        onLoad={() => setLeafletListo(true)}
      />

      <div className="barra">
        <Link href="/" className="volver">
          &larr; Inicio
        </Link>
        <button
          type="button"
          id="play"
          className="boton"
          aria-label="Reproducir"
          onClick={togglePlay}
        >
          {reproduciendo ? "❚❚ Pausar" : "▶ Reproducir"}
        </button>
        <input
          type="range"
          id="slider"
          min={0}
          max={MAX_INDICE}
          value={indice}
          onChange={(e) => setIndice(Number(e.target.value))}
          aria-label="Mes"
        />
        <strong id="etiqueta">{mesDeIndice(indice)}</strong>
        <span id="coords">{coords}</span>
      </div>

      <div id="mapa"></div>
    </div>
  );
}
