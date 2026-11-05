"use client";
// 8인 경기 3D 중계. 표준 400m 트랙의 일반 경기장이며 특정 경기장을 측량한 모델이 아니다.
// 3D 색은 CSS 토큰을 읽지 못하므로 앱 테마 값을 이곳에 모은다.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { BodyPlan } from "@/lib/battle/bodyPlan";
import { TRACK, outwardAt, trackPoint } from "@/lib/battle/stadiumTrack";
import { FOOT_GAP, FRAME_COUNT, bodyMotion, drawNumberTag, drawRunnerFrames, runnerCreature, runnerHeight } from "./runnerArt";

export type StadiumRunner = { lane: number; progress: number; mine: boolean; body: BodyPlan; line?: readonly (readonly number[])[] | null };
export type CameraMode = "director" | "mine";

const PALETTE = {
  sky: "#0b1f36", ground: "#0f2a47", trackSurface: "#0a72d6", infield: "#2f6f58", pitch: "#3a8268", line: "#e5f2ff",
  seatA: "#1b3d61", seatB: "#2a4664", roof: "#a9bdd3", ring: "#ffffff", ink: "#0b1f36",
};
const CROWD_SHIRTS = ["#ffb020", "#5cb4ff", "#ff6b6b", "#e879f9", "#34d399", "#f4f5f7", "#fb923c", "#a5b4fc", "#1f6fd1", "#fde68a"];
const CROWD_SKIN = ["#f6d1b1", "#e8b98f", "#c98f64", "#8d5a3b"];
const RUNNER_COLORS = ["#ffb020", "#5cb4ff", "#ff6b6b", "#e879f9", "#34d399", "#fb923c", "#a5b4fc", "#f4f5f7"];
const SECTIONS = 12;
const LAPS = 3;

const lanePoint = (lane: number, progress: number) => trackPoint((progress / SECTIONS) * LAPS, TRACK.radius + (lane - 0.5) * TRACK.laneWidth);

/**
 * 선두의 진행 구간(0~12)으로 카메라를 고른다. 평균이 아니라 선두를 봐서, 결승 카메라가 선수보다 먼저 가 있지 않게 한다.
 * 선수 안쪽(관중이 배경)과 관중석 쪽(관중 너머로 선수)을 번갈아 쓴다.
 */
export function directorShot(leaderProgress: number): "start" | "leader" | "mine" | "wide" | "stands" | "finish" {
  if (leaderProgress < 0.7) return "start";
  if (leaderProgress >= 11.7) return "finish";
  const order = ["leader", "stands", "mine", "wide", "stands", "leader", "mine"] as const;
  return order[Math.floor((leaderProgress - 0.7) / 1.2) % order.length];
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

    // 관중: 네 무리로 나눠 무리마다 들썩이게 한다. 사람마다 움직이면 휴대폰에서 무겁다
    const crowdBody = new THREE.BoxGeometry(0.9, 1.2, 0.5);
    const crowdHead = new THREE.IcosahedronGeometry(0.34, 0);
    disposables.push(crowdBody, crowdHead);
    const crowdMaterial = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    disposables.push(crowdMaterial);
    const seatsOfCrowd: { x: number; y: number; z: number }[][] = [[], [], [], []];
    // 값이 늘 같아 다시 그려도 관중이 바뀌지 않는다
    let pick = 12345;
    const next = () => (pick = (pick * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let tier = 0; tier < 9; tier++) {
      for (let spot = 0; spot < 150 + tier * 12; spot++) {
        if (next() < 0.14) continue; // 빈자리
        const p = trackPoint(spot / (150 + tier * 12), 52 + tier * 2.5);
        seatsOfCrowd[Math.floor(next() * 4)].push({ x: p.x, y: 2.2 + tier * 1.3, z: p.z });
      }
    }
    const crowds = seatsOfCrowd.map((people) => {
      const group = new THREE.Group();
      const bodies = new THREE.InstancedMesh(crowdBody, crowdMaterial, people.length);
      const heads = new THREE.InstancedMesh(crowdHead, crowdMaterial, people.length);
      people.forEach((person, i) => {
        place3.rotation.set(0, Math.atan2(person.x, person.z), 0);
        place3.scale.set(1, 1, 1);
        place3.position.set(person.x, person.y, person.z);
        place3.updateMatrix();
        bodies.setMatrixAt(i, place3.matrix);
        bodies.setColorAt(i, tint.set(CROWD_SHIRTS[Math.floor(next() * CROWD_SHIRTS.length)]));
        place3.position.set(person.x, person.y + 0.92, person.z);
        place3.updateMatrix();
        heads.setMatrixAt(i, place3.matrix);
        heads.setColorAt(i, tint.set(CROWD_SKIN[Math.floor(next() * CROWD_SKIN.length)]));
      });
      group.add(bodies, heads);
      scene.add(group);
      return { group, bodies, heads };
    });

    const textures: THREE.Texture[] = [];
    const paper = new THREE.PlaneGeometry(1, 1);
    const shadowShape = new THREE.CircleGeometry(1, 20);
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.28, depthWrite: false });
    disposables.push(paper, shadowShape, shadowMaterial);
    type Runner3D = { sheet: THREE.Mesh; tag: THREE.Sprite; shadow: THREE.Mesh; texture: THREE.Texture; seed: number; height: number };
    const sprites = new Map<number, Runner3D>();
    function canvasTexture(canvas: HTMLCanvasElement) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.push(texture);
      return texture;
    }
    function makeRunner(runner: StadiumRunner) {
      const color = RUNNER_COLORS[(runner.lane - 1) % RUNNER_COLORS.length];
      const texture = canvasTexture(drawRunnerFrames(runner.body, color, runner.line ?? null, runner.lane));
      texture.repeat.set(1 / FRAME_COUNT, 1);
      const sheetMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
      const tagMaterial = new THREE.SpriteMaterial({ map: canvasTexture(drawNumberTag(runner.lane, runner.mine, color)), depthTest: false });
      disposables.push(sheetMaterial, tagMaterial);
      const sheet = new THREE.Mesh(paper, sheetMaterial);
      sheet.rotation.order = "YXZ";
      const tag = new THREE.Sprite(tagMaterial);
      const shadow = new THREE.Mesh(shadowShape, shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      scene.add(sheet, tag, shadow);
      const made = { sheet, tag, shadow, texture, seed: runner.lane, height: runnerHeight(runnerCreature(runner.body, runner.lane, runner.line ?? null), runner.body) };
      sprites.set(runner.lane, made);
      return made;
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
      let leader: THREE.Mesh | undefined, leaderProgress = -1, mineSprite: THREE.Mesh | undefined;
      if (!reduced.matches) {
        crowds.forEach(({ group }, i) => {
          group.position.y = Math.max(0, Math.sin(now / 240 + i * 1.7)) * 0.32;
        });
      }
      for (const runner of rows) {
        const made = sprites.get(runner.lane) ?? makeRunner(runner);
        const sheet = made.sheet;
        const point = lanePoint(runner.lane, runner.progress);
        const ahead = lanePoint(runner.lane, runner.progress + 0.02);
        const moving = runner.progress > 0 && runner.progress < SECTIONS;
        const animate = moving && !reduced.matches;
        const size = runner.mine ? 8 : 6.4;
        const pose = animate
          ? bodyMotion(runner.body, now, runner.lane, runner.progress * 100)
          // 완주하면 제자리에서 기뻐 뛴다
          : { rise: runner.progress >= SECTIONS && !reduced.matches ? Math.abs(Math.sin(now / 160 + runner.lane)) * 1.4 : 0, tilt: 0, squashX: 1, squashY: 1 };
        // 그림 칸 아래의 빈 곳만큼 내려 발이 땅에 닿게 한다
        sheet.position.set(point.x, size / 2 + pose.rise - size * FOOT_GAP, point.z);
        sheet.scale.set(size * pose.squashX, size * pose.squashY, 1);
        // 종이를 달리는 방향으로 세운다. 옆에서는 넓고 앞뒤에서는 얇게 보이며, 바람에 살짝 펄럭인다
        const heading = -Math.atan2(ahead.z - point.z, ahead.x - point.x);
        sheet.rotation.y = heading + (animate ? Math.sin(now / 130 + made.seed) * 0.14 : 0);
        sheet.rotation.z = pose.tilt;
        made.texture.offset.x = (animate ? Math.floor(now / 70 + runner.lane) % FRAME_COUNT : 0) / FRAME_COUNT;
        made.tag.position.set(point.x, size * made.height + pose.rise + 1.4, point.z);
        made.tag.scale.setScalar(runner.mine ? 3.4 : 2.7);
        made.shadow.position.set(point.x, 0.14, point.z);
        made.shadow.scale.setScalar(size * 0.34);
        const sprite = sheet;
        if (runner.progress > leaderProgress) { leaderProgress = runner.progress; leader = sprite; }
        if (runner.mine) mineSprite = sprite;
      }
      const shot = reduced.matches ? "wide" : mode.current === "mine" ? "mine" : directorShot(leaderProgress);
      const target = (shot === "mine" ? mineSprite ?? leader : leader)?.position;
      if (shot === "wide" || !target) {
        destination.set(0, 62, 92);
        look.set(0, 0, 0);
      } else if (shot === "finish") {
        const finishX = -TRACK.straight / 2;
        destination.set(finishX + 12, 6, TRACK.radius - 16);
        look.set(finishX, 3, TRACK.radius + 6);
      } else {
        const out = outwardAt(target.x, target.z);
        if (shot === "start") {
          // 출발선을 비스듬히 앞에서 본다. 정면으로 보면 여덟 레인이 한 줄로 겹친다
          const middle = TRACK.radius + (TRACK.lanes * TRACK.laneWidth) / 2;
          destination.set(target.x + 17, 8, middle - 21);
          look.set(target.x, 3, middle);
        } else if (shot === "stands") {
          // 관중석 위쪽에서 앞줄 관중 머리 너머로 선수를 본다
          destination.set(target.x + out.x * 32, 17, target.z + out.z * 32);
        } else {
          // 선수의 안쪽에서 따라간다. 뒤로 좌석 대신 관중이 보인다
          destination.set(target.x - out.x * 26, 11, target.z - out.z * 26);
        }
        if (shot !== "start") look.copy(target);
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
      crowds.forEach(({ bodies, heads }) => { bodies.dispose(); heads.dispose(); });
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
