# Rollout placement 선택의 크기·회전·공간 분포 진단

2026-10-14. 이 문서는 저장된 결과와 코드의 읽기 전용 분석이다. 경로 생성, scorefield 재실행, 알고리즘 수정, holdout 열람은 하지 않았다. 실제 선택 placement 8개의 저장된 결과가 있는 것은 광안리 네 조건이다. 서면·강남의 현재 rollout 선택 8개는 아직 이 자료에 없으므로 그 분포를 추정하지 않았다. 알려진 최종 경로 12개의 placement는 비교 자료이며 생성 seed로 주입하지 않는다.

## 확인한 선택 단계

`globalSearch(g, shape, region, 0, true, true)`는 거리 field로 도형 외곽선의 도로 근접도를 순위화한다. coarse 단계는 scale 8개, 공간 3×3, scale index 두 개씩 묶은 4개 그룹, rotation index 세 개씩 묶은 그룹별로 상위 3개를 보존한다. 따라서 내부 coarse bucket 단계에는 크기 다양성이 있다. 하지만 최종 `placementSeeds`는 전체 bucket seed를 순위로 정렬한 **상위 48개만** 반환한다.

그 뒤 `selectRolloutPoses`와 `rolloutPoseSeeds`는 공간 2×2, 회전 90° 구간으로만 다양성을 선택한다. 크기 구간을 선택 key에 넣지 않는다. 앞선 top48에서 크기 그룹이 사라지면 rollout 단계에서 복원할 수 없다. 저장된 `coarseSeeds` 수는 bucket을 통과한 seed 수이며, 원래 생성한 모든 grid pose 수도 아니고 상위 48개 각각의 분포를 기록한 값도 아니다.

## 광안리 실제 선택 8개

| 조건 | bucket 후 seed 수 | 실제 선택 scale와 수 | 서로 다른 center 수 | 알려진 최종 경로 scale |
|---|---:|---|---:|---:|
| 네모 | 756 | 742.997 ×8 | 3 | 1116.291 |
| 하트 | 805 | 927.598 ×3, 1128.234 ×4, 1372.267 ×1 | 8 | 1082.479 |
| 별 | 786 | 977.665 ×2, 1191.787 ×5, 1452.804 ×1 | 5 | 808.363 |
| 고양이 | 750 | 828.043 ×4, 1009.396 ×2, 1230.467 ×2 | 8 | 875.429 |

네모는 선택된 8개가 모두 같은 크기다. 첫 center `(354.378, 482.162)`의 회전 `-120°, 60°, 150°, -30°`는 차이가 90°의 정수배이므로 물리적인 정사각형 외곽선이 같다. 다른 center `(-247.449, 749.641)`의 `60°, -120°, 150°`도 같은 외곽선이다. 남은 `(-180.580, 749.641, -12°)`를 합하면 8개 placement가 **3개 물리 외곽선**에 배분되어 있다.

다만 이 중복이 검색 상태까지 완전히 같다는 뜻은 아니다. 회전이 바뀌면 원래 template의 첫 점과 단계 순서가 다른 모서리에서 시작하고, nearest2 시작 port도 달라질 수 있다. 따라서 모든 대칭 회전을 무조건 제거하면 시작 위치의 다양성을 잃을 수 있다. 물리 외곽선의 중복과 시작 phase 다양성은 별도로 기록해야 한다.

알려진 최종 경로와 선택 seed의 가장 가까운 center 거리는 네모 151.354m, 하트 24.377m, 별 78.350m, 고양이 227.985m다. 이는 center만 비교한 값이다. 가까운 center와 가까운 회전·크기가 같은 seed에서 동시에 성립한다고 일반화하면 안 된다. 하트의 첫 seed는 실제로 center 24.377m, scale 비율 1.04227, 회전 차이 2.955°로 알려진 placement와 가까우나, 이 근접성만으로 동일한 경로를 생성할 수 있다고 판단할 수 없다.

## 이상적 외곽선 길이와 native 3km 하한

원래 정규화 도형의 perimeter는 네모 4, 하트 3.1896956961, 별 3.7056612503, 고양이 3.5891717910이다. guide에 선형 checkpoint를 추가해도 원래 외곽선 길이는 같으므로 이상적 guide 길이는 `scale × perimeter`다. 아래 값은 실제 도로 경로 길이가 아니다.

| 조건 | 선택된 이상적 guide 길이와 수 | 원래 3km 하한보다 짧은 선택 수 | 알려진 최종 경로 guide 길이 | 검증된 실제 native 길이 |
|---|---|---:|---:|---:|
| 광안리 네모 | 2971.989m ×8 | 8/8 | 4465.165m | 5373.840m |
| 광안리 하트 | 2958.754m ×3, 3598.722m ×4, 4377.113m ×1 | 3/8 | 3452.780m | 3691.325m |
| 광안리 별 | 3622.895m ×2, 4416.358m ×5, 5383.601m ×1 | 0/8 | 2995.518m | 3339.330m |
| 광안리 고양이 | 2971.989m ×4, 3622.895m ×2, 4416.358m ×2 | 4/8 | 3142.065m | 3528.271m |

네모 2971.989m는 3km보다 28.011m, 약 0.94% 짧다. 하트의 가장 작은 선택은 41.246m, 약 1.39%의 길이가 추가되어야 3km에 이른다. 도로를 따라가는 실제 경로가 이상적 외곽선보다 길어질 수 있으므로 이 작은 차이는 종료 불가능 증거가 아니다. 실제 알려진 광안리 별도 guide 길이는 2995.518m지만 native 길이는 3339.330m이고 제약을 통과했다.

선택된 네모의 scale은 알려진 네모 scale의 0.66559배다. 반면 별의 선택 scale은 알려진 별의 1.20944–1.79722배다. 전자는 작은 면적에서 native 3km와 닫힘을 함께 만족해야 하고, 후자는 더 큰 공간에서 도형의 단계를 순서대로 지나야 한다. 이는 검색하는 문제가 서로 다르다는 설명이며, 어느 쪽이 더 많은 expansion을 반드시 요구한다거나 높은 점수를 낸다는 증거는 아니다. 허용 반경도 scale과 함께 바뀐다: 네모 118.880m, 하트 148.416–219.563m, 별 156.426–232.449m, 고양이 132.487–196.875m다.

단계 수는 네모 32개 구간, 하트 102개, 별 40개, 고양이 44개다. 반경/평균 guide 구간 길이의 비율은 같은 도형에서 scale과 무관하다. 따라서 크기만 다양화한다고 하트의 많은 겹치는 checkpoint나 phase branch 문제가 해결되는 것도 아니다. 실제 branch와 종료 비용은 root의 유한 product graph 진단과 탐색 결과로 따로 확인해야 한다.

## 알려진 최종 경로 12개 비교 자료

| 지역·도형 | 알려진 scale | 이상적 guide 길이 | 검증된 native 길이 |
|---|---:|---:|---:|
| 광안리 네모 | 1116.291 | 4465.165m | 5373.840m |
| 광안리 하트 | 1082.479 | 3452.780m | 3691.325m |
| 광안리 별 | 808.363 | 2995.518m | 3339.330m |
| 광안리 고양이 | 875.429 | 3142.065m | 3528.271m |
| 서면 네모 | 758.414 | 3033.655m | 3185.865m |
| 서면 하트 | 1002.639 | 3198.113m | 3253.659m |
| 서면 별 | 1643.122 | 6088.854m | 6876.354m |
| 서면 고양이 | 1346.755 | 4833.734m | 5124.886m |
| 강남 네모 | 987.355 | 3949.418m | 3948.561m |
| 강남 하트 | 1862.870 | 5941.989m | 6378.592m |
| 강남 별 | 1807.043 | 6696.289m | 7536.605m |
| 강남 고양이 | 1872.316 | 6720.063m | 7857.120m |

native 길이는 저장된 정수 표시값 대신 known-path 재생에서 원래 CSR 간선 길이로 다시 계산한 값을 사용했다. 이 표는 12개 지역·도형에서 하나의 크기 prior를 최종 정답으로 취급하기 어렵다는 참고 자료다. 알려진 placement를 다음 생성 seed로 넣거나, 이 값에 맞춰 조건별 임의 parameter를 선택하는 근거로 사용하지 않는다.

## 제안하는 대안 하나: 전체 bucket seed에서 크기 그룹을 먼저 보존

기존 coarse grid와 거리 field 점수식을 보존하고, **top48 절단 전** bucket seed 전체를 선택기에 제공한다. 자동 생성된 서로 다른 scale을 크기순으로 정렬하고 percentile rank로 4개 그룹에 넣는다. 원래 scale 8개가 모두 남아 있는 경우 두 개씩 묶는 기존 coarse scale 그룹과 일치한다. 각 그룹의 원래 coarse 순위 최상위 placement를 하나씩 먼저 선택한다. 그룹 일부가 비어 있거나 scale 수가 줄면 실제 남아 있는 그룹만 선택한다. 저장된 최종 경로의 placement와 score는 선택에 사용하지 않는다.

남은 총 8개 자리에는 공간 2×2의 새 구간, 도형의 회전 대칭을 고려한 새 각도 구간, 원래 coarse rank 순으로 placement를 채운다. 각 fill 단계는 가능한 경우 기존 선택과 물리 외곽선이 다른 placement를 먼저 선택한다. 대칭 도형의 outline은 **실제로 배치된 원래 polygon의 cyclic vertex sequence**로 비교하여 물리적으로 같은 경계를 하나의 orbit로 기록한다. 그 orbit 안의 첫 점/회전 variant는 삭제하지 않고 metadata로 유지한다. 크기·공간·각도 coverage 이후 자리가 남으면 원래 순위의 phase variant로 채운다. 실제 회전이나 시작 점을 새로 만들어 template를 변형하지 않는다.

이 대안은 네모의 8개 모두가 한 크기에 몰리는 선택을 구조적으로 방지한다. 낮은 scale의 guide가 3km보다 짧더라도 hard exclude하지 않는다. 기존 native 거리 제약은 완성 경로에 그대로 적용한다. 이 선택 정책의 유사도 향상이나 평균 80점 달성은 아직 검증하지 않았다.

## 다음 blind 진단을 만드는 방법

1. 원래 평가와 source hash를 동결하고 `globalSearch.ts`의 독립 clone을 만든다. 함수 이름 변경과 clone의 `placementSeeds: seeds.slice(0,48).map(...)`를 전체 `seeds.map(...)`로 바꾸는 것 외에 원래 본문을 보존한다. 원래 `globalSearch.ts`는 수정하지 않는다. 전체 catalog의 원래 순위와 크기·공간·대칭 orbit은 별도 helper로 관측한다. 역방향 치환으로 원래 source bytes를 정확히 복원하는 검사를 둔다.
2. attempts 0으로 원래 도로·도형 12조건의 bucket seed를 수집한다. 완성 경로 평가나 known-path placement 주입은 하지 않는다. 원래 반환 top48와 clone 전체 catalog의 첫48이 같은지 검사한다. 기존 선택8, 대안 선택8의 scale index·공간·물리 outline orbit·시작 phase 분포를 저장한다. 입력·source byte hash를 전후 검사하고 holdout을 읽지 않는다.
3. 대안 quota와 symmetry 규칙은 결과 품질을 보기 전에 동결한다. root의 finite product graph 검사를 사용해 선택된 placement의 종료 연결 여부를 조사한다. 거리·반복률을 완화한 product 연결은 실제 valid 3–8km 경로 성공과 구분한다.
4. 종료 연결만으로 품질을 주장하지 않는다. 선택 정책이 타당하다면 그 뒤 동일한 8pose×2start×25,000 expansion, Q ceiling, actualedge/ROI/3–8km/repeat≤0.2 및 원래 점수식으로 경로 생성 대조를 한다. 최종 성공은 원래12의 fresh 자동 pipeline 평균80 이상과 untouched 새 지역 검증으로 판단한다.

## 독립 clone 구현 및 blind 기능 검사

`src/lib/route/globalSearchAllPoseSeeds.ts`와 generator `tests/eval/create-all-pose-seeds.mjs`를 추가했다. 원래 함수 source hash `8d2ccd…`를 동결했으며, generator의 역방향 복원 검사로 원래 body가 이름과 반환 catalog 절단 외에 같음을 확인했다. 전체 catalog는 원래 coarse rank 순서를 유지한다. module 끝의 `selectPoseScaleDiversity`는 원래 placement object만 선택하여 반환하며, metadata helper는 모든 입력 항목의 원래 rank를 보존한다. 기존 globalSearch와 앱 기본 동작은 변경하지 않았다.

`tests/all-pose-seeds.test.ts`의 네 검사에서 원래 source 복원, 실제 광안리 네모의 coarse-only 전체 catalog, scale/outline 다양성, 대칭 phase fallback을 확인했다. 실제 도로 검사에서는 원래와 clone이 같은 readonly DistanceField를 사용하고, routing 함수 호출을 금지했다. catalog 756개, 첫48 일치, 서로 다른 scale 8개, evaluated 0, routing call 0을 확인했다. 선택된 모든 pose는 원래 catalog object였고 처음 네 선택에 4개 scale tier가 모두 포함되었다. Vitest 4개 통과, 1.98초였다. 새 품질·거리·경로 결과를 만들거나 이 기능 검사를 평균 점수 향상으로 집계하지 않았다.

## 근거 파일과 해시

- 광안리 선택8: `eval/recognition/route-improvement/shape-guided-rollout-astar-20261014/gwangalli/results.json`, SHA-256 `2a16cb72d18a16c3e7be09492f5d90e93d0fd60ca87ec359113dc75fb4ec583e`.
- 알려진 최종12: `eval/recognition/route-improvement/offline-cascade-20261013/results.json`, SHA-256 `e3eef1f70792e5d75915724c1dc02e8b3775334515dd2ecb6794a58b79edcdf0`.
- native 재검증: `eval/recognition/route-improvement/rollout-known-path-replay-20261014/stable-lf-rerun/results.json`, SHA-256 `548309e20b5b336b29c178d87d718efc844137eb944b341fd3ad2999b287a5d5`.
- AStar pilot의 frozen `globalSearch.ts.source`: SHA-256 `8d2ccd481557ab8e32074df47cd53a75a436980b420bd2fc589ad7137f321308`.
- 같은 pilot의 frozen `shapes.ts.source`: SHA-256 `49cdf31beb5400c8bbb2be02b3ada15d86bc8f0ad5ab85c8221d93ea0684cd0d`. 도형 perimeter는 이 파일의 RAW 좌표·normalize·polylineLength 식으로 산술 계산했으며 원래 shape를 변경하지 않았다.
