/**
 * my-jarvis–style holographic particle sphere (JarvisScene-inspired).
 * Bridge: window.setOrbState(state: string)
 *         window.setWeather({ tempLabel, icon, label, place })
 */
(function () {
  "use strict";

  if (typeof THREE === "undefined") {
    console.error("THREE failed to load");
    return;
  }

  // Motion stays calm; activity shows as glow / soft voice pulse, not spinning.
  const STATES = {
    idle: { energy: 0.25, spin: 0.06, bloom: 0.45, breath: 0.22, voice: 0 },
    connecting: { energy: 0.32, spin: 0.07, bloom: 0.55, breath: 0.26, voice: 0 },
    armed: { energy: 0.4, spin: 0.07, bloom: 0.65, breath: 0.28, voice: 0 },
    ack: { energy: 0.55, spin: 0.07, bloom: 0.95, breath: 0.3, voice: 0.35 },
    processing: { energy: 0.55, spin: 0.07, bloom: 1.05, breath: 0.28, voice: 0.2 },
    listening: { energy: 0.55, spin: 0.08, bloom: 0.85, breath: 0.4, voice: 0.25 },
    speaking: { energy: 0.7, spin: 0.07, bloom: 1.15, breath: 0.32, voice: 1.0 },
  };

  const canvas = document.getElementById("c");
  const stateTag = document.getElementById("stateTag");
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 8);

  const root = new THREE.Group();
  scene.add(root);

  scene.add(new THREE.AmbientLight(0x111111, 0.35));
  const key = new THREE.PointLight(0x00e5b0, 2.0, 30);
  key.position.set(5, 5, 5);
  scene.add(key);
  const fill = new THREE.PointLight(0x00aa77, 1.0, 30);
  fill.position.set(-5, -5, 5);
  scene.add(fill);

  function makeParticleSphere(radius, count) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c1 = new THREE.Color(0x00e5b0);
    const c2 = new THREE.Color(0x00cc99);
    const dirs = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const radii = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius * (0.85 + Math.random() * 0.3);
      const sinPhi = Math.sin(phi);
      const dx = sinPhi * Math.cos(theta);
      const dy = sinPhi * Math.sin(theta);
      const dz = Math.cos(phi);
      dirs[i * 3] = dx;
      dirs[i * 3 + 1] = dy;
      dirs[i * 3 + 2] = dz;
      radii[i] = r;
      positions[i * 3] = dx * r;
      positions[i * 3 + 1] = dy * r;
      positions[i * 3 + 2] = dz * r;

      const mixed = c1.clone().lerp(c2, Math.random());
      colors[i * 3] = mixed.r;
      colors[i * 3 + 1] = mixed.g;
      colors[i * 3 + 2] = mixed.b;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();

    const mat = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData = { dirs: dirs, radii: radii, phases: phases, baseRadius: radius };
    return pts;
  }

  const sphere = makeParticleSphere(2.5, 10000);
  root.add(sphere);

  // Inner glow shell
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 64, 64),
    new THREE.MeshBasicMaterial({
      color: 0x005544,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    })
  );
  root.add(glow);

  // Soft core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0x00ffd4,
      transparent: true,
      opacity: 0.22,
    })
  );
  root.add(core);

  function makeOrbitalRing(radius, color, speed, tilt) {
    const group = new THREE.Group();
    group.rotation.x = tilt;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.015, 16, 100),
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.55,
      })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const spinner = new THREE.Group();
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    bead.position.set(radius, 0, 0);
    const beadGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 24, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0.3,
      })
    );
    beadGlow.position.set(radius, 0, 0);
    spinner.add(bead);
    spinner.add(beadGlow);
    group.add(spinner);

    group.userData = { spinner: spinner, speed: speed };
    return group;
  }

  function drawWeatherBadge(ctx, size, weather) {
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.42;
    ctx.clearRect(0, 0, size, size);

    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    grad.addColorStop(0, "rgba(0, 60, 48, 0.95)");
    grad.addColorStop(1, "rgba(0, 12, 10, 0.92)");
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 229, 176, 0.95)";
    ctx.lineWidth = size * 0.028;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 229, 176, 0.28)";
    ctx.lineWidth = size * 0.01;
    ctx.stroke();

    const icon = (weather && weather.icon) || "·";
    const temp = (weather && weather.tempLabel) || "--°";
    const place = (weather && weather.place) || "";

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#00e5b0";
    ctx.shadowColor = "rgba(0, 229, 176, 0.7)";
    ctx.shadowBlur = size * 0.04;

    const iconIsGlyph = icon.length <= 2;
    ctx.font = iconIsGlyph
      ? "bold " + Math.round(size * 0.22) + "px sans-serif"
      : "600 " + Math.round(size * 0.09) + "px Orbitron, sans-serif";
    ctx.fillText(icon, cx, cy - size * (iconIsGlyph ? 0.1 : 0.12));

    ctx.font = "800 " + Math.round(size * 0.16) + "px Orbitron, sans-serif";
    ctx.fillText(temp, cx, cy + size * (iconIsGlyph ? 0.12 : 0.06));

    if (place) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0, 204, 153, 0.75)";
      ctx.font = "600 " + Math.round(size * 0.055) + "px Orbitron, sans-serif";
      const short =
        place.length > 14 ? place.slice(0, 12).trim() + "…" : place;
      ctx.fillText(short.toUpperCase(), cx, cy + size * 0.28);
    }
    ctx.shadowBlur = 0;
  }

  function makeWeatherSatellite(radius, speed, tilt) {
    const group = new THREE.Group();
    group.rotation.x = tilt;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.018, 16, 120),
      new THREE.MeshBasicMaterial({
        color: 0x00e5b0,
        transparent: true,
        opacity: 0.45,
      })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const badgeSize = 256;
    const badgeCanvas = document.createElement("canvas");
    badgeCanvas.width = badgeSize;
    badgeCanvas.height = badgeSize;
    const badgeCtx = badgeCanvas.getContext("2d");
    drawWeatherBadge(badgeCtx, badgeSize, null);
    const tex = new THREE.CanvasTexture(badgeCanvas);
    tex.needsUpdate = true;

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.0,
      })
    );
    sprite.scale.set(1.55, 1.55, 1);
    sprite.position.set(radius, 0, 0);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 24),
      new THREE.MeshBasicMaterial({
        color: 0x00e5b0,
        transparent: true,
        opacity: 0.0,
      })
    );
    halo.position.set(radius, 0, 0);

    const spinner = new THREE.Group();
    spinner.add(halo);
    spinner.add(sprite);
    group.add(spinner);
    group.visible = false;

    group.userData = {
      spinner: spinner,
      speed: speed,
      badgeCanvas: badgeCanvas,
      badgeCtx: badgeCtx,
      badgeSize: badgeSize,
      tex: tex,
      sprite: sprite,
      halo: halo,
      ready: false,
    };
    return group;
  }

  const weatherRing = makeWeatherSatellite(3.5, 0.28, 0.3);
  const ringB = makeOrbitalRing(4.0, 0xaaaaaa, -0.22, -0.5);
  root.add(weatherRing);
  root.add(ringB);

  let target = Object.assign({}, STATES.idle);
  let current = Object.assign({}, STATES.idle);
  let stateName = "idle";
  const t0 = performance.now();

  window.setOrbState = function setOrbState(state) {
    const key = String(state || "idle").toLowerCase();
    stateName = key;
    target = Object.assign({}, STATES[key] || STATES.idle);
    if (stateTag) {
      stateTag.textContent = key;
      const listening = key === "listening";
      const speaking = key === "speaking";
      const busy = key === "processing" || key === "ack";
      const color = listening ? "#ff4444" : speaking ? "#00e5b0" : busy ? "#ffaa00" : "#00e5b0";
      stateTag.style.color = color;
      stateTag.style.borderColor = color;
      stateTag.style.background = listening
        ? "rgba(255,68,68,0.18)"
        : speaking
          ? "rgba(0,229,176,0.12)"
          : busy
            ? "rgba(255,170,0,0.15)"
            : "rgba(0,229,176,0.12)";
    }
  };

  window.setWeather = function setWeather(payload) {
    const data = payload && typeof payload === "object" ? payload : null;
    const ud = weatherRing.userData;
    if (!data || (!data.tempLabel && data.tempC == null)) {
      ud.ready = false;
      weatherRing.visible = false;
      ud.sprite.material.opacity = 0;
      ud.halo.material.opacity = 0;
      return;
    }
    const weather = {
      tempLabel:
        data.tempLabel ||
        (typeof data.tempC === "number"
          ? (data.tempC > 0 ? "+" : "") + Math.round(data.tempC) + "°"
          : "--°"),
      icon: data.icon || "·",
      label: data.label || "",
      place: data.place || "",
    };
    drawWeatherBadge(ud.badgeCtx, ud.badgeSize, weather);
    ud.tex.needsUpdate = true;
    ud.ready = true;
    weatherRing.visible = true;
    ud.sprite.material.opacity = 0.95;
    ud.halo.material.opacity = 0.22;
  };

  function ease(a, b, k) {
    return a + (b - a) * k;
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth || 640);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight || 480);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", resize);
  resize();

  function pulseSphere(pts, time, energy, voice) {
    const pos = pts.geometry.attributes.position;
    const arr = pos.array;
    const dirs = pts.userData.dirs;
    const radii = pts.userData.radii;
    const phases = pts.userData.phases;
    const count = pos.count;
    // Soft shell shimmer + gentle speech envelope (no chaotic multi-freq thrash).
    const voiceWave =
      voice > 0.01
        ? 0.012 * voice * (0.55 + 0.45 * Math.sin(time * Math.PI * 2 * 3.2)) +
          0.006 * voice * Math.sin(time * Math.PI * 2 * 5.1)
        : 0;
    for (let i = 0; i < count; i++) {
      const phase = phases[i];
      const shimmer = 0.012 * energy * Math.sin(time * 0.9 + phase);
      const n = 1 + shimmer + voiceWave * (0.7 + 0.3 * Math.sin(phase));
      const u = radii[i] * n;
      const ix = i * 3;
      arr[ix] = dirs[ix] * u;
      arr[ix + 1] = dirs[ix + 1] * u;
      arr[ix + 2] = dirs[ix + 2] * u;
    }
    pos.needsUpdate = true;
    if (!pts.geometry.boundingSphere) {
      pts.geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(),
        pts.userData.baseRadius * 1.35
      );
    } else {
      pts.geometry.boundingSphere.radius = pts.userData.baseRadius * 1.35;
    }
  }

  function frame(now) {
    const elapsed = (now - t0) / 1000;
    // Slow easing → no snap when state flips.
    const k = 0.045;
    current.energy = ease(current.energy, target.energy, k);
    current.spin = ease(current.spin, target.spin, k);
    current.bloom = ease(current.bloom, target.bloom, k);
    current.breath = ease(current.breath, target.breath, k);
    current.voice = ease(current.voice || 0, target.voice || 0, k);

    // Calm living breath (tiny). Speaking adds a soft voice bob, not a shake.
    const breathAmp = 0.012 + 0.01 * current.energy;
    const voiceBob =
      current.voice > 0.01
        ? 0.01 * current.voice * Math.sin(elapsed * Math.PI * 2 * 2.8)
        : 0;
    const breath =
      1 +
      breathAmp * Math.sin(elapsed * Math.PI * 2 * current.breath) +
      voiceBob;

    sphere.rotation.y = elapsed * current.spin;
    sphere.rotation.x = Math.sin(elapsed * 0.04) * 0.04;
    root.scale.setScalar(breath);

    pulseSphere(sphere, elapsed, current.energy, current.voice);

    weatherRing.userData.spinner.rotation.z =
      elapsed * weatherRing.userData.speed * 0.35;
    ringB.userData.spinner.rotation.z = elapsed * ringB.userData.speed * 0.35;
    weatherRing.rotation.y = elapsed * 0.08;
    ringB.rotation.y = -elapsed * 0.06;

    // Activity reads as light, not motion.
    glow.material.opacity = 0.12 + 0.08 * current.energy + 0.06 * current.voice;
    core.material.opacity = 0.16 + 0.12 * current.energy + 0.14 * current.voice;
    key.intensity = 1.3 + current.bloom * 0.7 + current.voice * 0.35;
    renderer.toneMappingExposure = 1.05 + current.bloom * 0.12 + current.voice * 0.08;

    // Stable camera — no push/pull with energy.
    camera.position.z = 8;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  window.orbReady = true;
  requestAnimationFrame(frame);
})();
