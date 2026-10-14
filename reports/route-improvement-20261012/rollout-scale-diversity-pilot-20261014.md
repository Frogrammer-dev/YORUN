# 전체 coarse 배치와 크기 다양성 선택: 광안리 실제 경로 대조

2026-10-14. **배치 다양성은 늘었지만 기존 최고 경로를 이기지 못했다.** 광안리 원래 네 조건에서 두 선택 정책 모두 기존 후보를 보존한 표시 평균 **72.75**, 정밀 평균 **72.4719731927**, 채택 향상 **0/4**였다. 새 후보의 네모·고양이 품질은 기존 선택보다 높아졌으나 공정 기준선에 미달했다. 이 결과는 원래 12조건 전체 자동 파이프라인의 재실행이 아니며, 기존 자동 12조건의 평균77.416667과 목표80 사이의 차이를 해소하지 못했다. 새 지역과 holdout-v2는 읽거나 평가하지 않았다.

## 실험 범위와 동결

`tests/eval/shape-guided-scale-diversity-20261014.test.ts`를 새로 추가하고 기존 `shape-guided-product-stages-20261014.test.ts`의 평가·채택 규칙을 유지했다. 원래 광안리 bbox `(35.143,129.100)-(35.166,129.128)`, `square/heart/star/cat` 네 caseId의 정확한 집합, 원래 자료 해시를 실행 전에 검사했다. 원본 도로 스냅샷은 `2026-10-09T20:21:04Z`, `simple`, 계단 제외, 실제 폐곡선, 원래 영역 안의 경로와 원본 도형, 3,000–8,000m, 반복률≤0.2를 유지한다.

실행 전에 두 정책·예산·비교 규칙을 `protocol-before-run.json`으로 동결했다. 24개 실행 source의 해시와 `.source` 사본을 남겼으며, 입력·도로·source를 종료 시 다시 바이트 해시로 확인했다. 조건별 두 배치 선택은 저장 최고 후보를 열람·refit하기 전에 `*-selection-before-quality.json`으로 잠갔다. 저장 후보는 공정 기준선 비교에만 사용했다. 저장 좌표·배치·점수를 생성 seed나 선택 순위에 주입하지 않았다.

두 arm은 모두 **feedback=true**이고 같은 `shapeGuidedPortRolloutProductStages`를 사용했다. 따라서 이번 비교는 feedback 유무 실험이 아니라 **자동 placement 선택 정책의 대조**다.

| 정책 | coarse catalog | 실제 선택 |
|---|---|---|
| legacy-top48 | 원래 `globalSearch`가 반환한 상위48 | 기존 공간2×2·90° 회전 구간 선택8 |
| full-scale-diversity | 원래 coarse bucket 전체를 동일 순위로 반환한 독립 clone | 실제 scale의4개 percentile tier 우선, 공간·대칭 회전·원래 순위로 총8 |

독립 clone은 함수 이름과 반환 `placementSeeds`의48개 절단 제거 외에 원래 `globalSearch` 본문이 동일함을 역방향 복원으로 검사했다. 같은 readonly DistanceField에서 attempts=0으로 두 catalog를 생성했고, 실제 route 평가0·pool 없음·전체 catalog 첫48과 원래 반환48의 정확한 일치를 네 조건 모두 확인했다. 새 선택은 원래 catalog의 placement 객체8개만 반환한다. 이동·회전·균일 크기를 새로 만들어 넣지 않았다.

기존 rollout 함수는 전달된 pose를 내부 `rolloutPoseSeeds`로 다시 순서화한다. 두 정책 모두 이 기존 순서를 먼저 적용하고 선택 집합8개가 그대로 유지되는지 검사했다. 정책 선택 순서와 실제 실행 순서를 따로 저장했다. 예를 들어 새 네모 실행 순서는 정책 index `[0,1,2,4,5,6,7,3]`였다. nearest2 시작 port도 실제 실행 순서에 맞춰 별도 재계산·검사했다.

## 거리·연결·점수와 공정 기준선

공통 상한은 8pose×2start, unit별25,000·case별400,000 expansion, case별 rollout 원식 Q512, prefix4stage·기존 suffix profile이다. unused unit 예산을 다른 unit에 재배분하지 않았다. phase branch 때문에 단일 call cap이 최대3만큼 초과할 수 있는 기존 규칙을 각각 검사했고, unit/case hard cap은 그대로 통과했다. 두 arm의 상한은 같지만 실제 수행량은 다르다.

원래 `evaluatePath`와 원본 그림을 사용했다. 표시 필드를 역산하지 않고 정밀 평가 결과로 원래 지수 점수를 계산한다. retained pool 전체, refit 결과와 baseline에 대해 원래 영역·원래 도형·실제 연결·폐곡선·projected 거리·반복률을 검사했다. 추가로 실제 CSR의 각 간선 길이를 합하고 이미 지난 undirected 간선의 길이를 합하여 **native 3–8km와 native 반복률≤0.2를 독립 검사**했다. 최종 채택 후보에도 같은 native 검사를 적용했다. 저장된 `allCandidatesNativeAudited`는 하네스가 비교한 baseline·반환 pool·refit·채택 후보 범위를 가리킨다. top16 보존 이전 모든 내부 rollout의 독립 외부 감사가 수행됐다는 뜻은 아니다.

원래 경로와 `pairPhaseZero`로 시작점·방향을 표준화한 경로 각각에128회 균일 placement refit을 하고, 원래·표준화·보정 후 점수 중 최고를 기준선으로 삼았다. arm은 반환 상위8개 경로에 같은128회 보정을 적용했다. 원래와 다른 간선 multiset의 새 경로만 향상 후보로 삼고 이 더 강한 기준선을 초과할 때만 채택했다. 같은 경로의 이음매 재출력만으로 얻은 점수 변화는 채택하지 않는다. 후보가 기준선을 못 이기면 기존 결과를 보존하며 네 조건을 분모에서 제외하지 않는다.

최종 채택 경로는 이번에는 모두 기존 경로였다. native 길이는 네모5373.839716m, 하트3691.324675m, 별3339.329811m, 고양이3528.270555m였고 반복률은 모두0이다.

## 실제 결과

| 조건 | 공정 기준선 정밀점수 | legacy 새 경로 최고 | 전체·크기 다양성 새 경로 최고 | 최종 표시점수 두 arm |
|---|---:|---:|---:|---:|
| 네모 | 70.669645 | 60.940378 | 61.915182 | 71 |
| 하트 | 76.117988 | 75.885448 | 75.885448 | 76 |
| 별 | 72.534088 | 60.975426 | 60.975426 | 73 |
| 고양이 | 70.566172 | 44.509718 | 54.899962 | 71 |
| 표시 평균 / 정밀 평균 | 72.75 / 72.471973 | 기존 결과 보존 | 기존 결과 보존 | 72.75 |

‘새 경로 최고’는 원래와 다른 간선 multiset의 생성 후보와 공통 refit 중 최고다. 새 고양이는 legacy보다 정밀10.390243점 높아졌지만 기존 공정 기준선보다15.666211점 낮았다. 새 네모 최고 경로 native 길이는3046.701972m·반복률0.146950, 새 고양이는3033.286241m·반복률0.071773로 제약을 통과했다. 유효 경로 생성 성공과 기존 경로보다 좋은 모양 발견을 구분한다.

| 조건 | 선택 scale 수 legacy→새 | 물리 outline orbit 수 legacy→새 | rollout Q legacy→새 | expansion legacy→새 |
|---|---:|---:|---:|---:|
| 네모 | 1→6 | 3→8 | 245→38 | 205319→80544 |
| 하트 | 3→5 | 8→8 | 146→103 | 176621→152354 |
| 별 | 3→6 | 8→8 | 104→105 | 147145→139177 |
| 고양이 | 3→5 | 8→8 | 230→80 | 218728→169987 |
| 합계 | — | — | 725→326 | 747813→542062 |

원래 네모의 선택 scale은742.997145 하나였다. 새 정책에서는 `500,742.997145,905.723664,1104.089514,1345.900193,2000` 여섯 크기를 선택했다. 네모의 물리적 외곽선 중복은 줄었지만 완성 Q와 실제 expansion은 줄었다. catalog 다양성만으로 더 많은 유효 고품질 경로를 보장하지 않았다. legacy Q·expansion은 앞선 fixed-stage feedback arm의 기록을 정확히 재현했다.

## 비용과 제한

| 광안리4조건 합산 | legacy-top48 | full-scale-diversity |
|---|---:|---:|
| search 시간(전처리 포함) | 233.139초 | 258.327초 |
| product graph 전처리 | 168.150135초 | 210.397447초 |
| 시작점 reverse bound 준비 | 0.178816초 | 0.143473초 |
| 상위8 refit 시간 | 17.732초 | 14.652초 |
| 상위8 refit 평가 횟수 | 2720 | 2720 |

product·reverse 준비는 기존 expansion 상한 밖 비용으로 별도 저장한다. 하트의 product 전처리만 legacy139.506051초, 새171.767457초였다. 새 정책의 전체 expansion은27.5% 적었지만, 더 넓은 guide 반경·phase 후보를 가진 배치의 전처리 비용 때문에 search 시간은 늘었다. 실측 wall time은 같은 실행 환경의 참고값이며, 동시에 수행하는 다른 작업과 기기 상태의 영향을 받을 수 있다. 공통 graph182ms, 조건별 DistanceField·legacy coarse·full coarse·baseline refit 시간은 별도 case 기록에 남겼다. 단순히 case expansion 상한이 같다고 전체 계산량·지연이 같다고 보고하지 않는다.

실험은 독립 source·입력 동결 대조이고 최종 상태가 정상 종료된 결과다. 원래12 전체의 fresh 자동 cascade나 앱 시간 예산에서의 평가가 아니므로 이 대안을 앱에 적용하지 않았다. holdout-v2를 열지 않았다. 이름 인식·사람의 자유 명명 성능과 관련된 주장은 하지 않는다. finite completed-suffix proxy bound가 native Q 최적성이나 유효 해의 부재를 증명하는 것도 아니다.

결론은 **top48의 크기 편중은 실제로 존재하고 선택기로 해소할 수 있으나, 이 fixed-stage rollout에서 크기 다양화만으로 기존 경로를 넘는 효과는 확인되지 않았다**는 것이다. 같은 대조를 조건별 결과를 보며 반복 튜닝하는 대신 다음 실험에서는 서로 다른 생성 방식·native Q 개선 기작을 분리해 검증한다.

## 완료·재현 근거

- 새 하네스 단독 opt-in 실행: Vitest1개 통과, terminal exit0,17:27:31 시작,548.79초. `complete.json` 완료시각 `2026-10-14T08:36:39.831Z`.
- 최종 하네스 ESLint exit0, 프로젝트 `tsc --noEmit --incremental false` exit0. 실행 하네스 bytes는 완료 시 동결 해시와 여전히 같다.
- 결과: `eval/recognition/route-improvement/shape-guided-scale-diversity-20261014/gwangalli/results.json`, SHA-256 `72f67d07e461071ccd3af807ae1b7b248a5e23491a23cb6ee5e970b769b17aa2`.
- 사전 protocol: 같은 폴더 `protocol-before-run.json`, SHA-256 `2f5cd71e6cb832f77259f5a9cdc66c76effc8bd244dbda973d54fa481f4e9598`.
- baseline 입력: `offline-cascade-20261013/results.json`, SHA-256 `e3eef1f70792e5d75915724c1dc02e8b3775334515dd2ecb6794a58b79edcdf0`.
- 광안리 원 도로: SHA-256 `e31aa49adb02b6ec5e74759ad5fb3b2111084013df6ff48391ebd88d42ddf828`.
- 새 하네스: SHA-256 `d3a9d68bf199be89509afc8cff755e8248c81d8fddc6e1034598dd958f3eee23`.
- 원래 globalSearch: SHA-256 `8d2ccd481557ab8e32074df47cd53a75a436980b420bd2fc589ad7137f321308`.
- 전체 catalog clone: SHA-256 `0cc2ef0366f95cabdcd3d4ccd3d344809722923b5a67b23276e8ae93e78de6b6`.
- 공통 ProductStages: SHA-256 `3fd8205b351274692ba349cdd2a9268bc40437715be3b0018938ccdc67163093`.

실행 환경 변수는 `SHAPE_GUIDED_SCALE_DIVERSITY=1`, `ROLLOUT_AREA=gwangalli`이고 실행 파일은 `tests/eval/shape-guided-scale-diversity-20261014.test.ts`다. 출력 폴더가 이미 있으면 하네스는 덮어쓰기를 거부한다. 기존 근거를 보존하고 새 version의 하네스·출력 경로·해시로 후속 실행을 만든다. 실험 입력·결과 폴더는 로컬 평가 자료이며 Git 코드와 이 보고서만으로 복원되지 않는다. 완료 artifact의 해시·24 snapshot/current source·입력·도로·요약 재산술·case/unit/call 상한·native 최종 후보·품질 전 선택 lock은 별도 읽기 전용 감사 agent도 확인했다.
