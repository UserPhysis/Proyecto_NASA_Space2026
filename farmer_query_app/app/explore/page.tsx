
"use client";
 
import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import Script from "next/script";
import "./explore.css";
import {
  ECOCROP_DATABASE,
  GLOBAL_AGRICULTURAL_ZONES,
  CropECOCROP,
} from "./ecocropData";
 
declare global {
  interface Window {
    Globe: any;
  }
}
 
// ---------- Utilidades de geometría y color para pintar países ----------
const COUNTRIES_URLS = [
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson",
  "https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson",
];
 
const OCEAN_COLOR = "#c9dde6";
const LAND_COLOR = "#f1efe6";
const BORDER_COLOR = "rgba(120, 118, 105, 0.75)";
const CURRENT_COUNTRY_COLOR = "#e3a33b";
 
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
 
function pointInFeature(lng: number, lat: number, feature: any): boolean {
  const g = feature?.geometry;
  if (!g) return false;
  const polys: number[][][][] =
    g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some(
    (poly) =>
      pointInRing(lng, lat, poly[0]) &&
      !poly.slice(1).some((hole) => pointInRing(lng, lat, hole))
  );
}
 
// Verde claro (pocos cultivos) → verde oscuro (muchos cultivos)
function greenScale(count: number): string {
  const t = Math.min(1, Math.max(0, (count - 1) / 5));
  const from = [183, 208, 138];
  const to = [86, 120, 36];
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
 
// Clases de pendiente (umbrales de referencia, ajustables)
function slopeClass(pct: number): { label: string; advice: string } {
  if (pct < 3) return { label: "Flat", advice: "Low erosion risk. Suitable for most row crops." };
  if (pct < 8) return { label: "Gently sloping", advice: "Low risk. Keep soil covered between seasons." };
  if (pct < 15)
    return { label: "Moderately sloping", advice: "Plant along contour lines and use cover crops." };
  if (pct < 30)
    return {
      label: "Steep",
      advice: "High erosion risk. Prefer terraces, perennials and cover crops.",
    };
  return {
    label: "Very steep",
    advice: "Avoid annual tillage. Favor agroforestry or permanent cover.",
  };
}
 
type TerrainState = {
  status: "loading" | "ok" | "nodata" | "error";
  elevation: number | null;
  slope: number | null;
};
 
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
 
export default function ExplorePage() {
  const [globeReady, setGlobeReady] = useState<boolean>(false);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [coords, setCoords] = useState<string>("Lat: 13.8500°, Lon: -89.7800°");
 
  // Estado de la región activa (inicia en El Salvador)
  const [regionLabel, setRegionLabel] = useState<string>("El Salvador · Apaneca-Ilamatepec");
  const [selectedLat, setSelectedLat] = useState<number>(13.85);
  const [selectedLng, setSelectedLng] = useState<number>(-89.78);
  const [temperature, setTemperature] = useState<number>(22.5);
  const [precipitation, setPrecipitation] = useState<number>(1850);
  const [soilPh, setSoilPh] = useState<number>(5.8);
  const [cargandoClima, setCargandoClima] = useState<boolean>(false);
 
  // Cultivo seleccionado para ver dónde crece en el mundo
  const [focusedCropId, setFocusedCropId] = useState<number | null>(null);
 
  // Terreno del punto seleccionado (SRTM): altitud y pendiente
  const [terrain, setTerrain] = useState<TerrainState>({
    status: "loading",
    elevation: null,
    slope: null,
  });
 
  // Países (GeoJSON) para dibujar fronteras y pintar los que cumplen
  const [countries, setCountries] = useState<any[]>([]);
 
  const globeContainerRef = useRef<HTMLDivElement | null>(null);
  const globeInstanceRef = useRef<any>(null);
  const terrainCacheRef = useRef(new Map());
  const elevationQuotaExceededRef = useRef<boolean>(false);
  // Consultar altitud y pendiente cuando cambia el punto (con pequeña espera para no saturar la API)
  // Consultar altitud y pendiente con caché, timeout y tolerancia a fallos/cuota
  useEffect(() => {
    const cacheKey = `${selectedLat.toFixed(3)},${selectedLng.toFixed(3)}`;

    // 1. Si ya tenemos este punto en caché, lo usamos y ahorramos créditos
    if (terrainCacheRef.current.has(cacheKey)) {
      const cached = terrainCacheRef.current.get(cacheKey)!;
      setTerrain({
        status: cached.elevation !== null ? "ok" : "nodata",
        elevation: cached.elevation,
        slope: cached.slope,
      });
      return;
    }

    // 2. Si ya detectamos que se acabaron los créditos en esta sesión, no insistimos
    if (elevationQuotaExceededRef.current) {
      setTerrain({ status: "error", elevation: null, slope: null });
      <p style={{ fontSize: "0.8rem", color: "#8a5a12", margin: "6px 0 0" }}>
    Could not retrieve altitude data right now (API unavailable or limit reached). Crop climate matching still works normally.
      </p>
      return;
    }

    const controller = new AbortController();
    setTerrain({ status: "loading", elevation: null, slope: null });

    const timer = setTimeout(async () => {
      let isTimeout = false;
      const timeoutId = setTimeout(() => {
        isTimeout = true;
        controller.abort();
      }, 6000);

      try {
        const res = await fetch(
          `/api/elevation?lat=${selectedLat.toFixed(5)}&lng=${selectedLng.toFixed(5)}`,
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        if (res.status === 402 || res.status === 403 || res.status === 429) {
          elevationQuotaExceededRef.current = true;
          setTerrain({ status: "error", elevation: null, slope: null });
          return;
        }

        if (!res.ok) throw new Error(String(res.status));

        const data = await res.json();

        if (data?.error) {
          setTerrain({ status: "error", elevation: null, slope: null });
          return;
        }

        if (typeof data.elevation !== "number") {
          terrainCacheRef.current.set(cacheKey, { elevation: null, slope: null });
          setTerrain({ status: "nodata", elevation: null, slope: null });
        } else {
          const result = {
            elevation: data.elevation,
            slope: typeof data.slopePct === "number" ? data.slopePct : null,
          };
          terrainCacheRef.current.set(cacheKey, result);
          setTerrain({
            status: "ok",
            elevation: result.elevation,
            slope: result.slope,
          });
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err?.name !== "AbortError" || isTimeout) {
          setTerrain({ status: "error", elevation: null, slope: null });
        }
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedLat, selectedLng]);
 
  // Descargar el GeoJSON de países (con una URL de respaldo)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const url of COUNTRIES_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const json = await res.json();
          if (!cancelled && Array.isArray(json?.features)) {
            setCountries(json.features);
          }
          return;
        } catch {
          /* intenta la siguiente URL */
        }
      }
      console.error("No se pudo cargar el GeoJSON de países");
    })();
    return () => {
      cancelled = true;
    };
  }, []);
 
  // Si el script de globe.gl ya estaba cargado (navegación de vuelta a la página),
  // onLoad no se vuelve a disparar, así que lo revisamos manualmente.
  useEffect(() => {
    if (typeof window !== "undefined" && window.Globe) {
      setGlobeReady(true);
    }
  }, []);
 
  // Consultar país y clima real de NASA POWER al hacer clic en el globo
  const analizarPuntoEnGlobo = async (lat: number, lon: number, customName?: string) => {
    setSelectedLat(lat);
    setSelectedLng(lon);
    setCoords(`Lat: ${lat.toFixed(4)}°, Lon: ${lon.toFixed(4)}°`);
    setCargandoClima(true);
 
    if (customName) {
      setRegionLabel(customName);
    } else {
      setRegionLabel(`Analyzing Lat ${lat.toFixed(2)}°, Lon ${lon.toFixed(2)}°...`);
    }
 
    try {
      const nasaUrl =
        "https://power.larc.nasa.gov/api/temporal/climatology/point" +
        "?parameters=T2M,PRECTOTCORR&community=AG" +
        "&longitude=" + lon.toFixed(4) +
        "&latitude=" + lat.toFixed(4) +
        "&format=JSON";
      const geoUrl =
        "https://api.bigdatacloud.net/data/reverse-geocode-client" +
        "?latitude=" + lat.toFixed(4) +
        "&longitude=" + lon.toFixed(4) +
        "&localityLanguage=en";
 
      const [nasaRes, geoRes] = await Promise.all([fetch(nasaUrl), fetch(geoUrl)]);
 
      const nasaData = nasaRes.ok ? await nasaRes.json() : null;
      const geoData = geoRes.ok ? await geoRes.json() : null;
 
      if (!customName) {
        const country = geoData?.countryName;
        const state = geoData?.principalSubdivision || geoData?.city || geoData?.locality;
        if (country && state && country !== state) setRegionLabel(`${country} · ${state}`);
        else if (country) setRegionLabel(country);
        else if (geoData?.locality) setRegionLabel(geoData.locality);
        else setRegionLabel(`Lat ${lat.toFixed(2)}°, Lon ${lon.toFixed(2)}°`);
      }
 
      const params = nasaData?.properties?.parameter;
      if (params?.T2M?.ANN !== undefined && params.T2M.ANN > -900) {
        setTemperature(Number(params.T2M.ANN.toFixed(1)));
      }
      // En climatología, PRECTOTCORR.ANN viene en mm/día → se multiplica por 365
      if (params?.PRECTOTCORR?.ANN !== undefined && params.PRECTOTCORR.ANN >= 0) {
        const lluviaAnual = Math.round(params.PRECTOTCORR.ANN * 365);
        setPrecipitation(Math.min(3000, Math.max(200, lluviaAnual)));
      }
    } catch (err) {
      console.error("Error consultando punto en el globo:", err);
      if (!customName) {
        setRegionLabel(`Lat ${lat.toFixed(2)}°, Lon ${lon.toFixed(2)}°`);
      }
    } finally {
      setCargandoClima(false);
    }
  };
 
  // Cultivos de ECOCROP compatibles con la temperatura, lluvia y pH actuales
  const compatibleCrops = useMemo(() => {
    return ECOCROP_DATABASE.filter(
      (crop) =>
        temperature >= crop.tempMin &&
        temperature <= crop.tempMax &&
        precipitation >= crop.rainMin &&
        precipitation <= crop.rainMax &&
        soilPh >= crop.phMin &&
        soilPh <= crop.phMax
    )
      .map((crop) => ({
        ...crop,
        isOptimal: temperature >= crop.tempOptMin && temperature <= crop.tempOptMax,
      }))
      .sort((a, b) => Number(b.isOptimal) - Number(a.isOptimal));
  }, [temperature, precipitation, soilPh]);
 
  // Regiones del globo con condiciones análogas
  const matchingWorldZones = useMemo(() => {
    const targetCrops: CropECOCROP[] = focusedCropId
      ? ECOCROP_DATABASE.filter((c) => c.id === focusedCropId)
      : compatibleCrops;
 
    if (targetCrops.length === 0) {
      return [
        {
          id: "current-selection",
          region: regionLabel,
          country: "",
          lat: selectedLat,
          lng: selectedLng,
          icons: "📍",
          isCurrent: true,
        },
      ] as any[];
    }
 
    const matched: any[] = GLOBAL_AGRICULTURAL_ZONES.map((zone) => {
      const cropsInZone = targetCrops.filter(
        (crop) =>
          zone.temp >= crop.tempMin &&
          zone.temp <= crop.tempMax &&
          zone.rain >= crop.rainMin &&
          zone.rain <= crop.rainMax &&
          zone.ph >= crop.phMin &&
          zone.ph <= crop.phMax
      );
 
      return {
        ...zone,
        matchedCrops: cropsInZone,
        icons: cropsInZone
          .slice(0, 3)
          .map((c) => c.icon)
          .join(""),
        isCurrent:
          Math.abs(zone.lat - selectedLat) < 1.5 &&
          Math.abs(zone.lng - selectedLng) < 1.5,
      };
    }).filter((z) => z.matchedCrops.length > 0);
 
    // El punto donde el usuario hizo clic siempre aparece marcado
    const hasCurrent = matched.some((m) => m.isCurrent);
    if (!hasCurrent) {
      matched.unshift({
        id: "user-clicked-point",
        region: regionLabel.split("·").pop()?.trim() || regionLabel,
        country: "",
        lat: selectedLat,
        lng: selectedLng,
        temp: temperature,
        rain: precipitation,
        ph: soilPh,
        matchedCrops: targetCrops,
        icons: targetCrops
          .slice(0, 3)
          .map((c) => c.icon)
          .join(""),
        isCurrent: true,
      });
    }
 
    return matched;
  }, [
    compatibleCrops,
    focusedCropId,
    regionLabel,
    selectedLat,
    selectedLng,
    temperature,
    precipitation,
    soilPh,
  ]);
 
  // Países que cumplen los criterios: se ubica cada zona análoga dentro de su país
  const paintedCountries = useMemo(() => {
    const map = new Map<any, { crops: string[]; isCurrent: boolean }>();
    if (countries.length === 0) return map;
 
    matchingWorldZones.forEach((z: any) => {
      if (!z.matchedCrops || z.matchedCrops.length === 0) return;
      const feature = countries.find((f) => pointInFeature(z.lng, z.lat, f));
      if (!feature) return;
 
      const prev = map.get(feature) ?? { crops: [], isCurrent: false };
      const names = new Set(prev.crops);
      z.matchedCrops.forEach((c: CropECOCROP) => names.add(`${c.icon} ${c.name}`));
      map.set(feature, {
        crops: Array.from(names),
        isCurrent: prev.isCurrent || !!z.isCurrent,
      });
    });
 
    return map;
  }, [countries, matchingWorldZones]);
 
  // Inicializar el Globo 3D (globe.gl)
  // Inicializar el Globo 3D (globe.gl)
  useEffect(() => {
    if (!globeReady || !window.Globe || !globeContainerRef.current || globeInstanceRef.current) {
      return;
    }

    const container = globeContainerRef.current;
    
    // Obtener dimensiones seguras evitando valores de 0px
    const width = container.clientWidth || container.offsetWidth || window.innerWidth * 0.6;
    const height = container.clientHeight || container.offsetHeight || 600;

    const globe = window
      .Globe()(container)
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(true)
      .atmosphereColor("#8eb049")
      .atmosphereAltitude(0.16)
      .width(width)
      .height(height)
      .onGlobeClick(({ lat, lng }: { lat: number; lng: number }) => {
        setAutoRotate(false);
        setFocusedCropId(null);
        analizarPuntoEnGlobo(lat, lng);
      });

    // Océano liso, sin textura satelital ni relieve
    const mat = globe.globeMaterial();
    mat.color.set(OCEAN_COLOR);
    mat.emissive.set(OCEAN_COLOR);
    mat.emissiveIntensity = 0.55;
    mat.specular.set("#000000");
    mat.shininess = 0;

    // Centrar inicialmente sobre El Salvador
    globe.pointOfView({ lat: 13.8, lng: -88.9, altitude: 2.1 }, 1000);

    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.6;

    globeInstanceRef.current = globe;

    // Observer para redimensionar el globo dinámicamente cuando el contenedor cargue su tamaño real
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0 && globeInstanceRef.current) {
          globeInstanceRef.current.width(w).height(h);
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      try {
        globeInstanceRef.current?._destructor?.();
      } catch {
        /* noop */
      }
      globeInstanceRef.current = null;
      container.innerHTML = "";
    };
  }, [globeReady]);
 
  // Dibujar países: fronteras para todos y relleno verde en los que cumplen
  useEffect(() => {
    if (!globeInstanceRef.current) return;
    const globe = globeInstanceRef.current;
 
    globe
      .polygonsData(countries)
      .polygonCapColor((d: any) => {
        const info = paintedCountries.get(d);
        if (!info) return LAND_COLOR;
        return info.isCurrent ? CURRENT_COUNTRY_COLOR : greenScale(info.crops.length);
      })
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor(() => BORDER_COLOR)
      .polygonAltitude((d: any) => (paintedCountries.has(d) ? 0.012 : 0.004))
      .polygonsTransitionDuration(300)
      .polygonLabel((d: any) => {
        const name = escapeHtml(d?.properties?.NAME || d?.properties?.ADMIN || "");
        const info = paintedCountries.get(d);
        const body = info
          ? info.crops.map((c) => escapeHtml(c)).join("<br/>")
          : "No matching crops for these conditions";
        return `<div style="background:rgba(30,30,25,.88);color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.4"><strong>${name}</strong><br/>${body}</div>`;
      })
      .onPolygonClick((_d: any, _event: MouseEvent, c: { lat: number; lng: number }) => {
        setAutoRotate(false);
        setFocusedCropId(null);
        analizarPuntoEnGlobo(c.lat, c.lng);
      });
  }, [countries, paintedCountries, globeReady]);
 
  // Pausa/giro automático
  useEffect(() => {
    if (!globeInstanceRef.current) return;
    globeInstanceRef.current.controls().autoRotate = autoRotate;
  }, [autoRotate]);
 
  // Marcadores HTML (figuritas de cultivos) y anillos de pulso
  useEffect(() => {
    if (!globeInstanceRef.current) return;
    const globe = globeInstanceRef.current;
 
    globe
      .htmlElementsData(matchingWorldZones)
      .htmlLat((d: any) => d.lat)
      .htmlLng((d: any) => d.lng)
      .htmlElement((d: any) => {
        const el = document.createElement("div");
        el.className = `cropPin ${d.isCurrent ? "cropPinSelected" : ""}`;
 
        // Se usa textContent para evitar inyección de HTML con nombres de región
        const bubble = document.createElement("div");
        bubble.className = "cropPinBubble";
        bubble.textContent = d.icons || "🌱";
 
        const label = document.createElement("div");
        label.className = "cropPinLabel";
        label.textContent = d.region;
 
        el.appendChild(bubble);
        el.appendChild(label);
 
        el.style.pointerEvents = "auto";
        el.onclick = (e) => {
          e.stopPropagation();
          setAutoRotate(false);
          if (d.temp !== undefined && d.rain !== undefined && d.ph !== undefined) {
            setTemperature(d.temp);
            setPrecipitation(d.rain);
            setSoilPh(d.ph);
            setSelectedLat(d.lat);
            setSelectedLng(d.lng);
            setRegionLabel(d.country ? `${d.country} · ${d.region}` : d.region);
            setCoords(`Lat: ${d.lat.toFixed(4)}°, Lon: ${d.lng.toFixed(4)}°`);
            globe.pointOfView({ lat: d.lat, lng: d.lng, altitude: 1.8 }, 800);
          }
        };
        return el;
      });
 
    // Ondas verdes en los puntos análogos
    globe
      .ringsData(matchingWorldZones)
      .ringLat((d: any) => d.lat)
      .ringLng((d: any) => d.lng)
      .ringColor(() => "#8eb049")
      .ringMaxRadius(4)
      .ringPropagationSpeed(2)
      .ringRepeatPeriod(1400);
  }, [matchingWorldZones, globeReady]);
 
  return (
    <div className="exploreLayout">
      <Script
        src="https://unpkg.com/globe.gl"
        strategy="afterInteractive"
        onLoad={() => setGlobeReady(true)}
      />
 
      {/* Barra Superior */}
      <div className="barra">
        <Link href="/" className="volver">
          &larr; Home
        </Link>
        <button
          type="button"
          className="boton"
          onClick={() => setAutoRotate((prev) => !prev)}
        >
          {autoRotate ? "❚❚ Pause Spin" : "↻ Spin Globe"}
        </button>
        <button
          type="button"
          className="boton botonSecundario"
          onClick={() => {
            setFocusedCropId(null);
            analizarPuntoEnGlobo(13.85, -89.78, "El Salvador · Apaneca-Ilamatepec");
            globeInstanceRef.current?.pointOfView({ lat: 13.85, lng: -89.78, altitude: 2.0 }, 900);
          }}
        >
          🇸🇻 Center El Salvador
        </button>
        <span id="coords">{coords}</span>
      </div>
 
      <div className="splitContent">
        <div className="globeWrapper">
          <div id="globo3d" ref={globeContainerRef}></div>
          <div className="globeOverlayLegend" translate="no" suppressHydrationWarning>
            <strong>🌍 Analogous Agro-Climatic Zones ({matchingWorldZones.length})</strong>
            <span>Drag to rotate · Click any country or crop icon to compare global suitability.</span>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#5f7f2a" }}>■</span> <span>Suitable (darker = more crops)</span>
              {" · "}
              <span style={{ color: CURRENT_COUNTRY_COLOR }}>■</span> <span>Selected</span>
            </div>
          </div>
        </div>
 
        <aside className="ecocropPanel">
          <div className="panelHeader">
            <span className="eyebrow">
              {cargandoClima ? "Syncing NASA POWER..." : "FAO ECOCROP · Global Similarity"}
            </span>
            <h2>{regionLabel}</h2>
            <p>
              Showing {compatibleCrops.length} adapted crops and{" "}
              <strong>{matchingWorldZones.length} regions worldwide</strong> with similar growing conditions.
            </p>
          </div>
 
          <div className="controlsCard">
            <div className="controlItem">
              <label>
                <span>Temp</span>
                <strong>{temperature}°C</strong>
              </label>
              <input
                type="range"
                min="5"
                max="42"
                step="0.5"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
            </div>
 
            <div className="controlItem">
              <label>
                <span>Rain/yr</span>
                <strong>{precipitation}mm</strong>
              </label>
              <input
                type="range"
                min="200"
                max="3000"
                step="50"
                value={precipitation}
                onChange={(e) => setPrecipitation(parseInt(e.target.value, 10))}
              />
            </div>
 
            <div className="controlItem">
              <label>
                <span>Soil pH</span>
                <strong>{soilPh}</strong>
              </label>
              <input
                type="range"
                min="4.0"
                max="8.5"
                step="0.1"
                value={soilPh}
                onChange={(e) => setSoilPh(parseFloat(e.target.value))}
              />
            </div>
          </div>
 
          <div className="controlsCard" translate="no">
            <div className="controlItem">
              <label>
                <span>Elevation</span>
                <strong>
                  {terrain.status === "loading"
                    ? "…"
                    : terrain.elevation !== null
                    ? `${Math.round(terrain.elevation)} m`
                    : "n/a"}
                </strong>
              </label>
            </div>
            <div className="controlItem">
              <label>
                <span>Slope</span>
                <strong>
                  {terrain.status === "loading"
                    ? "…"
                    : terrain.slope !== null
                    ? `${terrain.slope}%`
                    : "n/a"}
                </strong>
              </label>
            </div>
            {terrain.slope !== null && (
              <p style={{ fontSize: "0.8rem", color: "#73726c", margin: "6px 0 0" }}>
                <strong>{slopeClass(terrain.slope).label}</strong> · {slopeClass(terrain.slope).advice}
              </p>
            )}
            {terrain.status === "nodata" && (
              <p style={{ fontSize: "0.8rem", color: "#73726c", margin: "6px 0 0" }}>
                No SRTM coverage here (ocean or beyond ±60° latitude).
              </p>
            )}
            {terrain.status === "error" && (
              <p style={{ fontSize: "0.8rem", color: "#73726c", margin: "6px 0 0" }}>
                Terrain data unavailable right now.
              </p>
            )}
            <small style={{ display: "block", marginTop: 6, color: "#9a978a" }}>
              NASA SRTM 30 m · slope estimated over ~550 m
            </small>
          </div>
 
          {focusedCropId !== null && (
            <div className="filterHint">
              <span>
                Filtering globe by:{" "}
                <strong>
                  {ECOCROP_DATABASE.find((c) => c.id === focusedCropId)?.icon}{" "}
                  {ECOCROP_DATABASE.find((c) => c.id === focusedCropId)?.name}
                </strong>
              </span>
              <button
                type="button"
                className="clearFilterBtn"
                onClick={() => setFocusedCropId(null)}
              >
                Show all
              </button>
            </div>
          )}
 
          <div className="cropsList">
            {compatibleCrops.length > 0 ? (
              compatibleCrops.map((crop) => (
                <article
                  key={crop.id}
                  onClick={() =>
                    setFocusedCropId((prev) => (prev === crop.id ? null : crop.id))
                  }
                  className={`cropCard ${
                    crop.isOptimal ? "cropCardOptimal" : ""
                  } ${focusedCropId === crop.id ? "cropCardFocused" : ""}`}
                >
                  <span
                    className={`badgeMatch ${
                      crop.isOptimal ? "badgeOptimal" : "badgeTolerant"
                    }`}
                  >
                    {crop.isOptimal ? "Optimal Match" : "Tolerant"}
                  </span>
                  {terrain.elevation !== null && terrain.elevation > crop.altitudeMax && (
                    <span
                      className="badgeMatch"
                      style={{ background: "#dbe6f3", color: "#274a73", marginLeft: 6 }}
                      title={`Elevation ${Math.round(terrain.elevation)} m is above the suggested ${crop.altitudeMax} m for this crop`}
                    >
                      Too high for this crop
                    </span>
                  )}
                  {terrain.slope !== null && terrain.slope > crop.slopeMaxPct && (
                    <span
                      className="badgeMatch"
                      style={{ background: "#f6e3c4", color: "#8a5a12", marginLeft: 6 }}
                      title={`Slope ${terrain.slope}% is above the suggested ${crop.slopeMaxPct}% for this crop`}
                    >
                      Steep for this crop
                    </span>
                  )}
                  <h3>
                    <span>{crop.icon}</span> {crop.name}
                  </h3>
                  <small>{crop.scientificName}</small>
                  <div className="cropMeta">
                    <span>
                      <strong>Optimal Temp:</strong> {crop.tempOptMin}–{crop.tempOptMax}°C
                    </span>
                    <span>
                      <strong>Rainfall:</strong> {crop.rainMin}–{crop.rainMax} mm
                    </span>
                    <span>
                      <strong>pH:</strong> {crop.phMin}–{crop.phMax} · {crop.climateZone}
                    </span>
                  </div>
                </article>
              ))
            ) : (
              <p style={{ fontSize: "0.85rem", color: "#73726c" }}>
                No crops match these extreme climate/soil thresholds. Try clicking a land region on the globe or adjusting the sliders.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
 