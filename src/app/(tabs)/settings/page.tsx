"use client";
// 데이터와 계정: 되돌릴 수 없는 삭제만 모은 화면. 모달 대신 화면 안에서 한 번 더 확인한다.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { clearDeviceData, hasRunInProgress } from "@/lib/client/deviceData";

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [askDevice, setAskDevice] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const auth = browserSupabase()?.auth;
    if (!auth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그인 상태는 브라우저에서만 알 수 있다
      setEmail(null);
      return;
    }
    void auth.getUser().then(({ data }) => setEmail(data.user ? (data.user.email ?? "로그인한 계정") : null));
  }, []);

  async function wipeDevice() {
    if (busy) return;
    if (hasRunInProgress()) {
      setAskDevice(false);
      setMessage("끝내지 않은 달리기가 있어요. 먼저 달리기를 끝내거나 버려 주세요.");
      return;
    }
    setBusy(true);
    const done = await clearDeviceData();
    setBusy(false);
    setAskDevice(false);
    setMessage(done ? "이 기기의 데이터를 지웠어요." : "일부를 지우지 못했어요. 브라우저 설정에서 사이트 데이터를 지워 주세요.");
  }

  async function deleteAccount() {
    if (busy || typed !== "삭제") return;
    if (hasRunInProgress()) {
      setMessage("끝내지 않은 달리기가 있어요. 먼저 달리기를 끝내거나 버려 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/me/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: typed }) });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw Error(data?.message ?? "계정을 삭제하지 못했어요.");
      }
      await browserSupabase()?.auth.signOut({ scope: "local" }).catch(() => undefined);
      await clearDeviceData();
      setEmail(null);
      setTyped("");
      setMessage("계정과 서버 데이터를 삭제했어요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "계정을 삭제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="hub-page">
      <header className="appbar">
        <Link href="/hub" className="icon-btn appbar-back" aria-label="콘텐츠로 돌아가기">
          <Icon name="back" size={24} />
        </Link>
        <span className="appbar-title">
          <h1>데이터와 계정</h1>
        </span>
      </header>
      <div className="hub-body">
        {message && <p className="battle-msg" role="status">{message}</p>}

        <section className="hub-card">
          <h2>이 기기 데이터</h2>
          <p>고른 코스, 끝낸 달리기 결과, 러닝 통계, 포인트, 임시 작품방, 대결 대기 기록을 지워요. 음성과 지도 표시 설정은 남아요.</p>
          <p className="hint">설치형 기록 앱의 원본 위치는 기록 앱의 삭제 버튼으로 지워 주세요. 이미 공유한 GPX 파일은 지울 수 없어요.</p>
          {askDevice ? (
            <div className="danger-confirm">
              <p>지우면 되돌릴 수 없어요. 저장하지 않은 임시 작품과 포인트도 사라져요.</p>
              <button type="button" className="btn btn-danger wide" disabled={busy} onClick={() => void wipeDevice()}>이 기기 데이터 지우기</button>
              <button type="button" className="btn btn-ghost wide" disabled={busy} onClick={() => setAskDevice(false)}>취소</button>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary wide" onClick={() => { setMessage(""); setAskDevice(true); }}>이 기기 데이터 지우기</button>
          )}
        </section>

        <section className="hub-card">
          <h2>계정 삭제</h2>
          {email === undefined && <p className="hint">계정을 확인하고 있어요.</p>}
          {email === null && (
            <>
              <p>로그인하지 않았어요. 서버에 저장한 작품이 있다면 로그인한 뒤 삭제할 수 있어요.</p>
              <Link href="/room" className="btn btn-secondary wide">로그인하러 가기</Link>
            </>
          )}
          {email && (
            <>
              <p>{email} 계정을 삭제해요. 작품방, 작품, 공유 링크, 대결 선수와 전적이 지워지고 되돌릴 수 없어요.</p>
              <p className="hint">끝난 8인 더비의 능력치는 다른 참가자의 결과라서, 누구의 기록인지 알 수 없게 바꿔 남겨요. 모집 중인 경주에서는 빠져요. 상대방의 전적에서도 나와의 대결이 사라져요.</p>
              <label className="field">
                <span>확인을 위해 삭제라고 입력해 주세요</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
              <button type="button" className="btn btn-danger wide" disabled={busy || typed !== "삭제"} onClick={() => void deleteAccount()}>
                {busy ? "삭제하는 중" : "계정 영구 삭제"}
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
