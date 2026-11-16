(function () {
  // The map has a CSS fallback when the external library is unavailable.
  if (typeof Globe === 'undefined') return;
  const container = document.getElementById('globo');
  const infoPanel = document.getElementById('info');
  let requestId = 0;

  const globe = Globe()(container)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundColor('rgba(0,0,0,0)')
    .pointLat('lat').pointLng('lng').pointAltitude(0.02).pointRadius(0.6)
    .pointColor(() => '#ff5252')
    .onGlobeClick(({ lat, lng }) => selectPoint(lat, lng));

  function resizeGlobe() {
    globe.width(container.clientWidth).height(container.clientHeight);
  }
  resizeGlobe();
  new ResizeObserver(resizeGlobe).observe(container);
  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.4;
  globe.pointOfView({ lat: 13.7, lng: -88.9, altitude: 2.2 });

  function selectPoint(lat, lng) {
    globe.controls().autoRotate = false;
    globe.pointsData([{ lat, lng }]);
    globe.pointOfView({ lat, lng }, 800);
    const coordinates = `Lat: ${lat.toFixed(4)}°, Lon: ${lng.toFixed(4)}°`;
    infoPanel.innerHTML = `<strong>${coordinates}</strong><br>Loading NASA POWER data...`;
    const currentRequest = ++requestId;
    fetchPowerData(lat, lng).then((result) => {
      if (currentRequest !== requestId) return;
      infoPanel.innerHTML = `<strong>${coordinates}</strong><br>` +
        `Last 30 days (NASA POWER):<br>` +
        `Average temperature at 2 m: ${result.temp} °C<br>` +
        `Accumulated precipitation: ${result.rain} mm`;
    }).catch(() => {
      if (currentRequest !== requestId) return;
      infoPanel.innerHTML = `<strong>${coordinates}</strong><br>NASA POWER data is unavailable.`;
    });
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  async function fetchPowerData(lat, lng) {
    const end = new Date(Date.now() - 3 * 86400000);
    const start = new Date(end.getTime() - 29 * 86400000);
    const url = 'https://power.larc.nasa.gov/api/temporal/daily/point' +
      '?parameters=T2M,PRECTOTCORR&community=AG' +
      `&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}` +
      `&start=${formatDate(start)}&end=${formatDate(end)}&format=JSON`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const parameters = data.properties.parameter;
    const temperatures = Object.values(parameters.T2M).filter((value) => value > -999);
    const rainfall = Object.values(parameters.PRECTOTCORR).filter((value) => value > -999);
    if (!temperatures.length) throw new Error('No data');
    const averageTemperature = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
    const totalRainfall = rainfall.reduce((sum, value) => sum + value, 0);
    return { temp: averageTemperature.toFixed(1), rain: totalRainfall.toFixed(1) };
  }
})();
