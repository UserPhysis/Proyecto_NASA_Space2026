
// app/explore/ecocropData.ts
//
// Cultivos: FAO EcoCrop (espejo OpenCLIM). Los rangos de temperatura, lluvia, pH y
// ciclo vienen tal cual del dataset. Los campos marcados como "agronómicos" y
// category / mainUse / altitudeMax los agregué con criterio general: NO vienen de
// ese JSON y puedes ajustarlos libremente.
 
export type WaterNeed = "low" | "medium" | "high";
 
export interface CropECOCROP {
  id: number;
  icon: string;
  name: string; // nombre para la interfaz (inglés)
  nameEs: string; // nombre original del dataset
  scientificName: string;
  category: string;
  climateZone: string;
  mainUse: string;
 
  // --- EcoCrop ---
  tempMin: number;
  tempOptMin: number;
  tempOptMax: number;
  tempMax: number;
  rainMin: number; // mm/año
  rainOptMin: number;
  rainOptMax: number;
  rainMax: number;
  phMin: number;
  phOptMin: number;
  phOptMax: number;
  phMax: number;
  cycleDaysMin: number;
  cycleDaysMax: number;
 
  // --- Agregados ---
  altitudeMax: number; // m s. n. m. (aproximado)
  family: string; // familia botánica (útil para rotación: no repetir familia)
  fixesNitrogen: boolean; // leguminosas: aportan nitrógeno al suelo
  slopeMaxPct: number; // pendiente (%) a partir de la cual se advierte riesgo de erosión
  waterNeed: WaterNeed; // calculado a partir del rango óptimo de lluvia
}
 
export interface GlobalAnalogPoint {
  id: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  temp: number;
  rain: number;
  ph: number;
}
 
// Se calcula desde el punto medio del rango óptimo de lluvia anual
function waterNeedFromRain(optMin: number, optMax: number): WaterNeed {
  const mid = (optMin + optMax) / 2;
  if (mid < 900) return "low";
  if (mid < 1500) return "medium";
  return "high";
}
 
const RAW_CROPS: Omit<CropECOCROP, "waterNeed">[] = [
  {
    id: 1,
    icon: "🌽",
    name: "Maize (Corn)",
    nameEs: "Maíz",
    scientificName: "Zea mays",
    category: "Cereal",
    climateZone: "Tropical & Temperate",
    mainUse: "Staple food & Forage",
    tempMin: 10, tempOptMin: 18, tempOptMax: 33, tempMax: 47,
    rainMin: 400, rainOptMin: 600, rainOptMax: 1200, rainMax: 1800,
    phMin: 4.5, phOptMin: 5, phOptMax: 7, phMax: 8.5,
    cycleDaysMin: 65, cycleDaysMax: 365,
    altitudeMax: 3000,
    family: "Poaceae",
    fixesNitrogen: false,
    slopeMaxPct: 15,
  },
  {
    id: 2,
    icon: "🫘",
    name: "Common Bean",
    nameEs: "Frijol",
    scientificName: "Phaseolus vulgaris",
    category: "Legume",
    climateZone: "Tropical & Temperate",
    mainUse: "Dry grain / Protein source",
    tempMin: 7, tempOptMin: 16, tempOptMax: 25, tempMax: 32,
    rainMin: 300, rainOptMin: 500, rainOptMax: 2000, rainMax: 4300,
    phMin: 4, phOptMin: 5.5, phOptMax: 7.5, phMax: 9,
    cycleDaysMin: 50, cycleDaysMax: 270,
    altitudeMax: 2500,
    family: "Fabaceae",
    fixesNitrogen: true,
    slopeMaxPct: 15,
  },
  {
    id: 3,
    icon: "☕",
    name: "Coffee",
    nameEs: "Café",
    scientificName: "Coffea arabica",
    category: "Beverage / Cash Crop",
    climateZone: "Tropical Highlands",
    mainUse: "Roasted beans / Export",
    tempMin: 10, tempOptMin: 14, tempOptMax: 28, tempMax: 34,
    rainMin: 750, rainOptMin: 1400, rainOptMax: 2300, rainMax: 4200,
    phMin: 4.3, phOptMin: 5.5, phOptMax: 7, phMax: 8.4,
    cycleDaysMin: 210, cycleDaysMax: 330,
    altitudeMax: 2000,
    family: "Rubiaceae",
    fixesNitrogen: false,
    slopeMaxPct: 30,
  },
  {
    id: 4,
    icon: "🎋",
    name: "Sugarcane",
    nameEs: "Caña de azúcar",
    scientificName: "Saccharum officinarum",
    category: "Industrial / Energy",
    climateZone: "Tropical & Subtropical",
    mainUse: "Sugar & Bioethanol",
    tempMin: 15, tempOptMin: 24, tempOptMax: 37, tempMax: 41,
    rainMin: 1000, rainOptMin: 1500, rainOptMax: 2000, rainMax: 5000,
    phMin: 4.5, phOptMin: 5, phOptMax: 8, phMax: 9,
    cycleDaysMin: 210, cycleDaysMax: 365,
    altitudeMax: 1600,
    family: "Poaceae",
    fixesNitrogen: false,
    slopeMaxPct: 12,
  },
  {
    id: 5,
    icon: "🍚",
    name: "Rice",
    nameEs: "Arroz",
    scientificName: "Oryza sativa",
    category: "Cereal",
    climateZone: "Tropical & Subtropical",
    mainUse: "Staple grain",
    tempMin: 10, tempOptMin: 20, tempOptMax: 30, tempMax: 36,
    rainMin: 1000, rainOptMin: 1500, rainOptMax: 2000, rainMax: 4000,
    phMin: 4.5, phOptMin: 5.5, phOptMax: 7, phMax: 9,
    cycleDaysMin: 80, cycleDaysMax: 180,
    altitudeMax: 1800,
    family: "Poaceae",
    fixesNitrogen: false,
    slopeMaxPct: 3, // arroz inundado necesita terreno casi plano (o terrazas)
  },
  {
    id: 6,
    icon: "🌱",
    name: "Soybean",
    nameEs: "Soya",
    scientificName: "Glycine max",
    category: "Legume / Oilseed",
    climateZone: "Subtropical & Temperate",
    mainUse: "Oil, protein meal & Feed",
    tempMin: 10, tempOptMin: 20, tempOptMax: 33, tempMax: 38,
    rainMin: 450, rainOptMin: 600, rainOptMax: 1500, rainMax: 1800,
    phMin: 4.5, phOptMin: 5.5, phOptMax: 6.5, phMax: 8.4,
    cycleDaysMin: 75, cycleDaysMax: 180,
    altitudeMax: 2000,
    family: "Fabaceae",
    fixesNitrogen: true,
    slopeMaxPct: 12,
  },
  {
    id: 7,
    icon: "🌾",
    name: "Wheat",
    nameEs: "Trigo",
    scientificName: "Triticum aestivum",
    category: "Cereal",
    climateZone: "Temperate",
    mainUse: "Flour & Staple grain",
    tempMin: 5, tempOptMin: 15, tempOptMax: 23, tempMax: 27,
    rainMin: 300, rainOptMin: 750, rainOptMax: 900, rainMax: 1600,
    phMin: 5.5, phOptMin: 6, phOptMax: 7, phMax: 8.5,
    cycleDaysMin: 90, cycleDaysMax: 250,
    altitudeMax: 3000,
    family: "Poaceae",
    fixesNitrogen: false,
    slopeMaxPct: 15,
  },
  {
    id: 8,
    icon: "🥔",
    name: "Potato",
    nameEs: "Papa",
    scientificName: "Solanum tuberosum",
    category: "Tuber / Root",
    climateZone: "Temperate & Highlands",
    mainUse: "Fresh food & Processing",
    tempMin: 7, tempOptMin: 15, tempOptMax: 25, tempMax: 30,
    rainMin: 250, rainOptMin: 500, rainOptMax: 800, rainMax: 2000,
    phMin: 4.2, phOptMin: 5, phOptMax: 6.2, phMax: 8.5,
    cycleDaysMin: 90, cycleDaysMax: 160,
    altitudeMax: 4000,
    family: "Solanaceae",
    fixesNitrogen: false,
    slopeMaxPct: 12,
  },
  {
    id: 9,
    icon: "🍅",
    name: "Tomato",
    nameEs: "Tomate",
    scientificName: "Lycopersicon esculentum",
    category: "Vegetable",
    climateZone: "Subtropical & Temperate",
    mainUse: "Fresh market & Processing",
    tempMin: 7, tempOptMin: 20, tempOptMax: 27, tempMax: 35,
    rainMin: 400, rainOptMin: 600, rainOptMax: 1300, rainMax: 1800,
    phMin: 5, phOptMin: 5.5, phOptMax: 6.8, phMax: 7.5,
    cycleDaysMin: 70, cycleDaysMax: 150,
    altitudeMax: 2500,
    family: "Solanaceae",
    fixesNitrogen: false,
    slopeMaxPct: 12,
  },
  {
    id: 10,
    icon: "🍠",
    name: "Cassava",
    nameEs: "Yuca",
    scientificName: "Manihot esculenta",
    category: "Root Crop",
    climateZone: "Tropical",
    mainUse: "Starch & Staple food",
    tempMin: 10, tempOptMin: 20, tempOptMax: 29, tempMax: 35,
    rainMin: 500, rainOptMin: 1000, rainOptMax: 1500, rainMax: 5000,
    phMin: 4, phOptMin: 5.5, phOptMax: 8, phMax: 9,
    cycleDaysMin: 180, cycleDaysMax: 365,
    altitudeMax: 1800,
    family: "Euphorbiaceae",
    fixesNitrogen: false,
    slopeMaxPct: 15,
  },
];
 
export const ECOCROP_DATABASE: CropECOCROP[] = RAW_CROPS.map((c) => ({
  ...c,
  waterNeed: waterNeedFromRain(c.rainOptMin, c.rainOptMax),
}));
 
// Regiones agrícolas clave alrededor del planeta con sus perfiles climáticos
export const GLOBAL_AGRICULTURAL_ZONES: GlobalAnalogPoint[] = [
  { id: "sv-apaneca", region: "Apaneca-Ilamatepec", country: "El Salvador", lat: 13.85, lng: -89.78, temp: 22.5, rain: 1850, ph: 5.8 },
  { id: "sv-zapotitan", region: "Valle de Zapotitán", country: "El Salvador", lat: 13.80, lng: -89.43, temp: 26.5, rain: 1550, ph: 6.3 },
  { id: "sv-oriente", region: "San Miguel · Dry Corridor", country: "El Salvador", lat: 13.48, lng: -88.18, temp: 30.0, rain: 900, ph: 6.7 },
  { id: "cr-tarrazu", region: "Tarrazú Highlands", country: "Costa Rica", lat: 9.65, lng: -84.02, temp: 20.5, rain: 2100, ph: 5.6 },
  { id: "co-ejecafetero", region: "Eje Cafetero · Caldas", country: "Colombia", lat: 5.07, lng: -75.52, temp: 21.0, rain: 2000, ph: 5.5 },
  { id: "br-minas", region: "Minas Gerais", country: "Brazil", lat: -18.51, lng: -44.55, temp: 23.0, rain: 1500, ph: 5.8 },
  // Renombrado: antes "Bahia Cocoa Belt" (el cacao ya no está en la lista de cultivos)
  { id: "br-bahia", region: "Bahia Coast", country: "Brazil", lat: -14.79, lng: -39.27, temp: 25.5, rain: 1950, ph: 5.9 },
  // Renombrado: antes "Michoacán Avocado Belt" (el aguacate ya no está en la lista de cultivos)
  { id: "mx-michoacan", region: "Michoacán Highlands", country: "Mexico", lat: 19.42, lng: -102.05, temp: 20.0, rain: 1300, ph: 6.2 },
  { id: "mx-sinaloa", region: "Sinaloa Valley", country: "Mexico", lat: 25.80, lng: -108.98, temp: 26.0, rain: 650, ph: 7.2 },
  { id: "us-iowa", region: "Iowa Corn Belt", country: "United States", lat: 41.87, lng: -93.09, temp: 14.5, rain: 900, ph: 6.5 },
  { id: "et-sidama", region: "Sidama Highlands", country: "Ethiopia", lat: 6.74, lng: 38.45, temp: 20.0, rain: 1600, ph: 5.7 },
  { id: "ke-nyeri", region: "Mount Kenya · Nyeri", country: "Kenya", lat: -0.42, lng: 36.95, temp: 19.5, rain: 1450, ph: 5.9 },
  { id: "gh-ashanti", region: "Ashanti Region", country: "Ghana", lat: 6.75, lng: -1.52, temp: 26.5, rain: 1650, ph: 6.0 },
  { id: "vn-daklak", region: "Central Highlands · Dak Lak", country: "Vietnam", lat: 12.67, lng: 108.04, temp: 23.5, rain: 1800, ph: 5.6 },
  { id: "vn-mekong", region: "Mekong Delta", country: "Vietnam", lat: 10.04, lng: 105.78, temp: 27.5, rain: 1900, ph: 5.8 },
  { id: "id-java", region: "East Java", country: "Indonesia", lat: -7.53, lng: 112.23, temp: 25.5, rain: 2000, ph: 6.1 },
  { id: "in-punjab", region: "Punjab Plains", country: "India", lat: 30.90, lng: 75.85, temp: 24.5, rain: 750, ph: 7.4 },
  { id: "th-chiangmai", region: "Chiang Mai Valleys", country: "Thailand", lat: 18.79, lng: 98.98, temp: 25.5, rain: 1250, ph: 6.2 },
  { id: "pe-junin", region: "Chanchamayo · Junín", country: "Peru", lat: -11.06, lng: -75.33, temp: 22.0, rain: 1900, ph: 5.7 },
  { id: "es-andalucia", region: "Andalucía", country: "Spain", lat: 37.38, lng: -5.98, temp: 19.0, rain: 550, ph: 7.3 },
];
 