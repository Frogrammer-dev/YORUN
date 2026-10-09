// S-01 시작·가져오기
import Link from "next/link";
import { LandingStart } from "@/components/LandingStart";
import { SceneSvg } from "@/components/SceneSvg";
import { BrandMark, Icon } from "@/components/Icon";
import { buildDemoArtwork } from "@/lib/art/artwork";
import type { Scene } from "@/lib/render/scene";

function exampleScene(): Scene {
  const heart = buildDemoArtwork().view;
  return {
    theme: "light",
    items: [
      { key: "a", x: 0.5, y: 0.47, size: 0.3, rotationDeg: 0, zIndex: 1, style: { strokeColor: "#0A72D6", strokeWidth: 0.012, frame: "paper" }, lines: heart.renderLines },
      { key: "b", x: 0.18, y: 0.42, size: 0.22, rotationDeg: -8, zIndex: 0, style: { strokeColor: "#111318", strokeWidth: 0.01, frame: "plain" }, lines: heart.renderLines },
      { key: "c", x: 0.82, y: 0.44, size: 0.22, rotationDeg: 6, zIndex: 2, style: { strokeColor: "#38BDF8", strokeWidth: 0.012, frame: "neon" }, lines: heart.renderLines },
    ],
  };
}

const HEART = "M165 225 H135 V195 H105 V165 H75 V75 H105 V45 H135 V75 H195 V45 H225 V75 H255 V165 H225 V195 H195 V225 Z";

/** 동네 길(격자) 위에 하트 코스가 그려지는 히어로 그림 */
function HeroArt() {
  const xs = [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315];
  const ys = [15, 45, 75, 105, 135, 165, 195, 225, 255];
  return (
    <svg viewBox="0 0 330 270" role="img" aria-label="동네 길 위에 그려진 하트 모양 러닝 코스">
      <g stroke="#2A2E36" strokeWidth="1.5" strokeLinecap="round">
        {xs.map((x) => (
          <line key={`x${x}`} x1={x} y1={4} x2={x} y2={266} />
        ))}
        {ys.map((y) => (
          <line key={`y${y}`} x1={4} y1={y} x2={326} y2={y} />
        ))}
        <line x1={4} y1={262} x2={326} y2={8} strokeWidth="5" stroke="#181A1F" />
      </g>
      <path d="M165 232 C120 196 62 160 66 102 C70 58 128 44 165 92 C202 44 260 58 264 102 C268 160 210 196 165 232Z" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
      <path className="draw-path hero-glow" pathLength={1} d={HEART} fill="none" stroke="#38BDF8" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <circle className="pulse" cx="165" cy="225" r="8" fill="#12B76A" />
      <circle cx="165" cy="225" r="7" fill="#12B76A" stroke="#0B0C0F" strokeWidth="3" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="landing">
      <div className="hero-dark">
        <header className="topbar">
          <Link href="/" className="brand">
            <BrandMark size={26} />
            요런
          </Link>
          <nav className="actions">
            <Link href="/run" className="btn btn-link">
              달리기
            </Link>
            <Link href="/room" className="btn btn-link">
              작품방
            </Link>
          </nav>
        </header>

        <section className="hero-inner">
          <div className="hero-art">
            <HeroArt />
          </div>
          <div className="hero-copy">
            <h1>
              내 주변 길에 숨은
              <br />
              <em>그림</em>을 찾아 달려요.
            </h1>
            <p>지도를 동네에 맞추면 실제 길만 따라 한 번에 달릴 수 있는 하트·별·고양이 그림 코스를 찾아 줘요. 달린 GPS 선은 그대로 작품이 되어 작품방에 걸려요.</p>
            <div className="hero-cta">
              <Link href="/routes" className="btn btn-primary btn-lg">
                <Icon name="map" size={20} />
                내 주변 드로잉 코스 찾기
              </Link>
              <Link href="/run" className="btn btn-lg btn-on-dark">
                <Icon name="play" size={18} />
                코스 없이 자유롭게 달리기
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className="section">
        <h2>이렇게 달려요</h2>
        <ol className="how">
          <li>
            <span className="num">1</span>
            <strong>동네 맞추기</strong>
            <span>지도에서 달릴 동네를 화면에 맞추고 거리·그림을 골라요.</span>
          </li>
          <li>
            <span className="num">2</span>
            <strong>안내 따라 달리기</strong>
            <span>찾은 코스 중 하나를 골라 GPS 방향 안내를 받으며 달려요.</span>
          </li>
          <li>
            <span className="num">3</span>
            <strong>작품방에 걸기</strong>
            <span>달린 선을 작품으로 만들어 작품방에 걸고 공유해요.</span>
          </li>
        </ol>
      </section>

      <section className="section">
        <h2>이미 달린 기록이 있나요?</h2>
        <p style={{ color: "var(--text-2)" }}>다른 앱·시계에서 내보낸 GPX 파일로 바로 작품을 만들 수도 있어요.</p>
        <LandingStart />

        <figure className="example">
          <div className="stage-canvas">
            <SceneSvg scene={exampleScene()} ariaLabel="예시 작품방: 예시 기록으로 만든 하트 작품 3점" />
          </div>
          <figcaption>예시 기록으로 만든 작품방 (실제 사용자의 활동이 아니에요)</figcaption>
        </figure>

        <div className="accordion">
          <details>
            <summary>
              <h2>파일 조건</h2>
              <Icon name="chevronDown" />
            </summary>
            <ul>
              <li>트랙 기록(trk)이 들어 있는 GPX 1.0/1.1 파일, 5 MiB 이하 · 점 20,000개 이하 · 구간 200개 이하</li>
              <li>계획 경로(rte)·지점(wpt)만 있는 GPX, FIT·TCX·ZIP은 아직 지원하지 않아요</li>
              <li>가로·세로 50km 이하 지역의 기록 (날짜변경선·극지 제외)</li>
            </ul>
          </details>
          <details>
            <summary>
              <h2>GPX 준비하기</h2>
              <Icon name="chevronDown" />
            </summary>
            <ul>
              <li>쓰고 있는 러닝 기록 앱이나 시계 서비스의 활동 상세 화면에서 ‘GPX 내보내기/다운로드’ 메뉴를 찾아 주세요.</li>
              <li>앱마다 메뉴 위치가 달라요. 웹 버전에서만 내보내기를 제공하는 경우도 있어요.</li>
            </ul>
          </details>
          <details>
            <summary>
              <h2>개인정보</h2>
              <Icon name="chevronDown" />
            </summary>
            <ul>
              <li>GPX 파일과 실제 위치(위도·경도)는 이 브라우저 안에서만 처리하고 서버로 보내지 않아요.</li>
              <li>서버에는 기준 위치를 지운 상대 모양만 저장해요. 다만 독특한 모양이나 제목으로 장소를 추정할 수 있어요.</li>
              <li>작품방은 기본 비공개이고, 공유 링크는 직접 만들 때만 생겨요.</li>
              <li>파일로 제공된 기록을 그리는 서비스이며, 실제 달림·완주를 인증하지 않아요.</li>
            </ul>
          </details>
        </div>
        <div className="footer-space" />
      </section>
    </main>
  );
}
