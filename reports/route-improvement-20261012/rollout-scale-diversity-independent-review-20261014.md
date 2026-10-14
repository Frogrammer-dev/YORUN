# 전체 배치 catalog·크기 다양성 대조의 독립 감사

2026-10-14. 이 감사는 생성 코드·하네스·동결 소스·실제 출력의 읽기 전용 검토다. 도로 탐색을 다시 실행하지 않았고, 기존 경로·평가식·holdout-v2를 수정하거나 열람하지 않았다. 실행 담당 에이전트가 확인한 session 19460은 종료 코드 0, Vitest 1개 통과, 548.79초로 완료됐다.

결론: 새 선택기는 크기 다양성을 확보했지만 광안리 4조건에서 기존 최고 경로를 넘지 못했다. 두 arm의 보존 평균은 **72.75 / 정밀 72.47197319265052**, 향상 0건이다. 고정 12조건의 fresh 자동 평균 77.416667을 올린 결과가 아니며, 평균 80 목표와 새 지역 검증은 아직 미완료다.

## 1. 실제 대조와 숫자

두 arm 모두 같은 ProductStages 모듈, feedback=true, 8개 자동 배치 × 배치별 시작 port 2개를 사용한다. control은 원래 globalSearch가 반환한 상위 48개와 기존 선택기를, 대안은 원래 coarse bucket 전체 catalog와 4개 크기 tier 선택기를 사용한다. 따라서 이 실험은 catalog 제공 범위와 선택 정책을 함께 바꾼 대조다. 각각의 단독 효과를 분리했다고 표현할 수 없다.

| 조건 | control 크기 / 물리 외곽선 수 | 대안 크기 / 물리 외곽선 수 | control 새 후보 최고 raw | 대안 새 후보 최고 raw | 공정 비교 기준 raw | 채택 점수 |
|---|---:|---:|---:|---:|---:|---:|
| 광안리 네모 | 1 / 3 | 6 / 8 | 60.940378 | 61.915182 | 70.669645 | 71 |
| 광안리 하트 | 3 / 8 | 5 / 8 | 75.885448 | 75.885448 | 76.117988 | 76 |
| 광안리 별 | 3 / 8 | 6 / 8 | 60.975426 | 60.975426 | 72.534088 | 73 |
| 광안리 고양이 | 3 / 8 | 5 / 8 | 44.509718 | 54.899962 | 70.566172 | 71 |

물리 외곽선 수는 실제 배치한 원본 polygon의 cyclic 좌표열을 1µm 단위로 비교한 metadata다. 회전 대칭이 같은 모양이라도 원본 template의 phase-zero와 시작 port가 다를 수 있다. 네모에서 control 8배치가 3외곽선에 몰렸던 현상은 해소됐지만, 다양성이 완성 경로의 양이나 점수 향상으로 곧바로 이어지지는 않았다. relaxed product 하한의 유한 시작 상태 수는 control 14/16, 16/16, 16/16, 16/16에서 대안 6/16, 14/16, 12/16, 12/16으로 줄었다. 이는 현재 선택된 phase label 그래프의 진단이며 해당 도로에서 모든 유효 경로가 불가능하다는 증명이 아니다.

## 2. 예산과 실제 비용

각 조건의 전개 상한 400,000, unit 상한 25,000, 직접 원식 평가 상한 512를 유지했다. prefix 호출 1,875, suffix 호출 546의 개별 상한도 동일하며 한 전이가 여러 phase branch를 반환해 생기는 최대 3개 초과를 계측·검사한다. 모든 실제 조건·unit·호출 기록은 해당 상한을 통과했다. 사용하지 못한 unit 예산을 다른 배치로 옮기지 않는다.

| 합계 | control | 대안 |
|---|---:|---:|
| 직접 원식 평가 Q | 725 | 326 |
| 실제 전개 | 747,813 | 542,062 |
| search 전체 | 233.139초 | 258.327초 |
| 위 search에 포함된 product 전처리 | 168.150초 | 210.397초 |
| 위 search에 포함된 reverse 하한 전처리 | 0.179초 | 0.143초 |
| 별도 최종 배치 보정 | 17.732초 | 14.652초 |
| 보정의 원식 평가 | 2,720 | 2,720 |

동일한 설정 상한을 비교했으나 실제 작업량·벽시계 시간은 같지 않다. product 그래프 준비, reverse 탐색, coarse 거리장 준비, 원식 평가·보정은 전개 상한 밖의 비용이다. 특히 하트에서 control product 전처리 139.506초, 대안 171.767초가 발생했다. 대안의 가장 큰 하트 배치 scale 2030.100의 product 준비만 49.127초였다. 대안은 전개가 줄고도 search 시간이 늘었으므로 이 결과를 속도 개선으로 주장하면 안 된다.

## 3. 원래 평가 조건과 채택 규칙

하네스에서 네 case ID의 정확한 집합과 네 row의 동일한 고정 bbox를 검사한다. 광안리 영역은 south 35.143 / west 129.100 / north 35.166 / east 129.128, 원래 snapshot 시각은 2026-10-09T20:21:04Z다. simple·계단 제외 그래프에서 실제 노드와 간선, 폐곡선, 원래 영역 안 경로·원본 그림, 3,000–8,000m, 반복률 0.2 이하를 유지했다.

점수는 원래 evaluatePath 그대로이며 표시용 반올림 필드로 raw를 재구성하지 않는다. CSR adjLen으로 native 길이와 반복된 undirected 실제 간선의 길이를 따로 합산하는 gate도 원래 incumbent·canonical·최종 후보에 적용했다. 최종 보존 경로의 native 길이는 네모 5373.839716m, 하트 3691.324675m, 별 3339.329811m, 고양이 3528.270555m이며 모두 반복률 0이다. 감사에서는 이 gate의 코드·호출 범위와 출력값을 확인했다. 별도의 graph 재구성·전체 경로 재생은 수행하지 않았다.

baseline은 저장된 자동 incumbent의 원래 이음매와 canonical 이음매를 각각 최대 128회 균일 배치 보정한 뒤 최고 raw를 보존한다. 새 경로도 canonical 입력과 상위 8개에 최대 128회 보정을 적용한다. 새 경로의 실제 undirected 간선 multiset이 원본과 달라야 하고 위 공정 baseline raw를 넘어야 향상으로 채택한다. 같은 경로의 시작점을 바꿔 얻은 상승만 채택하는 구조가 아니다. baseline은 비교·보존에만 쓰이며 생성 seed로 주입하지 않는다.

출력 분모는 정확히 4다. 이 보존 평균을 fresh 12조건 결과나 새 지역 결과로 표현하지 않는다. 프로토콜의 fromRoadsWholeCascadeRerun, twelveConditionGoalVerified, newRegionValidationPerformed는 모두 false다.

## 4. 배치 선택과 소스 동일성

globalSearchAllPoseSeeds의 원래 본문을 함수 이름과 catalog 반환 절단만 역치환하면 원래 globalSearch source bytes가 정확히 복원된다. 원래 coarse 점수·grid·bucket·routing 본문은 유지됐다. clone의 첫 48개는 원래 반환 48개와 동일하며 attempts=0이므로 이 단계의 routing/evaluate 결과는 없다. 모든 새 배치는 원래 전체 catalog의 객체이며 known-path placement나 점수를 선택기에 전달하지 않는다.

각 shape의 selection-before-quality 파일을 원래 incumbent의 평가·보정 전에 저장했다. 최종 record의 selection 내용이 이 파일과 동일한 것을 독립 비교했다. 내부 rolloutPoseSeeds가 실행 순서를 다시 정렬할 수 있어 policy 순서와 실제 순서를 분리해 기록한다. 실제 8배치의 객체 값 집합은 유지된다. 예를 들어 네모 대안의 실행 policy index는 [0, 1, 2, 4, 5, 6, 7, 3]이다. 시작 port 검사는 이 실제 실행 순서에 맞춰 수행한다.

24개 관련 소스의 동결 snapshot 해시·현재 소스 해시가 protocol 해시와 모두 일치했다. 입력·도로도 전후 해시가 일치한다. frozen AStar 자료와 비교한 evaluatePath 본문은 bytes 동일하다. shapes.ts 전체는 다른 작업의 run/frame/image metadata 때문에 옛 파일과 다르지만, sharpVertices·normalize·RAW·SHAPES·resample·anchors의 원본 template 핵심 구간은 bytes 동일했다. 이 차이를 원본 그림 변경으로 혼동하지 않는다.

## 5. 완료 자료와 다음 해석

complete.json의 resultsHash와 protocolHash가 실제 파일 bytes와 일치한다. 저장된 네 조건을 재산술한 정수 평균·raw 평균·향상 수·Q 합·전개 합도 summary와 일치한다. 코드·데이터 동결, 자동 catalog 멤버십, 시작 port·실제 거리·연결·공정 이음매 비교를 감사한 범위에서 평가 위반은 발견하지 못했다.

이번 증거는 크기 다양성 선택의 실행을 확인하고 이 설정에서의 품질 향상 가설을 기각하는 데 쓴다. 평균 80 달성이나 product 탐색의 최적성, 더 넓은 크기 탐색의 보편적 무용성을 주장하지 않는다. 이 실험을 앱에 적용하거나 서면·강남 전체 대조와 untouched 새 지역 검증을 완료했다는 근거도 없다.

근거 폴더: eval/recognition/route-improvement/shape-guided-scale-diversity-20261014/gwangalli/.

- results.json: SHA-256 72f67d07e461071ccd3af807ae1b7b248a5e23491a23cb6ee5e970b769b17aa2.
- protocol-before-run.json: SHA-256 2f5cd71e6cb832f77259f5a9cdc66c76effc8bd244dbda973d54fa481f4e9598.
- 원래 globalSearch.ts: SHA-256 8d2ccd481557ab8e32074df47cd53a75a436980b420bd2fc589ad7137f321308.
- 전체 catalog clone: SHA-256 0cc2ef0366f95cabdcd3d4ccd3d344809722923b5a67b23276e8ae93e78de6b6.
- 원래 evaluatePath 핵심 구간: SHA-256 78707400037b9359fe578856a9a35c6e757b5119e6354edc6497d8e097cdbd0e.
- 원래 template 생성 핵심 구간: SHA-256 2be7d11f3eae9ae7952208573e80d70ae05d4c9aee35b2b37ca8ef0abc119f0a.

## 6. 보조 감사: 직접 global routing의 크기 순서 변경

같은 날 root가 별도로 완료한 global-scale-interleaved-20261014/gwangalli 대조도 읽기 전용으로 확인했다. root가 관찰한 session 80548은 종료 코드 0, 189.20초였다. 이 대조는 원래 globalSearch의 coarse 점수·실제 routing·최종 local 보정 본문을 유지하고, 처음 routing할 240개 원래 배치를 4개 크기 tier 순위의 round-robin으로 바꾼다. 함수 이름과 seed 순서 치환을 역복원하면 원래 source bytes가 정확히 복원된다.

실제 저장된 routingTrace의 처음 240개를 위 rollout 대조의 동일 coarse 전체 catalog metadata와 대조했다. control은 원래 coarse rank 순서와, 대안은 별도로 재구성한 4tier round-robin 순서와 네 조건 모두 정확히 일치한다. 두 arm 각각 조건별 실제 호출은 초기 240 + local 96 = 336이며 합계 1,344다. 단지 정책 이름만 바뀌고 같은 호출이 실행된 실험이 아니다.

| 조건 | 초기 240 중 공통 배치 | 대안만 호출한 배치 | 동일 순서 위치 수 | 두 arm 최고 후보 raw |
|---|---:|---:|---:|---:|
| 네모 | 194 | 46 | 1 | 67.790793 |
| 하트 | 176 | 64 | 4 | 74.255330 |
| 별 | 193 | 47 | 2 | 71.404637 |
| 고양이 | 189 | 51 | 3 | 67.812299 |

초기 호출의 모든 배치는 원래 catalog에 존재한다. 두 arm의 최종 최고 후보는 네 조건에서 실제 nodes 순서·undirected 간선 multiset·placement·native 길이·raw가 모두 정확히 같았다. 반환 전체 pool은 이 자료에 보존되지 않았으므로 전체 pool의 동일성까지 주장하지 않는다. global 결과 평균은 두 arm 모두 70.25 / 정밀 70.31576481657227, 기존 최고를 보존한 평균은 72.75 / 정밀 72.47197319265052, 향상 0건이며 반환 후보 거절은 0건이었다.

13개 동결 소스 snapshot이 protocol 해시와 일치한다. 현재 소스와의 차이는 실행 종료 후 추가한 하네스의 records 배열 타입 주석 한 줄뿐이다. 그 한 줄만 되돌린 문자열이 frozen 하네스 bytes와 정확히 같고 SHA-256 9df145340bcf772e96bb7402414063a226c11ae115a6fe6d379bb1f3682644b2를 복원하는 것을 확인했다. 런타임 소스가 달라진 현재 실행을 옛 결과로 덮어쓴 것으로 해석하지 않는다. 원래 도로·입력 해시도 일치한다.

이 보조 대조는 실제 다른 배치를 routing했는데도 최고 결과가 바뀌지 않았다는 음성 근거다. 12조건의 전체 자동 파이프라인이나 새 지역 검증, 다른 크기 선택 정책의 가능성에 대한 결론으로 확장하지 않는다.

- 보조 results.json: SHA-256 48ed59895520b2bb61d6274064b546ab7c83a0d5ac67f145ae4520999dce8ffe.
- 보조 protocol-before-run.json: SHA-256 d97f3bce70757481b561310fa63ac774eb3fcd33df6d72a4f40225de5fbb3302.
