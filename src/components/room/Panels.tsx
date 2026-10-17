"use client";
// 보관 목록 · PNG 내보내기 · 읽기 전용 공유 · 로그인 패널 (S-02, S-04)

import { useCallback, useEffect, useState } from "react";
import type { ArtworkListItemDto, ShareStatusDto } from "@/lib/contracts/types";
import { formatDistance } from "@/lib/gpx/metrics";
import { downloadBlob, renderScenePng } from "@/lib/render/png";
import type { Scene } from "@/lib/render/scene";
import { ApiError, api } from "@/lib/client/api";
import { track } from "@/lib/client/analytics";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import type { RoomApi, Session } from "./useRoom";

// ───────────────────────── 보관 목록 ─────────────────────────

export function ArchivePanel({ room, session }: { room: RoomApi; session: Session }) {
  const displayed = new Set(room.model.items.map((i) => i.artworkId));
  const [list, setList] = useState<ArtworkListItemDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (c: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ items: ArtworkListItemDto[]; nextCursor: string | null }>(`/api/artworks?limit=20${c ? `&cursor=${encodeURIComponent(c)}` : ""}`);
      setList((prev) => (c ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "목록을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  const rev = room.model.revision;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소·위치·로그인 세션)은 서버 렌더와 어긋나지 않게 첫 화면 뒤 효과에서 읽는다
    if (session.kind === "account") void load(null);
  }, [session.kind, load, rev]);

  const rows =
    session.kind === "account"
      ? list.map((a) => ({ id: a.id, title: a.title, distance: a.distanceEstimateMeters, segs: a.segmentCount, demo: a.sourceKind === "demo" }))
      : Object.values(room.model.artworks).map((a) => ({
          id: a.id,
          title: a.title,
          distance: a.stats.distanceEstimateMeters,
          segs: a.stats.segmentCount,
          demo: a.sourceKind === "demo",
        }));

  return (
    <section className="panel" aria-label="작품 보관 목록">
      <header className="panel-head">
        <h2>보관 목록</h2>
        <span className="hint">
          전시 {room.model.items.length}/20 · 보관 {room.model.artworkCount}/50
        </span>
      </header>
      {error && <p className="card card-error">{error}</p>}
      {rows.length === 0 && !loading && <p className="hint">아직 작품이 없어요.</p>}
      <ul className="archive">
        {rows.map((a) => (
          <li key={a.id}>
            <span>
              <strong>{a.title}</strong>
              {a.demo && <em className="tag">예시</em>}
              <br />
              <small>
                {formatDistance(a.distance)} · {a.segs}개 구간
              </small>
            </span>
            {displayed.has(a.id) ? (
              <span className="tag">전시 중</span>
            ) : (
              <button type="button" className="btn" onClick={() => void room.displayArtwork(a.id)} disabled={room.model.items.length >= 20}>
                방에 전시
              </button>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <button type="button" className="btn" onClick={() => void load(cursor)} disabled={loading}>
          더 보기
        </button>
      )}
    </section>
  );
}

// ───────────────────────── PNG 내보내기 ─────────────────────────

export function ExportPanel({ scene }: { scene: Scene }) {
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeDistance, setIncludeDistance] = useState(false);
  const [includeDate, setIncludeDate] = useState(false); // 날짜는 기본 제외
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function run() {
    setState("working");
    try {
      const blob = await renderScenePng(scene, { includeTitle, includeDistance, includeDate });
      downloadBlob(blob, "yorun-room.png");
      track({ name: "png_exported" });
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="panel" aria-label="이미지 저장">
      <h2>이미지 저장 (PNG 1000×750)</h2>
      <label className="check">
        <input type="checkbox" checked={includeTitle} onChange={(e) => setIncludeTitle(e.target.checked)} /> 제목 포함
      </label>
      <label className="check">
        <input type="checkbox" checked={includeDistance} onChange={(e) => setIncludeDistance(e.target.checked)} /> 추정 거리 포함
      </label>
      <label className="check">
        <input type="checkbox" checked={includeDate} onChange={(e) => setIncludeDate(e.target.checked)} /> 기록 날짜 포함
      </label>
      <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={state === "working" || scene.items.length === 0}>
        {state === "working" ? "만드는 중…" : "PNG 저장"}
      </button>
      {state === "error" && (
        <p className="card card-error" role="alert">
          이미지를 만들지 못했어요. 화면은 그대로예요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
      <p className="hint">내려받은 이미지는 링크를 종료해도 회수할 수 없어요.</p>
    </section>
  );
}

// ───────────────────────── 읽기 전용 공유 ─────────────────────────

export function SharePanel({ room, session, onNeedLogin }: { room: RoomApi; session: Session; onNeedLogin: () => void }) {
  const [includeTitles, setIncludeTitles] = useState(true);
  const [includeDistances, setIncludeDistances] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const share: ShareStatusDto | null = room.model.share;

  if (session.kind !== "account") {
    return (
      <section className="panel" aria-label="공유">
        <h2>읽기 전용 링크 공유</h2>
        <p>공유 링크는 로그인해 저장한 작품방에서 만들 수 있어요.</p>
        <button type="button" className="btn btn-primary" onClick={onNeedLogin}>
          로그인하고 저장
        </button>
      </section>
    );
  }

  async function create() {
    setError(null);
    if (room.status !== "saved") {
      setError("먼저 저장해 주세요. 링크에는 저장된 버전만 들어가요.");
      return;
    }
    if (!room.model.roomId) return;
    setWorking(true);
    try {
      const r = await api<{ shareId: string; expiresAt: string; sourceRevision: number; url: string }>(`/api/rooms/${room.model.roomId}/shares`, {
        method: "POST",
        body: { expectedRevision: room.model.revision, includeTitles, includeDistances, displayName: displayName.trim() || null },
      });
      setUrl(r.url);
      room.setShare({ id: r.shareId, expiresAt: r.expiresAt, sourceRevision: r.sourceRevision, createdAt: new Date().toISOString() });
      track({ name: "share_created" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "링크를 만들지 못했어요.");
    } finally {
      setWorking(false);
    }
  }

  async function revoke() {
    if (!share) return;
    setWorking(true);
    try {
      await api(`/api/shares/${share.id}`, { method: "DELETE" });
      room.setShare(null);
      setUrl(null);
      track({ name: "share_revoked" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "링크를 종료하지 못했어요.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="panel" aria-label="공유">
      <h2>읽기 전용 링크 공유</h2>
      <p className="hint">
        링크는 지금 저장된 모습의 복사본이에요. 이후 편집은 자동으로 반영되지 않아요. 기록 날짜·원래 위치·이메일은 공개하지 않아요. 새 링크를 만들면 이전 링크는 종료돼요.
      </p>
      <label className="check">
        <input type="checkbox" checked={includeTitles} onChange={(e) => setIncludeTitles(e.target.checked)} /> 작품 제목 공개
      </label>
      <label className="check">
        <input type="checkbox" checked={includeDistances} onChange={(e) => setIncludeDistances(e.target.checked)} /> 추정 거리 공개
      </label>
      <label className="field">
        <span>표시 이름 (선택, 20자)</span>
        <input value={displayName} maxLength={20} onChange={(e) => setDisplayName(e.target.value)} placeholder="공개하지 않음" />
      </label>
      <p className="hint">독특한 경로 모양이나 제목으로 장소를 추정할 수 있어요. 공개 전에 확인해 주세요.</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={working || room.model.items.length === 0}>
          {share ? "새 링크 만들기" : "링크 만들기"}
        </button>
        {share && (
          <button type="button" className="btn btn-danger" onClick={() => void revoke()} disabled={working}>
            링크 종료
          </button>
        )}
      </div>
      {share && <p className="hint">활성 링크 1개 · 만료 {new Date(share.expiresAt).toLocaleDateString("ko-KR")}</p>}
      {url && (
        <div className="card">
          <p>이 주소는 지금 한 번만 보여 드려요.</p>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="공유 링크" />
          <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(url)}>
            복사
          </button>
        </div>
      )}
      {error && (
        <p className="card card-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// ───────────────────────── 로그인 ─────────────────────────

export function LoginPanel({ guest, onClose, prepareDraft }: { guest: boolean; onClose: () => void; prepareDraft: () => Promise<string | null> }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "oauthError">("idle");
  const [kept, setKept] = useState<boolean | null>(null);
  const supabase = browserSupabase();

  if (!supabase) {
    return (
      <section className="panel" aria-label="로그인">
        <h2>로그인</h2>
        <p>이 실행 환경에는 저장 서비스(Supabase)가 설정되어 있지 않아요. 임시 작품방과 PNG 저장만 쓸 수 있어요.</p>
        <button type="button" className="btn" onClick={onClose}>
          계속 미리보기
        </button>
      </section>
    );
  }

  /** 로그인 후 돌아올 주소. 복귀 주소에는 예측 불가능한 draftId만 넣는다. 작품 내용은 이 기기의 IndexedDB에만 있다. */
  async function callbackUrl() {
    const draftId = guest ? await prepareDraft() : null;
    setKept(guest ? draftId !== null : null);
    const next = draftId ? `/room?draft=${encodeURIComponent(draftId)}` : "/room";
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabase!.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: await callbackUrl() } });
    setState(error ? "error" : "sent");
  }

  // 성공하면 구글 화면으로 이동했다가 /auth/callback으로 돌아온다
  async function google() {
    setState("sending");
    const { error } = await supabase!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: await callbackUrl() } });
    if (error) setState("oauthError");
  }

  return (
    <section className="panel" aria-label="로그인">
      <header className="panel-head">
        <h2>로그인하고 저장</h2>
        <button type="button" className="btn btn-link" onClick={onClose}>
          닫기
        </button>
      </header>
      {state === "sent" ? (
        <>
          <p>메일로 로그인 링크를 보냈어요. 같은 브라우저에서 링크를 열어 주세요.</p>
          {kept === false && <p className="card card-error">이 기기에 임시 작품을 보관하지 못했어요. 로그인 후 파일을 다시 선택해야 할 수 있어요.</p>}
        </>
      ) : (
        <form onSubmit={send}>
          <button type="button" className="btn btn-secondary" style={{ width: "100%" }} onClick={() => void google()} disabled={state === "sending"}>
            Google로 계속하기
          </button>
          {state === "oauthError" && (
            <p className="card card-error" role="alert">
              Google 로그인을 시작하지 못했어요. 임시 작품은 그대로예요. 이메일 링크로 로그인해 주세요.
            </p>
          )}
          <p className="hint center">또는 이메일로 로그인 링크 받기</p>
          <label className="field">
            <span>이메일</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <p className="hint">임시 작품은 이 기기(브라우저)에 계속 보관돼요. 다른 기기·브라우저에서 메일을 열면 이어받지 못할 수 있어요.</p>
          <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
            {state === "sending" ? "보내는 중…" : "로그인 링크 받기"}
          </button>
          {state === "error" && (
            <p className="card card-error" role="alert">
              로그인 메일을 보내지 못했어요. 임시 작품은 그대로예요. 다시 시도하거나 계속 미리보기를 이용해 주세요.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
