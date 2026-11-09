import { existsSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import phrases from "@/lib/run/voicePhrases.json";
import { CAP_PHRASE, OFF_ROUTE_PHRASE, kmPhrase, pointsPhrase } from "@/lib/run/spoken";
import { speak, stopVoice } from "@/lib/run/voice";

const manifest = phrases as Record<string, number>;

describe("음성 파일", () => {
  const spoken = [
    OFF_ROUTE_PHRASE, CAP_PHRASE,
    ...[100, 200, 300, 400, 500].map(pointsPhrase),
    ...Array.from({ length: 42 }, (_, i) => kmPhrase(i + 1)),
    "달리기를 시작했어요", "잠시 후 좌회전이에요.", "약 100미터 후 우회전이에요.",
  ];

  it("달리는 중 말하는 문구마다 남녀 파일이 모두 있다", () => {
    for (const text of spoken) {
      const id = manifest[text];
      expect(id, text).toBeTypeOf("number");
      for (const voice of ["male", "female"]) {
        const file = `public/run-voices/${voice}-${id}.mp3`;
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, file).toBeGreaterThan(2000);
      }
    }
  });

  it("번호가 겹치지 않는다", () => {
    const ids = Object.values(manifest);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("speak", () => {
  const device = vi.fn();
  const plays: string[] = [];
  let current: { paused: boolean; pause: () => void; play: () => Promise<void>; src: string } | null;

  beforeEach(() => {
    device.mockClear();
    plays.length = 0;
    current = null;
    vi.stubGlobal("window", { speechSynthesis: { cancel: vi.fn(), speak: device, getVoices: () => [] } });
    vi.stubGlobal("localStorage", { getItem: () => "male" });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
    vi.stubGlobal("Audio", class {
      paused = true;
      src: string;
      constructor(src: string) { this.src = src; current = this as never; }
      pause() { this.paused = true; }
      play() { this.paused = false; plays.push(this.src); return Promise.resolve(); }
    });
  });
  afterEach(() => { stopVoice(); vi.unstubAllGlobals(); });

  it("고른 목소리의 파일을 재생하고 기기 TTS를 쓰지 않는다", () => {
    speak(pointsPhrase(100));
    expect(plays).toEqual([`/run-voices/male-${manifest[pointsPhrase(100)]}.mp3`]);
    expect(device).not.toHaveBeenCalled();
  });

  it("긴급하지 않은 안내는 재생 중인 회전 안내를 끊지 않는다", () => {
    speak("잠시 후 좌회전이에요.", true);
    const turn = current;
    speak(pointsPhrase(100));
    expect(turn!.paused).toBe(false);
    expect(plays).toHaveLength(1);
  });

  it("긴급 안내는 재생 중인 안내를 끊는다", () => {
    speak(pointsPhrase(100));
    const first = current;
    speak("잠시 후 좌회전이에요.", true);
    expect(first!.paused).toBe(true);
    expect(plays).toHaveLength(2);
  });

  it("앞 안내가 끝났으면 다음 안내를 재생한다", () => {
    speak(pointsPhrase(100));
    current!.paused = true;
    speak(kmPhrase(1));
    expect(plays).toHaveLength(2);
  });

  it("파일이 없는 문구만 기기 TTS로 넘어간다", () => {
    speak(kmPhrase(43));
    expect(plays).toEqual([]);
    expect(device).toHaveBeenCalledTimes(1);
  });
});
