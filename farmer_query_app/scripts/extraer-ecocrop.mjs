// farmer_query_app/scripts/extraer-ecocrop.mjs
// Uso (desde farmer_query_app):
//   node scripts/extraer-ecocrop.mjs                 -> descarga el CSV de GitHub
//   node scripts/extraer-ecocrop.mjs C:\ruta\EcoCrop_DB.csv  -> usa un CSV local
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const URLS = [
  "https://raw.githubusercontent.com/OpenCLIM/ecocrop/main/EcoCrop_DB.csv",
  "https://raw.githubusercontent.com/OpenCLIM/ecocrop/master/EcoCrop_DB.csv",
];

// nombre en español -> nombres científicos posibles (se busca por coincidencia parcial)
const CULTIVOS = {
  "Maíz": ["zea mays"],
  "Frijol": ["phaseolus vulgaris"],
  "Café": ["coffea arabica"],
  "Caña de azúcar": ["saccharum officinarum"],
  "Arroz": ["oryza sativa"],
  "Soya": ["glycine max"],
  "Trigo": ["triticum aestivum"],
  "Papa": ["solanum tuberosum"],
  "Tomate": ["solanum lycopersicum", "lycopersicon esculentum"],
  "Yuca": ["manihot esculenta"],
};

// Posibles nombres de cada columna (sin distinguir mayúsculas)
const COLUMNAS = {
  cientifico: ["scientname", "scientificname", "scientific name", "sciname"],
  tMin: ["tmin"], tOptMin: ["topmn"], tOptMax: ["topmx"], tMax: ["tmax"],
  rMin: ["rmin"], rOptMin: ["ropmn"], rOptMax: ["ropmx"], rMax: ["rmax"],
  phMin: ["phmin"], phOptMin: ["phopmn"], phOptMax: ["phopmx"], phMax: ["phmax"],
  cicloMin: ["gmin"], cicloMax: ["gmax"],
};

// Lector CSV simple que respeta comillas
function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x !== "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

async function obtenerTexto() {
  const local = process.argv[2];
  if (local) return readFileSync(local, "utf8");
  for (const url of URLS) {
    const res = await fetch(url);
    if (res.ok) { console.log("Descargado de:", url); return await res.text(); }
    console.log(`No se pudo (${res.status}):`, url);
  }
  throw new Error("No se pudo descargar. Bajá el CSV a mano y pasalo como argumento.");
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
};

const texto = await obtenerTexto();
const filas = parsearCSV(texto);
const cabeceras = filas[0].map((h) => h.trim());
const idx = (candidatos) =>
  cabeceras.findIndex((h) => candidatos.includes(h.toLowerCase()));

const col = Object.fromEntries(Object.entries(COLUMNAS).map(([k, v]) => [k, idx(v)]));

if (col.cientifico < 0) {
  console.log("No encontré la columna del nombre científico. Cabeceras del CSV:");
  console.log(cabeceras.join(" | "));
  process.exit(1);
}
const faltan = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
if (faltan.length) console.log("Columnas no encontradas (quedarán en null):", faltan.join(", "));

const dato = (fila, clave) => (col[clave] >= 0 ? num(fila[col[clave]]) : null);
const resultado = {};
const sinEncontrar = [];

for (const [nombre, cientificos] of Object.entries(CULTIVOS)) {
  const fila = filas.slice(1).find((f) =>
    cientificos.some((c) => (f[col.cientifico] ?? "").toLowerCase().includes(c))
  );
  if (!fila) { sinEncontrar.push(nombre); continue; }

  const cicloMin = dato(fila, "cicloMin");
  const cicloMax = dato(fila, "cicloMax");
  // Ciclo en días -> meses (Recocrop suma 1 mes al ciclo mínimo para pasar a lluvia mensual)
  const meses = cicloMin !== null ? cicloMin / 30 + 1 : null;
  const lluviaAnual = {
    min: dato(fila, "rMin"), optMin: dato(fila, "rOptMin"),
    optMax: dato(fila, "rOptMax"), max: dato(fila, "rMax"),
  };
  const aMensual = (v) => (v !== null && meses ? Math.round(v / meses) : null);

  resultado[nombre] = {
    cientifico: fila[col.cientifico].trim(),
    temperatura: {
      min: dato(fila, "tMin"), optMin: dato(fila, "tOptMin"),
      optMax: dato(fila, "tOptMax"), max: dato(fila, "tMax"),
    },
    lluviaAnual,
    lluviaMensualAprox: {
      min: aMensual(lluviaAnual.min), optMin: aMensual(lluviaAnual.optMin),
      optMax: aMensual(lluviaAnual.optMax), max: aMensual(lluviaAnual.max),
    },
    ph: {
      min: dato(fila, "phMin"), optMin: dato(fila, "phOptMin"),
      optMax: dato(fila, "phOptMax"), max: dato(fila, "phMax"),
    },
    cicloDias: { min: cicloMin, max: cicloMax },
  };
}

mkdirSync("public/datos", { recursive: true });
writeFileSync(
  "public/datos/ecocrop.json",
  JSON.stringify({ fuente: "FAO EcoCrop (espejo OpenCLIM)", cultivos: resultado }, null, 2)
);

console.log(`Listo: ${Object.keys(resultado).length} cultivos en public/datos/ecocrop.json`);
if (sinEncontrar.length) console.log("No encontrados:", sinEncontrar.join(", "));