# Ordered contour의 단일 라벨 길이 자원 진단

원래 `orderedContourPath`를 관찰 callback 두 개만 추가한 literal clone으로 실행했다. callback을 제거하면 원본 코드 문자열과 완전히 같다. 상태 갱신 조건과 우선순위, 경로 복원, 탐색 상한을 바꾸지 않았다. 고정된 원래 12조건의 최신 자동 결과에서 배치만 가져와 bins 32/64 × 양방향으로 총 48회 실행했다. 이는 기존 배치의 positive control이며 신규 자동 경로 탐색 성능으로 주장하지 않는다.

단일 라벨의 key는 phase와 incoming edge이며 실제 길이가 key에 포함되지 않는다. 길이는 별도 Float32 배열에 하나만 저장된다. 관찰 결과:

| 관찰 | 건수 |
|---|---:|
| 실제 갱신 시도 | 1,763,945 |
| 더 짧고 저렴한 기존 라벨 때문에 긴 제안이 거부됨 | 452,677 |
| 기존 길이 3km 미만, 제안 길이 3km 이상인 위 거부 | 17,173 |
| 더 저렴하고 짧은 제안이 기존 긴 라벨을 덮어씀 | 10,064 |
| 최종 phase에서 시작 노드에 도달했으나 3km 미달 | 0 |
| 반환 경로 | 48 / 48 |
| 400,000 확장 상한 도달 | 0 |

긴 이력 정보가 실제로 사라지는 갱신은 존재한다. 하지만 최신 자동 배치 48회에서는 모든 검색이 3–8km의 실제 연결 경로를 반환했고 반복 비율도 0.2 이하였다. 따라서 이번 자료는 길이 정보 소실이 이 배치에서 경로 생성 실패를 일으켰다는 주장을 지지하지 않는다. 거부된 라벨들의 미래 성공 가능성이나 Whole-Q 개선 가능성을 별도로 탐색하지 않았으므로, 이를 더 좋은 경로의 소실 개수로 해석하면 안 된다. 최종 목표 평균 80점 미달의 주원인이라고 단정할 수 없다.

원본과 clone의 반환 경로 전체, expanded, states가 48회 모두 정확히 같았다. 총 expanded 908,362, 원본+관찰 실행 합 약 3.445초였다. 각 반환 경로의 원식 평가 결과를 저장했다. 표시 점수의 48 trial 평균 73.9167은 같은 조건 네 번의 개별 실행 평균이므로 원래 12조건의 기존 최고 결과 평균과 비교할 성능 수치가 아니다.

이미 `multiLabelContourPath.ts`에는 phase/incoming edge에 500m 길이 bucket을 추가하고 immutable predecessor label로 경로를 복원하는 구현이 존재한다. 별도의 이전 12조건 실험에서도 이 방식만으로 목표를 달성하지 못했다. 이번 진단은 그 기존 실험을 대체하거나 bucket만 추가하는 신규 접근의 근거가 아니다. 현재 두 구현의 normalized road penalty와 phase penalty는 동일한 수식이다. 일반 비정규화 proxy, maxLabels/maxExpanded/maxGoals, 길이 bucket/복원 방식 등 실제 차이는 각각 구분해야 한다. 단순 bucket이 원리적으로 부족하다는 결론도 이번 실험 범위를 넘는다.

후속 history-label/Whole-Q feedback 설계는 최종 거리 제약뿐 아니라 원식 편차·RDP 꺾임과 proxy 순위 불일치 여부를 측정해야 한다. 같은 상태의 다른 경로 이력이 실제 Whole-Q를 개선하는지, 추가 계산 비용과 대조군 탐색 예산을 함께 검증해야 한다.

데이터: `eval/recognition/route-improvement/ordered-label-diagnosis-20261013/results.json`. 각 trial 파일에 원식 평가, 길이 교차 거부 witness, 검색 통계를 저장했다. 입력과 코드 원본·사본의 바이트 SHA-256을 고정했다. 원본 공유 core와 holdout은 수정하거나 읽지 않았다. 환경 변수 `ORDERED_LABEL_DIAGNOSIS=1`로 해당 eval 테스트를 실행하면 재현된다. 테스트 1개와 두 신규 파일 ESLint 통과.
