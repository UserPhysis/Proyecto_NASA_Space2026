"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Script from "next/script";
import "./know-your-land.css";

declare global {
  interface Window { L: any }
}

type Place = { name: string; lat: number; lng: number; country: string };
type Metric = { key: string; label: string; value: string; score: number; tone: string; note: string };
type CropRecommendation = { name: string; stars: number; reason: string; rotation: string };

const initialPlace: Place = { name: "Apaneca-Ilamatepec", lat: 13.85, lng: -89.8, country: "El Salvador" };

function normalize(value: number, min: number, max: number) {
  return Math.max(0, Math.min(100, Math.round(((value - min) / (max - min)) * 100)));
}

function getMetrics(temp: number, rain: number, humidity: number): Metric[] {
  const heatStress = normalize(temp, 18, 34);
  const rainfall = normalize(rain, 0, 240);
  const soilMoisture = Math.round(Math.max(0, Math.min(100, humidity * 0.72 + rainfall * 0.28)));
  return [
    { key: "temperature", label: "Temperatura", value: `${temp.toFixed(1)} °C`, score: normalize(temp, 8, 34), tone: "amber", note: "Media de 30 días" },
    { key: "heat", label: "Estrés térmico", value: heatStress > 72 ? "Alto" : heatStress > 45 ? "Medio" : "Bajo", score: heatStress, tone: "red", note: "Riesgo por calor" },
    { key: "rain", label: "Precipitación", value: `${rain.toFixed(0)} mm`, score: rainfall, tone: "blue", note: "Acumulada en 30 días" },
    { key: "soil", label: "Humedad del suelo", value: `${soilMoisture}%`, score: soilMoisture, tone: "green", note: "Estimación satelital" },
    { key: "evaporation", label: "Evaporación", value: `${(3.4 + temp * 0.08).toFixed(1)} mm/día`, score: normalize(temp, 10, 35), tone: "amber", note: "Demanda atmosférica" },
    { key: "frost", label: "Riesgo de helada", value: temp < 12 ? "Alto" : temp < 17 ? "Medio" : "Bajo", score: 100 - normalize(temp, 4, 24), tone: "violet", note: "Temperatura mínima estimada" },
    { key: "extreme-rain", label: "Lluvia extrema", value: rain > 180 ? "Alto" : "Bajo", score: normalize(rain, 60, 260), tone: "cyan", note: "Eventos intensos" },
    { key: "vegetation", label: "Estrés de vegetación", value: soilMoisture < 35 ? "Medio" : "Bajo", score: 100 - soilMoisture, tone: "green", note: "Proxy de disponibilidad hídrica" },
    { key: "water-trend", label: "Tendencia hídrica", value: rain > 130 ? "Favorable" : "Vigilar", score: rainfall, tone: "blue", note: "Señal de corto plazo" },
  ];
}

function getRecommendations(temp: number, rain: number, humidity: number): CropRecommendation[] {
  const waterScore = rain > 140 && humidity > 55 ? 5 : rain > 90 ? 4 : 3;
  const coffeeScore = temp >= 18 && temp <= 25 && rain >= 100 ? 5 : temp >= 16 && rain >= 80 ? 4 : 2;
  const grainScore = temp >= 19 && temp <= 31 && rain >= 70 ? 4 : 3;
  return [
    { name: "Frijol", stars: waterScore, reason: "Aporta nitrógeno y ayuda a recuperar materia orgánica.", rotation: "Después de un cereal; reduce la dependencia de fertilizante nitrogenado." },
    { name: "Café de sombra", stars: coffeeScore, reason: "Compatible con clima templado y cobertura permanente contra erosión.", rotation: "Sistema perenne con cobertura vegetal y leguminosa entre hileras." },
    { name: "Maíz", stars: grainScore, reason: "Ciclo conocido y útil para alternar con una leguminosa.", rotation: "Maíz → frijol → cobertura; vigilar demanda de agua y erosión." },
  ];
}

export default function KnowYourLandPage() {
  const [leafletReady, setLeafletReady] = useState(false);
  const [place, setPlace] = useState(initialPlace);
  const [query, setQuery] = useState("El Salvador");
  const [metrics, setMetrics] = useState<Metric[]>(getMetrics(22.8, 165.5, 62));
  const [recommendations, setRecommendations] = useState<CropRecommendation[]>(getRecommendations(22.8, 165.5, 62));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Datos de referencia cargados");
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    if (!leafletReady || !window.L || mapRef.current) return;
    const map = window.L.map("land-map", { zoomControl: false }).setView([place.lat, place.lng], 7);
    window.L.control.zoom({ position: "bottomright" }).addTo(map);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
    markerRef.current = window.L.circleMarker([place.lat, place.lng], { radius: 9, color: "#50e5b0", fillColor: "#50e5b0", fillOpacity: .8 }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [leafletReady, place.lat, place.lng]);

  async function searchPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true); setMessage("Buscando ubicación y datos ambientales…");
    try {
      const geoResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`);
      const geoData = await geoResponse.json();
      if (!geoData[0]) throw new Error("Lugar no encontrado");
      const nextPlace = { name: geoData[0].display_name.split(",")[0], lat: Number(geoData[0].lat), lng: Number(geoData[0].lon), country: geoData[0].display_name.split(",").slice(-1)[0].trim() };
      const end = new Date(Date.now() - 3 * 86400000); const start = new Date(end.getTime() - 29 * 86400000);
      const formatDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
      const powerUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR,RH2M&community=AG&longitude=${nextPlace.lng.toFixed(4)}&latitude=${nextPlace.lat.toFixed(4)}&start=${formatDate(start)}&end=${formatDate(end)}&format=JSON`;
      const powerResponse = await fetch(powerUrl); const data = await powerResponse.json(); const parameters = data.properties.parameter;
      const values = (input: Record<string, number>) => Object.values(input).filter((value) => value > -999);
      const temperatures = values(parameters.T2M); const rainValues = values(parameters.PRECTOTCORR); const humidityValues = values(parameters.RH2M);
      const average = (items: number[]) => items.reduce((sum, value) => sum + value, 0) / Math.max(items.length, 1);
      const averageTemperature = average(temperatures); const totalRain = rainValues.reduce((sum, value) => sum + value, 0); const averageHumidity = average(humidityValues);
      setPlace(nextPlace); setMetrics(getMetrics(averageTemperature, totalRain, averageHumidity)); setRecommendations(getRecommendations(averageTemperature, totalRain, averageHumidity)); setMessage("Datos NASA POWER actualizados");
      window.setTimeout(() => mapRef.current?.setView([nextPlace.lat, nextPlace.lng], 8), 50);
    } catch { setMessage("No se pudo consultar el lugar. Prueba con un país o municipio."); }
    finally { setLoading(false); }
  }

  return <div className="land-module">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <header className="land-header"><Link href="/" className="land-back">← Farmer Query</Link><div><span className="land-code">MODULE 01 / LAND INTELLIGENCE</span><h1>CONOCER MI TERRENO</h1></div><span className="land-status"><i /> LIVE DATA</span></header>
    <main className="land-content">
      <section className="land-map-panel"><div id="land-map" className="land-map" /><div className="map-overlay"><span>RESOLUCIÓN OPERATIVA</span><strong>Municipio · 1–10 km</strong><small>Consulta liviana con datos satelitales y climáticos agregados.</small></div></section>
      <section className="land-search-row"><form onSubmit={searchPlace} className="land-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Escribe un país, región o municipio" aria-label="Lugar" /><button type="submit">{loading ? "CONSULTANDO…" : "BUSCAR LUGAR"}</button></form><div className="land-place"><span>UBICACIÓN ANALIZADA</span><strong>{place.name}, {place.country}</strong><small>{message}</small></div></section>
      <section className="land-section-heading"><div><span className="land-code">LECTURA AMBIENTAL</span><h2>Parámetros del lugar</h2></div><p>Cada tarjeta resume una señal y su intensidad relativa para orientar el siguiente análisis.</p></section>
      <section className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.key}><div className="metric-card-top"><span>{metric.label}</span><b className={`metric-icon ${metric.tone}`}>{metric.key.slice(0, 2).toUpperCase()}</b></div><strong className="metric-value">{metric.value}</strong><div className="heat-track"><i className={metric.tone} style={{ width: `${Math.max(8, metric.score)}%` }} /></div><small>{metric.note}</small></article>)}</section>
      <section className="recommendation-section"><div className="land-section-heading"><div><span className="land-code">DECISIÓN AGRÍCOLA</span><h2>Qué puede sembrar</h2></div><p>Ranking inicial de 1 a 5 estrellas. Se actualizará al combinar suelo local, clima, mercado y prioridades del agricultor.</p></div><div className="recommendation-grid">{recommendations.map((crop) => <article className="recommendation-card" key={crop.name}><div className="recommendation-title"><h3>{crop.name}</h3><span className="stars" aria-label={`${crop.stars} de 5 estrellas`}>{"★".repeat(crop.stars)}<em>{"★".repeat(5 - crop.stars)}</em></span></div><p>{crop.reason}</p><small><strong>ROTACIÓN:</strong> {crop.rotation}</small></article>)}</div></section>
      <section className="land-disclaimer"><span>◈</span><p><strong>Ayuda para decidir, no una sentencia.</strong> Estas lecturas combinan datos satelitales y rangos de referencia. Valida el suelo, la variedad y las condiciones reales de tu parcela antes de sembrar.</p></section>
    </main>
    <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onLoad={() => setLeafletReady(true)} />
  </div>;
}
