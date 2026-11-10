import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "페이지를 찾을 수 없어요 — 요런" };

// 없는 주소: Next.js 기본 영어 404 대신 한국어 안내와 메인으로 가는 길을 보여 준다
export default function NotFound() {
  return (
    <main className="hub-page auth-page">
      <div className="hub-body">
        <div className="auth-head">
          <h1>페이지를 찾을 수 없어요</h1>
          <p>주소가 바뀌었거나 없어진 페이지예요.</p>
        </div>
        <Link href="/" className="btn btn-primary wide">
          메인으로 가기
        </Link>
      </div>
    </main>
  );
}
