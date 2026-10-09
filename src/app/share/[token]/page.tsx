// S-04 읽기 전용 공유 화면. 편집·추가·원본 다운로드 없음, 외부 분석·광고 호출 없음.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SceneSvg } from "@/components/SceneSvg";
import type { Scene } from "@/lib/render/scene";
import { readSharedSnapshot } from "@/lib/server/shareRead";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "공유된 작품방 — 요런",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await readSharedSnapshot(token);

  // 없음·만료·폐기는 모두 같은 404 (개인 정보 미노출)
  if (r.status === "not_found") notFound();
  if (r.status !== "ok") {
    return (
      <main className="share-page">
        <p className="card" role="alert">
          지금은 공유 화면을 열 수 없어요. 잠시 뒤 다시 시도해 주세요.
        </p>
        <Link href="/" className="btn">
          요런 알아보기
        </Link>
      </main>
    );
  }

  const s = r.snapshot;
  const scene: Scene = {
    theme: s.theme,
    items: s.items.map((it, i) => ({
      key: String(i),
      x: it.x,
      y: it.y,
      size: it.size,
      rotationDeg: it.rotationDeg,
      zIndex: it.zIndex,
      style: it.style,
      lines: it.lines,
      title: it.title,
      distanceEstimateMeters: it.distanceEstimateMeters,
    })),
  };

  return (
    <main className="share-page">
      <header className="share-head">
        <h1>{s.displayName ? `${s.displayName}의 작품방` : "공유된 작품방"}</h1>
        <p className="hint">읽기 전용 복사본이에요. 작품은 사용자가 제공한 GPS 기록의 선이며, 실제 운동 여부는 확인하지 않았어요.</p>
      </header>
      <div className="stage-canvas">
        <SceneSvg scene={scene} showLabels ariaLabel={`공유된 작품방, 작품 ${scene.items.length}개`} />
      </div>
      <p>
        <Link href="/" className="btn">
          나도 내 기록으로 만들어 보기
        </Link>
      </p>
    </main>
  );
}
