"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

interface CallbackConstellationProps {
  callbacks: Record<string, boolean>;
  riskLevel?: string;
  poolCount?: number;
  className?: string;
}

const ALL_CALLBACKS = [
  "beforeInitialize", "afterInitialize",
  "beforeAddLiquidity", "afterAddLiquidity",
  "beforeRemoveLiquidity", "afterRemoveLiquidity",
  "beforeSwap", "afterSwap",
  "beforeDonate", "afterDonate",
  "beforeSwapReturnsDelta", "afterSwapReturnsDelta",
  "afterAddLiquidityReturnsDelta", "afterRemoveLiquidityReturnsDelta",
];

function riskToColor(risk: string): THREE.Color {
  switch (risk?.toUpperCase()) {
    case "CRITICAL": return new THREE.Color(0.95, 0.10, 0.10);
    case "HIGH":     return new THREE.Color(0.95, 0.52, 0.08);
    case "MEDIUM":   return new THREE.Color(0.90, 0.80, 0.10);
    default:         return new THREE.Color(0.30, 0.65, 1.00);
  }
}

// Evenly distribute N items over multiple orbit rings
interface PoolSatellite {
  angle: number;          // initial angle (radians)
  radius: number;         // orbit radius
  speed: number;          // radians/frame
  tilt: number;           // orbit plane tilt
  size: number;           // sphere radius
  color: THREE.Color;
}

function buildPoolSatellites(poolCount: number, centerColor: THREE.Color): PoolSatellite[] {
  if (poolCount === 0) return [];
  const satellites: PoolSatellite[] = [];
  // Cap display at 48 satellites; beyond that, scale sizes up instead
  const display = Math.min(poolCount, 48);

  // Decide how many rings: 1 ring ≤8, 2 rings ≤20, 3 rings for more
  const rings = display <= 8 ? 1 : display <= 20 ? 2 : 3;
  const perRing = Math.ceil(display / rings);

  const RING_PARAMS = [
    { radius: 0.65, speed: 0.012, tilt: 0.0,  size: 0.06 },
    { radius: 0.95, speed: 0.007, tilt: 0.45, size: 0.05 },
    { radius: 1.28, speed: 0.004, tilt: 0.85, size: 0.04 },
  ];

  let placed = 0;
  for (let r = 0; r < rings && placed < display; r++) {
    const inThisRing = Math.min(perRing, display - placed);
    const p = RING_PARAMS[r];
    for (let i = 0; i < inThisRing; i++) {
      const angle = (i / inThisRing) * Math.PI * 2;
      // Color: blend between center color and a soft blue/white
      const t = Math.random() * 0.4 + 0.2;
      const col = centerColor.clone().lerp(new THREE.Color(0.6, 0.85, 1.0), t);
      satellites.push({
        angle,
        radius: p.radius + (Math.random() - 0.5) * 0.12,
        speed: p.speed * (0.8 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1),
        tilt: p.tilt + (Math.random() - 0.5) * 0.3,
        size: p.size * (0.7 + Math.random() * 0.6),
        color: col,
      });
      placed++;
    }
  }
  return satellites;
}

export function CallbackConstellation({
  callbacks,
  riskLevel = "LOW",
  poolCount = 0,
  className = "",
}: CallbackConstellationProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.clientWidth  || 400;
    const H = mount.clientHeight || 400;

    // ── Renderer ───────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 100);
    camera.position.set(0, 0, 5.2);

    const centerColor = riskToColor(riskLevel);

    // ── Pool satellites ────────────────────────────────────────────────────
    const sats = buildPoolSatellites(poolCount, centerColor);
    const satMeshes: { mesh: THREE.Mesh; sat: PoolSatellite }[] = [];

    for (const sat of sats) {
      const geo = new THREE.SphereGeometry(sat.size, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: sat.color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);

      // Tiny halo
      const hGeo = new THREE.SphereGeometry(sat.size * 2.2, 6, 6);
      const hMat = new THREE.MeshBasicMaterial({
        color: sat.color,
        transparent: true,
        opacity: 0.10,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(hGeo, hMat);
      mesh.add(halo);

      satMeshes.push({ mesh, sat });
    }

    // Orbit ring decorations (one per ring in use)
    const ringCount = poolCount === 0 ? 0 : poolCount <= 8 ? 1 : poolCount <= 20 ? 2 : 3;
    const ringRadii = [0.65, 0.95, 1.28];
    const ringTilts = [0.0, 0.45, 0.85];
    for (let r = 0; r < ringCount; r++) {
      const rGeo = new THREE.TorusGeometry(ringRadii[r], 0.004, 4, 90);
      const rMat = new THREE.MeshBasicMaterial({
        color: 0x1e293b,
        transparent: true,
        opacity: 0.35,
      });
      const ring = new THREE.Mesh(rGeo, rMat);
      ring.rotation.x = ringTilts[r];
      scene.add(ring);
    }

    // ── Center orb (the hook) ──────────────────────────────────────────────
    // Scale orb slightly with pool count
    const orbScale = 1 + Math.min(poolCount, 50) * 0.003;
    const orbGeo  = new THREE.SphereGeometry(0.20 * orbScale, 32, 32);
    const orbMat  = new THREE.MeshBasicMaterial({ color: centerColor, transparent: true, opacity: 0.9 });
    const orb     = new THREE.Mesh(orbGeo, orbMat);
    scene.add(orb);

    // Glow rings
    const ringGeo = new THREE.TorusGeometry(0.33 * orbScale, 0.022, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: centerColor, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    scene.add(ringMesh);

    const ring2Geo = new THREE.TorusGeometry(0.50 * orbScale, 0.010, 8, 48);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: centerColor, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending });
    const ring2Mesh = new THREE.Mesh(ring2Geo, ring2Mat);
    scene.add(ring2Mesh);

    // ── Pool count label (texture sprite) ─────────────────────────────────
    // Render the pool count as a sprite above the hub
    if (poolCount > 0) {
      const canvas2d = document.createElement("canvas");
      canvas2d.width = 128; canvas2d.height = 48;
      const ctx = canvas2d.getContext("2d")!;
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillRect(0, 0, 128, 48);
      ctx.font = "bold 20px monospace";
      ctx.fillStyle = `rgba(${centerColor.r*255|0},${centerColor.g*255|0},${centerColor.b*255|0},0.9)`;
      ctx.textAlign = "center";
      ctx.fillText(`${poolCount} pool${poolCount !== 1 ? "s" : ""}`, 64, 32);
      const tex = new THREE.CanvasTexture(canvas2d);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75 });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(1.2, 0.45, 1);
      sprite.position.set(0, 0.55, 0);
      scene.add(sprite);
    }

    // ── Ambient starfield ──────────────────────────────────────────────────
    const starCount = 100;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i*3]     = (Math.random() - 0.5) * 10;
      starPos[i*3 + 1] = (Math.random() - 0.5) * 10;
      starPos[i*3 + 2] = (Math.random() - 0.5) * 10 - 3;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.022, transparent: true, opacity: 0.20, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(starGeo, starMat));

    // ── Callback nodes (outer rings) ───────────────────────────────────────
    const n = ALL_CALLBACKS.length;
    const nodeMeshes: THREE.Mesh[] = [];

    for (let i = 0; i < n; i++) {
      const name   = ALL_CALLBACKS[i];
      const active = callbacks[name] === true;
      const isDelta = name.includes("ReturnsDelta");

      const isInner = i % 2 === 0;
      const idx     = Math.floor(i / 2);
      const total   = Math.ceil(n / 2);
      const angle   = (idx / total) * Math.PI * 2;
      const radius  = isInner ? 1.62 : 2.35;

      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = isInner ? 0.18 : -0.18;
      const nodePos = new THREE.Vector3(x, y, z);

      const size = active ? 0.11 : 0.048;
      const color = active
        ? isDelta ? new THREE.Color(1, 0.4, 0.05) : new THREE.Color(0.35, 0.75, 1)
        : new THREE.Color(0.18, 0.20, 0.25);

      const nGeo = new THREE.SphereGeometry(size, 16, 16);
      const nMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: active ? 0.95 : 0.30,
        blending: active ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(nGeo, nMat);
      mesh.position.copy(nodePos);
      scene.add(mesh);
      nodeMeshes.push(mesh);

      if (active) {
        const haloGeo = new THREE.SphereGeometry(size * 2.4, 10, 10);
        const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.copy(nodePos);
        scene.add(halo);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), nodePos]);
        const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending });
        scene.add(new THREE.Line(lineGeo, lineMat));
      }
    }

    // Callback orbit ring decorations
    const cb1Geo = new THREE.TorusGeometry(1.62, 0.005, 4, 80);
    scene.add(new THREE.Mesh(cb1Geo, new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.25 })));
    const cb2Geo = new THREE.TorusGeometry(2.35, 0.005, 4, 110);
    scene.add(new THREE.Mesh(cb2Geo, new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.18 })));

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!mount) return;
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // ── Mouse orbit drag ───────────────────────────────────────────────────
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let rotY = 0, rotX = 0.2;
    let autoRotate = true;

    const onMouseDown = (e: MouseEvent) => { isDragging = true; autoRotate = false; prevMouse = { x: e.clientX, y: e.clientY }; };
    const onMouseUp   = () => { isDragging = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      rotY += (e.clientX - prevMouse.x) * 0.01;
      rotX += (e.clientY - prevMouse.y) * 0.005;
      rotX = Math.max(-0.9, Math.min(0.9, rotX));
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    mount.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);

    // Touch support
    const onTouchStart = (e: TouchEvent) => { isDragging = true; autoRotate = false; prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const onTouchEnd   = () => { isDragging = false; };
    const onTouchMove  = (e: TouchEvent) => {
      if (!isDragging) return;
      rotY += (e.touches[0].clientX - prevMouse.x) * 0.01;
      rotX += (e.touches[0].clientY - prevMouse.y) * 0.005;
      rotX = Math.max(-0.9, Math.min(0.9, rotX));
      prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    mount.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    // ── Animation ──────────────────────────────────────────────────────────
    let frameId: number;
    let tick = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      tick++;

      if (autoRotate) rotY += 0.0035;
      scene.rotation.y = rotY;
      scene.rotation.x = rotX;

      // Pulsing center orb
      const pulse = 0.85 + Math.sin(tick * 0.05) * 0.15;
      orb.scale.setScalar(pulse);
      orbMat.opacity = 0.7 + Math.sin(tick * 0.05) * 0.2;
      ringMesh.rotation.z  += 0.007;
      ring2Mesh.rotation.z -= 0.003;
      ringMat.opacity  = 0.30 + Math.sin(tick * 0.04) * 0.18;

      // Animate pool satellites along their orbits
      for (const { mesh, sat } of satMeshes) {
        sat.angle += sat.speed;
        const x = Math.cos(sat.angle) * sat.radius;
        const z = Math.sin(sat.angle) * sat.radius;
        // Apply orbit tilt
        const y = Math.sin(sat.tilt) * z;
        mesh.position.set(x, y, Math.cos(sat.tilt) * z);
        // Subtle pulse
        const s = 0.85 + Math.sin(tick * 0.07 + sat.angle) * 0.18;
        mesh.scale.setScalar(s);
      }

      // Pulse active callback nodes
      nodeMeshes.forEach((mesh, i) => {
        const name = ALL_CALLBACKS[i];
        if (callbacks[name]) {
          const s = 0.88 + Math.sin(tick * 0.06 + i * 0.9) * 0.14;
          mesh.scale.setScalar(s);
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchmove", onTouchMove);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [callbacks, riskLevel, poolCount]);

  return (
    <div
      ref={mountRef}
      className={`cursor-grab active:cursor-grabbing ${className}`}
      style={{ userSelect: "none" }}
    />
  );
}
