"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const PARTICLE_COUNT = 160;
const MAX_CONNECTIONS = 200;
const CONNECTION_DISTANCE = 2.8;
const DRIFT_SPEED = 0.0008;
const BOUNDS = 6;

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  risk: "critical" | "high" | "medium" | "low";
  phase: number;
}

function riskColor(r: Particle["risk"]): [number, number, number] {
  switch (r) {
    case "critical": return [0.95, 0.15, 0.15];
    case "high":     return [0.95, 0.55, 0.08];
    case "medium":   return [0.95, 0.85, 0.10];
    default:         return [0.30, 0.65, 1.00];
  }
}

function randomRisk(): Particle["risk"] {
  const r = Math.random();
  if (r < 0.04) return "critical";
  if (r < 0.22) return "high";
  if (r < 0.50) return "medium";
  return "low";
}

export function HeroCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Renderer ───────────────────────────────────────────────────────────
    const { clientWidth: W, clientHeight: H } = mount;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // ── Scene / Camera ─────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 9);

    // ── Particles ──────────────────────────────────────────────────────────
    const particles: Particle[] = [];
    const pPositions = new Float32Array(PARTICLE_COUNT * 3);
    const pColors    = new Float32Array(PARTICLE_COUNT * 3);
    const pSizes     = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const risk = randomRisk();
      const [r, g, b] = riskColor(risk);
      const p: Particle = {
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * BOUNDS * 2,
          (Math.random() - 0.5) * BOUNDS * 2,
          (Math.random() - 0.5) * BOUNDS * 1.2,
        ),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * DRIFT_SPEED * 2,
          (Math.random() - 0.5) * DRIFT_SPEED * 2,
          (Math.random() - 0.5) * DRIFT_SPEED * 0.5,
        ),
        risk,
        phase: Math.random() * Math.PI * 2,
      };
      particles.push(p);
      pPositions[i * 3]     = p.pos.x;
      pPositions[i * 3 + 1] = p.pos.y;
      pPositions[i * 3 + 2] = p.pos.z;
      pColors[i * 3]     = r;
      pColors[i * 3 + 1] = g;
      pColors[i * 3 + 2] = b;
      const riskSize = risk === "critical" ? 10 : risk === "high" ? 7 : risk === "medium" ? 5 : 4;
      pSizes[i] = riskSize;
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
    pGeo.setAttribute("color",    new THREE.BufferAttribute(pColors, 3));
    pGeo.setAttribute("size",     new THREE.BufferAttribute(pSizes, 1));

    // Circular sprite texture for glow effect
    const canvas2d = document.createElement("canvas");
    canvas2d.width = canvas2d.height = 64;
    const ctx = canvas2d.getContext("2d")!;
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0,   "rgba(255,255,255,1)");
    grd.addColorStop(0.3, "rgba(255,255,255,0.8)");
    grd.addColorStop(1,   "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(canvas2d);

    const pMat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: sprite,
    });
    const pointsMesh = new THREE.Points(pGeo, pMat);
    scene.add(pointsMesh);

    // ── Connection lines ───────────────────────────────────────────────────
    const linePositions = new Float32Array(MAX_CONNECTIONS * 2 * 3);
    const lineColors    = new Float32Array(MAX_CONNECTIONS * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute("color",    new THREE.BufferAttribute(lineColors, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const linesMesh = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(linesMesh);

    // ── Mouse parallax ─────────────────────────────────────────────────────
    const mouse = { x: 0, y: 0 };
    const targetRot = { x: 0, y: 0 };
    const currentRot = { x: 0, y: 0 };

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth  - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouseMove);

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // ── Animation loop ─────────────────────────────────────────────────────
    let frameId: number;
    let tick = 0;
    let lineCount = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      tick++;

      // Update particle positions (slow organic drift)
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particles[i];
        // Sinusoidal drift perturbation
        p.pos.x += p.vel.x + Math.sin(tick * 0.012 + p.phase) * 0.0003;
        p.pos.y += p.vel.y + Math.cos(tick * 0.009 + p.phase * 1.3) * 0.0003;
        p.pos.z += p.vel.z;
        // Soft boundary repulsion
        if (Math.abs(p.pos.x) > BOUNDS) p.vel.x *= -0.9;
        if (Math.abs(p.pos.y) > BOUNDS) p.vel.y *= -0.9;
        if (Math.abs(p.pos.z) > BOUNDS * 0.6) p.vel.z *= -0.9;

        pPositions[i * 3]     = p.pos.x;
        pPositions[i * 3 + 1] = p.pos.y;
        pPositions[i * 3 + 2] = p.pos.z;
      }
      pGeo.attributes.position.needsUpdate = true;

      // Rebuild connection lines every 3 frames
      if (tick % 3 === 0) {
        lineCount = 0;
        for (let i = 0; i < PARTICLE_COUNT && lineCount < MAX_CONNECTIONS; i++) {
          for (let j = i + 1; j < PARTICLE_COUNT && lineCount < MAX_CONNECTIONS; j++) {
            const dx = particles[i].pos.x - particles[j].pos.x;
            const dy = particles[i].pos.y - particles[j].pos.y;
            const dz = particles[i].pos.z - particles[j].pos.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < CONNECTION_DISTANCE) {
              const alpha = (1 - dist / CONNECTION_DISTANCE) * 0.6;
              const [r1, g1, b1] = riskColor(particles[i].risk);
              const [r2, g2, b2] = riskColor(particles[j].risk);
              const base = lineCount * 6;
              linePositions[base]     = particles[i].pos.x;
              linePositions[base + 1] = particles[i].pos.y;
              linePositions[base + 2] = particles[i].pos.z;
              linePositions[base + 3] = particles[j].pos.x;
              linePositions[base + 4] = particles[j].pos.y;
              linePositions[base + 5] = particles[j].pos.z;
              lineColors[base]     = r1 * alpha;
              lineColors[base + 1] = g1 * alpha;
              lineColors[base + 2] = b1 * alpha;
              lineColors[base + 3] = r2 * alpha;
              lineColors[base + 4] = g2 * alpha;
              lineColors[base + 5] = b2 * alpha;
              lineCount++;
            }
          }
        }
        lineGeo.setDrawRange(0, lineCount * 2);
        lineGeo.attributes.position.needsUpdate = true;
        lineGeo.attributes.color.needsUpdate = true;
      }

      // Smooth camera parallax
      targetRot.x = mouse.y * 0.12;
      targetRot.y = mouse.x * 0.18;
      currentRot.x += (targetRot.x - currentRot.x) * 0.04;
      currentRot.y += (targetRot.y - currentRot.y) * 0.04;
      scene.rotation.x = currentRot.x;
      scene.rotation.y = currentRot.y;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      pGeo.dispose();
      lineGeo.dispose();
      pMat.dispose();
      lineMat.dispose();
      sprite.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
