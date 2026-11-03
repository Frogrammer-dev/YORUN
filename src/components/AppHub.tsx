import Link from "next/link";
import { BrandMark, Icon } from "./Icon";
import { LandingStart } from "./LandingStart";

type Section = "dashboard" | "running" | "contents";
export function AppHub({ section }: { section: Section }) {
  const titles = { dashboard: "오늘의 한 걸음이 나만의 그림이 되도록.", running: "나에게 맞는 방식으로 달려요.", contents: "달린 길을 작품으로 남겨요." };
  return <><header className="hub-navigation"><Link href="/" className="brand"><BrandMark size={26} />요런</Link><nav aria-label="주요 메뉴">
    {([["dashboard", "/", "대시보드"], ["running", "/running", "러닝"], ["contents", "/contents", "콘텐츠"]] as const).map(([id, href, label]) => <Link key={id} href={href} aria-current={section === id ? "page" : undefined}>{label}</Link>)}
  </nav></header><main className="hub-page"><p className="hub-eyebrow">{section === "dashboard" ? "나의 러닝 대시보드" : section === "running" ? "RUNNING" : "CONTENTS"}</p><h1>{titles[section]}</h1>
    <p className="hub-lead">{section === "contents" ? "기록을 작품으로 만들고, 꾸미고, 공유하세요." : "코스를 찾고, 움직임을 기록하고, 나만의 작품을 남겨요."}</p>
    {section === "dashboard" && <><section className="hub-feature"><h2>오늘은 어디로 달려볼까요?</h2><p>주변 코스를 찾아보거나 자유롭게 달리기를 시작하세요.</p><Link href="/running" className="btn btn-primary">러닝 시작하기 <Icon name="play" size={18} /></Link></section><h2>빠르게 이동하기</h2><div className="hub-grid">
      <Link href="/routes" className="hub-card"><Icon name="map" /><h3>코스 찾기</h3><p>지도에서 달릴 동네와 코스를 골라요.</p><span>코스 살펴보기 →</span></Link>
      <Link href="/room" className="hub-card"><Icon name="layers" /><h3>나의 작품방</h3><p>달린 선으로 만든 작품을 모아보세요.</p><span>작품방 열기 →</span></Link>
      <Link href="/contents#import" className="hub-card"><Icon name="play" /><h3>기록으로 작품 만들기</h3><p>가지고 있는 GPX 기록을 가져와요.</p><span>기록 가져오기 →</span></Link>
    </div></>}
    {section === "running" && <><div className="hub-grid hub-two"><section className="hub-card"><Icon name="map" size={32} /><h2>코스 찾아 달리기</h2><p>달릴 동네와 거리를 설정하고 지도에서 코스를 확인하세요.</p><Link href="/routes" className="btn btn-primary">주변 코스 찾기</Link></section><section className="hub-card"><Icon name="play" size={32} /><h2>달리기 기록하기</h2><p>선택한 코스로 달리거나 자유롭게 움직이세요. 진행 중인 기록도 여기서 이어갈 수 있어요.</p><Link href="/run" className="btn btn-primary">달리기 화면 열기</Link></section></div><aside className="hub-note"><h2>달린 다음에는</h2><p>완료한 기록을 작품으로 만들어보세요.</p><Link href="/contents">콘텐츠 둘러보기 →</Link></aside></>}
    {section === "contents" && <><section className="hub-feature"><h2>나의 작품방</h2><p>기록으로 만든 작품을 배치하고 나만의 공간을 꾸며보세요.</p><Link href="/room" className="btn btn-primary">작품방 열기</Link></section><section id="import" className="hub-card"><h2>GPX 기록 가져오기</h2><p>다른 러닝 앱이나 시계에서 내보낸 기록으로 작품을 만들어요.</p><LandingStart /><details><summary>지원 파일과 개인정보 안내</summary><p>트랙이 포함된 GPX 1.0/1.1, 최대 5 MiB·20,000점·200구간을 지원해요. FIT·TCX·ZIP, 계획 경로만 있는 파일은 지원하지 않아요. 가로·세로 50km 이하 기록을 사용해 주세요. 날짜변경선·극지는 제외돼요.</p><p>실제 좌표는 브라우저에서 처리해요. 배경 도로망 요청 시 기록 주변 범위만 자료 서버로 전송해요. 서버에는 위치를 지운 상대 모양을 저장하지만, 모양이나 제목으로 장소를 추정할 수 있어요. 작품방은 기본 비공개이며 공유 링크는 직접 만들 때만 생겨요.</p></details></section></>}
  </main></>;
}
