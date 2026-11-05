import Link from "next/link";
import { Icon, PathThumb } from "@/components/Icon";
import { SHAPES } from "@/lib/route/shapes";

export const metadata = { title: "도감 — 요런" };

export default function CatalogPage() {
  return (
    <main className="hub-page">
      <header className="appbar">
        <Link href="/hub" className="icon-btn appbar-back" aria-label="콘텐츠로 돌아가기">
          <Icon name="back" size={24} />
        </Link>
        <span className="appbar-title">
          <h1>도감</h1>
        </span>
      </header>
      <div className="hub-body">
        <p>코스 찾기에서 선택할 수 있는 그림 모양이에요.</p>
        <div className="hub-tiles">
          {SHAPES.map((shape) => (
            <article key={shape.id} className="hub-tile">
              <PathThumb lines={[shape.points]} size={96} />
              <strong>{shape.name}</strong>
            </article>
          ))}
        </div>
        <Link href="/routes" className="btn btn-primary btn-lg wide">코스 찾기</Link>
      </div>
    </main>
  );
}
