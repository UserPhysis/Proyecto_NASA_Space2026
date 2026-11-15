"use client";

import { useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";

const modules = [
  { number: "01", icon: "", title: "Conocer mi terreno", detail: "Clima, suelo y cultivos", href: "/know-your-land", active: true },
  { number: "02", icon: "", title: "Explorar", detail: "Regiones y cultivos", href: "/explore" },
  { number: "03", icon: "", title: "Analizar mis cultivos", detail: "Historial y proyección", href: "/analyze-my-crops" },
  { number: "04", icon: "", title: "Pronóstico", detail: "Escenarios para tu cultivo", href: "/forecast" },
];

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [launchingLandModule, setLaunchingLandModule] = useState(false);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearched(false);
    window.setTimeout(() => {
      setSearching(false);
      setSearched(true);
    }, 1500);
  }

  function openLandModule(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (launchingLandModule) return;
    setLaunchingLandModule(true);
    window.setTimeout(() => router.push("/know-your-land"), 900);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Farmer Query inicio">
          <img src="/farmer-query-logo.svg" alt="Farmer Query" className="brand-logo" />
        </Link>
        <form className={`searchbar ${searching ? "is-searching" : ""}`} role="search" onSubmit={handleSearch}>
          <span className="search-icon">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="¿Qué deseas cultivar?" aria-label="¿Qué deseas cultivar?" /><button type="submit" className="search-submit" aria-label="Buscar">⌘ K</button>
        </form>
        <nav className="account-nav" aria-label="Cuenta"><span className="live-label"><i /> DATOS EN VIVO</span></nav>
      </header>

      <main className={`dashboard ${launchingLandModule ? "launching-land-module" : ""}`}>
        <aside className="sidebar">
          <div className="eyebrow-row"><span>Farmer Query</span><i /></div>
          <div className="heading-row"><h1>Módulos</h1><small>04</small></div>
          <div className="module-list">
            {modules.map((item) => <Link key={item.number} href={item.href} onClick={item.href === "/know-your-land" ? openLandModule : undefined} className={`module-card ${item.active ? "active" : ""}`}>
              <span className="module-number">{item.number}</span><span className="module-icon">{item.icon}</span><span className="module-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
              {item.active ? <span className="status-pill">ACTIVO</span> : <span className="module-arrow">›</span>}
            </Link>)}
          </div>
          <div className="connection"><span className="connection-dot" /> CONECTADO A NASA POWER <time>ACTUALIZADO HOY</time></div>
        </aside>

        <section className={`map-stage ${searching ? "is-searching" : ""} ${searched ? "has-result" : ""}`} aria-label="Explorador geográfico">
          <div className="stage-label">ARRASTRA PARA GIRAR</div><div className="star-field" aria-hidden="true" />
          {launchingLandModule && <div className="launch-feedback">ABRIENDO CONOCER MI TERRENO<span /><small>Preparando vista geográfica</small></div>}
          <div className="globe-wrap"><div className="globe" id="globo" /></div>
          <div className="map-controls" aria-label="Controles del mapa"><button type="button">+</button><button type="button">−</button></div>
          <div className="location-line"><span className="location-dot" /><span className="location-coords">14.16°N 89.81°O</span></div>
          <div className="search-feedback" aria-live="polite">{searching ? <><span className="loader" /> Consultando clima, suelo y cultivos…</> : searched ? <>✓ Zona localizada · análisis listo</> : <>Escribe una región o cultivo para comenzar</>}</div>
          <div className="location-card" id="info">
            <div className="location-card-top"><span>PUNTO SELECCIONADO</span><b>NASA POWER</b></div><h2>El Salvador · Apaneca-llamatepec</h2><p>Lat. 14.1606° · Lon. −89.0058°</p><p>Últimos 30 días</p>
            <div className="metrics"><div><span className="metric-icon warm">♨</span><strong>22.8 °C</strong><small>Temperatura media a 2 m</small></div><div><span className="metric-icon rain">♢</span><strong>165.5 mm</strong><small>Precipitación acumulada</small></div></div>
          </div>
        </section>
      </main>
      <Script src="https://unpkg.com/three@0.160.0/build/three.min.js" strategy="afterInteractive" />
      <Script src="https://unpkg.com/three-globe@2.41.12/dist/three-globe.min.js" strategy="afterInteractive" />
      <Script src="/globe.js" strategy="afterInteractive" />
    </div>
  );
}
