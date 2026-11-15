"use client";

import { useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";

const modules = [
  { number: "01", icon: "⌁", title: "Know My Land", detail: "Climate, soil and crops", href: "/know-your-land", active: true },
  { number: "02", icon: "◉", title: "Explore", detail: "Regions and crops", href: "/explore" },
  { number: "03", icon: "⌁", title: "Analyze my crops", detail: "History and projection", href: "/analyze-my-crops" },
  { number: "04", icon: "?", title: "Frequently asked questions", detail: "How each module works", href: "/faq" },
];
type HomePoint = { name: string; lat: number; lng: number; temp: string; rain: string };
const initialPoint: HomePoint = { name: "El Salvador · Apaneca-Ilamatepec", lat: 14.1606, lng: -89.0058, temp: "22.8 °C", rain: "165.5 mm" };

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState(""); const [searching, setSearching] = useState(false); const [searched, setSearched] = useState(false); const [launching, setLaunching] = useState(false); const [point, setPoint] = useState(initialPoint); const [pin, setPin] = useState<{ x: number; y: number; visible?: boolean } | null>(null);

  async function loadPoint(lat: number, lng: number, name: string) {
    const globe = document.getElementById("globo"); if (globe) { globe.dataset.pinLat = String(lat); globe.dataset.pinLng = String(lng); }
    try {
      const end = new Date(Date.now() - 3 * 86400000); const start = new Date(end.getTime() - 29 * 86400000); const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
      const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${format(start)}&end=${format(end)}&format=JSON`); const parameters = (await response.json()).properties.parameter;
      const values = (input: Record<string, number>) => Object.values(input).filter((value) => value > -999); const temperatures = values(parameters.T2M); const rainfall = values(parameters.PRECTOTCORR);
      setPoint({ name, lat, lng, temp: `${(temperatures.reduce((a, b) => a + b, 0) / Math.max(temperatures.length, 1)).toFixed(1)} °C`, rain: `${rainfall.reduce((a, b) => a + b, 0).toFixed(1)} mm` });
    } catch { /* Keep the last trusted reading when the external API is unavailable. */ }
  }
  async function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!query.trim() || searching) return; setSearching(true); setSearched(false); try { const result = (await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`)).json())[0]; if (result) await loadPoint(Number(result.lat), Number(result.lon), result.display_name.split(",")[0]); } finally { setSearching(false); setSearched(true); } }
  useEffect(() => { const handler = (event: Event) => { const detail = (event as CustomEvent<{ x: number; y: number; visible: boolean }>).detail; setPin({ x: detail.x, y: detail.y, visible: detail.visible }); }; window.addEventListener("earth:pin-position", handler); return () => window.removeEventListener("earth:pin-position", handler); }, []);
  const rotation = 0;
  function startDrag() { /* Three.js owns globe drag interaction. */ }
  function moveGlobe() { /* Three.js owns globe drag interaction. */ }
  function stopDrag() { /* Three.js owns globe drag interaction. */ }
  function openLand(event: MouseEvent<HTMLAnchorElement>) { event.preventDefault(); if (launching) return; setLaunching(true); window.setTimeout(() => router.push("/know-your-land"), 900); }
  async function clickGlobe(event: React.MouseEvent<HTMLDivElement>) { const globe = document.getElementById("globo"); if (globe?.dataset.dragged === "true") { globe.dataset.dragged = "false"; return; } const rect = event.currentTarget.getBoundingClientRect(); const x = ((event.clientX - rect.left) / rect.width) * 100; const y = ((event.clientY - rect.top) / rect.height) * 100; const lat = 90 - y * 1.8; const lng = x * 3.6 - 180; setPin({ x, y, visible: true }); await loadPoint(lat, lng, "Map pin"); setSearched(true); }

  return <div className="app-shell">
    <header className="topbar"><Link href="/" className="brand" aria-label="Farmer Query home"><img src="/farmer-query-logo.svg" alt="Farmer Query" className="brand-logo" /></Link><form className={`searchbar ${searching ? "is-searching" : ""}`} role="search" onSubmit={search}><span className="search-icon">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="What do you want to grow?" aria-label="What do you want to grow?" /><button type="submit" className="search-submit">⌘ K</button></form><nav className="account-nav" aria-label="Status"><span className="live-label"><i /> LIVE DATA</span></nav></header>
    <main className={`dashboard ${launching ? "launching-land-module" : ""}`}><aside className="sidebar"><div className="eyebrow-row"><span>Farmer Query</span><i /></div><div className="heading-row"><h1>Modules</h1><small>{String(modules.length).padStart(2, "0")}</small></div><div className="module-list">{modules.map((item) => <Link key={item.number} href={item.href} onClick={item.href === "/know-your-land" ? openLand : undefined} className={`module-card ${item.active ? "active" : ""}`}><span className="module-number">{item.number}</span><span className="module-icon">{item.icon}</span><span className="module-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>{item.active ? <span className="status-pill">ACTIVE</span> : <span className="module-arrow">›</span>}</Link>)}</div><div className="connection"><span className="connection-dot" /> CONNECTED TO NASA POWER <time>UPDATED TODAY</time></div></aside>
      <section className={`map-stage ${searching ? "is-searching" : ""} ${searched ? "has-result" : ""}`}><div className="stage-label">DRAG TO ROTATE · CLICK TO INTERACT</div><div className="star-field" aria-hidden="true" />{launching && <div className="launch-feedback">OPENING KNOW YOUR LAND<span /><small>Preparing geographic view</small></div>}<div className="globe-wrap" onPointerDown={startDrag} onPointerMove={moveGlobe} onPointerUp={stopDrag} onPointerCancel={stopDrag} onClick={clickGlobe}><div className="globe" id="globo" style={{ transform: `rotateY(${rotation}deg)` }} />{pin && <span className="home-pin" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} />}</div><div className="map-controls"><button type="button">+</button><button type="button">−</button></div><div className="location-line"><span className="location-dot" /><span className="location-coords">{point.lat.toFixed(2)}°N {Math.abs(point.lng).toFixed(2)}°W</span></div><div className="search-feedback">{searching ? "Fetching climate and rainfall data..." : searched ? "✓ Area located · analysis ready" : "Search for a region or click the globe"}</div><div className="location-card" id="info"><div className="location-card-top"><span>SELECTED POINT</span><b>NASA POWER</b></div><h2>{point.name}</h2><p>Lat. {point.lat.toFixed(4)}° · Lon. {point.lng.toFixed(4)}°</p><p>Last 30 days</p><div className="metrics"><div><span className="metric-icon warm">♨</span><strong>{point.temp}</strong><small>Average temperature at 2 m</small></div><div><span className="metric-icon rain">♢</span><strong>{point.rain}</strong><small>Accumulated precipitation</small></div></div></div></section>
    </main><Script src="https://unpkg.com/three@0.160.0/build/three.min.js" strategy="afterInteractive" /><Script src="/globe.js?v=3" strategy="afterInteractive" />
  </div>;
}
