"use client";
// 8인 경기 3D 중계. 표준 400m 트랙의 일반 경기장이며 특정 경기장을 측량한 모델이 아니다.
// 3D 색은 CSS 토큰을 읽지 못하므로 앱 테마 값을 이곳에 모은다.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { BodyPlan } from "@/lib/battle/bodyPlan";
import { TRACK, trackPoint } from "@/lib/battle/stadiumTrack";
import { FRAME_COUNT, bodyMotion, drawRunnerFrames } from "./runnerArt";

export type StadiumRunner = { lane: number; progress: number; mine: boolean; body: BodyPlan; line?: readonly (readonly number[])[] | null };
export type CameraMode = "director" | "mine";

const PALETTE = {
  sky: "#0b1f36", ground: "#0f2a47", trackSurface: "#0a72d6", infield: "#2f6f58", pitch: "#3a8268", line: "#e5f2ff",
  seatA: "#1b3d61", seatB: "#2a4664", roof: "#a9bdd3", ring: "#ffffff", ink: "#0b1f36",
};
const RUNNER_COLORS = ["#ffb020", "#5cb4ff", "#ff6b6b", "#e879f9", "#34d399", "#fb923c", "#a5b4fc", "#f4f5f7"];
const SECTIONS = 12;
const LAPS = 3;

const lanePoint = (lane: number, progress: number) => trackPoint((progress / SECTIONS) * LAPS, TRACK.radius + (lane - 0.5) * TRACK.laneWidth);

/** 경기 진행률에 따라 카메라를 고른다. 시작은 낮게, 중간은 선두와 내 선수를 번갈아, 끝은 결승선 */
export function directorShot(fraction: number): "start" | "leader" | "mine" | "wide" | "finish" {
  if (fraction < 0.08) return "start";
  if (fraction > 0.9) return "finish";
  const beat = Math.floor((fraction - 0.08) / 0.1) % 4;
  return beat === 0 ? "leader" : beat === 1 ? "mine" : beat === 2 ? "wide" : "leader";
}

export function StadiumMap({ runners, camera: cameraMode }: { runners: StadiumRunner[]; camera: CameraMode }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(runners);
  const mode = useRef(cameraMode);
  const [error, setError] = useState("");
  useEffect(() => { live.current = runners; }, [runners]);
  useEffect(() => { mode.current = cameraMode; }, [cameraMode]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- WebGL 지원 여부는 브라우저에서만 알 수 있다
      setError("이 기기는 3D 중계를 지원하지 않아요. 아래 순위로 경기를 볼 수 있어요.");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "8개 레인 트랙을 달리는 선수들의 3D 중계 화면");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(PALETTE.sky);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 900);
    camera.position.set(120, 110, 150);
    scene.add(new THREE.HemisphereLight("#dcecff", "#0f2a47", 2.6));
    const sun = new THREE.DirectionalLight("#ffffff", 2.2);
    sun.position.set(-70, 120, 80);
    scene.add(sun);

    const disposables: { dispose(): void }[] = [];
    const material = (color: string) => {
      const m = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
      disposables.push(m);
      return m;
    };
    function surface(radius: number, y: number, color: string) {
      const shape = new THREE.Shape();
      for (let i = 0; i <= 240; i++) {
        const p = trackPoint(i / 240, radius);
        if (i === 0) shape.moveTo(p.x, -p.z);
        else shape.lineTo(p.x, -p.z);
      }
      const geometry = new THREE.ShapeGeometry(shape);
      disposables.push(geometry);
      const mesh = new THREE.Mesh(geometry, material(color));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      scene.add(mesh);
    }
    function loopLine(radius: number, y: number, color: string) {
      const points = Array.from({ length: 241 }, (_, i) => {
        const p = trackPoint(i / 240, radius);
        return new THREE.Vector3(p.x, y, p.z);
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const lineMaterial = new THREE.LineBasicMaterial({ color });
      disposables.push(geometry, lineMaterial);
      scene.add(new THREE.Line(geometry, lineMaterial));
    }
    surface(150, -0.2, PALETTE.ground);
    surface(TRACK.radius + TRACK.laneWidth * TRACK.lanes, 0.02, PALETTE.trackSurface);
    surface(TRACK.radius, 0.04, PALETTE.infield);
    for (let lane = 0; lane <= TRACK.lanes; lane++) loopLine(TRACK.radius + lane * TRACK.laneWidth, 0.08, PALETTE.line);

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    disposables.push(unitBox);
    const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) => {
      const mesh = new THREE.Mesh(unitBox, material(color));
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      scene.add(mesh);
      return mesh;
    };
    place(0, 0.07, 0, 90, 0.02, 56, PALETTE.pitch);
    // 결승선
    place(-TRACK.straight / 2, 0.12, TRACK.radius + (TRACK.lanes * TRACK.laneWidth) / 2, 0.5, 0.04, TRACK.lanes * TRACK.laneWidth, PALETTE.ring);

    // 관중석: 조각이 많아 한 번에 그린다
    const seats = 9 * 64;
    const stand = new THREE.InstancedMesh(unitBox, material("#ffffff"), seats);
    const place3 = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let tier = 0, i = 0; tier < 9; tier++) {
      for (let segment = 0; segment < 64; segment++, i++) {
        const radius = 52 + tier * 2.5;
        const p = trackPoint(segment / 64, radius), q = trackPoint((segment + 0.01) / 64, radius);
        place3.position.set(p.x, 1 + tier * 1.3, p.z);
        place3.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
        place3.scale.set(6.4, 1.1, 2.3);
        place3.updateMatrix();
        stand.setMatrixAt(i, place3.matrix);
        stand.setColorAt(i, tint.set(tier % 3 === 0 ? PALETTE.seatB : PALETTE.seatA));
      }
    }
    scene.add(stand);

    const textures: THREE.Texture[] = [];
    const sprites = new Map<number, THREE.Sprite>();
    function makeRunner(runner: StadiumRunner) {
      const color = RUNNER_COLORS[(runner.lane - 1) % RUNNER_COLORS.length];
      const texture = new THREE.CanvasTexture(drawRunnerFrames(runner.body, color, runner.lane, runner.mine, runner.line ?? null));
      texture.repeat.set(1 / FRAME_COUNT, 1);
      textures.push(texture);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
      disposables.push(spriteMaterial);
      const sprite = new THREE.Sprite(spriteMaterial);
      scene.add(sprite);
      sprites.set(runner.lane, sprite);
      return sprite;
    }

    const resize = () => {
      const width = container.clientWidth;
      const height = Math.max(260, Math.min(480, width * 0.72));
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const aim = new THREE.Vector3();
    const destination = new THREE.Vector3();
    const look = new THREE.Vector3();
    const probe = new THREE.Vector3();
    let previous = performance.now();
    let frame = 0;
    function render(now: number) {
      const dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      const rows = live.current;
      let leader: THREE.Sprite | undefined, leaderProgress = -1, mineSprite: THREE.Sprite | undefined;
      let sum = 0;
      for (const runner of rows) {
        const sprite = sprites.get(runner.lane) ?? makeRunner(runner);
        const point = lanePoint(runner.lane, runner.progress);
        const ahead = lanePoint(runner.lane, runner.progress + 0.02);
        const moving = runner.progress > 0 && runner.progress < SECTIONS;
        const animate = moving && !reduced.matches;
        const size = runner.mine ? 8 : 6.4;
        const pose = animate
          ? bodyMotion(runner.body, now, runner.lane, runner.progress * 100)
          // 완주하면 제자리에서 기뻐 뛴다
          : { rise: runner.progress >= SECTIONS && !reduced.matches ? Math.abs(Math.sin(now / 160 + runner.lane)) * 1.4 : 0, tilt: 0, squashX: 1, squashY: 1 };
        sprite.position.set(point.x, size / 2 + pose.rise, point.z);
        sprite.scale.set(size * pose.squashX, size * pose.squashY, 1);
        // 화면에서 달려가는 쪽을 보게 그림을 뒤집는다
        const screenNow = probe.set(point.x, 0, point.z).project(camera).x;
        const screenNext = probe.set(ahead.x, 0, ahead.z).project(camera).x;
        const facingLeft = screenNext < screenNow;
        const material = sprite.material as THREE.SpriteMaterial;
        const texture = material.map!;
        const frameIndex = animate ? Math.floor(now / 70 + runner.lane) % FRAME_COUNT : 0;
        texture.repeat.x = (facingLeft ? -1 : 1) / FRAME_COUNT;
        texture.offset.x = (frameIndex + (facingLeft ? 1 : 0)) / FRAME_COUNT;
        material.rotation = facingLeft ? -pose.tilt : pose.tilt;
        if (runner.progress > leaderProgress) { leaderProgress = runner.progress; leader = sprite; }
        if (runner.mine) mineSprite = sprite;
        sum += runner.progress;
      }
      const fraction = rows.length ? sum / rows.length / SECTIONS : 0;
      const shot = reduced.matches ? "wide" : mode.current === "mine" ? "mine" : directorShot(fraction);
      const target = (shot === "mine" ? mineSprite ?? leader : leader)?.position;
      if (shot === "wide" || !target) {
        destination.set(0, 62, 92);
        look.set(0, 0, 0);
      } else if (shot === "start") {
        destination.set(target.x - 20, 11, target.z + 22);
        look.copy(target);
      } else if (shot === "finish") {
        destination.set(-TRACK.straight / 2 - 6, 7, TRACK.radius + 28);
        look.set(-TRACK.straight / 2, 1, TRACK.radius + 5);
      } else {
        // 선수 바깥쪽 위에서 따라간다
        const outward = Math.hypot(target.x, target.z) || 1;
        destination.set(target.x + (target.x / outward) * 26, 19, target.z + (target.z / outward) * 26);
        look.copy(target);
      }
      const blend = reduced.matches ? 1 : 1 - Math.exp(-dt * 7);
      camera.position.lerp(destination, blend);
      aim.lerp(look, blend);
      camera.lookAt(aim);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stand.dispose();
      textures.forEach((texture) => texture.dispose());
      disposables.forEach((item) => item.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="derby-stadium">
      <div ref={host} className="derby-canvas" />
      {error && <p role="status" className="derby-note">{error}</p>}
    </div>
  );
}
