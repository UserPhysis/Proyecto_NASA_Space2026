(function bootThreeGlobe() {
  if (typeof THREE === "undefined") { window.setTimeout(bootThreeGlobe, 200); return; }
  const container = document.getElementById("globo");
  if (!container || container.dataset.threeReady === "true") return;
  container.dataset.threeReady = "true";
  container.innerHTML = "";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.z = 3.05;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.setAttribute("aria-label", "Interactive 3D Earth");
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;cursor:grab";
  container.appendChild(renderer.domElement);

  const earthMaterial = new THREE.MeshPhongMaterial({ color: 0x2f78ad, shininess: 7, specular: 0x223344 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMaterial);
  scene.add(earth);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 48), new THREE.MeshBasicMaterial({ color: 0x4d9fff, transparent: true, opacity: 0, side: THREE.BackSide }));
  scene.add(atmosphere);
  scene.add(new THREE.AmbientLight(0xd8ecff, 1.45));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(-3, 2, 4); scene.add(sun);

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load("https://unpkg.com/three-globe@2.41.12/example/img/earth-blue-marble.jpg", (texture) => { texture.colorSpace = THREE.SRGBColorSpace; earthMaterial.map = texture; earthMaterial.color.set(0xffffff); earthMaterial.needsUpdate = true; });
  textureLoader.load("https://unpkg.com/three-globe@2.41.12/example/img/earth-topology.png", (relief) => { relief.colorSpace = THREE.NoColorSpace; earthMaterial.bumpMap = relief; earthMaterial.bumpScale = 0.18; earthMaterial.displacementMap = relief; earthMaterial.displacementScale = 0.02; earthMaterial.needsUpdate = true; });

  // ---------- Pin 3D: es HIJO de `earth`, así rota exactamente con el globo ----------
  const PIN_R = 1.03; // un poco por encima del relieve (displacementScale = 0.02)
  const pin = new THREE.Group(); pin.visible = false; earth.add(pin);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 20, 20), new THREE.MeshBasicMaterial({ color: 0xed4c4c }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.027, 20, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.037, 40), new THREE.MeshBasicMaterial({ color: 0xed4c4c, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  pin.add(halo, dot, ring);

  // lat/lng -> vector local; coincide con SphereGeometry + textura equirectangular estándar
  function toVec3(lat, lng, r) {
    const la = lat * Math.PI / 180, lo = lng * Math.PI / 180;
    return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
  }

  let dragging = false; let lastX = 0; let lastY = 0; let velocity = 0; let tiltVelocity = 0; let targetRotation = -1.1; let targetTilt = 0.12; let pauseUntil = 0;

  function focus(lat, lng, immediate) {
    const a = -lng * Math.PI / 180 - Math.PI / 2;               // lleva ese meridiano al frente
    let d = (a - targetRotation) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; // camino más corto
    targetRotation += d;
    targetTilt = Math.max(-0.85, Math.min(0.85, lat * Math.PI / 180));
    velocity = 0; tiltVelocity = 0; pauseUntil = performance.now() + 5000;
    if (immediate) { earth.rotation.y = targetRotation; earth.rotation.x = targetTilt; }
  }
  function setPin(lat, lng, doFocus) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pin.position.copy(toVec3(lat, lng, PIN_R));
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pin.position.clone().normalize());
    pin.visible = true;
    if (doFocus) focus(lat, lng, false);
  }
  window.earthGlobe = { setPin: (lat, lng, doFocus = true) => setPin(lat, lng, doFocus) };

  // ---------- Clic -> lat/lng reales con raycast (corrige la rotación) ----------
  const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  function pick(event) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObject(earth, false)[0];
    if (!hit) return;
    earth.updateMatrixWorld();
    const p = earth.worldToLocal(hit.point.clone()).normalize();
    const lat = Math.asin(p.y) * 180 / Math.PI;
    let phi = Math.atan2(p.z, -p.x) * 180 / Math.PI; if (phi < 0) phi += 360;
    const lng = phi - 180;
    setPin(lat, lng, false);                    // el pin aparece en el mismo instante
    pauseUntil = performance.now() + 4000;      // pausa la auto-rotación un momento
    window.dispatchEvent(new CustomEvent("earth:pick", { detail: { lat, lng } }));
  }

  renderer.domElement.addEventListener("pointerdown", (event) => { dragging = true; container.dataset.dragged = "false"; lastX = event.clientX; lastY = event.clientY; velocity = 0; tiltVelocity = 0; renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = "grabbing"; });
  renderer.domElement.addEventListener("pointermove", (event) => { if (!dragging) return; const deltaX = event.clientX - lastX; const deltaY = event.clientY - lastY; if (Math.hypot(deltaX, deltaY) > 2) container.dataset.dragged = "true"; targetRotation += deltaX * 0.008; targetTilt = Math.max(-0.85, Math.min(0.85, targetTilt + deltaY * 0.006)); velocity = deltaX * 0.008; tiltVelocity = deltaY * 0.006; lastX = event.clientX; lastY = event.clientY; });
  renderer.domElement.addEventListener("pointerup", (event) => { const wasDrag = container.dataset.dragged === "true"; dragging = false; if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId); renderer.domElement.style.cursor = "grab"; if (!wasDrag) pick(event); });
  renderer.domElement.addEventListener("pointercancel", () => { dragging = false; renderer.domElement.style.cursor = "grab"; });
  renderer.domElement.addEventListener("wheel", (event) => { event.preventDefault(); camera.position.z = Math.max(2.25, Math.min(4.2, camera.position.z + event.deltaY * 0.0015)); }, { passive: false });
  function resize() { const width = container.clientWidth; const height = container.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(container); resize();

  function animate() {
    requestAnimationFrame(animate);
    const paused = performance.now() < pauseUntil;
    if (!dragging) { targetRotation += (paused ? 0 : 0.0014) + velocity * 0.08; targetTilt = Math.max(-0.85, Math.min(0.85, targetTilt + tiltVelocity * 0.08)); }
    velocity *= 0.94; tiltVelocity *= 0.94;
    earth.rotation.y += (targetRotation - earth.rotation.y) * 0.08; earth.rotation.x += (targetTilt - earth.rotation.x) * 0.08;
    atmosphere.rotation.y = earth.rotation.y; atmosphere.rotation.x = earth.rotation.x;
    const k = (performance.now() % 1800) / 1800; ring.scale.setScalar(1 + k * 2.2); ring.material.opacity = 0.8 * (1 - k);
    renderer.render(scene, camera);
  }

  // pin inicial (El Salvador, igual que initialPoint en page.tsx)
  const iLat = Number(container.dataset.pinLat), iLng = Number(container.dataset.pinLng);
  const sLat = Number.isFinite(iLat) && container.dataset.pinLat ? iLat : 14.1606;
  const sLng = Number.isFinite(iLng) && container.dataset.pinLng ? iLng : -89.0058;
  setPin(sLat, sLng, false); focus(sLat, sLng, true);
  animate();
})();