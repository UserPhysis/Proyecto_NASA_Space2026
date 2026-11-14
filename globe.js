(function () {
  const contenedor = document.getElementById('globo');
  const info = document.getElementById('info');

  let consultaActual = 0; // evita mostrar respuestas viejas si se hace clic rápido

  const globo = Globe()(contenedor)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundColor('rgba(0,0,0,0)')
    .pointLat('lat')
    .pointLng('lng')
    .pointAltitude(0.02)
    .pointRadius(0.6)
    .pointColor(() => '#ff5252')
    .onGlobeClick(({ lat, lng }) => seleccionar(lat, lng));

  // Ajustar el canvas al tamaño del círculo
  function ajustarTamano() {
    globo.width(contenedor.clientWidth).height(contenedor.clientHeight);
  }
  ajustarTamano();
  new ResizeObserver(ajustarTamano).observe(contenedor);

  // Rotación suave inicial y vista centrada en El Salvador
  globo.controls().autoRotate = true;
  globo.controls().autoRotateSpeed = 0.4;
  globo.pointOfView({ lat: 13.7, lng: -88.9, altitude: 2.2 });

  function seleccionar(lat, lng) {
    globo.controls().autoRotate = false;
    globo.pointsData([{ lat, lng }]);
    globo.pointOfView({ lat, lng }, 800);

    const coords = `Lat: ${lat.toFixed(4)}°, Lon: ${lng.toFixed(4)}°`;
    info.innerHTML = `<strong>${coords}</strong><br>Consultando NASA POWER...`;

    const id = ++consultaActual;
    consultarPower(lat, lng)
      .then((r) => {
        if (id !== consultaActual) return;
        info.innerHTML =
          `<strong>${coords}</strong><br>` +
          `Últimos 30 días (NASA POWER):<br>` +
          `Temperatura media a 2 m: ${r.temp} °C<br>` +
          `Precipitación acumulada: ${r.lluvia} mm`;
      })
      .catch(() => {
        if (id !== consultaActual) return;
        info.innerHTML =
          `<strong>${coords}</strong><br>No se pudieron obtener datos de NASA POWER.`;
      });
  }

  function fecha(d) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  async function consultarPower(lat, lng) {
    // POWER tiene unos días de retraso: terminamos 3 días atrás
    const fin = new Date(Date.now() - 3 * 86400000);
    const ini = new Date(fin.getTime() - 29 * 86400000);

    const url =
      'https://power.larc.nasa.gov/api/temporal/daily/point' +
      '?parameters=T2M,PRECTOTCORR&community=AG' +
      `&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}` +
      `&start=${fecha(ini)}&end=${fecha(fin)}&format=JSON`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const datos = await resp.json();
    const p = datos.properties.parameter;

    // -999 es el valor de "sin dato" en POWER
    const temps = Object.values(p.T2M).filter((v) => v > -999);
    const lluvias = Object.values(p.PRECTOTCORR).filter((v) => v > -999);
    if (!temps.length) throw new Error('sin datos');

    const media = temps.reduce((a, b) => a + b, 0) / temps.length;
    const total = lluvias.reduce((a, b) => a + b, 0);

    return { temp: media.toFixed(1), lluvia: total.toFixed(1) };
  }
})();
