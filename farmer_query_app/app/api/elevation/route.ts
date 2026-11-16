
// Guardar como: app/api/elevation/route.ts
import { NextRequest, NextResponse } from "next/server";
 
// Distancia (en grados) entre el punto central y los 4 vecinos (~550 m)
const DELTA = 0.005;
const METERS_PER_DEG = 111320;
 
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
 
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }
 
  // Centro, Norte, Sur, Este, Oeste
  const points: [number, number][] = [
    [lat, lng],
    [lat + DELTA, lng],
    [lat - DELTA, lng],
    [lat, lng + DELTA],
    [lat, lng - DELTA],
  ];
  const locations = points.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join("|");
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locations}`;
 
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    }
    const json = await res.json();
    const elevations: (number | null)[] = (json?.results ?? []).map(
      (r: { elevation: number | null }) => (typeof r?.elevation === "number" ? r.elevation : null)
    );
 
    if (elevations.length !== 5 || elevations[0] === null) {
      // Sin cobertura SRTM (océano, latitudes > 60°, etc.)
      return NextResponse.json({ elevation: null, slopePct: null });
    }
 
    const [center, north, south, east, west] = elevations;
    let slopePct: number | null = null;
 
    if (north !== null && south !== null && east !== null && west !== null) {
      const dy = 2 * DELTA * METERS_PER_DEG;
      const dx = 2 * DELTA * METERS_PER_DEG * Math.cos((lat * Math.PI) / 180);
      const dzdy = (north - south) / dy;
      const dzdx = (east - west) / dx;
      slopePct = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
    }
 
    return NextResponse.json({
      elevation: center,
      slopePct: slopePct === null ? null : Number(slopePct.toFixed(1)),
      source: "SRTM 30m via Open Topo Data",
    });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 502 });
  }
}
 