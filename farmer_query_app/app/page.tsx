"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";

const modules = [
  { number: "01", icon: "mountain", title: "Know My Land", detail: "Climate, soil and crops", href: "/know-your-land" },
  { number: "02", icon: "search", title: "Explore", detail: "Regions and crops", href: "/explore" },
  { number: "03", icon: "chart", title: "Analyze my crops", detail: "History and projection", href: "/analyze-my-crops" },
  { number: "04", icon: "help", title: "Frequently asked questions", detail: "How each module works", href: "/faq" },
];

// Iconos con el mismo estilo (trazo 1.8, extremos redondeados, 24x24)
const iconPaths: Record<string, React.ReactNode> = {
  mountain: <path d="m8 3 4 8 5-5 5 15H2L8 3z" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
};
// Brote que "crece" al entrar a un módulo: solo SVG + CSS, sin imágenes ni librerías
function Sprout() {
  return <svg className="sprout" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path pathLength="1" d="M18 58h28" />
    <path pathLength="1" d="M32 58V30" />
    <path pathLength="1" className="s-leaf l1" d="M32 38C32 28 24 22 12 22c0 10 8 16 20 16z" />
    <path pathLength="1" className="s-leaf l2" d="M32 30C32 20 40 12 54 12c0 12-8 18-22 18z" />
  </svg>;
}
function ModuleIcon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}
type HomePoint = { name: string; lat: number; lng: number; temp: string; rain: string };
const initialPoint: HomePoint = { name: "El Salvador · Apaneca-Ilamatepec", lat: 14.1606, lng: -89.0058, temp: "22.8 °C", rain: "165.5 mm" };

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [point, setPoint] = useState(initialPoint);
  const controller = useRef<AbortController | null>(null);

  // Carga los datos de NASA POWER. El pin ya lo dibuja globe.js, aquí solo se llenan los datos.
  async function loadPoint(lat: number, lng: number, name?: string, focus = false) {
    if (focus) (window as any).earthGlobe?.setPin(lat, lng, true); // solo en búsquedas: gira el globo al punto
    controller.current?.abort(); // cancela la petición anterior si el usuario hizo otro clic
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const end = new Date(Date.now() - 3 * 86400000);
      const start = new Date(end.getTime() - 29 * 86400000);
      const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
      const powerUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${format(start)}&end=${format(end)}&format=JSON`;
      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
      // en paralelo: datos NASA + nombre del lugar (si no lo conocemos)
      const [powerJson, reverse] = await Promise.all([
        fetch(powerUrl, { signal }).then((r) => r.json()),
        name ? Promise.resolve(null) : fetch(reverseUrl, { signal }).then((r) => r.json()).catch(() => null),
      ]);
      const parameters = powerJson.properties.parameter;
      const values = (input: Record<string, number>) => Object.values(input).filter((value) => value > -999);
      const temperatures = values(parameters.T2M);
      const rainfall = values(parameters.PRECTOTCORR);
      setPoint({
        name: name || reverse?.display_name?.split(",")[0] || "Selected point",
        lat,
        lng,
        temp: `${(temperatures.reduce((a, b) => a + b, 0) / Math.max(temperatures.length, 1)).toFixed(1)} °C`,
        rain: `${rainfall.reduce((a, b) => a + b, 0).toFixed(1)} mm`,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      /* Keep the last trusted reading when the external API is unavailable. */
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearched(false);
    try {
      const result = (await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`)).json())[0];
      if (result) await loadPoint(Number(result.lat), Number(result.lon), result.display_name.split(",")[0], true);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }

  // globe.js avisa con este evento cuando el usuario hace clic en el globo
  useEffect(() => {
    const onPick = (event: Event) => {
      const { lat, lng } = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      setPoint((p) => ({ ...p, name: "Selected point", lat, lng, temp: "…", rain: "…" })); // se muestra al instante
      setSearched(true);
      loadPoint(lat, lng);
    };
    window.addEventListener("earth:pick", onPick);
    return () => window.removeEventListener("earth:pick", onPick);
  }, []);

  function openLand(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (launching) return;
    setLaunching(true);
    window.setTimeout(() => router.push("/know-your-land"), 900);
  }

  const latLabel = `${Math.abs(point.lat).toFixed(2)}°${point.lat >= 0 ? "N" : "S"}`;
  const lngLabel = `${Math.abs(point.lng).toFixed(2)}°${point.lng >= 0 ? "E" : "W"}`;

  return <div className="app-shell">
    <header className="topbar"><Link href="/" className="brand" aria-label="Farmer Query home"><img src="/farmer-query-logo.svg" alt="Farmer Query" className="brand-logo" /></Link><form className={`searchbar ${searching ? "is-searching" : ""}`} role="search" onSubmit={search}><span className="search-icon">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="What do you want to grow?" aria-label="What do you want to grow?" /><button type="submit" className="search-submit">⌘ K</button></form><nav className="account-nav" aria-label="Status"><span className="live-label"><i /> LIVE DATA</span></nav></header>
    <main className={`dashboard ${launching ? "launching-land-module" : ""}`}><aside className="sidebar"><div className="heading-row"><h1>Modules</h1></div><div className="module-list">{modules.map((item) => <Link key={item.number} href={item.href} onClick={item.href === "/know-your-land" ? openLand : undefined} className="module-card"><span className="module-number">{item.number}</span><span className="module-icon"><ModuleIcon name={item.icon} /></span><span className="module-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="module-arrow">›</span></Link>)}</div><div className="connection"><span className="connection-dot" /> CONNECTED TO NASA POWER <time>UPDATED TODAY</time></div></aside>
      <section className={`map-stage ${searching ? "is-searching" : ""} ${searched ? "has-result" : ""}`}><div className="stage-label">DRAG TO ROTATE · CLICK TO INTERACT</div><div className="star-field" aria-hidden="true" />{launching && <div className="launch-feedback"><Sprout />OPENING KNOW YOUR LAND<span /><small>Loading climate, soil and altitude</small></div>}<div className="globe-wrap"><div className="globe" id="globo" /></div><div className="map-controls"><button type="button">+</button><button type="button">−</button></div><div className="location-line"><span className="location-dot" /><span className="location-coords">{latLabel} {lngLabel}</span></div><div className="search-feedback">{searching ? "Fetching climate and rainfall data..." : searched ? "✓ Area located · analysis ready" : "Search for a region or click the globe"}</div><div className="location-card" id="info"><div className="location-card-top"><span>SELECTED POINT</span><b>NASA POWER</b></div><h2>{point.name}</h2><p>Lat. {point.lat.toFixed(4)}° · Lon. {point.lng.toFixed(4)}°</p><p>Last 30 days</p><div className="metrics"><div><span className="metric-icon warm">♨</span><strong>{point.temp}</strong><small>Average temperature at 2 m</small></div><div><span className="metric-icon rain">♢</span><strong>{point.rain}</strong><small>Accumulated precipitation</small></div></div></div></section>
    </main><Script src="https://unpkg.com/three@0.160.0/build/three.min.js" strategy="afterInteractive" /><Script src="/globe.js?v=4" strategy="afterInteractive" />
  </div>;
}
