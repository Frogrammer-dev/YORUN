// 3D 중계의 화면 배율. 고해상도로 그리되, 기기가 버거워하면 한 번 낮춘다.

export const SHARP_RATIO = 2;
export const SAFE_RATIO = 1.5;
const WINDOW_FRAMES = 60;
/** 평균 프레임이 이보다 길면(약 36fps 아래) 느린 구간으로 본다 */
const SLOW_MS = 28;
/** 탭을 내렸다 올리는 등 그림과 상관없는 긴 공백은 세지 않는다 */
const IGNORE_MS = 250;
const SLOW_WINDOWS = 2;

export const startRatio = (deviceRatio: number) => Math.min(deviceRatio, SHARP_RATIO);

/** 프레임 시간을 받아, 느린 구간이 연달아 나오면 한 번만 true를 돌려준다 */
export function qualityGuard() {
  let sum = 0, count = 0, slow = 0, done = false;
  return (frameMs: number) => {
    if (done || frameMs > IGNORE_MS) return false;
    sum += frameMs;
    if (++count < WINDOW_FRAMES) return false;
    slow = sum / count > SLOW_MS ? slow + 1 : 0;
    sum = 0;
    count = 0;
    if (slow < SLOW_WINDOWS) return false;
    done = true;
    return true;
  };
}
