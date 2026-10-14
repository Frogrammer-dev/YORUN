# 실제 도로 선분을 따라 진행하는 선택형 phase DP

이 문서는 새 알고리즘의 설계이며 성능 결과가 아니다. 원래 유사도77.416667, 목표80, 원본 도형·평가식·실제 도로·3–8km·repeat≤0.2 조건을 유지한다. radius 또는 예산을 늘리는 제안이 아니다.

## 새 근거와 판단

남은 unit 예산을 모두 사용하는 Scheduled pilot도 광안리4조건의 두 arm에서 각 case400000 expansion을 모두 사용했고 strict rollout/Q호출은0이었다. 이전1875/546 subcap 병목은 실제로 존재했지만 이를 없애는 것만으로 완성 경로가 생성되지 않았다. 따라서 이전 진단을 단독 원인 또는 품질 개선으로 해석하지 않는다.

새 읽기 전용 observer는 `advance()`가 같은 node에서 phase를 여러 번 강제로 전진한 직후, 다음 실제 간선이 이전 phase에서라면 허용됐는지 검사했다. 검색 state 밖 WeakMap에 이전/이후 phase와 실제 node만 저장했으며 원본 함수의 결과를 정확히 재현했다.

| 광안리 cat 진단 | 실제 expansion | 다중 phase 전진 호출 | 최대 한번 전진 | greedy 이후 거절됐으나 이전 phase에서 통과한 actual edge | strict/Q |
|---|---:|---:|---:|---:|---:|
| 저장된 자동 coarse pose8 replay | 400000 | 13546 | 7 | 51 | 0 / 0 |
| 기존 자동 incumbent pose 하나, 진단 전용 | 50000 | 1930 | 7 | 0 | 0 / 0 |

51개는 동일 검색 내 상관된 local witnesses이고 서로 다른 전체 해답51개가 아니다. 양 endpoint가 이전 guide segment의2×radius 안에 있으나 greedy phase segment에서는 거절됐음을 보였다. 완성·거리·반복·높은 점수를 복구했다는 증거는 아니다. known pose에서는 같은 witness가0이므로 그 실패 전체를 즉시 greedy jump 하나로 설명할 수 없다.

root의 별도 실제3200m 완전 square 계약검사에서 sparse4nodes와 dense32nodes가 같은 연속 도로 모양·원래 native similarity100·repeat0을 가졌지만 Scheduled는 sparse strict0/dense strict>0이었다. 긴 실제 간선의 endpoint를 아직 진행하지 않은 작은 guide segment에 먼저 검사하는 순서가 node 간격에 의존한다. **node에서 phase만 선택형으로 바꿔도 중간 checkpoint가 양 endpoint에서 모두 멀면 이 문제가 남는다.**

근거는 `rollout-greedy-phase-diagnosis-20261013/gwangalli-cat/`의 두 mode, `rollout-node-spacing-20261013/`, `shape-guided-rollout-scheduled-20261013/gwangalli/`다. known pose는 진단 전용이며 자동 후보 발견 성과로 합산하지 않는다. 원본 Scheduled source SHA는 유지했다.

## 권고하는 하나의 변경

**실제 간선의 연속 선분 위에서 checkpoint를 통과할 수 있는 순서를 계산하고, 가능한 여러 종료 phase를 보존한다.** 실제 경로의 node나 간선을 추가하지 않는다. 선분 내부의 진행 위치 t는 검색 bookkeeping이며 최종 route/GPX에는 원래 node sequence만 복원한다. 보간점을 새 도로 교차점으로 쓰거나 다른 길로 갈라지는 port로 쓰지 않는다.

현재 mandatory `while(maxnearbyphase)`를 폐기한다. 각 actual macro arc의 원래 간선들을 순서대로 처리하면서 `Map<phase, localLabel>` 형태의 내부 DP를 수행한다. 최초 label은 prefix phase이며, 진행하지 않는 선택도 보존한다. 현재 phase가 checkpoint k를 지났다는 의미를 유지하고 다음 checkpoint는 k+1이다.

실제 간선은 A→B, 길이 d, 위치는 A+t(B−A), t∈[0,1]이다. 다음 checkpoint C와 반경 r=.16×scale을 사용한다. 다음 원형 근접 조건의 t 구간을 계산한다.

```text
|A + t(B-A) - C|² ≤ r², 0 ≤ t ≤ 1
```

이는 이차식의 교집합 구간이다. 판별식이 음수이거나 교집합이 비면 해당 checkpoint를 이 실제 간선에서 넘을 수 없다. 물리적으로 간선을 따라 움직일 때 checkpoint 순서가 뒤집히지 않도록, 다음 hit의 최소 위치를 직전 hit 이상으로 제한한다. 연결된 checkpoint들의 구간에서 순서대로 가능한 가장 이른 hit를 사용한다. 이것은 고정한 실제 선분에서 순서 있는 checkpoint 근접의 가능성을 위한 한 선택이며 whole-Q 최적화라고 주장하지 않는다.

각 k에 대해 다음 선택을 모두 만들 수 있다.

1. checkpoint를 더 넘지 않고 endpoint에서 현재 guide segment의 corridor 조건을 통과하는 종료 label.
2. k+1을 hit한 뒤 endpoint에서 종료하는 label.
3. 같은 실제 선분에서 k+2, k+3…을 순서대로 hit한 뒤 종료하는 여러 label.

각 가능한 종료 phase마다 원래 실제 endpoint가 현재 guide segment의2r 안에 있어야 한다. final phase에서는 원래 마지막 guide 구간 또는 실제 시작 checkpoint와의 closure 조건을 명시한다. endpoint를 항상 이전 phase의 짧은 segment에 먼저 검사하고 전체 간선을 버리는 현재 순서를 반복하지 않는다.

hit 사이의 실제 선분 구간은 대응하는 guide segment에 배정한다. 해당 구간 양끝의 point-to-segment 거리를 검사하고 기존2r corridor 조건을 유지한다. guide phase가 넘어가는 hit에서는 checkpoint 자체와의 r 근접 조건을 만족한다. 즉 간선 안의 실제 이동을 따라 guide가 진행하며, node 간격 때문에 checkpoint 통과가 누락되지 않게 한다. 도로에서 이동하지 않고 overlapping checkpoint 원형들이 허용한 t=0 전진은 여전히 생길 수 있으므로 별도 기록하고 실제 이동 coverage라고 세지 않는다.

proxy 비용은 배정한 실제 이동 거리의 비율과 해당 guide segment deviation으로 계산한다. 모든 부분 거리 합은 원래 간선 native adjLen이며 실제 경로 길이는 동일하다. turn 비용은 원래 실제 간선의 방향 변화에서만 계산한다. 내부 phase hit를 새 도로 꺾임으로 세지 않는다. 기존 profile turnWeight30/0과 guideWeight1은 유지한다.

actual arc 내부의 DP는 각 actual node endpoint에서 종료 phase별 한 개의 낮은 proxy label을 보존하는 초안이다. 동일 actual prefix+arc geometry이며 미래 종료 phase가 같은 label만 비교한다. 서로 다른 actual edge history의 외부4label 보존은 유지한다. 이 내부 proxy 선택이 최종 whole-Q 최적성을 보장하지 않는다는 제한을 명시한다. 필요 시 내부2label을 늘리는 후속은 별도의 예산 실험이어야 하며 처음부터 묶지 않는다.

## 구현 인터페이스

```ts
type EdgePhaseLabel = {
  phase: number;
  proxyExtra: number;
  zeroDistancePhaseAdvances: number;
  phaseNativeMeters: number[];
  // 검색용 hit 위치와 실제 endpoint만 진단에 저장한다.
};
edgePhaseTransitions(g, fromNode, toNode, guide, initialPhase, radius, nativeMeters)
  => { labels: EdgePhaseLabel[], diagnostics };

// 원래 actual arc의 edges마다 이 함수를 적용한다.
// 실제 경로·edge history·length·repeat는 arc 선택으로 한 번만 추가한다.
arcPhaseTransitions(prefixState, actualArc, guide)
  => actual endpoint에 도달한 여러 종료 phase state;
```

여러 phase label을 생성했다는 이유로 간선 native 길이를 여러 번 한 경로에 합산하지 않는다. 원래 macro arc 하나를 시도한 work count와 실제 edge×phase 계산 수를 분리한다. 기존 case expansion400000을 더 많은 내부 작업으로 우회했다고 숨기지 않는다. Scheduled의 unit25000, 동일 prefix/suffix 공유, rolloutQ512, top8canonicalrefit128은 그대로다. control/treatment의 차이는 계속 whole-Q feedback 여부뿐이다.

## 검증 순서와 거절 조건

먼저 실제 sparse4nodes/dense32nodes perfect square에서 둘 다 올바른 guide 순서와3200m strict closure를 얻는지 확인한다. 생성 route에 원래 node 이외 좌표가 없어야 한다. 같은 선분을 중간 collinear 실제 node로 나눴을 때 최종 reachable phase와 합산 native 길이가 일치하는지 검사한다. 이는 원래12조건 성능이 아니라 node sampling 의존성에 대한 계약이다.

이후 root가 확인한 greedy local witness51개 중 해당 actual edge가 optional 초기 phase를 보존해 처리 가능한지 검사한다. 체크포인트 순서가 반대로 투영되는 synthetic edge, 멀리 떨어진 checkpoint, 길이0 edge, overlapping checkpoint 원형은 따로 검사한다. virtual phase 진행을 physical feature hit와 같다고 보고하지 않는다.

마지막으로 같은 자동 coarse pose 정책의 광안리4 control/treatment를 재실행한다. strict rollout이 충분히 생기기 전에는 whole-Q feedback 효과를 평가할 수 없다. Scheduled가 전체 예산을 사용하고도 실패한 원인은 phase discretization 외 label selection, proxy cost, pose·start 선택 또는 실제 topology에도 있을 수 있다. 새 DP에서도 Q0이면 다음 failure 원인을 분리하며 radius·전체 예산을 늘려 이 계약 교정과 혼합하지 않는다.

새 실제 개선이 있더라도 기존12조건·원자료 cold rerun·새 holdout 검증은 여전히 필요하다. 이 제안은80점 달성의 증거가 아니다.
