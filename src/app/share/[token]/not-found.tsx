import Link from "next/link";

export default function ShareNotFound() {
  return (
    <main className="share-page">
      <p className="card" role="alert">
        공유가 종료되었거나 링크를 찾을 수 없어요.
      </p>
      <Link href="/" className="btn">
        요런 알아보기
      </Link>
    </main>
  );
}
