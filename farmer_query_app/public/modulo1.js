(function () {
  const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
  const LEYENDAS = 'https://gibs.earthdata.nasa.gov/legends/';

  // Datos tomados del catálogo WMTS de GIBS (GetCapabilities)
  const CAPAS = {
    temp: {
      capa: 'MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day',
      matriz: 'GoogleMapsCompatible_Level6', zoomNativo: 6,
      paso: 'mes', inicio: '2000-03', fin: '2026-10',
      leyenda: 'MODIS_Land_Surface_Temp_V.svg',
      desc: 'Temperatura superficial terrestre diurna, promedio mensual (MODIS Terra, nivel 3).',
      nota: 'Una imagen por mes.'
    },
    imerg: {
      capa: 'IMERG_Precipitation_Rate',
      matriz: 'GoogleMapsCompatible_Level6', zoomNativo: 6,
      paso: 'dia', inicio: '2000-06-01', fin: '2026-11-13',
      leyenda: 'GPM_Precipitation_Rate_V.svg',
      desc: 'Tasa de precipitación diaria (IMERG, misión GPM).',
      nota: 'Una imagen por día. Faltan algunas fechas.'
    },
    merra: {
      capa: 'MERRA2_Precipitation_Bias_Corrected_Monthly',
      matriz: 'GoogleMapsCompatible_Level6', zoomNativo: 6,
      paso: 'mes', inicio: '2000-06', fin: '2026-08',
      leyenda: 'MERRA2_Precipitation_Bias_Corrected_Monthly_V.svg',
      desc: 'Precipitación total corregida por sesgo, mensual (reanálisis MERRA-2).',
      nota: 'Una imagen por mes.'
    },
    evi: {
      capa: 'MODIS_Terra_L3_EVI_Monthly',
      matriz: 'GoogleMapsCompatible_Level7', zoomNativo: 7,
      paso: 'mes', inicio: '2000-03', fin: '2026-10',
      leyenda: 'MODIS_L3_EVI_V.svg',
      desc: 'Índice de vegetación mejorado (EVI), promedio mensual (MODIS Terra, nivel 3).',
      nota: 'Una imagen por mes. Falta abril de 2025.'
    },
    smap: {
      capa: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
      matriz: 'GoogleMapsCompatible_Level6', zoomNativo: 6,
      paso: 'dia', inicio: '2015-03-31', fin: '2026-11-10',
      leyenda: 'SMAP_Analyzed_Soil_Moisture_V.svg',
      desc: 'Humedad del suelo en la zona de raíces, modelo SMAP nivel 4 (instantánea de las 12 UTC).',
      nota: 'Una imagen por día. Faltan varias fechas.'
    }
  };

  const estado = {
    capaId: 'temp',
    indice: 0,
    punto: { lat: 13.7, lng: -88.9 }, // por defecto: centro de El Salvador
    puntoElegido: false
  };

  // ---------- Fechas ----------
  function totalPasos(c) {
    if (c.paso === 'mes') {
      const [y1, m1] = c.inicio.split('-').map(Number);
      const [y2, m2] = c.fin.split('-').map(Number);
      return (y2 - y1) * 12 + (m2 - m1);
    }
    return Math.round((Date.parse(c.fin) - Date.parse(c.inicio)) / 864e5);
  }

  function fechaDe(c, i) {
    if (c.paso === 'mes') {
      const [y, m] = c.inicio.split('-').map(Number);
      const n = m - 1 + i;
      const yy = y + Math.floor(n / 12);
      const mm = (n % 12) + 1;
      return `${yy}-${String(mm).padStart(2, '0')}-01`;
    }
    return new Date(Date.parse(c.inicio) + i * 864e5).toISOString().slice(0, 10);
  }

  function etiquetaDe(c, i) {
    const f = fechaDe(c, i);
    return c.paso === 'mes' ? f.slice(0, 7) : f;
  }

  // ---------- Mapa ----------
  const mapa = L.map('mapa').setView([13.7, -88.9], 5);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap'
  }).addTo(mapa);

  let capaActual = null;

  function urlCapa(c, fecha) {
    return `${BASE}/${c.capa}/default/${fecha}/${c.matriz}/{z}/{y}/{x}.png`;
  }

  // Leyenda
  const leyenda = L.control({ position: 'bottomright' });
  leyenda.onAdd = function () {
    const div = L.DomUtil.create('div', 'leyenda');
    div.innerHTML = '<img id="leyenda-img" alt="Leyenda">';
    return div;
  };
  leyenda.addTo(mapa);

  // Punto elegido
  let marcador = null;
  mapa.on('click', (e) => {
    const { lat, lng } = e.latlng;
    estado.punto = { lat, lng };
    estado.puntoElegido = true;
    document.getElementById('coords').textContent =
      `Lat: ${lat.toFixed(4)}°, Lon: ${lng.toFixed(4)}°`;
    if (marcador) marcador.remove();
    marcador = L.circleMarker([lat, lng], { radius: 6, color: '#d32f2f' }).addTo(mapa);
  });

  // ---------- Barra de tiempo ----------
  const slider = document.getElementById('slider');
  const etiqueta = document.getElementById('etiqueta');
  const botonPlay = document.getElementById('play');
  let espera = null;
  let timer = null;

  function parar() {
    clearInterval(timer);
    timer = null;
    botonPlay.innerHTML = '&#9654; Reproducir';
  }

  function mostrarFecha(i) {
    const c = CAPAS[estado.capaId];
    estado.indice = i;
    etiqueta.textContent = etiquetaDe(c, i);
    clearTimeout(espera);
    espera = setTimeout(() => {
      if (capaActual) capaActual.setUrl(urlCapa(c, fechaDe(c, i)));
    }, 150);
  }

  slider.addEventListener('input', () => mostrarFecha(Number(slider.value)));

  botonPlay.addEventListener('click', () => {
    if (timer) { parar(); return; }
    const c = CAPAS[estado.capaId];
    const max = totalPasos(c);
    botonPlay.innerHTML = '&#10074;&#10074; Pausar';
    if (Number(slider.value) >= max) slider.value = 0;
    timer = setInterval(() => {
      const sig = Number(slider.value) + 1;
      if (sig > max) { parar(); return; }
      slider.value = sig;
      mostrarFecha(sig);
    }, c.paso === 'mes' ? 1200 : 450);
  });

  // ---------- Cambio de variable ----------
  function elegirCapa(id) {
    parar();
    estado.capaId = id;
    const c = CAPAS[id];
    const max = totalPasos(c);

    slider.max = max;
    slider.value = max;
    estado.indice = max;
    etiqueta.textContent = etiquetaDe(c, max);

    if (capaActual) mapa.removeLayer(capaActual);
    capaActual = L.tileLayer(urlCapa(c, fechaDe(c, max)), {
      maxNativeZoom: c.zoomNativo,
      maxZoom: 12,
      opacity: 0.75,
      attribution: 'NASA GIBS'
    }).addTo(mapa);

    document.getElementById('leyenda-img').src = LEYENDAS + c.leyenda;
    document.getElementById('descripcion').innerHTML =
      `${c.desc}<small>${c.nota} Rango: ${etiquetaDe(c, 0)} a ${etiquetaDe(c, max)}.</small>`;
  }

  // ---------- Climograma (NASA POWER, climatología) ----------
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const CLAVES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  let grafica = null;
  let consulta = 0;
  const cache = {};

  async function datosClimatologia(lat, lng) {
    const clave = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (cache[clave]) return cache[clave];

    const url =
      'https://power.larc.nasa.gov/api/temporal/climatology/point' +
      '?parameters=T2M,PRECTOTCORR&community=AG' +
      `&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    const p = json.properties.parameter;

    const limpiar = (v) => (typeof v === 'number' && v > -999 ? v : null);
    const temp = CLAVES.map((k) => limpiar(p.T2M[k]));
    // PRECTOTCORR viene en mm/día; se convierte a mm/mes aproximado
    const lluvia = CLAVES.map((k, i) => {
      const v = limpiar(p.PRECTOTCORR[k]);
      return v === null ? null : v * DIAS[i];
    });

    cache[clave] = { temp, lluvia };
    return cache[clave];
  }

  async function mostrarGrafica() {
    const { lat, lng } = estado.punto;
    const titulo = document.getElementById('grafica-titulo');
    const nota = document.getElementById('grafica-nota');

    titulo.textContent = `Climograma · Lat ${lat.toFixed(3)}°, Lon ${lng.toFixed(3)}°`;
    nota.textContent = estado.puntoElegido
      ? 'Consultando NASA POWER...'
      : 'Punto por defecto (centro de El Salvador). Elige otro punto haciendo clic en cualquier mapa. Consultando NASA POWER...';

    const id = ++consulta;
    try {
      const d = await datosClimatologia(lat, lng);
      if (id !== consulta) return;

      if (grafica) grafica.destroy();
      grafica = new Chart(document.getElementById('climograma'), {
        data: {
          labels: MESES,
          datasets: [
            {
              type: 'bar',
              label: 'Precipitación (mm/mes, aprox.)',
              data: d.lluvia,
              yAxisID: 'yLluvia',
              backgroundColor: 'rgba(31, 58, 95, 0.55)'
            },
            {
              type: 'line',
              label: 'Temperatura media a 2 m (°C)',
              data: d.temp,
              yAxisID: 'yTemp',
              borderColor: '#c0392b',
              backgroundColor: '#c0392b',
              tension: 0.25
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            yLluvia: { position: 'left', beginAtZero: true, title: { display: true, text: 'mm/mes' } },
            yTemp: { position: 'right', title: { display: true, text: '°C' }, grid: { drawOnChartArea: false } }
          }
        }
      });

      nota.textContent =
        (estado.puntoElegido ? '' : 'Punto por defecto (centro de El Salvador). Elige otro punto haciendo clic en cualquier mapa. ') +
        'Promedios climatológicos mensuales de NASA POWER. La precipitación se convirtió de mm/día a mm/mes multiplicando por los días de cada mes.';
    } catch (err) {
      if (id !== consulta) return;
      nota.textContent = 'No se pudieron obtener datos de NASA POWER para este punto.';
    }
  }

  // ---------- Menú ----------
  const botones = document.querySelectorAll('.opcion');
  const vistaMapa = document.getElementById('vista-mapa');
  const vistaGrafica = document.getElementById('vista-grafica');

  botones.forEach((b) => {
    b.addEventListener('click', () => {
      botones.forEach((x) => x.classList.remove('activa'));
      b.classList.add('activa');

      if (b.dataset.vista === 'grafica') {
        parar();
        vistaMapa.hidden = true;
        vistaGrafica.hidden = false;
        mostrarGrafica();
      } else {
        vistaGrafica.hidden = true;
        vistaMapa.hidden = false;
        mapa.invalidateSize();
        elegirCapa(b.dataset.capa);
      }
    });
  });

  elegirCapa('temp');
})();
