// 가로로 넘기는 줄을 마우스 휠로도 넘긴다. 터치패드의 가로 쓸기와 끝에 닿은 뒤의 휠은 그대로 둬서 패널이 이어서 움직인다.

const LINE_PX = 16;

/** 줄을 얼마나 옮길지 돌려준다. 0이면 건드리지 않는다 */
export function railWheelStep(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }, scrollLeft: number, maxLeft: number) {
  if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return 0;
  const step = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY;
  // 소수점 스크롤 값 때문에 끝에서 멈춘 듯 걸리지 않도록 1px은 끝으로 본다
  if (step > 0 ? scrollLeft >= maxLeft - 1 : scrollLeft <= 1) return 0;
  return step;
}

/** ref로 붙인다. 기본 동작을 막아야 하므로 passive가 아닌 리스너를 직접 등록한다 */
export function wheelRailRef(rail: HTMLElement | null) {
  if (!rail) return;
  const onWheel = (e: WheelEvent) => {
    const step = railWheelStep(e, rail.scrollLeft, rail.scrollWidth - rail.clientWidth);
    if (!step) return;
    e.preventDefault();
    rail.scrollLeft += step;
  };
  rail.addEventListener("wheel", onWheel, { passive: false });
  return () => rail.removeEventListener("wheel", onWheel);
}
