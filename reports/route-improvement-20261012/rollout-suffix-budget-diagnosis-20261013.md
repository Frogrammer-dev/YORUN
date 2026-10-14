# 완성 경로 rollout의 호출별 예산 진단

첫 광안리 pilot에서 두 arm 모두 strict rollout0, 원식 Q 호출0이었다. 따라서 whole-Q feedback의 품질 효과를 검증한 실험이라고 볼 수 없다. 원래 평균72.75 유지와 성공적인 연결 경로 생성은 다른 주장이다.

원본 `shapeGuidedPortRolloutBeam.ts`를 수정하지 않고 literal 관측 clone을 만들었다. 계측 블록, 함수 이름, 관측 callback만 제거하면 원본 source 전체와 정확히 일치한다. 원래 자동 coarse pose를 저장된 pilot 결과에서 그대로 읽어 control arm을 replay했으며, 새 검색 seed 또는 수동 배치를 추가하지 않았다. 최종 pool과 전체 diagnostics가 원래 frozen 결과와 정확히 일치했다.

| 관측 사례 | prefix 호출 / cap 도달 | suffix 호출 / cap 도달 | prefix 목표를 밟은 호출 | suffix 최종 phase 도달 | heap이 비어 끝난 호출 |
|---|---:|---:|---:|---:|---:|
| 광안리 cat | 18 / 18 | 4 / 4 | 2 | 0 | 0 |
| 광안리 square | 18 / 18 | 16 / 16 | 2 | 0 | 0 |

prefix는1875 arc expansion, suffix는546 expansion에서 모두 중단됐다. square의 각 prefix 종료 heap에는230–438항목, suffix에는151–201항목이 남았다. stale label도 heap에 있을 수 있으므로 이 수치를 모두 서로 다른 유효 미래 후보라고 세지 않는다. heap 고갈로 검색이 종료됐다는 설명은 두 사례에서 반박됐다.

square의 첫 목표 phase는8/32였다. 첫 prefix search 다수는 phase4–7까지만 도달했다. 일부 unit은 phase9까지 도달해 rollout을 시작했으나 suffix는 phase13–14/32에서 끊겼고, 다음 prefix stage도15/32에서 끊겼다. cat의 suffix는 phase18–20/44까지 도달했다. 검색 최종 phase 및 실제 start closure까지 진행하지 못했으므로, 이 결과만으로3km 하한·반복률이 최종 후보를 막았다고 주장할 수 없다.

case 전체 상한400000은16unit 각25000으로 나뉘지만, 미래 호출에 고정 예약한1875/546 subcap 때문에 prefix 목표를 못 얻은 unit은 예산 대부분을 남긴 채 종료됐다. 실제 cat control은35934 expansion을 썼다. prefix/suffix가 큰 전체 ceiling을 공유한다고 설명했지만, 호출별 hard cap이 실제 검색의 도달을 먼저 막은 차이를 드러낸 진단이다. 이것은 추가 탐색이 성공한다는 증명이 아니라 원래 제안의 품질 비교를 실행하지 못한 원인 중 하나다.

자료는 `eval/recognition/route-improvement/rollout-suffix-diagnosis-20261013/{gwangalli-cat,gwangalli-square}/results.json`에 저장했다. square 관측에는 heapRemaining, label 거절 수, resource key와 보존 label 수를 추가했다. 두 실행은 관측 schema가 조금 다르지만 각각 frozen source snapshot과 관측 source hash를 보존했다. `tests/eval/create-rollout-observer.mjs`가 clone identity를 확인하고 `tests/eval/rollout-suffix-diagnosis-20261013.test.ts`가 exact replay 및 원본SHA를 검사했다. 타입·관련 lint도 통과했다.

## 후속의 사전 고정 변경

별도 `shapeGuidedPortRolloutScheduled.ts`를 만들고 각 search 호출 cap을 현재 unit의 남은25000 전체로 설정한다. prefix가 기존64후보 목표에 도달하거나 suffix가 첫 strict 완성 경로를 얻으면 그 호출은 즉시 끝난다. 남은 allowance는 같은 unit의 다음 호출에 남는다. 다른 unit에 이전하거나 전체400000/Q512 상한을 늘리지 않는다. 원본 guide, radius, native 거리·반복, actual edge history4 labels, beam 선택, suffix profile은 그대로다.

후속은 **최대 예산이 같은 비교**이며 arm의 실제 작업 수까지 같다는 주장이 아니다. 첫 prefix 또는 suffix가 남은 unit 예산을 전부 사용할 수 있고, Q로 beam을 선택한 뒤 다음 검색 작업이 없을 수도 있다. 각 unit의 `afterFeedbackExpansions`는 Q 선택 이후 작업이 있었는지만 보여주며 Q로 구조된 특정 ancestor의 개선 증거가 아니다. 실제 rescuer provenance 및 changed geometry의 원식 비교가 별도로 필요하다.

각 호출에 effectiveCap, legacyCap, remainingBefore/After, expanded, unusedCallCap, maxPhase, heapRemaining과 goalResults를 기록한다. `legacyCap`은 비교 설명용으로만 남고 실제 hard cap은 아니다. 순수 실제3200m cycle 계약검사에서 native geometry와 반복 제약, 총상한, 각 호출의 예산 보존식을 확인했다. 새 실제 품질 결과는 이 문서 작성 시점에 아직 없다.
