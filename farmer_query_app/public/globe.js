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
  renderer.toneMappingExposure = 1;
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
  let dragging = false; let lastX = 0; let lastY = 0; let velocity = 0; let tiltVelocity = 0; let targetRotation = -1.1; let targetTilt = 0.12;
  renderer.domElement.addEventListener("pointerdown", (event) => { dragging = true; container.dataset.dragged = "false"; lastX = event.clientX; lastY = event.clientY; velocity = 0; tiltVelocity = 0; renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = "grabbing"; });
  renderer.domElement.addEventListener("pointermove", (event) => { if (!dragging) return; const deltaX = event.clientX - lastX; const deltaY = event.clientY - lastY; if (Math.hypot(deltaX, deltaY) > 2) container.dataset.dragged = "true"; targetRotation += deltaX * 0.008; targetTilt = Math.max(-0.85, Math.min(0.85, targetTilt + deltaY * 0.006)); velocity = deltaX * 0.008; tiltVelocity = deltaY * 0.006; lastX = event.clientX; lastY = event.clientY; });
  renderer.domElement.addEventListener("pointerup", (event) => { dragging = false; if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId); renderer.domElement.style.cursor = "grab"; });
  renderer.domElement.addEventListener("pointercancel", () => { dragging = false; renderer.domElement.style.cursor = "grab"; });
  renderer.domElement.addEventListener("wheel", (event) => { event.preventDefault(); camera.position.z = Math.max(2.25, Math.min(4.2, camera.position.z + event.deltaY * 0.0015)); }, { passive: false });
  function resize() { const width = container.clientWidth; const height = container.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(container); resize();
  function updatePinProjection() { const lat = Number(container.dataset.pinLat); const lng = Number(container.dataset.pinLng); if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; const latitude = lat * Math.PI / 180; const longitude = lng * Math.PI / 180; const baseX = Math.cos(latitude) * Math.cos(longitude); const baseY = Math.sin(latitude); const baseZ = Math.cos(latitude) * Math.sin(longitude); const angle = earth.rotation.y; const x = Math.cos(angle) * baseX + Math.sin(angle) * baseZ; const rotatedZ = -Math.sin(angle) * baseX + Math.cos(angle) * baseZ; const tilt = earth.rotation.x; const y = Math.cos(tilt) * baseY - Math.sin(tilt) * rotatedZ; const z = Math.sin(tilt) * baseY + Math.cos(tilt) * rotatedZ; const detail = { x: 50 + x * 44, y: 50 - y * 44, visible: z > -0.08 }; const pin = document.querySelector(".home-pin"); if (pin) { pin.style.left = detail.x + "%"; pin.style.top = detail.y + "%"; pin.style.opacity = detail.visible ? "1" : "0"; } window.dispatchEvent(new CustomEvent("earth:pin-position", { detail })); }
  function animate() { requestAnimationFrame(animate); if (!dragging) { targetRotation += 0.0014 + velocity * 0.08; targetTilt = Math.max(-0.85, Math.min(0.85, targetTilt + tiltVelocity * 0.08)); } velocity *= 0.94; tiltVelocity *= 0.94; earth.rotation.y += (targetRotation - earth.rotation.y) * 0.08; earth.rotation.x += (targetTilt - earth.rotation.x) * 0.08; atmosphere.rotation.y = earth.rotation.y; atmosphere.rotation.x = earth.rotation.x; updatePinProjection(); renderer.render(scene, camera); }
  animate();
})();
