# 도로 × phase 완성 하한: 독립 검토

검토일: 2026-10-14. 검토자는 구현 소스를 읽고 고정 snapshot을 대조했다. 진행 중인 실제 도로 평가를 다시 실행하거나 평가 코드·도로·점수·원본 도형·holdout을 수정하지 않았다. 이 문서는 알고리즘의 조건부 타당성과 검증 범위를 설명하며 평균 80 달성 증거가 아니다.

helper는 별도 에이전트가 작성했고 검토자는 ProductBound clone/generator 작성자다. 따라서 helper 검토는 작성자와 분리되어 있지만 clone 부분은 작성자의 read-only 역변환·동일성 검증이다. 두 영역을 모두 작성자와 독립된 감사로 표현하지 않는다.

## 검토 대상과 고정 소스

- `src/lib/route/guideProductClosureBound.ts`: SHA-256 `68ffa2b4a8fe2201054a21decd26ab20edfd7d3cdd469385216b4e8cf7edc4b5`.
- `src/lib/route/shapeGuidedPortRolloutProductBound.ts`: `65d580fcf0ff3479e3bc0a4bfc7cded67e25cf0a019dfb684fcf98639ad7185e`.
- `tests/eval/create-product-bound-rollout.mjs`: `4733bb9af64c9fe3886e71c3b500af51a1a46dc24b13acb0db73bc742f7d5739`.
- 고정 AStar 부모: `cdd002cb865d783f91e73ac3b0b5c0379366c096a565ac925041d8ac4735afef`.
- 실제 평가 snapshot: `eval/recognition/route-improvement/shape-guided-rollout-product-bound-20261014/gwangalli/protocol-before-run.json`.

generator의 write를 read-only 동일성 검사로 바꿔 실행했다. 11개 anchor 적용 결과가 현재 clone과 일치했고 역변환이 부모 소스를 정확히 복구했다. 위 세 파일과 `continuousEdgePhase.ts`, `fit.ts`, `shapes.ts`의 현재 바이트 hash가 진행 중 평가 snapshot과 모두 일치했다. clone의 차이는 완성 하한, 그 하한이 무한인 상태의 제거, 전처리와 제거 횟수 진단이다. 기존 history/500m 길이 버킷의 label 정렬은 실제 누적 cost를 그대로 사용하며 beam 선택 함수, phase 전이 함수, 거리·반복·깊이 제약, unit당 25k/case당 400k, Q 상한은 부모와 같다.

`shapes.ts` 전체 hash는 AStar snapshot의 `49cdf31b…`에서 이번 snapshot의 `2727527f…`로 달라졌다. 두 파일의 실제 diff는 다른 앱 작업의 `ShapeKey`에 `run` 추가, 이미지/획 frame 메타데이터, `groupFromLoops`의 frame 계산 추가다. 평가 대상 square/heart/star/cat의 원본 좌표와 정규화·resample 구현에는 차이가 없고 점수 파일 hash도 동일하다. 파일 전체 hash가 같다고 표현하지 않으며, 이 별도 작업을 되돌리지 않았다.

## 완성 비용 하한의 근거

product 상태는 `(실제 port, guide phase)`이다. 각 실제 directed macro arc에 대해 `continuousArcPhase`가 현재 설정으로 **실제 반환하는 최대 네 개의 endpoint label**을 그대로 간선으로 삼는다. product 간선의 비정규화 비용은 해당 label의 `proxyExtra`다. 도로 노드나 간선을 생성하지 않으며, cache hit가 있더라도 macro arc의 모든 native 간선을 먼저 검사한다.

실제 rollout 전이 비용은 `(label.proxyExtra + turnWeight × physicalTurn) / max(scale, 1)`이다. 현재 두 turn profile의 가중치는 30과 0이고 physicalTurn은 음수가 아니다. product는 turn, incoming arc, used-edge history, 거리 범위, 반복률, 깊이, 즉시 역방향 이동 금지 제약을 제거한다. 따라서 실제 허용 완성 경로는 product의 경로로 대응하며, product 최단 suffix 비용을 `max(scale, 1)`로 나눈 값은 그 완성의 남은 실제 proxy 비용을 넘지 않는다. 이는 원래 기하학 Q의 하한 또는 최고 Q 보장이 아니다.

reverse CSR은 원래 전이 `from -> to`를 `to`의 incoming 목록에 넣는다. reverse Dijkstra는 `(해당 unit의 start, 마지막 phase)` 하나를 비용 0인 목표로 시작해 predecessor를 갱신한다. 목표 phase를 처음 phase로 잘못 두거나, 모든 start를 하나의 목표로 합치지 않는다. 동일 pose의 product는 두 start가 공유하지만 거리 배열·목표·질의 진단은 start별로 분리되어 있다. stale heap entry는 저장된 distance와 현재 distance 비교로 제거한다.

최종 phase 이후에도 실제 forward matching과 같은 마지막 guide segment 허용 조건이 적용된다. 목표 자체의 비용은 0이고, 다른 port에서는 실제 guide-feasible 도로로 start에 돌아갈 비용만 남는다. checkpoint를 다시 한 바퀴 도는 요구를 추가하지 않는다.

## 필요조건 prefilter와 Infinity 제거

초기 port가 해당 initial phase의 guide segment에서 `2 × radius`보다 멀면 그 arc-phase를 생략한다. 이는 `continuousEdgePhase`와 같은 `pointSegDist` 함수·같은 비교 임계값이다. 각 유효 label은 첫 실제 도로 노드부터 initial phase에 할당된 첫 subsegment의 양 끝 거리 조건을 검사한다. 첫 phase jump가 도로 선분의 `t = 0`에서 일어나도 길이 0인 initial subsegment의 시작점 조건은 검사된다. 따라서 이 prefilter는 현재 forward helper가 반환할 수 있는 label을 제거하지 않는다.

`h = Infinity`는 현재 pose/radius/guide/선택된 phase label 전이로 마지막 phase의 정확한 start에 도달할 수 없다는 뜻이다. 실제 rollout은 이 product보다 더 엄격한 조건을 적용하므로, **완성을 최종 목적으로 하는** prefix·suffix 탐색에서 해당 상태를 제거하는 것은 안전하다. prefix 구간의 최단 경로만 구하려는 다른 목적에서는 이 pruning의 정당성을 그대로 적용할 수 없다.

유한한 h는 3–8km·repeat≤0.2·depth≤128·즉시 역주행 금지를 만족하는 실제 완성이 있다는 증거가 아니다. 반대로 Infinity도 일반적인 실제 도로·다른 배치·현재 cap에 잘려 나간 phase label까지 포함한 경로의 불가능성 증명이 아니다. 의미는 현재 product 전이 집합에 한정된다.

## cache와 비용의 범위

전처리는 supplied cache에서 기존 hit만 읽고 miss 결과를 cache에 보존하지 않는다. miss의 큰 `phaseNativeMeters`·`phaseActualNodes` 배열은 compact 전이의 port/phase/arcId/proxy 비용을 기록한 후 버린다. 실제 forward search의 miss는 원래처럼 계산해 live cache에 저장한다. product가 forward 반환 label이나 cache 객체를 수정하지 않는다.

retained 전처리 자료는 reverse CSR의 정수/비용 배열과 start별 거리·successor 배열이다. product 크기는 `ports × phases`, 전이 수는 현재 반환 label 수의 합에 따른다. temporary 배열도 product 크기에 비례하며 큰 DP 결과를 전체 arc-phase에 대해 누적 보존하지 않는다. certificate API는 실제 arc/phase 전이의 suffix를 복원할 수 있지만 **이번 clone은 이 API로 직접 Q 후보를 만들지 않는다**.

전처리 DP·prefilter·native adjacency 검사와 reverse Dijkstra는 branch 400k에 포함되지 않는다. `productPoses.setupMs/dpWork/arcPhasePairs/transitionCount/necessaryPrefilterSkipped`, unit의 `closureBound.boundSetupMs/arcInspections/heapPops`를 따로 기록한다. branch 상한만 같다는 이유로 이전 방법과 전체 계산 비용이 동일하다고 주장할 수 없다. h는 비정규화 proxy 단위이고 heap에서 scale로 정확히 한 번 나눈다. 그 값으로 native 최대 8km를 검사하면 안 된다.

## 테스트가 입증한 범위

`tests/guide-product-closure-bound.test.ts`의 일곱 사례는 다음을 검사한다.

- 4개 corner 도로와 100m 간격 subdivision 도로의 3200m square suffix 하한, 각 prefix의 실제 matching 비용 이하 조건, 실제 노드·native 길이 불변.
- 4 ports × 33 phases × 두 start의 모든 상태를 prefilter 없는 독립 Bellman-Ford와 비교하여 유한 거리·Infinity가 일치함. 같은 fixture에서 생략된 arc-phase의 실제 helper label이 모두 비어 있음도 검사.
- 이미 제공된 cache hit의 객체·내용·개수를 그대로 유지하고 전처리 miss로 cache를 채우지 않음.
- 빠진 실제 corner와 분리된 product component의 Infinity, 목표 자체의 0 비용.
- 마지막 phase 이후 실제 800m closure만 남는 사례와 guide-feasible closure가 없는 port.
- 존재하지 않는 실제 도로 span을 거부함. certificate의 각 arc/phase 전이를 helper로 다시 계산하여 비용과 실제 연결이 일치함.

Root가 실행한 `tests/rollout-no-backtrack.test.ts`의 세 search variant(NoBacktrack, AStar, ProductBound) 공통 fixture는 실제 100점 닫힌 square, 지연된 반복 connector 허용, 즉시 역주행 거절, native edge 연결, branch/Q 상한을 검사했다. 이는 synthetic 동작 검증이다. 원래 12조건 평균 향상이나 실제 도로 feedback의 인과 효과를 입증하지 않는다.

## 저장된 광안리 square 중간 결과

검토 시 완료되어 저장된 `gwangalli-square-control.json`과 `gwangalli-square-feedback.json`을 읽었다. 전체 네 조건 평가 결과를 대신하지 않는다.

양 arm 각각 start 16개 중 product 유한 start 14개, 불가능 start 2개였다. 불가능 start는 전개 0으로 제거되어 남은 예산을 다른 unit에 넘기지 않았다. 각각 전개 350000, strict 완성 50, 실제 Q 호출 50, unique geometry 41, product 불가능 상태 제거 334가 기록됐다. setupMs 합은 control 약 3798.9ms, feedback 약 4469.8ms였다. 기하학 하한 AStar의 square Q0와 비교하면 이번 방법은 같은 branch ceiling 안에서 완성 후보를 만들었다.

하지만 feedback elite 선택은 22회 기록되어도 그 선택 이후 전개 합은 0이었다. remaining-unit scheduling에서 한 suffix 실패가 남은 unit 예산을 먼저 소비해 다음 stage가 실행되지 않기 때문이다. 양 arm의 실제 생성 결과가 같다는 관찰은 feedback 효능 실패 또는 인과 효과를 입증하지 않는다. 먼저 선택 이후 실제 탐색을 수행할 예산을 남기는 통제가 필요하다.

## 다음 scheduling 대조의 검토 조건

product 전이를 고정한 채 `effectiveCap = min(legacyCap, remainingUnitBudget)`로 바꾸는 대조는 completion 하한과 scheduling 효과를 분리하는 데 타당하다. 현재 고정 subcap 기준으로 prefix 네 번의 `1875`와 suffix 최대 32번의 `546`을 합하면 unit 24972, case 399552의 계획 상한이다. unit 25k/case 400k ceiling과 미사용 unit 예산 미재분배는 계속 유지할 수 있다.

현재 transition은 per-call cap이 아니라 unit limit만 검사하므로 마지막 arc의 최대 네 phase branch로 개별 call이 cap을 최대 3개 넘을 수 있다. 한 줄 scheduling 변경만 대조한다면 이 bounded overshoot를 사전에 명시하고 실제 `expanded <= effectiveCap + 3` 및 전체 unit/case ceiling을 검사해야 한다. 정확한 per-call 상한을 보장하려면 transition 내부에 active call stop을 전달하는 추가 accounting 변경이 필요하며 별도 변경으로 기록해야 한다.

실질적인 feedback 검증은 elite 수나 선택 후 전개 수만으로 끝나지 않는다. 동일 reached pool의 counterfactual control beam 밖에 있던 실제 Q 평가 prefix가 feedback beam에 들어왔는지, 그 rescue 뒤에 실제 전개가 있었는지, 이후 서로 다른 실제 geometry 또는 원래 Q 개선이 나왔는지를 구분해야 한다. `rolloutTestPrefixes`가 이미 반환하는 control 집합으로 outside rescue와 selected 집합 차이를 계산할 수 있다. 테스트 통과, Q 생성 성공, 인과적으로 작동한 feedback, 평균 80 달성은 각각 별도의 주장이다.

## 고정 subcap clone 작성 기록

Root 승인 뒤 별도 `shapeGuidedPortRolloutProductStages.ts`와 `create-product-stage-rollout.mjs`를 작성했다. 부모 ProductBound의 고정 hash에서 13개 anchor를 적용하고 모든 역변환을 수행해 부모 내용을 정확히 복구했다. 실행 동작의 변경은 `effectiveCap = min(cap, remainingAtStart)`이며 나머지는 mode와 진단이다. 기존 guide/helper/cache/labels/비용/후보 선택/Q pool/실제 경로 조건은 그대로다. 새 소스 hash는 `3fd8205b351274692ba349cdd2a9268bc40437715be3b0018938ccdc67163093`이다.

각 search call의 overshoot, unit 및 전체의 최대 overshoot, 같은 reached pool의 counterfactual control 밖에서 실제 Q 평가 뒤 선택된 prefix 수와 선택 집합 차이를 기록한다. 첫 outside rescue 이후 unit의 전체 후속 전개 수를 별도로 기록한다. 이 수치는 rescue prefix의 후손이 실제 전개되었다는 lineage 증명은 아니므로 과도하게 해석하지 않는다. 새 두 파일 ESLint와 `npx tsc --noEmit`은 통과했으며 검토자가 새 field 평가나 holdout을 실행하지 않았다.
