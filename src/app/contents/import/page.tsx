import Link from "next/link";
import { LandingStart } from "@/components/LandingStart";

export const metadata = { title: "GPX 불러오기 — 요런" };

export default function ImportPage() {
  return <main className="hub-page">
    <Link href="/contents">← 콘텐츠</Link>
    <h1>GPX 기록 가져오기</h1>
    <p>다른 러닝 앱이나 시계에서 내보낸 기록으로 작품을 만들어요.</p>
    <section className="hub-card">
      <LandingStart />
      <details>
        <summary>지원 파일과 개인정보 안내</summary>
        <p>트랙이 포함된 GPX 1.0/1.1, 최대 5 MiB·20,000점·200구간을 지원해요. FIT·TCX·ZIP, 계획 경로만 있는 파일은 지원하지 않아요. 가로·세로 50km 이하 기록을 사용해 주세요. 날짜변경선·극지는 제외돼요.</p>
        <p>실제 좌표는 브라우저에서 처리해요. 배경 도로망 요청 시 기록 주변 범위만 자료 서버로 전송해요. 서버에는 위치를 지운 상대 모양을 저장하지만, 모양이나 제목으로 장소를 추정할 수 있어요. 작품방은 기본 비공개이며 공유 링크는 직접 만들 때만 생겨요.</p>
      </details>
    </section>
  </main>;
}
