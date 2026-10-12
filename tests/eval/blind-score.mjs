// 블라인드 판정 집계: node tests/eval/blind-score.mjs
// eval/blind/key.json(정답)과 eval/blind/results/*.json(판정자마다 하나)을 합쳐 방식별 인식률을 낸다.
// 판정 파일 형식: { who, items: [{ id, guess, match, agree }] }
//   match: 1단계 답이 의도한 이름과 같은 것을 가리키는가 (true/false) — '모르겠음'은 false
//   agree: 2단계 정답 공개 후 "그렇게 보인다" 1~5
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "eval/blind";
const key = JSON.parse(readFileSync(`${DIR}/key.json`, "utf8"));
const judges = readdirSync(`${DIR}/results`)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${DIR}/results/${f}`, "utf8")));
if (!key.length || !judges.length) throw new Error("판정 세트와 결과가 최소 하나씩 필요합니다.");
for (const judge of judges) {
  if (!Array.isArray(judge.items) || new Set(judge.items.map((x) => x.id)).size !== judge.items.length) throw new Error("중복 또는 잘못된 판정 항목입니다.");
  for (const item of key) {
    const answer = judge.items.find((x) => x.id === item.id);
    if (!answer || typeof answer.match !== "boolean" || !Number.isInteger(answer.agree) || answer.agree < 1 || answer.agree > 5) {
      throw new Error(`${judge.who}: ${item.id}의 명시적 match(true/false)·agree(1~5)가 필요합니다. 누락을 오답으로 처리하지 않습니다.`);
    }
  }
}
const METHODS = ["doodle", "discover", "shape"];
const LABEL = { doodle: "낙서 인식 이름 (지금 추천)", discover: "동네 고리 × 기본 그림", shape: "그림 지정 모드" };

const byId = (j) => Object.fromEntries(j.items.map((x) => [x.id, x]));
const J = judges.map((j) => ({ who: j.who, m: byId(j) }));
const unknown = (g) => !g || /모르|^\?$/.test(g);

/** 순위 상관 (동점은 평균 순위) */
function spearman(a, b) {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}
const pct = (x) => `${Math.round(x * 100)}%`;
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");

const rows = [];
rows.push(`판정자 ${J.length}명: ${J.map((j) => j.who).join(", ")}\n`);
rows.push(`| 방식 | 개수 | 맞힘 (판정자별) | 맞힘 평균 | 모르겠음 | 납득 평균 (1~5) | 점수↔맞힘 상관 |`);
rows.push(`|---|---|---|---|---|---|---|`);
const rate = {};
for (const m of METHODS) {
  const ks = key.filter((k) => k.method === m);
  const per = J.map((j) => ks.filter((k) => j.m[k.id]?.match).length / ks.length);
  const avg = per.reduce((s, x) => s + x, 0) / per.length;
  rate[m] = avg;
  const unk = J.map((j) => ks.filter((k) => unknown(j.m[k.id]?.guess)).length).reduce((s, x) => s + x, 0) / (ks.length * J.length);
  const agrees = J.flatMap((j) => ks.map((k) => j.m[k.id]?.agree).filter(Boolean));
  const agree = agrees.reduce((s, x) => s + x, 0) / agrees.length;
  // 방식 안에서 점수(확신도·유사도)가 높을수록 더 잘 맞히는가
  const hit = ks.map((k) => J.filter((j) => j.m[k.id]?.match).length / J.length);
  const rho = spearman(ks.map((k) => k.score), hit);
  rows.push(`| ${LABEL[m]} | ${ks.length} | ${per.map(pct).join(" / ")} | **${pct(avg)}** | ${pct(unk)} | ${f2(agree)} | ${f2(rho)} |`);
}
// 판정자끼리 '맞힘' 일치 (Cohen κ, 처음 두 명)
if (J.length >= 2) {
  const a = key.map((k) => !!J[0].m[k.id]?.match), b = key.map((k) => !!J[1].m[k.id]?.match);
  const po = a.filter((x, i) => x === b[i]).length / a.length;
  const pa = a.filter(Boolean).length / a.length, pb = b.filter(Boolean).length / b.length;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  rows.push(`\n판정자 일치 (맞힘 여부): ${pct(po)}, Cohen κ = ${f2((po - pe) / (1 - pe))}`);
}
// 전체 점수 ↔ 납득
const allAgree = key.map((k) => J.map((j) => j.m[k.id]?.agree ?? 0).reduce((s, x) => s + x, 0) / J.length);
rows.push(`점수(확신도·유사도) ↔ 납득 상관, 전체: ${f2(spearman(key.map((k) => k.score), allAgree))}`);
// 네모·세모 같은 기본 도형은 맞히기 쉬워 '그림 코스'의 품질을 부풀린다 → 빼고 다시 본다
const BASIC = new Set(["네모", "세모", "다이아몬드", "동그라미"]);
rows.push(`\n기본 도형(${[...BASIC].join("·")}) 제외:`);
for (const m of METHODS) {
  const ks = key.filter((k) => k.method === m && !BASIC.has(k.name));
  const hit = ks.length ? J.map((j) => ks.filter((k) => j.m[k.id]?.match).length).reduce((s, x) => s + x, 0) / (ks.length * J.length) : 0;
  rate[m] = hit;
  rows.push(`- ${LABEL[m]}: ${ks.length}개, 맞힘 ${pct(hit)}`);
}
const best = Math.max(rate.discover, rate.shape);
rows.push(
  `\n판정 규칙: 템플릿 방식(${pct(best)}) ÷ 지금 추천(${pct(rate.doodle)}) = ${rate.doodle ? (best / rate.doodle).toFixed(1) + "배" : "∞"} → ${
    best >= 1.5 * rate.doodle && best > 0.15 ? "템플릿 우선 방식으로" : Math.max(best, rate.doodle) < 0.3 ? "셋 다 낮음: 실현성 문제부터" : "차이 작음: 추가 판정 필요"
  }`,
);
// 항목별 표 (검토용)
rows.push(`\n| id | 방식 | 의도 | 점수 | ${J.map((j) => `${j.who} 답 (맞힘·납득)`).join(" | ")} |`);
rows.push(`|---|---|---|---|${J.map(() => "---").join("|")}|`);
for (const k of key)
  rows.push(`| ${k.id} | ${k.method} | ${k.name} | ${k.score} | ${J.map((j) => { const x = j.m[k.id]; return x ? `${x.guess} (${x.match ? "O" : "X"}·${x.agree ?? "-"})` : "-"; }).join(" | ")} |`);

const out = rows.join("\n");
writeFileSync(`${DIR}/score.md`, out + "\n");
console.log(out);
