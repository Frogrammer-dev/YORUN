"use client";
// 게스트가 6시간을 넘기면 이 기기의 기록을 지우고 로그아웃한다. 달리는 중이면 다음에 앱을 열 때 지운다.

import { useEffect } from "react";
import { clearDeviceData, hasRunInProgress } from "@/lib/client/deviceData";
import { forgetGuestExpiry, trackGuestExpiry } from "@/lib/client/guestExpiry";
import { browserSupabase } from "@/lib/client/supabaseBrowser";

export function GuestExpiry() {
  useEffect(() => {
    const auth = browserSupabase()?.auth;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isGuest = false;

    async function expire() {
      if (hasRunInProgress()) return;
      await clearDeviceData();
      forgetGuestExpiry(localStorage);
      if (isGuest) {
        await auth?.signOut({ scope: "local" }).catch(() => undefined);
        window.location.assign("/login");
      }
    }

    function check(user: Parameters<typeof trackGuestExpiry>[0]) {
      clearTimeout(timer);
      isGuest = !!user?.is_anonymous;
      const expires = trackGuestExpiry(user, localStorage);
      if (expires !== null) timer = setTimeout(() => void expire(), Math.max(0, expires - Date.now()));
    }

    if (!auth) {
      check(null);
      return () => clearTimeout(timer);
    }
    // 세션이 없을 때도 호출되어, 로그아웃한 게스트의 기록까지 확인한다
    const { data } = auth.onAuthStateChange((_event, session) => check(session?.user));
    return () => {
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);
  return null;
}
