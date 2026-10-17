"use client";
// 달리는 중 음성 안내 (브라우저 내장 음성 합성). 화면을 보지 않아도 방향·이탈·포인트를 알 수 있게 한다.
// iOS는 진동을 지원하지 않아 사실상 유일한 알림 수단이다. 화면이 꺼지면 브라우저가 멈춰 함께 멈춘다.

const PREF = "yorun.voice";

export function voiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function loadVoicePref(): boolean {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
}

export function saveVoicePref(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {}
}

/** iOS는 첫 음성을 사용자가 누른 순간에 내야 이후 자동 안내가 나온다. 시작 버튼에서 부른다. */
export function primeVoice() {
  if (!voiceSupported()) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

/** urgent: 방향·이탈처럼 늦으면 안 되는 안내는 앞선 말을 끊고 바로 말한다 */
export function speak(text: string, urgent = false) {
  if (!voiceSupported()) return;
  const s = window.speechSynthesis;
  if (urgent) s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.05;
  s.speak(u);
}
