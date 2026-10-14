# 실제 corridor macrocycle 생성 설계 검토

2026-10-13. AI 전문가 설계 검토 문서이며 구현 또는 성능 검증 결과가 아니다. 평가식, 원본 도형, 원래 세 지역, 3–8km 거리, 반복률 0.2 제한을 유지한다. 새 holdout는 읽지 않았다.

## 권고

**직교 네 변 열거를 모든 방향의 실제 교차점 port graph에서 5–16개 corridor run을 연결하는 고리 생성으로 교체하는 독립 실험을 권고한다.** 기존 자동 cascade의 최종 후보를 보존하고, 추가 생성 고리를 원래 평가식과 동일한 배치 정련 예산으로 비교한다. 기존 경로 수선과 별개로, 실제 도로에서 처음부터 새로운 큰 윤곽을 발견하는 단계다.

5–8개까지만 허용하면 서면 square의 표현 문제 하나는 줄일 수 있지만 약한 star/cat에 충분한 표현이라는 근거는 없다. 원본 star는 열 개 변과 다섯 개 안쪽 골짜기, cat은 열네 개 변과 두 귀 주변의 방향 전환을 갖는다. 도로 corridor 수와 도형 변 수가 일대일 대응하는 것은 아니므로 16도 충분성 증명은 아니다. 다만 4 또는 8이라는 작은 상한을 유지한 채 약한 도형까지 해결했다고 주장하는 오류를 피한다.

## 현재 근거와 해석

- 자동 from-roads cascade의 고정 12조건 평균은 표시 77.416667, raw 77.317593, 실패 0이다. 광안리 square/heart/star/cat은 71/76/73/71, 서면은 85/75/73/74, 강남은 98/81/77/75다. 목표 표시 평균 80까지 총점 31점이 더 필요하다. 강남 square를 조금 정련하는 것으로는 부족하다.
- v5 clipping은 강남 기존 98점 경로의 실제 65개 간선을 모두 표현했다. 발견 최고는 같은 geometry의 raw 98.098873으로 기존 98.203693보다 낮다. 표현 복구와 품질 향상은 별개다.
- v6는 실제 연결만으로 짧은 corner를 복원했지만 서면 3km 이상 고리 0개였다. 서면 기존 85점 경로는 서로 다른 여덟 selected run과 82.619m 짧은 run을 사용한다. 네 run을 남기는 70개 분할에서 최대 connector gap의 최솟값도 444.807m여서 현재 120m 제한으로 그 정확한 geometry를 표현할 수 없다.
- 기존 서면 corner를 shared node 262로 바꾸면 길이가 3185.865→3213.803m로 증가한다. 두 side가 실제로 연장되기 때문이다. 따라서 이 사례의 실패를 최단 corner가 전체 경로를 3km 미만으로 줄였기 때문이라고 설명할 수 없다. 이 진단은 새 geometry의 점수 향상을 입증하지 않았다.
- v6는 heading 차가 90±10°인 pair만 연결하고 네 corridor를 두 평행 쌍으로 제한한다. 이 구조는 별과 귀의 비직교·오목 윤곽을 직접 표현하기 어렵다. 단순히 DFS 깊이만 늘리고 같은 직교 연결 제한을 유지하는 후속은 권고하지 않는다.

근거: `eval/recognition/route-improvement/offline-cascade-20261013/results.json`, `road-geometry-cycles-v5-20261013/`, `road-geometry-cycles-v6-20261013/`, `road-connector-representation-20261013/results.json`; 코드 `src/lib/route/shapes.ts`, `roadConnectorCycles.ts`, `clippedRoadCorridors.ts`.

## 실제 그래프 표현

1. 현재 mutual-unique continuation 10°의 최대 corridor 분해를 유지한다. 원래 ROI 안 기존 node의 연속 run만 보존한다. 경계 교차점이나 chord 교차점을 실제 경로 node로 삽입하지 않는다.
2. **모든 heading의 실제 shared node를 port로 등록한다.** 각 chain의 endpoint와 다른 chain이 만나는 내부 node가 port다. 두 port 사이의 corridor slice는 전체 원래 node sequence와 실제 간선 길이, 방향, 간선 집합을 가진 방향성 macro arc다. 한 chain에 여러 교차점이 있으면 여러 진입·탈출 선택을 유지한다. 한 pair에서 첫 shared node만 선택하지 않는다.
3. min80m/chord0.96을 통과한 긴 support만으로 그래프를 만들면 이미 확인된 short-run coverage 결손이 남는다. 관측 trace의 short run도 실제 간선 연결층으로 보존한다. 이는 원래 extractor를 조용히 수정하는 것이 아니라 별도의 macrograph 입력 정책으로 기록한다. 곡선 trace는 실제 노드의 방향 전환점에서 나눠 간선을 보존한다. 도로 간선 하나도 chord로 대체하지 않는다.
4. 첫 독립 실험은 실제 shared node 및 원래 short-run 연결만 사용한다. 공간 교차 추정에 기반한 새 라우팅은 추가하지 않아 depth/직교 제한 제거의 효과를 분리한다. 필요 시 후속 버전에서 기존 radius60/actual length120 정책의 실제 connector를 더하되, 각 heading pair를 처리하는 비용과 추가 coverage를 별도로 보고한다.
5. 같은 chain의 서로 다른 slice를 사용하는 것은 금지하지 않는다. 상태는 실제 edge의 사용 횟수·누적 길이를 추적한다. 단순 chain ID 중복 금지는 원래 repeat≤0.2와 다른 추가 제약이므로 기본 정책에 넣지 않는다. 모든 macro arc는 actual-edge 검사를 통과해야 한다.

## 점수와 독립인 후보 탐색

전체 elementary cycle 열거는 지수적이므로 완전 탐색을 주장하지 않는 사전 고정 예산 탐색이 필요하다. 다음은 시작 실험의 구체적 정책 제안이다. 결과를 본 뒤 지역별 값으로 조정하지 않는다.

- depth는 최대 16개의 긴 corridor run이다. 짧은 연결 arc는 길이에 포함하지만 긴 run 개수와 별도로 계측한다. 무한 short-arc 확장을 막는 총 macro arc 깊이 상한 32도 기록한다. 기존 4-run v5/v6 최종 incumbent는 별도로 보존한다.
- 실제 port 좌표를 정렬하여 시작 상태를 만든다. 각 확장 단계는 현재 port의 outgoing arc를 접선 heading 8bin × 실제 길이 4bin으로 분류한다. 각 bin에서 고정 해시 순위 한 개를 선택하여 최대 fanout32로 제한한다. 거리는 원래 arc 길이로 분류하고 Q 또는 도형 배치를 사용하지 않는다. 긴 arc가 짧은 arc에 일괄 밀리지 않게 한다.
- 같은 깊이에서 최대 4096상태를 유지한다. 시작점의 ROI 4×4 공간 bin, 누적 길이 4bin, 오목 방향 전환 수 2bin의 128 strata에 각 32개 해시 순위 상태를 배정한다. 오목 전환은 방향 부호를 일관되게 정한 뒤 두 방향을 대칭적으로 처리하며, 원식의 zigzag와 동일하다고 주장하지 않는다. 완성 고리는 winding 방향을 정규화해 다시 분류한다.
- 상태가 길이8km를 넘으면 즉시 제거한다. 현재 port에서 시작 port까지 실제 graph 최단거리 하한을 더해8km를 넘으면 제거한다. 이 하한은 거리를 위한 admissible bound이고 Q의 bound가 아니다. 깊이가 아직 남았다는 이유만으로3km 미만 상태를 제거하지 않는다.
- 반복률은 완성 시 원식으로 검사한다. 중간에 repeat/currentLength가0.2를 넘는다는 이유만으로 제거하면 이후 길이 증가로 통과할 상태를 놓칠 수 있다. 안전한 중간 제거는 repeatedLength/8000>0.2인 경우다.
- 완성 고리는 실제 undirected edge multiset으로 중복 제거한다. 경로 방향·출발점을 바꿔 후보 수를 늘리지 않는다. 도형 평가 전 geometry hash로 정렬하되, 최종 pool도 길이 4bin × 오목 turn 수 4bin × 공간 중심 4bin의 strata에서 균등하게 뽑는다. 총 cap256을 제안한다. 앞선 cap48의 단일 lexical prefix가 특정 위치나 node ID에 치우치는 문제를 피한다.
- node ID가 바뀌어도 결과가 같도록 hash 입력은 원래 좌표의 안정적 key와 실제 간선 multiset이다. 원자료 좌표를 변형하거나 경로 점을 반올림하는 것이 아니라 순서·hash 표현에만 안정적 좌표 key를 사용한다.

이 방식의 pruning은 Q를 읽지 않는다는 뜻이며 도형에 좋은 후보를 보존한다는 보장은 아니다. turn/length/space bin은 검색 다양성 확보 정책이지 새로운 품질 점수 또는 유사도 정의가 아니다. fanout, 깊이, 해시 cap 때문에 놓친 좋은 경로가 있을 수 있다는 제한을 보고한다.

## 원래 평가 및 제어 실험

먼저 macrograph coverage와 frozen positive control의 정확한 replay를 검사한다. 서면 85점 경로와 강남 98점 경로는 표현 검사에만 쓰고 검색의 seed, 시작 port 순서, 해시 quota, 각도 제안에 넣지 않는다. square replay 성공은 cat/star 성공의 대리 지표가 아니다.

원래 3개 지역에서 한 번 만든 동일 geometry pool을 네 도형에 평가한다. 각 고리에 uniform translation/rotation/scale만 허용한다. 후보마다 같은 자동 pose 가설 수와 동일 정련 예산을 고정하고, 원래 evaluatePath를 그대로 호출한다. 실제 폐곡선·3–8km·repeat≤0.2·route와 template 원래 ROI 조건을 다시 검증한다. final path는 template point0에 맞춘 canonical start와 방향을 사용하고, 기존 original/canonical 중 높은 baseline을 보존한다.

현재 automatic 출력에서 추가 단계만 재생한 실험은 저장 출력 후속 실험으로 이름 붙인다. 개선이 나오면 cold부터 macrocycle 단계까지 원자료만으로 다시 실행해야 자동 from-roads 평균의 증거가 된다. 독립 holdout-v2는 정책 선택 이후 한 번 검사한다.

사전 ablation은 같은 전체 expansion 예산에서 (a) 직교 4-run 대조, (b) 모든 heading 5–8-run, (c) 모든 heading 5–16-run이다. 차이를 chain depth 효과와 heading coverage 효과로 나눠 보고한다. 추가 short-run 보존 여부도 별도 계측한다. 모든 variant의 실제 평가·pose 정련 호출 수를 기록해 더 많은 Q 호출을 topology 효과로 오인하지 않는다.

## 비용과 중단 판정

지역당 최대 32층 × 4096상태 × fanout32는 약 419만 expansion 시도 상한이다. 매번 전체 node 배열을 복제하지 말고 persistent parent, macro arc 참조, 작은 edge-use delta를 저장한다. 상태 정렬은 bounded heap으로 strata별32개만 보존한다. outgoing macro slice를 lazy 생성하면 port가 많은 chain의 제곱 조합을 미리 저장하지 않아도 된다.

256고리 × 4도형 × 3지역은 최대3072 geometry-shape fit 작업이다. 각 작업의 가설 수와 정련 횟수는 곱으로 추가되므로 cap256 자체를 전체 평가 비용으로 부르면 안 된다. 기존 v5 강남의 decomposition12ms/cycle834ms/fit81ms는 4-run 46valid 후보의 측정이며 이 방식의 시간 예측에 직접 외삽할 수 없다. 초 단위 예측은 아직 근거가 없어 제시하지 않는다. pilot에서 expansion, peak state, dedup pool, fit/refit, native Q 호출, wall time을 각각 측정한다.

검증 실패는 즉시 수정하되 성능이 낮다는 이유로 임계값을 계속 지역 맞춤으로 바꾸지 않는다. 다음 결과는 설계의 거절 근거다: 실제 positive control을 graph에서 표현하지 못함, 5–16에서도3km 이상 고리가 거의 없음, concave strata에서 cat/star 후보가 나오지 않음, 원래 대비 meanDev·zigzag가 함께 개선되는 후보가 없음, 비용이 기존 cascade에 비해 과도하고 최고점도 유지됨. 이때 더 깊게 같은 무작위 탐색만 늘리기보다 template 순서에 맞춘 macrograph 탐색을 별도 설계해야 한다.

## 예상 이점과 남은 위험

이 제안은 face 한 개씩 편집하는 population이나 incumbent 주변의 짧은 arc 대안을 늘리는 방식과 다르다. 한 번의 새로운 고리에 서로 떨어진 여러 큰 직선과 오목 방향 전환을 함께 구성한다. 그러나 edge×phase의 약한 proxy로 routing한 기존 local-arc 실험에서 전체 원식 개선이 없었던 사실을 고려하면, port graph로 바꿨다는 이유만으로80점에 도달할 것이라고 예측할 수 없다.

특히 Q와 무관한 reservoir가 좋은 배치를 지나치게 희석할 위험, short-run을 보존하면서 다시 원래 graph 수준의 branching으로 커질 위험, 도로의 방향 다양성 부족, RDP seam 효과, 같은 geometry의 pose-only 이익을 새로운 모양 개선으로 세는 위험이 남는다. 평균80이라는 목표는 최종 실제12조건 재평가 및 새지역 검증으로만 달성 여부를 판단한다.

추가 실패 근거: `population-cascade-20261013/results.json`, `anneal-cascade-20261013/results.json`, `local-arc-alternative-diagnosis-20261013/`, `normalized-arc-alternative-diagnosis-20261013/`, `corrected-arc-alternative-diagnosis-20261013/`. 해당 경로명은 저장 자료 확인용이며 구현 변경은 이 문서에 포함하지 않았다.

## 구현 착수용 API와 lossless graph 조율

root가 별도 담당자에게 맡긴 degree2 lossless compression helper는 위 corridor support 생성보다 앞 단계다. 이 helper는 내부 degree2 굴곡을 실제 node sequence로 보존한다. 포트를 degree≠2 junction으로 삼고, junction이 없는 순수 고리는 좌표순 anchor에서 표현한다. 내부 간선 길이는 native adjLen을 합산한다. 원래 ROI 안 모든 실제 간선의 역복원이 가능해야 한다. 이 graph에서 굽은 macro arc 하나는 여러 도형 방향 전환을 포함할 수 있고, 직선 하나도 여러 junction arc로 나뉠 수 있다. 따라서 **compressed arc 개수와 5–16 corridor run 또는 도형 turn 수를 동일시하지 않는다.**

예상 인터페이스는 구현자가 helper의 실제 이름에 맞춰 조정하되 의미를 유지한다.

```ts
type ActualArc = {
  id: number; from: number; to: number;
  nodes: readonly number[];     // 실제 graph node, endpoints 포함
  edgeIds: readonly number[];   // 원래 undirected edge ID, 중복 검사용
  nativeMeters: number;
  firstHeading: number; lastHeading: number;
};
type LosslessPortGraph = {
  ports: readonly number[];
  arcs: readonly ActualArc[];   // 방향별 arc 및 reverse mapping
  outgoing: readonly (readonly number[])[];
  pureCycles: readonly (readonly number[])[];
};
type MacroCycleProtocol = {
  maxStatesPerLayer: 4096; maxFanout: 32; maxRunCount: 16;
  maxArcDepth: 128; maxExpansions: 4194304; cycleCap: 256;
  minMeters: 3000; maxMeters: 8000; repeatMax: 0.2;
  shapeQualityUsedDuringGeneration: false;
};
// helper에서 만든 lossless graph와 검색 결과를 별도로 저장한다.
generateActualMacroCycles(g, portGraph, region, protocol)
  => { candidates, params, diagnostics };
```

port depth128은 독립적인 종료 안전장치 제안이며 충분성을 주장하지 않는다. 원12경로의 압축 arc 수와 run 수를 읽기 전용 진단으로 확인한 뒤 protocol을 사전 고정해야 한다. 원12경로만 간신히 통과하도록 값이 정해지면 학습자료 기반 예산 선택임을 명시한다. 기존409만 expansion 총상한은 유지하여128층으로 늘어난 것을 자동 예산 증가로 숨기지 않는다.

```text
graph := 원래 ROI 안 actual-edge lossless port graph
states := 모든 port 시작 상태를 spatial/hash quota로 선택
while states가 있고 totalExpansions < 사전 상한:
  다음 layer의 strata bounded heaps 초기화
  각 state와 deterministic outgoing arc에 대해:
    actual native length 및 edge-use delta 합산
    8km 초과 또는 repeatedLength/8km > .2이면 제거
    실제 graph lower-bound로 8km 내 closure 불가능하면 제거
    실제 접선 사이 turn과 arc 내부 bend를 누적; junction 자체는 turn 아님
    시작 port로 돌아오면 full actual node sequence 복원
      original guards → geometry dedup → Q-blind final strata
    아직 maxArcDepth/maxRunCount 내면 다음 strata에 hash로 유지
  states := 다음 strata의 상태들
최종 pool만 원래 template uniform fit/refit/evaluatePath에 전달
```

분해된 lossless arc들을 corridor continuation 10° 규칙으로 이어 센 run 수는 간선을 잃는 필터가 아니다. 별도 connector 내부 굴곡은 turn trace에 남긴다. pure cycle은 별도 완성 후보로 넣고 동일3–8km 및 cap을 적용한다. 반복 포트, 비단순 고리, 역방향 사용은 원래 반복률 조건으로 판단하며 port 방문만으로 무조건 거절하지 않는다. closure를 찾은 상태도 다른 유효 길이의 확장을 완전히 막는 정책인지 기록해야 한다.

template-phase guide는 이 설계의 Q-blind reservoir와 섞지 않는다. 나중에 별도 variant를 만들 경우 label을 분리하고 동일 proposal·정련 예산의 대조를 둔다. 압축 표현으로 바꿨다는 것만으로 기존 edge×phase proxy의 실패가 해결된다고 볼 수 없다.

## 첫 구현 검토 상태

`src/lib/route/macroCycleSearch.ts`를 신규 작성했다. hard run 제한은 제거했고 arc 깊이128, 확장4,194,304, 층별 다양성 슬롯 총4096, 최종 후보256 상한을 사용한다. 실제 압축 arc 내부의 모든 도로 노드를 최종 고리에 복원한다. 점수·도형 배치를 생성 단계에서 읽지 않는다. 첫 구현에는 시작점까지의 최단거리 하한 가지치기가 아직 없으며 `lowerBoundPruningUsed:false`로 기록한다. 이 차이를 설계대로 구현됐다고 숨기지 않는다. 표현 보존 검증과 코드를 검토한 상태이며 새 품질 결과는 아직 없다.

## 실제 구현과 두 고정 정책의 12조건 평가 완료

위 마지막 문장의 품질 미검증 상태는 아래 실제 실행으로 갱신됐다. degree2 lossless graph는 원12경로의 순서·평가값을 정확히 재현했고 pathMacroSpans는35–94였다. node 수준의 1° turns 진단은 RDP turn 평가 또는 도형 변 수와 다르다. hard run16은 제거했다. 깊이128은 이 진단을 보고 선택했으므로 학습 지역의 표현 검증을 사용한 정책 선택이며 새 지역 일반화 증거는 아니다.

실제 outgoing arc가32개 이하인 포트에서는 모든 arc를 보존한다. heading/length quota는32개를 넘는 경우에만 적용한다. 원3지역의 최종 두 실행에서 fanoutSkipped는 모두0이었다. 이전 초안의 같은 bin 중1개만 유지하는 정책은 평가 시작 전에 교정했고 초안 검사와 실행 source를 구분했다.

첫 정책은 start4×4 × 누적길이4 × 양쪽45° turn존재2 =128 strata에32상태씩 배정했다. 별도 diverse 정책은 repeated edge가 없는 상태/있는 상태를 분리하고 endpoint2×2를 더해1024 strata에4상태씩 배정했다. 두 정책 모두 nominal4096 slots, arcdepth128, expansion4194304, final256, fit 가설8, shape당 top8 refit128이다. 남은 실제 활성 strata 수가 적어 live state가4096에 도달하지 않는 경우가 있으며 nominal 최대값을 실사용량으로 보고하지 않는다.

| 지역 | 기본 strict closure / 최종 고리 | diverse strict closure / 최종 고리 | diverse expansion | diverse 생성 / fit 시간 ms |
|---|---:|---:|---:|---:|
| 광안리 | 0 / 0 | 103 / 75 | 214573 | 643 / 12420 |
| 서면 | 3 / 3 | 147 / 101 | 245503 | 1535 / 22019 |
| 강남 | 1 / 1 | 95 / 69 | 240509 | 1406 / 17858 |

이 시간은 해당 실행의 알고리즘 계측이다. 두 지역 diverse 평가가 동시에 실행됐으므로 독립적인 속도 비교 또는 총 wall 시간으로 해석하지 않는다. 고리 수가 늘어난 것은 표현·발견의 효과이고 원래 모양 품질 향상이 아니다.

두 정책 모두 원래12조건에서 개선0, 원래 표시 평균77.416667/raw77.317593 유지였다. diverse의 새로운 geometry 최고 raw는 광안리 square/heart/star/cat20.93/36.21/31.68/30.46, 서면15.26/31.01/35.18/22.57, 강남22.77/39.78/33.90/30.15다. 충분히 큰 실제 고리들을 만들었으나 임의 윤곽이 목표 모양과 크게 달랐다. **Q-blind hash quota만 확대해80점으로 갈 근거는 없다.**

기존 자동 경로를 search seed에 넣지 않고 최종 비교에서만 읽었다. 각 지역 pool은 실제 원자료에서 독립 생성했고 네 원본 도형에 같은 fit/refit 정책을 적용했다. 전체 cold cascade를 다시 실행한 것은 아니므로 `storedAutomaticIncumbentComparisonOnly`와 `fromRoadsWholeCascadeRerun:false`를 명시했다. 새 holdout 또는 앱은 변경하지 않았다.

자료:

- `eval/recognition/route-improvement/macro-cycle-pilot-20261013/{지역}/`: 기본 frozen source/protocol/generation/shape별 결과.
- `eval/recognition/route-improvement/macro-cycle-diverse-20261013/{지역}/`: diverse frozen source/protocol, layer별 무반복·반복 prefix와 길이 bin 유지 수, generation 및 shape별 결과.
- `eval/recognition/route-improvement/macro-cycle-comparison-20261013.json`: 두 정책의12조건 집계 및 입력 결과파일 SHA.
- `tests/eval/macro-cycle-pilot-20261013.test.ts`: 생성 전에 protocol과 `.source`를 기록하고 종료 시 현재 byte SHA 일치 확인.
- `tests/macro-cycle-search.test.ts`: 3.2km 실제 purecycle, 역방향 geometry 중복, 반복 return 거절, 실제 missing corner를 가짜 bridge로 잇지 않음, input edge 순서 불변 계약2개 통과. node permutation 검사를 했다고 주장하지 않는다.

직접 fit/native 평가 수는 `nativeQCalls`, refinePathPlacement 내부 평가 수는 `refitCalls`로 따로 기록했다. 전체 Q 호출 수는 두 값을 합한 수다. 예컨대 diverse 광안리 square는608+839=1447회다. 집계 파일은 `directNativeQCalls`, `internalRefitQCalls`, `totalNativeQCalls`를 명시한다. TypeScript와 관련 ESLint 검사도 통과했다.

후속 권고는 원본 template의 연속 방향과 상대적인 변 길이를 조건으로 port arc를 선택하는 **별도 shape-guided variant**다. 이번 Q-blind 대조를 유지하고 같은 실제 연결·거리·반복·원식·canonical 평가를 사용한다. 이전 local-arc proxy 실패가 이미 있으므로 단순히 같은 거리 proxy를 더 큰 graph에서 반복하지 말고, 전체 고리의 feature 순서 및 실제 closure를 명시적으로 다루는 설계가 필요하다. 성과는 여전히 미검증이다.
