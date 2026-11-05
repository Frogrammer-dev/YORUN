// 캐릭터 생김새로 달리는 방식을 고른다. 이름이 있으면 이름을 먼저 보고, 없으면 윤곽 모양으로 어림한다.
// 연출용 판별이며 사물 인식 성공을 뜻하지 않는다.

export const BODY_PLANS = ["biped", "quadruped", "roller"] as const;
export type BodyPlan = (typeof BODY_PLANS)[number];
export const BODY_LABELS: Record<BodyPlan, string> = { biped: "두 발로 뛰어요", quadruped: "네 발로 달려요", roller: "데굴데굴 굴러요" };

const NAME_RULES: [RegExp, BodyPlan][] = [
  [/강아지|개|고양이|토끼|말|소|호랑이|사자|늑대|여우|곰|돼지|양|염소|사슴|코끼리|기린|dog|cat|rabbit|horse/i, "quadruped"],
  [/사람|로봇|펭귄|닭|오리|새|공룡|곰돌이|person|robot|bird/i, "biped"],
  [/공|동그라미|원|도넛|수박|사과|달|별|하트|물방울|ball|circle|donut/i, "roller"],
];

type Pt = readonly number[];

function polygonArea(line: readonly Pt[]) {
  let sum = 0;
  for (let i = 0; i < line.length; i++) {
    const p = line[i], q = line[(i + 1) % line.length];
    sum += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(sum) / 2;
}

function convexHull(line: readonly Pt[]): Pt[] {
  const points = [...line].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (input: Pt[]) => {
    const out: Pt[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(points), ...half(points.reverse())];
}

/** y가 아래로 가는 좌표에서, 바닥 근처의 가로선이 윤곽 안을 지나는 구간 수. 다리처럼 내려온 돌출부를 센다 */
export function countFeet(line: readonly Pt[]): number {
  const ys = line.map((p) => p[1]);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const scan = bottom - (bottom - top) * 0.12;
  const crossings: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i], q = line[(i + 1) % line.length];
    if ((p[1] > scan) !== (q[1] > scan)) crossings.push(p[0] + ((scan - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
  }
  return Math.floor(crossings.length / 2);
}

/** line은 지도 좌표(y가 아래). 시작점과 끝점이 같아도 된다 */
export function classifyBody(line: readonly Pt[] | null, name = ""): BodyPlan {
  for (const [pattern, plan] of NAME_RULES) if (pattern.test(name)) return plan;
  if (!line || line.length < 4) return "biped";
  const open = line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1] ? line.slice(0, -1) : line;
  const hull = polygonArea(convexHull(open));
  if (hull > 0 && polygonArea(open) / hull > 0.8) return "roller";
  return countFeet(open) >= 3 ? "quadruped" : "biped";
}

/** 기본 유형과 봇의 몸: 코너를 잘 도는 유형일수록 잘 구른다 */
export const STYLE_BODIES = { speed: "biped", balance: "quadruped", corner: "roller" } as const satisfies Record<string, BodyPlan>;
