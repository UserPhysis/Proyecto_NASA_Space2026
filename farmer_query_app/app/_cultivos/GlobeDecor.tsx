"use client";

import "./cultivos.css";

// Cultivos que giran lentamente alrededor del planeta
const ORBITA = ["🌾", "🌽", "☕", "🍌", "🍇", "🫘"];

export default function GlobeDecor() {
  return (
    <div className="globe-decor" aria-hidden="true">
      <svg viewBox="0 0 100 100" fill="none">
        {/* anillo exterior punteado */}
        <circle cx="50" cy="50" r="49" stroke="#9bd43c" strokeWidth="0.25" strokeDasharray="1.2 1.8" opacity="0.75" />
        {/* anillo fino interior */}
        <circle cx="50" cy="50" r="46.6" stroke="#cfe5a3" strokeWidth="0.2" />
        {/* marcas de escala: una cada 5° y una más larga cada 30° */}
        <circle cx="50" cy="50" r="44.6" pathLength="360" stroke="#b7d97a" strokeWidth="1" strokeDasharray="0.4 4.6" />
        <circle cx="50" cy="50" r="44.8" pathLength="360" stroke="#7ea52b" strokeWidth="1.8" strokeDasharray="0.6 29.4" />
      </svg>

      <div className="orbit">
        {ORBITA.map((emoji, i) => {
          const rad = ((i * 360) / ORBITA.length - 90) * (Math.PI / 180);
          return (
            <span
              key={emoji}
              style={{ left: `${50 + 49 * Math.cos(rad)}%`, top: `${50 + 49 * Math.sin(rad)}%` }}
            >
              <i>{emoji}</i>
            </span>
          );
        })}
      </div>
    </div>
  );
}
