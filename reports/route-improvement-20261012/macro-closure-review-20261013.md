# Macrocycle 생성의 폐쇄 가능성 독립 검토

구현은 수정하지 않았다. 원래 도로 3지역과 저장된 자동 12경로를 읽기 전용으로 진단했다. 도형 품질 평가·holdout·새 검색은 실행하지 않았다. 상세 데이터와 검토 당시 코드 byte snapshot은 `eval/recognition/route-improvement/macro-closure-review-20261013/`에 있다.

**35–94는 지역 전체 port 수가 아니라 기존 경로의 압축 span 수다.** 실제 port 수는 광안리 471, 서면 537, 강남 848이며 macro edge는 795/885/1408이다. 따라서 depth128은 경로 표현 길이를 수용할 뿐, 수백 교차점에서 시작점으로 돌아오는 prefix가 유지된다는 증거는 아니다.

검토 당시 heading8 × length4 fanout은 방향 arc를 1590→1584, 1770→1740, 2816→2811로 줄였다. 모든 arc가 2km 미만이라 length4의 첫 bin만 사용되었다. 그러나 삭제율은 작고, 원래 12경로 모두 정방향 또는 역방향 하나에서는 필요한 arc가 모두 남았다. 최소 좌표 start보다 앞선 port를 금지한 induced graph에서도 시작점과 상호 도달 가능한 endpoint 쌍은 104494→104010, 129212→127001, 345346→344770으로 대부분 유지되었다. 그러므로 fanout이 실제 return 연결을 대규모로 끊었다는 설명은 현재 증거와 맞지 않는다.

**구현자가 이후 degree≤32이면 모든 outgoing을 보존하도록 수정했다. 위 수치는 수정 전 frozen snapshot 진단이다. 현재 구현의 성능·fanout 통계로 인용하지 않는다.**

상호 도달 가능성은 폐쇄의 필요조건이며 충분조건이 아니다. 같은 edge를 왕복하는 2-edge walk도 포함되므로 3–8km 또는 반복≤0.2를 만족하는 cycle 수로 해석하지 않는다. `startsNoCycleFull/Retained` 이름 역시 이 자료에서는 자신 외에 상호 도달 가능한 port가 없는 시작점 수이며, 엄밀한 유효 고리 부재 판정이 아니다. 기존 12경로의 적어도 한 orientation에서 필요한 arc가 남았다는 점은 표현 가능성 근거이나 reservoir가 해당 경로를 실제 생성했다는 증거는 아니다.

더 유력한 위험은 state reservoir의 희석이다. 현재 start-space × 누적길이 × 오목여부 strata는 endpoint와 closure availability를 구분하지 않는다. 초기 길이가 모두 2km 미만이고 양방향 turn이 없는 경우 실제 활성 quota는 16 start-space × 32 = 512이며, nominal 4096보다 작다. branching을 하면서 같은 시작점·현재 위치의 return 가능한 prefix와 되돌아가기 어려운 prefix가 같은 해시 quota에서 경쟁한다. 이 분석은 코드에서 도출한 상한이며, 실제 layer별 생존 분포는 아직 계측하지 않았다. 단순 depth 확대만으로 해결한다고 예상하지 않는다.

## 구현 담당자에게 전달한 제안

- 실제 port graph의 거리-only Dijkstra return lower bound를 이용해 `currentMeters + distanceToStart > 8000` 상태를 제거한다. canonical minimum-start 제한을 반영한 induced graph 거리도 안전한 하한이며 disconnected 상태는 제거할 수 있다. 완성 경로에 쓴 arc를 제거한 graph의 거리는 반복을 허용하는 원래 문제의 admissible bound가 아닐 수 있어 주의한다.
- 남은 depth보다 최단 macro-hop return 수가 많으면 폐쇄가 불가능하므로 안전하게 제거할 수 있다. 거리 bound는 Q bound가 아니다. 거리 bound를 넣는 것만으로 3km 이상 closure를 만들어 내지는 못한다.
- layer별 state 길이 분포, start별 생존 수, return 가능한 state 수, closure까지의 최단 거리·hop 분포를 계측한다. 후보가 없을 때 구조적 불가능과 quota에서 놓친 상태를 구분한다.
- port 방문·chain ID 재사용을 무조건 금지하면 원래 repeat≤0.2와 다른 문제를 풀게 된다. 중간 안전 제거는 `repeatedMeters/8000 > .2`이며 `repeatedMeters/currentMeters > .2`로 제거하지 않는다.
- 현재 코드가 start에 돌아온 뒤도 확장을 보존하므로, 3km 미만 첫 closure에서 종료하는 오류는 확인되지 않았다. 다만 짧은 반복 walk가 long return prefix와 경쟁하는 것은 별도 계측 대상이다.

실제 생성 결과가 희소하면 동일 frozen v1을 먼저 완료한 뒤, 후속 variant로 start까지 실제 shortest return suffix를 연결하는 Q-blind constructive closure를 별도 검토할 수 있다. 이는 현재 정책의 검증된 개선이 아니며 full path의 실제 edge·거리·반복 제약을 다시 검사해야 한다. 좋은 모양의 보존이나 80점 달성을 보장하지 않는다.
