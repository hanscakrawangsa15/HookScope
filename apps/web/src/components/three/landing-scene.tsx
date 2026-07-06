"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const PARTICLE_COUNT = 220;
const MAX_CONNECTIONS = 260;
const CONNECTION_DISTANCE = 3.2;
const DRIFT_SPEED = 0.0006;
const BOUNDS = 9;

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  phase: number;
}

const ACCENT: [number, number, number][] = [
  [0.30, 0.65, 1.00], // blue
  [0.66, 0.45, 1.00], // purple
  [0.30, 0.85, 0.65], // teal
];

function pickAccent(): [number, number, number] {
  return ACCENT[Math.floor(Math.random() * ACCENT.length)];
}

export function LandingScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── Renderer ───────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // ── Scene / Camera ─────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 13);

    // ── Hook-knot core (wireframe torus knot, evokes interlocking hooks) ────
    const knotGeo = new THREE.TorusKnotGeometry(2.6, 0.7, 140, 12, 2, 3);
    const knotMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
    });
    const knot = new THREE.Mesh(knotGeo, knotMat);
    scene.add(knot);

    // ── Particle network ──────────────────────────────────────────────────
    const particles: Particle[] = [];
    const pPositions = new Float32Array(PARTICLE_COUNT * 3);
    const pColors    = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const [r, g, b] = pickAccent();
      const p: Particle = {
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * BOUNDS * 2,
          (Math.random() - 0.5) * BOUNDS * 2,
          (Math.random() - 0.5) * BOUNDS * 1.4,
        ),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * DRIFT_SPEED * 2,
          (Math.random() - 0.5) * DRIFT_SPEED * 2,
          (Math.random() - 0.5) * DRIFT_SPEED * 0.5,
        ),
        phase: Math.random() * Math.PI * 2,
      };
      particles.push(p);
      pPositions[i * 3]     = p.pos.x;
      pPositions[i * 3 + 1] = p.pos.y;
      pPositions[i * 3 + 2] = p.pos.z;
      pColors[i * 3]     = r;
      pColors[i * 3 + 1] = g;
      pColors[i * 3 + 2] = b;
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
    pGeo.setAttribute("color",    new THREE.BufferAttribute(pColors, 3));

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
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: sprite,
    });
    const pointsMesh = new THREE.Points(pGeo, pMat);
    scene.add(pointsMesh);

    const linePositions = new Float32Array(MAX_CONNECTIONS * 2 * 3);
    const lineColors    = new Float32Array(MAX_CONNECTIONS * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute("color",    new THREE.BufferAttribute(lineColors, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
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

    // ── Scroll-linked camera dolly ───────────────────────────────────────
    let scrollProgress = 0;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // ── Pause when tab hidden ────────────────────────────────────────────
    let paused = false;
    const onVisibility = () => { paused = document.hidden; };
    document.addEventListener("visibilitychange", onVisibility);

    // ── Animation loop ─────────────────────────────────────────────────────
    let frameId: number;
    let tick = 0;
    let lineCount = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (paused) return;
      tick++;

      const driftScale = reducedMotion ? 0.15 : 1;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particles[i];
        p.pos.x += (p.vel.x + Math.sin(tick * 0.01 + p.phase) * 0.0003) * driftScale;
        p.pos.y += (p.vel.y + Math.cos(tick * 0.008 + p.phase * 1.3) * 0.0003) * driftScale;
        p.pos.z += p.vel.z * driftScale;
        if (Math.abs(p.pos.x) > BOUNDS) p.vel.x *= -0.9;
        if (Math.abs(p.pos.y) > BOUNDS) p.vel.y *= -0.9;
        if (Math.abs(p.pos.z) > BOUNDS * 0.7) p.vel.z *= -0.9;
        pPositions[i * 3]     = p.pos.x;
        pPositions[i * 3 + 1] = p.pos.y;
        pPositions[i * 3 + 2] = p.pos.z;
      }
      pGeo.attributes.position.needsUpdate = true;

      if (tick % 3 === 0) {
        lineCount = 0;
        for (let i = 0; i < PARTICLE_COUNT && lineCount < MAX_CONNECTIONS; i++) {
          for (let j = i + 1; j < PARTICLE_COUNT && lineCount < MAX_CONNECTIONS; j++) {
            const dx = particles[i].pos.x - particles[j].pos.x;
            const dy = particles[i].pos.y - particles[j].pos.y;
            const dz = particles[i].pos.z - particles[j].pos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < CONNECTION_DISTANCE) {
              const alpha = (1 - dist / CONNECTION_DISTANCE) * 0.55;
              const base = lineCount * 6;
              linePositions[base]     = particles[i].pos.x;
              linePositions[base + 1] = particles[i].pos.y;
              linePositions[base + 2] = particles[i].pos.z;
              linePositions[base + 3] = particles[j].pos.x;
              linePositions[base + 4] = particles[j].pos.y;
              linePositions[base + 5] = particles[j].pos.z;
              lineColors[base]     = 0.5 * alpha;
              lineColors[base + 1] = 0.6 * alpha;
              lineColors[base + 2] = 1.0 * alpha;
              lineColors[base + 3] = 0.5 * alpha;
              lineColors[base + 4] = 0.6 * alpha;
              lineColors[base + 5] = 1.0 * alpha;
              lineCount++;
            }
          }
        }
        lineGeo.setDrawRange(0, lineCount * 2);
        lineGeo.attributes.position.needsUpdate = true;
        lineGeo.attributes.color.needsUpdate = true;
      }

      // Knot rotation + scroll-linked dolly/zoom
      const knotSpin = reducedMotion ? 0.0006 : 0.0022;
      knot.rotation.x += knotSpin;
      knot.rotation.y += knotSpin * 1.4;

      camera.position.z = 13 + scrollProgress * 10;
      knot.material.opacity = 0.22 - scrollProgress * 0.14;

      targetRot.x = mouse.y * 0.10 + scrollProgress * 0.25;
      targetRot.y = mouse.x * 0.14;
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
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.dispose();
      pGeo.dispose();
      lineGeo.dispose();
      knotGeo.dispose();
      pMat.dispose();
      lineMat.dispose();
      knotMat.dispose();
      sprite.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
