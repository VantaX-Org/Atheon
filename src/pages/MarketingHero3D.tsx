import { useEffect, useRef } from "react";
import * as THREE from "three";

/* Three.js hero backdrop — the money river as thousands of particles flowing
   left→right in gentle sine bands, brand-blue, additive glow. Fills its parent
   (absolutely positioned by the caller), transparent so the page shows through.
   Lazy-loaded so three.js never lands in the main bundle; the caller skips
   mounting it entirely under prefers-reduced-motion. */

const COUNT = 2200;
const BANDS = 5;

function circleSprite(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export default function MarketingHero3D() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#7c9bff";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 16);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    } catch {
      return; // no WebGL — backdrop is decorative, page works without it
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    // Per-particle: band index, phase along the river, speed, amplitude jitter.
    const pos = new Float32Array(COUNT * 3);
    const phase = new Float32Array(COUNT);
    const speed = new Float32Array(COUNT);
    const band = new Float32Array(COUNT);
    const jitter = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      phase[i] = Math.random() * 44 - 22;
      speed[i] = 0.9 + Math.random() * 1.6;
      band[i] = (i % BANDS) - (BANDS - 1) / 2;
      jitter[i] = (Math.random() - 0.5) * 1.4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

    const color = new THREE.Color(brand);
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: circleSprite(),
      color,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(geo, mat));

    // Pointer parallax — eased toward the target each frame.
    let tx = 0, ty = 0;
    function onPointer(e: PointerEvent) {
      tx = (e.clientX / window.innerWidth - 0.5) * 1.6;
      ty = (e.clientY / window.innerHeight - 0.5) * 1.0;
    }
    window.addEventListener("pointermove", onPointer, { passive: true });

    function resize() {
      const w = host!.clientWidth, h = host!.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let t = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      t += 1 / 60;
      const p = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < COUNT; i++) {
        // Flow left→right, wrap at the edges; each band is a sine ribbon.
        let x = phase[i] + t * speed[i];
        x = ((x + 22) % 44) - 22;
        p[i * 3] = x;
        p[i * 3 + 1] = band[i] * 1.7 + Math.sin(x * 0.35 + band[i] * 2.1) * 1.5 + jitter[i];
      }
      geo.attributes.position.needsUpdate = true;
      camera.position.x += (tx - camera.position.x) * 0.04;
      camera.position.y += (-ty - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      geo.dispose();
      mat.map?.dispose();
      mat.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="mk5-hero-3d" aria-hidden />;
}
