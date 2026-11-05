"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TRACK, trackPoint } from "@/lib/battle/stadiumTrack";

type Runner = { id: string; progress: number };
type View = "overview" | "follow" | "broadcast";
const COLORS = ["#f97316", "#38bdf8", "#facc15", "#e879f9", "#34d399", "#fb7185", "#818cf8", "#ffffff"];

export function StadiumMap({ runners }: { runners: Runner[] }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(runners);
  const cameraMode = useRef<View>("overview");
  const selected = useRef("");
  const [view, setView] = useState<View>("overview");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { live.current = runners; }, [runners]);
  useEffect(() => { cameraMode.current = view; selected.current = target; }, [view, target]);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { setError("3D 화면을 지원하지 않는 기기예요. 아래 진행률로 경기를 볼 수 있어요."); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute("aria-label", "부산 아시아드주경기장 참고 3D 경주장");
    renderer.domElement.setAttribute("role", "img");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#dce8ec");
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
    camera.position.set(120, 125, 150);
    scene.add(new THREE.HemisphereLight("#ffffff", "#6f7960", 2.4));
    const sun = new THREE.DirectionalLight("#fff4df", 3);
    sun.position.set(-70, 120, 80);
    scene.add(sun);
    const textures: THREE.Texture[] = [];
    function box(x: number, y: number, z: number, width: number, height: number, depth: number, color: string) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color }));
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return mesh;
    }
    function oval(radius: number, y: number, color: string) {
      const points = Array.from({ length: 241 }, (_, i) => {
        const p = trackPoint(i / 240, radius);
        return new THREE.Vector3(p.x, y, p.z);
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color }));
      scene.add(line);
    }
    // A filled outer oval with a smaller grass oval masks its centre.
    function surface(radius: number, y: number, color: string) {
      const shape = new THREE.Shape();
      for (let i = 0; i <= 240; i++) {
        const p = trackPoint(i / 240, radius);
        if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
      }
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      scene.add(mesh);
    }
    box(0, -0.6, 0, 2000, 1, 2000, "#9eaf87");
    box(0, -0.08, 0, 290, 0.08, 220, "#d8d1bd");
    for (const x of [-160, 160]) box(x, -0.06, 0, 8, 0.1, 600, "#ddd9cc");
    for (const z of [-125, 125]) box(0, -0.06, z, 600, 0.1, 8, "#ddd9cc");
    for (let i = 0; i < 18; i++) {
      for (const side of [-1, 1]) {
        const x = -145 + i * 17;
        const z = side * 145;
        box(x, 1.4, z, 0.8, 3, 0.8, "#75634c");
        const tree = new THREE.Mesh(
          new THREE.IcosahedronGeometry(4.2, 1),
          new THREE.MeshStandardMaterial({ color: i % 2 ? "#617c55" : "#789363" }),
        );
        tree.position.set(x, 5.5, z);
        scene.add(tree);
      }
    }
    surface(TRACK.radius + TRACK.laneWidth * 8, 0.02, "#b95e48");
    surface(TRACK.radius, 0.04, "#679653");
    for (let lane = 0; lane <= 8; lane++) oval(TRACK.radius + lane * TRACK.laneWidth, 0.08, "#fff1dc");
    // Pitch dimensions are a visual standard reference, not a surveyed Busan measurement.
    box(0, 0.07, 0, 105, 0.02, 68, "#628f4e");
    for (const z of [-34, 34]) box(0, 0.10, z, 105, 0.03, 0.12, "#f1f1d8");
    for (const x of [-52.5, 0, 52.5]) box(x, 0.10, 0, 0.12, 0.03, 68, "#f1f1d8");
    box(-TRACK.straight / 2, 0.12, TRACK.radius + 4.88, 0.35, 0.04, 9.76, "#ffffff");
    for (let tier = 0; tier < 9; tier++) {
      const radius = 52 + tier * 2.5;
      for (let segment = 0; segment < 64; segment++) {
        const p = trackPoint(segment / 64, radius);
        const next = trackPoint((segment + 0.001) / 64, radius);
        const seat = box(p.x, 1 + tier * 1.3, p.z, 6, 1.1, 2.3, tier % 3 === 0 ? "#e8c79c" : "#56869a");
        seat.rotation.y = -Math.atan2(next.z - p.z, next.x - p.x);
      }
    }
    // Raised wave-like canopy segments retain a clear view of the running surface.
    for (let i = 0; i < 64; i++) {
      const p = trackPoint(i / 64, 78);
      const q = trackPoint((i + 0.01) / 64, 78);
      const roof = box(p.x, 22 + 2 * Math.sin(i / 64 * Math.PI * 4), p.z, 7.5, 0.45, 13, "#f3f0e6");
      roof.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
    }
    const sprites = new Map<string, THREE.Sprite>();
    function makeRunner(id: string, lane: number) {
      const canvas = document.createElement("canvas");
      canvas.width = 96; canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = COLORS[lane % 8];
      ctx.strokeStyle = "#172b36"; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(48, 26, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(48, 42); ctx.lineTo(48, 76);
      ctx.moveTo(28, 57); ctx.lineTo(48, 48); ctx.lineTo(68, 60);
      ctx.moveTo(48, 76); ctx.lineTo(30, 105); ctx.moveTo(48, 76); ctx.lineTo(66, 105); ctx.stroke();
      ctx.fillStyle = "#172b36"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(lane + 1), 48, 125);
      const texture = new THREE.CanvasTexture(canvas); textures.push(texture);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
      sprite.scale.set(2.4, 3.2, 1); scene.add(sprite); sprites.set(id, sprite);
      return sprite;
    }
    const resize = () => {
      const width = container.clientWidth;
      const height = Math.max(300, Math.min(540, width * 0.65));
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const aim = new THREE.Vector3();
    let previous = performance.now();
    let frame = 0;
    function render(now: number) {
      const dt = Math.min((now - previous) / 1000, 0.1); previous = now;
      const rows = [...live.current].sort((a, b) => a.id.localeCompare(b.id));
      rows.forEach((runner, lane) => {
        const sprite = sprites.get(runner.id) ?? makeRunner(runner.id, lane);
        const point = trackPoint(runner.progress / 4, TRACK.radius + (lane + 0.5) * TRACK.laneWidth);
        sprite.position.set(point.x, 1.7, point.z);
      });
      const focus = sprites.get(selected.current) ?? sprites.get(live.current[0]?.id);
      const destination = new THREE.Vector3(120, 125, 150);
      const look = new THREE.Vector3();
      if (!reduced.matches && focus && cameraMode.current !== "overview") {
        look.copy(focus.position);
        if (cameraMode.current === "follow") destination.copy(look).add(new THREE.Vector3(18, 13, 23));
        else destination.set(look.x * 0.35, 65, 95);
      }
      const blend = 1 - Math.exp(-dt * 3);
      camera.position.lerp(destination, blend); aim.lerp(look, blend); camera.lookAt(aim);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          if ("geometry" in object) object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      textures.forEach(texture => texture.dispose());
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);
  return <div>
    <div className="seg" aria-label="경주 카메라">
      {([["overview", "전체"], ["follow", "선수 추적"], ["broadcast", "중계"]] as const).map(([id, label]) =>
        <button key={id} type="button" className="seg-btn" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
      <select aria-label="추적할 선수" value={target} onChange={event => setTarget(event.target.value)}>
        <option value="">선두 추적</option>
        {[...runners].sort((a, b) => a.id.localeCompare(b.id)).map(runner => <option key={runner.id} value={runner.id}>{runner.id}번 선수</option>)}
      </select>
    </div>
    <div ref={host} style={{ width: "100%", minHeight: 300, overflow: "clip", borderRadius: 16 }} />
    {error && <p role="status">{error}</p>}
    <p className="hint">아시아드주경기장 참고 모델 · 표준 400m 트랙 3바퀴. 외곽 레인 이동은 경기 진행률에 맞춘 시각 연출이에요.</p>
  </div>;
}
