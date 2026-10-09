"use client";
// S-02 내 작품방 (/room)

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ROOM } from "@/lib/contracts/limits";
import type { ArtworkView } from "@/lib/contracts/types";
import { DraftRepository } from "@/lib/draft/DraftRepository";
import type { Scene } from "@/lib/render/scene";
import { takePendingArtwork } from "@/lib/client/pending";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { ImportPanel } from "@/components/ImportPanel";
import { SceneSvg } from "@/components/SceneSvg";
import { ItemPanel } from "./ItemPanel";
import { ArchivePanel, ExportPanel, LoginPanel, SharePanel } from "./Panels";
import { useRoom, type SaveStatus, type Session } from "./useRoom";
import { BrandMark, Icon } from "@/components/Icon";

type Tab = "edit" | "archive" | "export" | "share" | "login";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "저장됨",
  dirty: "변경 사항 있음",
  saving: "저장 중…",
  failed: "저장 실패",
};

export function RoomApp() {
  const router = useRouter();
  const params = useSearchParams();
  const [session, setSession] = useState<Session>({ kind: "loading" });
  const room = useRoom(session);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("edit");
  const [guestRestore, setGuestRestore] = useState<"none" | "ask" | "failed">("none");
  const [accountDraftAsk, setAccountDraftAsk] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointerId: number; sx: number; sy: number; ox: number; oy: number } | null>(null);

  // ───────── 세션 확인 (화면 표시용; 권한은 서버가 판단) ─────────
  useEffect(() => {
    const sb = browserSupabase();
    if (!sb) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소·위치·로그인 세션)은 서버 렌더와 어긋나지 않게 첫 화면 뒤 효과에서 읽는다
      setSession({ kind: "guest" });
      return;
    }
    void sb.auth.getUser().then(({ data }) => {
      setSession(data.user ? { kind: "account", userId: data.user.id, email: data.user.email ?? null } : { kind: "guest" });
    });
  }, []);

  // ───────── 첫 작품 자동 전시 / 로그인 복귀 처리 ─────────
  const handledPending = useRef(false);
  useEffect(() => {
    if (!room.ready || handledPending.current) return;
    handledPending.current = true;
    const pending = takePendingArtwork();
    if (pending) void room.addArtwork(pending);

    if (params.get("login") === "failed") {
      room.setNotice({ tone: "error", text: "로그인하지 못했어요. 임시 작품은 이 기기에 그대로 있어요. 다시 시도하거나 계속 미리보기를 이용해 주세요." });
    }
    const draftParam = params.get("draft");
    if (session.kind === "account" && draftParam) {
      void DraftRepository.loadGuest()
        .catch(() => null)
        .then((d) => setGuestRestore(d && d.draftId === draftParam && d.artworks.length ? "ask" : "failed"));
    }
    if (session.kind === "account") {
      void DraftRepository.loadAccountRoom(session.userId)
        .catch(() => null)
        .then((d) => {
          if (d && d.roomId === room.model.roomId && JSON.stringify(d.items) !== JSON.stringify(room.model.items)) setAccountDraftAsk(true);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.ready]);

  const scene: Scene = useMemo(
    () => ({
      theme: room.model.theme,
      items: room.model.items
        .filter((it) => room.model.artworks[it.artworkId])
        .map((it) => {
          const a = room.model.artworks[it.artworkId];
          return {
            key: it.id,
            x: it.x,
            y: it.y,
            size: it.size,
            rotationDeg: it.rotationDeg,
            zIndex: it.zIndex,
            style: it.style,
            lines: a.renderLines,
            title: a.title,
            distanceEstimateMeters: a.stats.distanceEstimateMeters,
            recordedDate: a.stats.recordedDate,
          };
        }),
    }),
    [room.model],
  );

  const selItem = room.model.items.find((i) => i.id === selected) ?? null;
  const selArt: ArtworkView | null = selItem ? room.model.artworks[selItem.artworkId] ?? null : null;

  // ───────── 드래그 ─────────
  const toRoom = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onItemPointerDown = useCallback(
    (key: string, e: ReactPointerEvent<SVGGElement>) => {
      e.stopPropagation();
      setSelected(key);
      setTab("edit");
      const it = room.model.items.find((i) => i.id === key);
      if (!it) return;
      const p = toRoom(e.clientX, e.clientY);
      drag.current = { id: key, pointerId: e.pointerId, sx: p.x, sy: p.y, ox: it.x, oy: it.y };
      wrapRef.current?.setPointerCapture(e.pointerId);
    },
    [room.model.items],
  );

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toRoom(e.clientX, e.clientY);
    room.updateItem(d.id, { x: d.ox + (p.x - d.sx) / ROOM.width, y: d.oy + (p.y - d.sy) / ROOM.height });
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  const onItemKeyDown = useCallback(
    (key: string, e: ReactKeyboardEvent<SVGGElement>) => {
      const it = room.model.items.find((i) => i.id === key);
      if (!it) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      const map: Record<string, Partial<typeof it>> = {
        ArrowLeft: { x: it.x - step },
        ArrowRight: { x: it.x + step },
        ArrowUp: { y: it.y - step },
        ArrowDown: { y: it.y + step },
        "+": { size: it.size + 0.02 },
        "=": { size: it.size + 0.02 },
        "-": { size: it.size - 0.02 },
      };
      const patch = map[e.key];
      if (patch) {
        e.preventDefault();
        room.updateItem(key, patch);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setSelected(key);
        setTab("edit");
      }
    },
    [room],
  );

  const onItemFocus = useCallback((key: string) => setSelected(key), []);

  // ───────── 동작 ─────────
  async function onSave() {
    if (session.kind !== "account") {
      setTab("login");
      return;
    }
    await room.save();
  }

  async function logout() {
    const sb = browserSupabase();
    // 계정 전환 시 다른 계정에 조용히 합치지 않도록 기기 초안을 모두 지운다.
    await DraftRepository.clearAll().catch(() => undefined);
    await sb?.auth.signOut();
    router.replace("/");
  }

  if (session.kind === "loading" || !room.ready) {
    return (
      <main className="room-page">
        <p role="status">작품방을 여는 중…</p>
      </main>
    );
  }

  const guest = session.kind === "guest";
  const displayFull = room.model.items.length >= ROOM.maxDisplayed;

  return (
    <main className={`room-page ${selItem && tab === "edit" ? "editing" : ""}`}>
      <header className="topbar">
        <Link href="/" className="brand">
          <BrandMark size={24} />
          <span className="brand-text">요런</span>
        </Link>
        <nav className="actions">
          <Link href="/routes" className="btn btn-link hide-sm">
            코스 찾기
          </Link>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void onSave()} disabled={room.status === "saving" || (!guest && room.status === "saved")}>
            {guest ? "로그인하고 저장" : "저장"}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={room.model.theme === "light" ? "배경을 어둡게 바꾸기" : "배경을 밝게 바꾸기"}
            title={room.model.theme === "light" ? "배경을 어둡게 바꾸기" : "배경을 밝게 바꾸기"}
            onClick={() => room.setTheme(room.model.theme === "light" ? "dark" : "light")}
          >
            <Icon name={room.model.theme === "light" ? "sun" : "moon"} size={22} />
          </button>
          {!guest && (
            <button type="button" className="btn btn-link btn-sm" onClick={() => void logout()}>
              로그아웃
            </button>
          )}
        </nav>
      </header>

      {room.busy && (
        <p className="banner banner-info" role="status">
          {room.busy}…
        </p>
      )}
      {room.notice && (
        <p className={`banner banner-${room.notice.tone}`} role={room.notice.tone === "error" ? "alert" : "status"}>
          {room.notice.text}
          <button type="button" className="btn btn-link" onClick={() => room.setNotice(null)} aria-label="알림 닫기">
            ✕
          </button>
        </p>
      )}
      {room.conflict && (
        <div className="banner banner-warn" role="alert">
          다른 창에서 방이 바뀌었어요. 자동 병합은 하지 않아요.
          <button type="button" className="btn" onClick={() => void room.reloadFromServer().then((ok) => ok && setAccountDraftAsk(true))}>
            서버 버전 불러오기 (내 편집은 이 기기에 백업)
          </button>
        </div>
      )}
      {guestRestore === "ask" && session.kind === "account" && (
        <div className="banner banner-info" role="alert">
          이 기기의 임시 작품을 현재 로그인 계정({session.email ?? "내 계정"})에 저장할까요? 기존 방은 덮어쓰지 않고 작품을 추가해요.
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setGuestRestore("none");
              void room.importGuestDraft();
              router.replace("/room");
            }}
          >
            저장
          </button>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              setGuestRestore("none");
              void room.discardGuestDraft();
              router.replace("/room");
            }}
          >
            버리기
          </button>
        </div>
      )}
      {guestRestore === "failed" && (
        <p className="banner banner-warn" role="alert">
          임시 작품을 복원하지 못했어요 (만료·기기 보관 실패·다른 브라우저에서 메일을 연 경우). 파일을 다시 선택해 주세요.
          <button type="button" className="btn btn-link" onClick={() => setGuestRestore("none")}>
            닫기
          </button>
        </p>
      )}
      {accountDraftAsk && (
        <div className="banner banner-info" role="alert">
          이 기기에 저장하지 않은 편집이 있어요.
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAccountDraftAsk(false);
              void room.applyAccountDraft();
            }}
          >
            편집 불러오기
          </button>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              setAccountDraftAsk(false);
              void room.discardAccountDraft();
            }}
          >
            버리기
          </button>
        </div>
      )}

      <div className="room-layout">
        <div className="stage">
          <div className="status stage-badge" aria-live="polite">
            {guest ? (
              <span className="badge badge-temp map-glass">
                임시 작품방 · {room.deviceKeep === "tab_only" ? "현재 탭에만 있어요" : room.deviceKeep === "kept" ? "이 기기에 24시간 보관" : "미저장"}
              </span>
            ) : (
              <span className={`badge badge-${room.status} map-glass`}>{STATUS_LABEL[room.status]}</span>
            )}
          </div>
          <div ref={wrapRef} className="stage-canvas" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <SceneSvg
              scene={scene}
              svgRef={svgRef}
              selectedKey={selected}
              onItemPointerDown={onItemPointerDown}
              onItemKeyDown={onItemKeyDown}
              onItemFocus={onItemFocus}
              onBackgroundPointerDown={() => setSelected(null)}
              ariaLabel={`내 작품방, 전시 작품 ${scene.items.length}개. 작품을 선택해 끌거나 방향키로 옮길 수 있어요.`}
            />
          </div>
          {scene.items.length === 0 && <p className="hint center">전시 중인 작품이 없어요. GPX를 가져오거나 보관 목록에서 전시해 보세요.</p>}
          <div className="stage-tools">
            <ImportPanel
              compact
              onCreated={(v) => void room.addArtwork(v)}
              disabledReason={room.model.artworkCount >= ROOM.maxArtworksPerAccount ? "보관 작품 한도(50개)에 도달했어요." : null}
            />
            {displayFull && <p className="hint">전시 한도(20개)에 도달했어요. 새 작품은 보관 목록에만 추가돼요.</p>}
          </div>
        </div>

        <aside className="side">
          <div className="tabs" role="tablist">
            {(
              [
                ["edit", "편집"],
                ["archive", "보관 목록"],
                ["export", "이미지"],
                ["share", "공유"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          {tab === "edit" &&
            (selItem && selArt ? (
              <ItemPanel key={selItem.id} room={room} item={selItem} artwork={selArt} onClose={() => setSelected(null)} />
            ) : (
              <div className="empty-state">
                <Icon name="frame" size={28} />
                <p>작품을 누르면 이동·크기·회전·앞뒤·색·굵기·액자를 바꿀 수 있어요. 꾸미지 않아도 그대로 저장할 수 있어요.</p>
              </div>
            ))}
          {tab === "archive" && <ArchivePanel room={room} session={session} />}
          {tab === "export" && <ExportPanel scene={scene} />}
          {tab === "share" && <SharePanel room={room} session={session} onNeedLogin={() => setTab("login")} />}
          {tab === "login" && (
            <LoginPanel
              guest={guest}
              prepareDraft={async () => ((await room.persistNow()) ? room.draftId.current : null)}
              onClose={() => setTab("edit")}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
