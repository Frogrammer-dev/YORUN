import Link from "next/link";
import { BrandMark, Icon } from "./Icon";
import { LandingStart } from "./LandingStart";
import { ResumeBanner, RunEntry } from "./RunEntry";

/** 홈 시작 카드의 배경: 동네 길을 떠올리게 하는 장식 (실제 경로가 아니다) */
function StreetArt() {
  return (
    <svg className="hub-start-art" viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2" opacity=".16">
        <path d="M-10 44 370 16M-10 104 370 78M-10 168 370 138M52 -10 88 210M150 -10 176 210M250 -10 262 210M332 -10 318 210" />
      </g>
      <path d="M236 40 318 30 326 104 276 126 262 170 196 144 204 84z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" opacity=".22" />
    </svg>
  );
}

const CourseRow = () => (
  <Link href="/routes" className="hub-row">
    <span className="hub-row-icon">
      <Icon name="map" size={24} />
    </span>
    <span className="hub-row-body">
      <strong>코스 찾기</strong>
      <span>내 주변 실제 길에서 그림 코스를 골라요</span>
    </span>
    <Icon name="chevronRight" size={20} />
  </Link>
);

export function HomeScreen() {
  return (
    <main className="hub-page">
      <header className="appbar">
        <span className="appbar-title">
          <BrandMark size={28} />
          <h1>요런</h1>
        </span>
      </header>
      <div className="hub-body">
        <ResumeBanner />
        <section className="hub-start">
          <StreetArt />
          <h2>오늘은 어떤 그림을 달릴까요?</h2>
          <p>내 주변 실제 길에서 그림 모양 코스를 찾아요.</p>
          <Link href="/routes" className="btn btn-primary btn-lg wide">
            코스 찾기
          </Link>
        </section>
        <RunEntry />
        <h2 className="hub-section">내 작품</h2>
        <div className="hub-list">
          <Link href="/room" className="hub-row">
            <span className="hub-row-icon">
              <Icon name="frame" size={24} />
            </span>
            <span className="hub-row-body">
              <strong>작품방</strong>
              <span>달린 선으로 만든 작품을 모아요</span>
            </span>
            <Icon name="chevronRight" size={20} />
          </Link>
          <Link href="/contents#import" className="hub-row">
            <span className="hub-row-icon">
              <Icon name="upload" size={24} />
            </span>
            <span className="hub-row-body">
              <strong>기록 가져오기</strong>
              <span>GPX 기록으로 작품을 만들어요</span>
            </span>
            <Icon name="chevronRight" size={20} />
          </Link>
        </div>
      </div>
    </main>
  );
}

export function RunningScreen() {
  return (
    <main className="hub-page">
      <header className="appbar">
        <span className="appbar-title">
          <h1>달리기</h1>
        </span>
      </header>
      <div className="hub-body">
        <ResumeBanner />
        <div className="hub-list">
          <CourseRow />
          <RunEntry />
        </div>
        <p className="hint">달린 선은 작품방에 걸어 작품으로 남길 수 있어요.</p>
      </div>
    </main>
  );
}

/** 탭 없는 하위 화면. 뒤로 버튼은 기록(history)이 없는 설치 앱에서도 동작하도록 작품방으로 고정 이동한다. */
export function ImportScreen() {
  return (
    <main className="hub-page">
      <header className="appbar">
        <Link href="/room" className="icon-btn appbar-back" aria-label="작품방으로 돌아가기">
          <Icon name="back" size={24} />
        </Link>
        <span className="appbar-title">
          <h1>기록 가져오기</h1>
        </span>
      </header>
      <div className="hub-body">
        <section id="import" className="hub-card">
          <h2>GPX 기록 가져오기</h2>
          <p>다른 러닝 앱이나 시계에서 내보낸 기록으로 작품을 만들어요.</p>
          <LandingStart />
          <details>
            <summary>지원 파일과 개인정보 안내</summary>
            <p>트랙이 포함된 GPX 1.0/1.1, 최대 5 MiB·20,000점·200구간을 지원해요. FIT·TCX·ZIP, 계획 경로만 있는 파일은 지원하지 않아요. 가로·세로 50km 이하 기록을 사용해 주세요. 날짜변경선·극지는 제외돼요.</p>
            <p>실제 좌표는 브라우저에서 처리해요. 배경 도로망 요청 시 기록 주변 범위만 자료 서버로 전송해요. 서버에는 위치를 지운 상대 모양을 저장하지만, 모양이나 제목으로 장소를 추정할 수 있어요. 작품방은 기본 비공개이며 공유 링크는 직접 만들 때만 생겨요.</p>
          </details>
        </section>
      </div>
    </main>
  );
}
