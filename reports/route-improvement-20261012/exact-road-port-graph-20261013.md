# 손실 없는 도로 port graph 진단

기존 직선 corridor 방식은 길이·직진성 필터로 경로의 일부를 버릴 수 있었다. 신규 `exactRoadPortGraph.ts`는 원래 영역 안의 실제 도로 간선을 전부 포함한 induced graph에서 차수 2 노드를 압축한다. 압축 간선은 원래 노드 배열 전체를 순서대로 저장하며, 꺾인 차수 2 도로도 버리지 않는다. 길이는 원래 CSR `adjLen`의 합이다. 단순 chord 길이로 대체하지 않는다.

차수가 1 또는 3 이상인 실제 노드는 port로 남는다. 차수 2 노드만으로 이루어진 독립 고리는 좌표가 가장 작은 실제 노드를 결정적으로 port로 지정한다. 영역 밖 노드와 연결된 간선은 제외한다. 따라서 coverage 100%의 분모는 원래 그래프 전체가 아니라 양 끝 실제 노드가 모두 원래 영역 안에 있는 간선이다. 광안리의 전체 그래프 2347간선과 영역 안 2067간선 차이는 누락이 아니다.

| 지역 | port 수 | 압축 간선 수 | 네모/하트/별/고양이 경로 span 수 |
|---|---:|---:|---|
| 광안리 | 471 | 795 | 74 / 48 / 45 / 52 |
| 서면 | 537 | 885 | 42 / 35 / 88 / 71 |
| 강남 | 848 | 1408 | 35 / 70 / 94 / 82 |

span 수는 입력 시작점이 압축 간선 내부에 있을 때 두 부분으로 나뉜 것을 포함한다. span 수를 직선 구간 수로 해석하면 안 된다. 예를 들어 서면 네모의 42개 span은 이전 진단의 8개 긴 직선 corridor run과 다른 단위다. 자동 12경로의 최대 span 수는 94이다.

모든 지역에서 원래 영역 안의 실제 간선 coverage 100%, 압축 간선의 native 길이 합 일치를 검증했다. 기존 자동 12경로를 encode 후 expand하면 시작점과 방향까지 원래 노드 배열과 완전히 같다. 따라서 `evaluatePath`의 전체 반환값도 원본과 일치한다. 실제 노드 전체의 부호 있는 회전, 1° 이상 회전의 부호/오목 회전 개수, 경로가 지나는 실제 노드의 induced degree 분포를 결과에 저장했다. 이 지표는 RDP 단순화 이후의 꺾임 점수와 다른 관찰 지표다. 성능 향상을 주장하는 실험은 아니다.

API:

- `exactRoadPortGraph(g, region)` → `ports`, `edges`, `incident`, `degree`, `directedLocations`.
- `edges` 각 항목은 `{id, a, b, nodes, lengthMeters}`. `a/b`는 실제 graph node ID이고 `nodes`는 전체 실제 경로이다. 역방향은 `nodes.slice().reverse()`를 사용한다.
- `incident`는 실제 port node ID에서 접한 압축 edge ID 배열로의 Map이다.
- `encodeExactRoadPath(pg, nodes)` → `{edgeId, from, to}[]`. `from/to`는 압축 간선의 노드 배열 인덱스다. 내부 시작점, 역방향, 부분 구간을 보존한다.
- `expandExactRoadPath(pg, spans)` → 실제 노드 전체 배열. 연결되지 않은 span은 거부한다.

계약 테스트 3개는 꺾인 차수 2 도로, 영역 경계, 부분 구간/역방향/되돌아감, 순수 고리 anchor, junction 차수, 노드 ID 재배열 및 간선 순서 반전에도 같은 좌표 경로가 생성됨을 확인했다. 실제 12경로 감사 테스트 1개도 통과했다. 입력과 코드의 바이트 SHA-256 및 원본 코드 사본은 `eval/recognition/route-improvement/exact-road-port-graph-20261013/`에 저장했다. 기존 공유 core와 새 지역 holdout은 변경하지 않았다.

재현: `EXACT_ROAD_PORT_AUDIT=1`로 `tests/eval/exact-road-port-graph-20261013.test.ts` 실행. 계약 테스트는 `tests/exact-road-port-graph.test.ts`이다.
