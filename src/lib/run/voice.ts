"use client";
// 달리는 중 음성 안내 (브라우저 내장 음성 합성). 화면을 보지 않아도 방향·이탈·포인트를 알 수 있게 한다.
// iOS는 진동을 지원하지 않아 사실상 유일한 알림 수단이다. 화면이 꺼지면 브라우저가 멈춰 함께 멈춘다.

const PREF = "yorun.voice";
import phrases from "./voicePhrases.json";
export type RunVoice = "female" | "male";
export function selectedVoice(): RunVoice {
  try { return localStorage.getItem("yorun.runVoice") === "male" ? "male" : "female"; }
  catch { return "female"; }
}
let clip: HTMLAudioElement | null = null;
export function stopVoice() {
  clip?.pause();
  clip = null;
  window.speechSynthesis?.cancel();
}
export function selectVoice(voice: RunVoice) {
  try { localStorage.setItem("yorun.runVoice",voice); } catch {}
  speak("약 100미터 후 좌회전이에요.",true,voice);
}

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
export function speak(text: string, urgent = false, voice = selectedVoice()) {
  const id = (phrases as Record<string,number>)[text];
  if (urgent) stopVoice();
  if (id !== undefined) {
    clip?.pause();
    window.speechSynthesis?.cancel();
    const audio = new Audio(`/run-voices/${voice}-${id}.mp3`);
    clip = audio;
    void audio.play().catch(() => { if (clip === audio) deviceSpeak(text); });
    return;
  }
  if (!urgent && clip && !clip.paused) return;
  deviceSpeak(text);
}
function deviceSpeak(text: string) {
  if (!voiceSupported()) return;
  const s = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  const korean = s.getVoices().filter(v => /^ko(?:[-_]|$)/i.test(v.lang));
  u.voice = korean.find(v => /enhanced|premium|natural|고품질/i.test(v.name))
    ?? korean.find(v => v.default) ?? korean[0] ?? null;
  u.rate = 0.98;
  s.speak(u);
}
