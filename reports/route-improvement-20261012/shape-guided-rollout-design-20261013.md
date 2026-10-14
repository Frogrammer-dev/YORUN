# 실제 port graph에서 완성 경로를 내다보는 도형 유도 beam 설계

구현 전 독립 전문가 제안이다. 보고서만 작성했으며 새로운 성능 결과는 없다. 원래 자동 평균 77.416667점과 80점 목표를 유지한다.

## 문제와 기존 방법의 차이

광안리 balanced Q-blind macrocycle이 유효 후보 75개를 얻었지만 최고 square/heart/star/cat 점수가 20.93/36.21/31.68/30.46이라는 parent의 현재 평가 결과를 출발점으로 삼는다. 연결 고리 개수 부족은 줄었으나 도형과 관계없는 geometry 생성은 현재 후보에서 부족하다. 이 수치는 새 제안의 성능이 아니다.

기존 `orderedContourPath`는 incoming edge × phase마다 가장 낮은 누적 대체 비용 한 label을 남긴다. `multiLabelContourPath`도 500m 길이 bucket을 추가했지만 각 bucket에서 대체 비용 한 label만 남겼고, 과거 원12 결과는 평균 76.75→76.75였다. 이름만 multi-label beam으로 바꾸는 후속은 권고하지 않는다.

`localArcSegmentRepair`는 기존 경로의 짧은 window만 바꾸며 phase radius 안에 머무는 동일 node에서 phase를 여러 번 전진시킬 수 있다. phase 완료는 해당 윤곽 구간을 실제로 걸었다는 증거가 아니다. normalized/corrected arc 실험도 surrogate 비용을 원식처럼 보이게 조정했지만 최종 개선이 없었다. 길이 정규화·raw edge turn은 whole-path RDP zigzag, feature coverage, spike, seam을 정확히 표현하지 않는다.

권고하는 새 요소는 **처음부터 도형 전체 경로를 만들고, 중간 prefix를 실제 완성 경로로 rollout한 원래 Q로 beam을 재선택하는 것**이다. 압축 자체나 proxy 가중치 변경에 개선을 귀속하지 않는다. 다른 실제 edge 사용 이력을 가진 label을 proxy 지배 관계만으로 제거하지 않는다.

원래 ordered 함수는 `(phase,incomingedge)`에 native length를 key로 넣지 않아 저렴한 짧은 prefix가 필요한 긴 prefix를 제거할 구조적 가능성이 있었다. 그러나 선행 observation-only 진단 결과 **48/48 경로가 native valid이고 min3km에 막힌 goal은 0개**였다. 자료는 `eval/recognition/route-improvement/ordered-label-diagnosis-20261013/results.json`이다. 이 관측 범위에서는 min3km 도달 실패를 현재 병목으로 뒷받침하지 않으므로 length-resource bucket 실험을 재반복하지 않는다. valid 경로의 품질 개선 대안이 single-label에서 사라졌는지까지 증명하거나 부정하는 진단은 아니다.

따라서 아래 whole-Q rollout을 **연결 실패 우회가 아닌 품질 선택 가설**로 검사한다. 네 가지 actual edge-history label 보존과 exact port 표현은 Control/Treatment 양쪽에 동일하게 적용한다. 두 arm의 차이는 완료 경로의 원식 Q가 다음 beam 선택에 feedback하는지뿐이다. 이 비교가 향상되더라도 label 수나 압축 자체의 독립 효과를 주장하지 않는다. 기존 multi-label negative 결과와 48/48 유효 진단에 의해 더 긴 label·더 많은 후보가 자동으로 좋은 모양을 만든다는 추정은 철회한다.

48개 진단은 최신 자동 후보의 placement에 대한 12조건 × bins32/64 × 정·역방향이다. 자동 coarse pose 전체의 48개 무작위 표본이 아니므로 모든 미탐색 pose에서 min3km 문제가 없다는 일반화는 하지 않는다. Rollout pilot의 coarse pose 성공률은 별도로 관측한다.

## 한 가지 구체적 알고리즘

이름은 `shapeGuidedPortRolloutBeam`으로 제안한다. Lossless actual port graph에서 방향 macro arc의 전체 원래 node sequence를 유지한다. 원래 shape의 uniform 배치에 대해 `original vertices ∪ uniform 32 samples`를 arc-length 순서로 정렬한 checkpoint guide를 만든다. 원형 양 끝 이외 중복 점만 합치며 원래 shape/template는 수정하지 않는다. Guide는 검색 보조이며 최종 원식은 원래 shape points를 사용한다.

자동 coarse pose는 `globalSearch(...attempts=0, fullRotation=true)`의 placement seeds에서 선택한다. 상위 coarse score를 좌표 2×2 × rotation4 strata로 나누어 각 bin에서 한 개씩, 총 8개를 고정 순서로 뽑는다. 부족하면 전체 coarse rank 순서로 채운다. 현재 incumbent pose나 수동 positive-control은 생성 seed로 주지 않는다. 각 pose의 첫 checkpoint에 가장 가까운 실제 port 두 개에서 시작한다. radius0.16×scale 안 port가 없으면 그 시작 unit은 실패로 기록한다. 임의의 내부 node를 실제 port로 삽입하지 않는다.

상태는 시작/current port, incoming arc, monotonic phase, 실제 node/edge 경로 참조, native meters, 반복 meters 및 실제 edge-use history를 가진다. 같은 incoming arc × phase × 500m length bucket에서 최대 4개의 **다른 geometry label**을 허용한다. proxy 비용의 단일 최솟값 dominance를 주장하지 않는다. 현재 arc 내부 실제 nodes를 검사해 phase guide를 따라가며 위치 제약은 기존 radius0.16을 재사용한다. 같은 node에서 무료 phase 전진할 수 있다는 기존 약점은 진단에 그대로 드러나게 한다. 각 phase별 실제 이동 거리·서로 다른 실제 node 수와 원래 feature hit를 계측하고 이를 최종 coverage 증거로 사용하지 않는다.

prefix 확장은 actual native arc만 사용하고 coarse guide deviation은 확장 순서의 proxy로만 쓴다. 모든 상태는 8km 초과 또는 repeatedMeters/8000>0.2일 때 제거한다. 시작점까지 실제 거리 Dijkstra 하한을 더해 8km를 넘거나 남은 depth로 실제 return hop이 불가능할 때 제거한다. port 재방문이나 같은 chain ID 사용을 무조건 금지하지 않는다. 동일 actual geometry의 반복 label은 제거하되 prefix 길이·사용 edge가 다른 것을 같다고 보지 않는다.

Guide 진행 25/50/75/100%의 네 stage마다 최대 16개 prefix를 고른다. 각 prefix에 남은 guide를 순서대로 따른 뒤 실제 start port에 닫히는 suffix를 최대 두 개 만든다. suffix profile은 `(guideWeight=1, turnWeight=30)` 및 `(guideWeight=1, turnWeight=0)`로 실행 전에 고정한다. 이는 native shortest path 최적성이나 whole-Q 최적성을 주장하지 않는 bounded ordered routing이다. prefix-used edge를 전부 금지하지 않고, 실제 전체 경로의 반복률로 판정한다. 실제 graph 밖 직선 closure는 만들지 않는다.

생성한 prefix+suffix를 완성 actual node path로 복원하고 원래 ROI, 3–8km, 반복≤0.2, 폐곡선·실제 edge를 검사한다. geometry-only `pairPhaseZero`로 seam/direction을 결정하고 **원래 evaluatePath의 unrounded Q**를 호출한다. 한 prefix의 가장 좋은 strict rollout Q를 beam selection 값으로 사용한다. 원식이 전체 geometry의 meanDev·RDP zigzag·features·spikes를 직접 비교하므로 지역 proxy를 원식으로 착각하는 문제를 줄일 수 있다. 그러나 suffix가 나쁘면 좋은 prefix가 낮게 평가되는 lookahead bias가 남는다.

각 stage의 다음 beam16은 best rollout 12개 + rollout 실패 또는 낮은 후보 중 geometry-hash 다양성 4개로 구성한다. 실패 prefix를 전부 버려 3km 이하 임시 closure나 suffix cap 때문에 큰 최종 경로를 놓치는 위험을 줄인다. 완료 stage에서는 strict 후보만 최종 pool에 넣는다. 각 unit의 actual arc depth 상한128, 짧은 phase-only action 상한 guide count로 종료한다.

## 사전 고정 pilot 예산과 대조

첫 rollout pilot은 기존 frozen 광안리 4도형으로 한다. 48/48 유효 진단에 따라 resource gate는 현재 병목을 지지하지 않은 것으로 종료하고 Q feedback의 품질 선택 효과를 독립 비교한다. 신규 holdout는 읽지 않는다. 각 case는 auto pose8 × actual start2 = 16 search units, prefix beam16, label bucket4, depth128이다. 전체 case당 **actual arc expansion 합계 400000**를 16unit에 균등 배정하고 prefix/suffix가 이 예산을 공유한다. unused unit budget은 다른 unit에 넘기지 않는다. 실제노드 단계 ordered400000과 macro arc400000은 같은 native-edge 작업량이 아니므로 arc 내부 node 검사 수를 따로 기록한다.

원식 rollout 호출은 case당 최대 **512회**다. unit당 stage4 × prefix4 × suffix2 = 32회, 합계16×32=512이며, 위 최대 prefix16개 중 평가 대상4개를 coarse proxy + hash quota에서 고정 선택한다. stage의 나머지 prefix는 평가되지 않은 것으로 기록한다. 평가된 prefix의 Q를 다른 prefix에 상속하지 않는다. nominal 16-prefix 전부의 rollout을 했다면 호출 상한은 2048이므로 512라고 보고하면 안 된다. 이 제한은 lookahead가 드문 초기 pilot이라는 명확한 한계다.

동일 생성 budgets로 두 arm을 실행한다.

- Control: 같은 실제 prefix/suffix·whole-Q 호출을 생성하되 beam 선택은 normalized proxy 및 동일 diversity quota만 사용한다. Q는 결과 평가를 위해 읽지만 상태 선택에 feedback하지 않는다.
- Treatment: 동일 512 rollout Q 호출을 beam selection에 feedback한다. 두 arm의 실제 후보가 갈라지는 것은 Q feedback의 효과이며 완전히 같은 후보 pool을 주장하지 않는다.

두 arm의 final geometry pool을 최대16개로 native Q 순위로 고른 뒤 top8에 **각 경로 canonical 표현 하나만 refit128**을 적용한다. refit 최대1024 Q호출/case/arm은 rollout512와 별도다. 동일 baseline에는 original/canonical 둘 다 refit128을 적용해 더 높은 것을 보존하며, 이 baseline 계산은 두 arm이 공유한다. baseline 고점 seam과 같은 edge geometry를 바꾸어 성능 향상으로 세지 않는다. 개선이 없으면 실제 원래 incumbent를 그대로 반환한다.

## 검증과 거절 근거

구현 전 협력 검토에서 단계 후보 수와 다음 beam 수가 모두16이면 모두 남아 Q 순위가 실질적 선택을 바꾸지 못하는 문제가 확인됐다. 첫 품질 실행 전에 단계 후보 상한64, 다음 beam16으로 고정했다. Treatment는 평가한 후보 중 Q 상위2개+proxy10개+hash 다양성4개, Control은 proxy12개+hash4개를 선택한다. 호출 예산512는 유지한다. Q에 따라 실제 보존되는 후보가 바뀌는 선택 계약을 별도로 확인한다. 이 수정은 성능 결과를 보고 예산을 맞춘 변경이 아니라 평가할 메커니즘이 실제 작동하도록 만든 사전 교정이다.

두 번째 독립 검토에서 평가 대상을 proxy 상위2개와 전체 hash 상위2개로 고르면, 네 후보 모두 Control에도 이미 보존되는 문제가 확인됐다. 고Q로 Control 밖 후보를 살리는 메커니즘을 검증하려면 평가 대상의 일부를 Control 선택 밖에서 뽑아야 한다. 첫 품질 실행 전 정책은 proxy 상위2개와 Control 밖 후보 중 hash 상위2개로 교정한다. 두 arm에 같은 평가 대상 선택 규칙을 적용한다. 계약은 임의 점수 Map만 테스트하는 대신 실제 평가 대상 선택과 beam 선택을 연결해 확인한다. 점수값 변경에 따라 실제 구출되는 후보가 바뀌는지 증명하고, 미평가 다양성 후보 증가를 Q의 품질 효과로 오인하지 않는다.

이 방식이 기존 proxy보다 낫다는 것은 가설이다. 증거는 Control 대비 Treatment에서 실제 changed geometry의 최종 native Q가 개선되고, 같은 refit 예산에서도 유지되는 경우다. 각 arm에서 실제 expansion/Q/refit 호출과 wall time, phase별 실이동·feature hit, strict closure 수, 길이·반복 탈락, proxy 순위와 rollout Q 순위 불일치, Q feedback으로 유지된 ancestor를 기록한다. 평균 개선이 단순히 더 많은 Q호출에서 나온 것인지 분리한다.

rollout strict 후보가 거의 없으면 Q feedback 효능을 평가할 수 없다. 그때 proxy 가중치와 radius를 튜닝하기 전에 어디서 phase가 정체되었는지, 후보가 min3km·repeat·suffix cap 중 무엇으로 탈락했는지 확인한다. 같은 node 다중 phase advancement가 많고 실제 feature coverage가 낮다면 phase gate 약점을 해결하지 못한 것으로 기각한다. 충분한 strict rollout이 있는데 Treatment가 Control을 이기지 못하면 이 제한된 whole-Q lookahead 정책을 거절한다. 깊이·512 budget을 늘린 결과를 원래 pilot의 성공으로 바꾸지 않는다.

pilot이 실제 개선을 보인 뒤 원래 전체12에서 같은 정책을 검증한다. 80 이상 정책을 선택하면 원자료로 cold부터 전체 자동 pipeline을 재실행하고 untouched holdout-v2에서 검증한다. 광안리 pilot 향상이나 저장 자동 incumbent 후속 실험만으로 목표 달성을 선언하지 않는다.
