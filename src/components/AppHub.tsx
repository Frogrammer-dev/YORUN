import Link from "next/link";
import { AccountButton } from "./AccountButton";
import { BrandMark, Icon } from "./Icon";
import { MonthPanel, PointsRow, WeekChart } from "./HomeStats";
import { LandingStart } from "./LandingStart";
import { ResumeBanner, RunEntry } from "./RunEntry";

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
        <AccountButton />
      </header>
      <div className="hub-body">
        <ResumeBanner />
        <h2 className="hub-greeting">오늘도 그려볼까요?</h2>
        <MonthPanel />
        <div className="hub-head">
          <h2>이번 주 한 걸음씩</h2>
        </div>
        <WeekChart />
        <div className="hub-head">
          <h2>오늘의 코스</h2>
          <Link href="/room">작품방</Link>
        </div>
        <RunEntry />
        <section className="hub-start" aria-label="코스 찾기">
          <Link href="/routes" className="btn btn-primary btn-lg wide">
            오늘의 드로잉 런 시작
          </Link>
        </section>
      </div>
    </main>
  );
}

/** 콘텐츠 탭. 저장 기록으로 참가하는 더비를 연다. */
export function HubScreen() {
  return (
    <main className="hub-page">
      <header className="appbar">
        <span className="appbar-title">
          <h1>콘텐츠 허브</h1>
        </span>
        <AccountButton />
      </header>
      <div className="hub-body">
        <PointsRow />
        <section className="hub-band">
          <h2>원하는 콘텐츠를 선택하세요</h2>
          <div className="hub-tiles">
            <Link href="/booth" className="hub-tile hub-tile-wide">
              <span className="hub-tile-icon">
                <Icon name="route" size={24} />
              </span>
              <span className="hub-tile-text">
                <strong>부스 체험</strong>
                <span>코스를 뽑고 가상으로 완주해 8인 경주에 참가해요.</span>
              </span>
              <Icon name="chevronRight" size={20} />
            </Link>
            <Link href="/room" className="hub-tile hub-tile-wide">
              <span className="hub-tile-icon">
                <Icon name="frame" size={24} />
              </span>
              <span className="hub-tile-text">
                <strong>작품방</strong>
                <span>달린 선으로 만든 작품을 모아요.</span>
              </span>
              <Icon name="chevronRight" size={20} />
            </Link>
            <Link href="/duel" className="hub-tile">
              <span className="hub-tile-icon">
                <Icon name="duo" size={24} />
              </span>
              <strong>1대1 대결</strong>
              <span>상대 선수를 골라 비동기 대결에 도전해요.</span>
            </Link>
            <Link href="/derby" className="hub-tile">
              <span className="hub-tile-icon">
                <Icon name="flag" size={24} />
              </span>
              <strong>8인 더비</strong>
              <span>여덟 명의 코스 기록으로 경주해요.</span>
            </Link>
            <Link href="/contents/catalog" className="hub-tile hub-tile-wide">
              <span className="hub-tile-icon">
                <Icon name="grid" size={24} />
              </span>
              <span className="hub-tile-text">
                <strong>도감</strong>
                <span>달리기로 그릴 수 있는 모양을 만나요.</span>
              </span>
              <Icon name="chevronRight" size={20} />
            </Link>
          </div>
        </section>
        <p className="hub-import-link">
          <Link href="/contents">GPX 불러오기</Link>
        </p>
        <Link href="/settings" className="hub-row">
          <span className="hub-row-icon">
            <Icon name="layers" size={24} />
          </span>
          <span className="hub-row-body">
            <strong>데이터와 계정</strong>
            <span>이 기기 데이터와 계정을 삭제해요</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </Link>
        <p className="hub-credits">
          지도와 앱 아이콘의 도로 자료{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            © OpenStreetMap contributors
          </a>
        </p>
        <p className="hub-credits">
          <Link href="/privacy">개인정보 처리방침</Link>
        </p>
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
