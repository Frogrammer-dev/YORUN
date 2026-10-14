# 짧은 도로 회랑 전이 복구 실험

기존 자동 cascade의 원래 12개 결과에 실제 도로 회랑의 교차점을 이용한 국소 복구 단계를 추가했다. 평균 기하학 유사도는 **77.416667점**, 원시 평균은 **77.317593점**으로 변화가 없었다. 신규 지역은 읽지 않았다. 앱에는 적용하지 않았다.

## 사전 고정 방법

`corridorContinuationRepair.ts`는 현재 경로의 각 실제 도로 edge를 clipped maximal corridor에 대응시킨다. 순환 경로의 모든 전이 지점을 검사하고, 양옆 서로 다른 회랑 사이에서 선택된 회랑에 속하지 않는 짧은 구간을 찾는다. 양옆 회랑에 공통 실제 교차점이 있으면 그 회랑의 실제 노드 slice로 구간을 교체한다.

원래 gap과 새 연결 구간 각각 120m 이하, case별 geometry cap 128개를 실행 전에 고정했다. edge multiset을 정렬해 cap을 적용하고 품질은 이후 원래 평가식으로 평가한다. 실제 edge 연결, 폐곡선, 3–8km, 반복 20% 이하, 원래 영역 및 uniform template 배치를 유지한다. 원래 경로와 geometry-only canonical 경로 중 더 높은 점수를 넘어서는 실제 edge 변경만 채택한다. 수동 교차점 ID나 수동 positive control 경로를 seed로 주지 않았다.

이 단계는 **선택된 짧은 중간 회랑을 건너뛰지 않는다**. 여러 짧은 회랑을 한꺼번에 바꾸는 일반적 repair의 검증 결과로 해석하면 안 된다. 정규화된 경로 끝을 넘어가는 gap도 circular indexing으로 검사한다.

## 결과와 해석

12개 중 서면 square에서만 서로 다른 실제 edge 후보 1개를 생성했다. 이 후보는 모든 제약을 통과했지만 기존 경로를 이기지 못했다. 다른 11개에서는 후보가 생성되지 않았다. 따라서 이 방법의 평균 개선 실패는 대체로 후보 생성 범위가 좁은 데서 발생했고, 서면 square에서는 후보 생성 후 실제 품질 비교에서 실패했다. 작은 기존 회랑의 단순 연장만으로 광안리의 계단형 경로나 복잡한 star/cat 경로를 교정한다는 근거는 얻지 못했다.

별도로 원래 경로와 모든 strict 후보에 동일한 placement refit을 비교했다. 각 경로의 original/canonical 표현 각각에 refit128을 적용하고 새 후보는 geometry-only phase로 평가했다. 원래 경로의 높은 seam 점수도 보존했다. 원래 direct refit을 한 번 더 재계산한 것은 같은 시작점·budget의 결정적 중복이며 새 탐색 예산이 아니다. 이 비교에서도 12개 모두 개선이 없었다. 회랑 복구 자체와 placement 개선을 섞어 보고하지 않았다.

## 증거

- 결과: `eval/recognition/route-improvement/corridor-cascade-20261013/results.json`
- 실행 전 protocol과 source hashes 및 byte-preserving `.source` snapshots 포함. 추가 clipped/decomposition hash는 실행 후 기록이며 실행 전 고정이라고 주장하지 않는다.
- Vitest 전체 12개 성공, 실제 세션 38036 exit 0. 테스트 6.84초, case별 module+refit 합계 5.810초.
- 해당 module 및 평가 harness ESLint 통과, 실제 세션 46333 exit 0.
- 전체 TypeScript 검사 통과. 실제 노드 후보에 대한 seam 회전·역방향 geometry 불변, 실제 edge 및 잘못된 edge 거부 contract 통과(524ms), ESLint 통과. 추가 contract 세션 40962 exit 0.
- 평가 harness가 원본 도로 hash, 실제 graph node/edge, 거리·반복·영역, 원식 점수, 입력 보존 및 채택 시 changed edge를 검증했다.

이는 저장된 **자동 결과에 대한 후속 단계 replay**다. 처음부터 도로를 읽어 전체 cascade를 다시 실행한 결과나 새로운 자동 평균 향상으로 주장하지 않는다. 원래 80점 목표는 아직 달성되지 않았다.
