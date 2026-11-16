// app/_cultivos/datos.ts
// Principales zonas productoras del mundo con clima medio ANUAL APROXIMADO.
// Los valores de temp (°C) y lluvia (mm/año) son orientativos. Para precisión real,
// reemplázalos con WorldClim / CHELSA / NASA POWER (ver notas al final).

export type Cultivo = {
  cultivo: string;
  emoji: string;
  pais: string;
  region: string;
  lat: number;
  lon: number;
  temp: number; // °C, media anual
  lluvia: number; // mm por año
};

export type Params = {
  temp: number;
  lluvia: number;
  cultivo: string; // "Todos" o el nombre de un cultivo
  tolerancia: number; // multiplicador: 0.5 estricta, 1 normal, 2 amplia
};

export const EMOJI: Record<string, string> = {
  Trigo: "🌾",
  Arroz: "🍚",
  Maíz: "🌽",
  Soya: "🫘",
  "Caña de azúcar": "🍬",
  Papa: "🥔",
  Café: "☕",
  Cacao: "🍫",
  Banano: "🍌",
  "Palma de aceite": "🌴",
  Té: "🍵",
  Algodón: "🧵",
  Uva: "🍇",
  Olivo: "🫒",
};

export const NOMBRES_CULTIVO = Object.keys(EMOJI);

// [cultivo, país, región, lat, lon, temp °C, lluvia mm/año]
const RAW: [string, string, string, number, number, number, number][] = [
  // Trigo
  ["Trigo", "EE. UU.", "Kansas", 38.5, -98.0, 12, 700],
  ["Trigo", "India", "Punjab", 30.9, 75.8, 24, 650],
  ["Trigo", "China", "Henan", 34.0, 113.5, 15, 700],
  ["Trigo", "Rusia", "Krasnodar", 45.0, 39.0, 11, 650],
  ["Trigo", "Francia", "Beauce", 48.2, 1.8, 11, 600],
  ["Trigo", "Australia", "Wheatbelt", -31.5, 117.5, 17, 380],
  ["Trigo", "Argentina", "Pampa húmeda", -34.5, -62.0, 17, 900],
  // Arroz
  ["Arroz", "Vietnam", "Delta del Mekong", 10.0, 105.8, 27, 1700],
  ["Arroz", "India", "Bengala Occidental", 23.0, 87.8, 26, 1500],
  ["Arroz", "China", "Hunan", 28.2, 112.9, 17, 1400],
  ["Arroz", "Indonesia", "Java", -7.2, 110.5, 26, 2200],
  ["Arroz", "Tailandia", "Chao Phraya", 15.0, 100.3, 28, 1400],
  // Maíz
  ["Maíz", "EE. UU.", "Iowa", 42.0, -93.5, 9, 850],
  ["Maíz", "Brasil", "Mato Grosso", -13.0, -55.5, 25, 1500],
  ["Maíz", "China", "Jilin", 43.8, 125.3, 5, 550],
  ["Maíz", "Argentina", "Córdoba", -32.0, -63.5, 17, 800],
  ["Maíz", "México", "Sinaloa", 25.0, -108.0, 25, 650],
  // Soya
  ["Soya", "Brasil", "Rio Grande do Sul", -28.5, -53.0, 19, 1700],
  ["Soya", "EE. UU.", "Illinois", 40.0, -89.0, 11, 1000],
  ["Soya", "Argentina", "Santa Fe", -31.0, -61.0, 19, 950],
  // Caña de azúcar
  ["Caña de azúcar", "Brasil", "São Paulo", -21.5, -48.5, 22, 1300],
  ["Caña de azúcar", "India", "Uttar Pradesh", 27.0, 80.5, 25, 900],
  ["Caña de azúcar", "Guatemala", "Costa Sur", 14.3, -91.0, 26, 2000],
  // Papa
  ["Papa", "Perú", "Andes centrales", -12.5, -75.0, 12, 700],
  ["Papa", "Países Bajos", "Flevoland", 52.5, 5.5, 10, 800],
  ["Papa", "China", "Mongolia Interior", 41.0, 112.0, 6, 350],
  // Café
  ["Café", "Brasil", "Minas Gerais", -20.0, -45.0, 21, 1500],
  ["Café", "Colombia", "Huila", 2.5, -75.6, 20, 1600],
  ["Café", "Vietnam", "Tierras Altas Centrales", 12.7, 108.0, 23, 1800],
  ["Café", "Etiopía", "Sidamo", 6.5, 38.5, 19, 1500],
  ["Café", "El Salvador", "Santa Ana", 13.9, -89.6, 21, 1800],
  // Cacao
  ["Cacao", "Costa de Marfil", "Soubré", 5.8, -6.6, 26, 1400],
  ["Cacao", "Ghana", "Ashanti", 6.7, -1.6, 26, 1500],
  ["Cacao", "Ecuador", "Guayas", -2.0, -79.5, 25, 1000],
  ["Cacao", "Indonesia", "Sulawesi", -3.0, 120.0, 26, 2500],
  // Banano
  ["Banano", "Ecuador", "Los Ríos", -1.8, -79.5, 25, 1800],
  ["Banano", "Filipinas", "Mindanao", 7.2, 125.5, 27, 2400],
  ["Banano", "Costa Rica", "Limón", 10.0, -83.2, 26, 3300],
  // Palma de aceite
  ["Palma de aceite", "Indonesia", "Riau, Sumatra", 0.5, 101.5, 27, 2800],
  ["Palma de aceite", "Malasia", "Johor", 2.0, 103.3, 27, 2400],
  // Té
  ["Té", "India", "Assam", 26.5, 93.5, 23, 2400],
  ["Té", "China", "Yunnan", 24.5, 101.0, 17, 1200],
  ["Té", "Kenia", "Kericho", -0.4, 35.3, 18, 1900],
  ["Té", "Sri Lanka", "Nuwara Eliya", 6.9, 80.7, 22, 2000],
  // Algodón
  ["Algodón", "China", "Xinjiang", 41.5, 85.0, 9, 150],
  ["Algodón", "EE. UU.", "Texas (High Plains)", 33.5, -101.9, 15, 500],
  ["Algodón", "India", "Gujarat", 22.3, 71.2, 27, 700],
  // Uva
  ["Uva", "Argentina", "Mendoza", -33.0, -68.8, 15, 220],
  ["Uva", "Francia", "Burdeos", 44.8, -0.6, 13, 950],
  ["Uva", "EE. UU.", "Napa Valley", 38.5, -122.3, 15, 650],
  ["Uva", "Chile", "Valle Central", -34.6, -71.0, 14, 600],
  // Olivo
  ["Olivo", "España", "Jaén", 37.8, -3.8, 17, 550],
  ["Olivo", "Italia", "Apulia", 40.9, 17.0, 16, 560],
  ["Olivo", "Túnez", "Sfax", 34.7, 10.7, 20, 230],
];

export const CULTIVOS: Cultivo[] = RAW.map(
  ([cultivo, pais, region, lat, lon, temp, lluvia]) => ({
    cultivo,
    emoji: EMOJI[cultivo] ?? "📍",
    pais,
    region,
    lat,
    lon,
    temp,
    lluvia,
  })
);

// Tolerancia base: ±4 °C y ±500 mm cuentan como "distancia 1".
const TOL_TEMP = 4;
const TOL_LLUVIA = 500;

export function distancia(c: Cultivo, p: Params): number {
  const dt = (c.temp - p.temp) / TOL_TEMP;
  const dp = (c.lluvia - p.lluvia) / TOL_LLUVIA;
  return Math.hypot(dt, dp);
}

export type Resultado = {
  mejor: Cultivo | null;
  coincidencias: Cultivo[]; // las que caen dentro de la tolerancia (o las 5 más cercanas)
  exacto: boolean; // false = no hubo coincidencias dentro de la tolerancia
};

export function buscar(p: Params): Resultado {
  const ordenados = CULTIVOS.filter(
    (c) => p.cultivo === "Todos" || c.cultivo === p.cultivo
  )
    .map((c) => ({ c, d: distancia(c, p) }))
    .sort((a, b) => a.d - b.d);

  const dentro = ordenados.filter((x) => x.d <= p.tolerancia).map((x) => x.c);
  const exacto = dentro.length > 0;

  return {
    mejor: ordenados[0]?.c ?? null,
    coincidencias: exacto ? dentro : ordenados.slice(0, 5).map((x) => x.c),
    exacto,
  };
}

/*
  Para datos climáticos reales (en vez de la tabla de arriba):
  - NASA POWER (API gratis, sin clave): temperatura y precipitación climatológica por lat/lon.
    https://power.larc.nasa.gov/api/temporal/climatology/point
  - WorldClim: rásters globales de temperatura y precipitación media anual.
*/

// ---------- Textos para la interfaz (español / inglés) ----------
export type Idioma = "es" | "en";

const CULTIVO_EN: Record<string, string> = {
  Trigo: "Wheat", Arroz: "Rice", Maíz: "Corn", Soya: "Soybean",
  "Caña de azúcar": "Sugarcane", Papa: "Potato", Café: "Coffee", Cacao: "Cocoa",
  Banano: "Banana", "Palma de aceite": "Oil palm", Té: "Tea", Algodón: "Cotton",
  Uva: "Grape", Olivo: "Olive",
};

const PAIS_EN: Record<string, string> = {
  "EE. UU.": "USA", Rusia: "Russia", Francia: "France", Tailandia: "Thailand",
  Brasil: "Brazil", México: "Mexico", Perú: "Peru", "Países Bajos": "Netherlands",
  Etiopía: "Ethiopia", "Costa de Marfil": "Ivory Coast", Filipinas: "Philippines",
  Malasia: "Malaysia", Kenia: "Kenya", España: "Spain", Italia: "Italy", Túnez: "Tunisia",
};

const REGION_EN: Record<string, string> = {
  "Pampa húmeda": "Humid Pampas", "Tierras Altas Centrales": "Central Highlands",
  "Costa Sur": "South Coast", "Valle Central": "Central Valley",
  "Mongolia Interior": "Inner Mongolia", "Andes centrales": "Central Andes",
  "Delta del Mekong": "Mekong Delta", "Bengala Occidental": "West Bengal",
  Burdeos: "Bordeaux", Apulia: "Puglia",
};

export const nombreCultivo = (c: string, l: Idioma) =>
  l === "en" ? CULTIVO_EN[c] ?? c : c;

export const lugar = (c: Cultivo, l: Idioma) =>
  l === "en"
    ? `${REGION_EN[c.region] ?? c.region}, ${PAIS_EN[c.pais] ?? c.pais}`
    : `${c.region}, ${c.pais}`;
