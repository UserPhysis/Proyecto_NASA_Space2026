"use client";

import Script from "next/script";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <header className="header">
        <form
          className="busqueda"
          role="search"
          onSubmit={(e) => e.preventDefault()}
        >
          <input type="search" placeholder="Buscar..." aria-label="Buscar" />
        </form>
      </header>

      <main className="contenido">
        <section className="columna columna-izquierda">
          <Link href="/modulo1" className="modulo">
            Módulo 1
          </Link>
          <a href="#" className="modulo">
            Módulo 2
          </a>
          <a href="#" className="modulo">
            Módulo 3
          </a>
          <a href="#" className="modulo">
            Módulo 4
          </a>
        </section>

        <section className="columna columna-derecha">
          <div className="globo" id="globo"></div>
          <div className="info" id="info">
            Haz clic en el globo para elegir un punto.
          </div>
        </section>
      </main>

      <Script src="https://unpkg.com" strategy="afterInteractive" />
      <Script src="/globe.js" strategy="afterInteractive" />
    </>
  );
}
