# 실제 도로 직선 지지선에서 만든 자동 배치 및 고리 제안

이 실험은 기존 global coarse의 계산 횟수를 늘리는 대신, 필터링된 실제 RoadGraph의 직선 체인과 평행 간격을 위치·회전·uniform 크기의 사전 분포로 사용했다. 광안리 square/heart/cat를 대상으로 각 방법 최대 48개 배치를 같은 기존 flex 라우팅으로 생성했다. 저장된 최신 자동 경로는 결과 비교와 fallback에만 사용했고 씨앗·수동 좌표로 사용하지 않았다. 새로운 지역 자료는 열지 않았다.

원래 평가식, 원래 도형, 폐곡선, 실제 간선, 3–8km, 반복률 ≤ 0.2, 원래 지도 영역 및 도형 영역 제약을 유지했다. 새 후보의 출발점과 방향은 pairPhaseZero로 고정했다. 신규 채택은 incumbent의 원래 점수와 canonical 점수 중 높은 값을 모두 넘어야 한다. distance-field surrogate는 후보 순위에만 사용했다.

## 사전 동결한 각 버전과 결과

- v1: degree-2 체인, ≥80m, chord/실제 길이 ≥0.96, 5도 heading histogram 상위 네 방향. 평행 두 지지선과 수직 한 지지선의 유한 선분 교차로 배치 생성. 세 도형 모두 proposal 0개였다.
- v2: junction에서도 전진 방향과 10도 이내인 유일한 실제 간선을 계속 추적해 긴 corridor 생성. 직선 164개, dominant headings 170/80/105/60도. 각 도형 48개 proposal이 생성되었다.
- v3: 평행 두 선과 수직 두 선의 중간을 center로 사용. 네 유한 chord의 교차에 80m 허용 범위, 두 간격에서 구한 uniform scale 일치 오차 ≤15%. 세 도형 모두 proposal 0개였다. 임계값을 계속 완화하지 않았다.

v2 결과:

| 도형 | 새 직선 prior valid /48 | 기존 global valid /48 | 직선 prior 신규 최고 정밀 점수 | 기존 global 신규 최고 | 유지한 incumbent |
|---|---:|---:|---:|---:|---:|
| square | 12 | 46 | 60.425000 | 65.067640 | 71 |
| heart | 11 | 44 | 44.567458 | 69.247245 | 76 |
| cat | 8 | 45 | 60.635748 | 64.639766 | 71 |

직선 prior 생성 111–193ms, 라우팅 243–436ms, 기존 coarse 생성 804–984ms, 라우팅 489–932ms였다. 실패와 후보 수가 크게 달라 이 시간 차이를 같은 품질에서의 속도 개선으로 해석할 수 없다. 신규 geometry 및 placement-only 채택은 모두 0건이다. v1/v3는 seed coverage 실패이므로 48개 라우팅의 동등 비교가 성립하지 않는다.

v3 관측 통계는 세 도형 모두 유한 지지선 조합 607,044개 거절/481개 통과였다. 이후 4방향 각각에 대한 aspect 거절은 square 1656, heart 1660, cat 1636이고, nominal 도형 길이 2–8km 거절은 각각 268/264/288이었다. template 영역 밖 거절은 0이었다. 따라서 이 v3에서는 배치 이후 routing이 아니라 proposal 전에 coverage가 막혔다. nominal 길이는 제안용 검사이며 최종 실제 3–8km 제약을 대신하지 않는다.

## 실제 네 corridor 폐곡선 추가 실험

네 방향 지지선이 같은 실제 graph node를 공유할 때만 꼭짓점으로 인정했다. 각 체인의 전체 node sequence에서 네 변을 잘라 이어 붙였다. 지도 위의 기하학적 교차만으로 연결을 만들지 않았다. 점수를 보기 전에 간선 geometry key 순서로 최대 48개를 고르는 별도 추가 예산이었다. 전체 후보가 3km 미만이라 원래 평가에 들어갈 후보는 없었다.

광안리에서 검출한 rectangle 조합 452개는 중복 방향 열거를 포함한다. 길이 최소 238.967m, 최대 1773.565m이며 모두 3km 미만이었다. 엄격한 길이 범위에 들어간 unique cycle은 0개, 라우팅·fit 평가도 0개다. 초기 광안리 실험의 추가 검출 전체는 약241ms였다.

초기 양성 결과 후 확대 규칙을, 같은 원래 3지역에서 지역별 coverage를 확인하도록 명시적으로 수정했다. 임계값·cycle cap·선정 순서·점수·도로 조건은 수정하지 않았다. 이후 원래 서면/강남 square에서도 검사했다.

| 지역 | 조합 수(중복 포함) | 길이 범위 m | 실제 3–8km unique/선정 | 유지한 점수 | 전체 시간 ms |
|---|---:|---:|---:|---:|---:|
| 광안리 | 452 | 238.967–1773.565 | 0 / 0 | 71 | 299 |
| 서면 | 602 | 50.144–2335.209 | 0 / 0 | 85 | 426 |
| 강남 | 279 | 210.414–1372.371 | 0 / 0 | 98 | 741 |

모든 조합은 3km 미만이었다. pose/native 평가에 들어갈 후보가 없었으므로 이 두 단계의 거절은 모두 0이다. 기존 자동 incumbent를 원래 및 canonical 점수로 다시 확인하여 강한 값으로 보존했다. 광안리의 같은 조건 재실행에서 기존 길이 통계가 정확히 재현됐다. 최신 결과는 각 지역 하위 폴더에 별도로 저장했다. 세 square 결과를 12조건 평균 개선으로 섞지 않았다.

이미 높은 점수의 3km 이상 square가 있는 강남에서도 검출하지 못한 점을 확인하기 위해 기존 경로 간선의 직선 지지선 포함률을 읽기 전용으로 계산했다. 길이 기준 광안리 82.34%, 서면 46.15%, 강남 25.01%였다. 기존 경로는 제안용 seed로 사용하지 않았다. 이 통계는 강남에서 직선 extractor가 유효 경로의 대부분을 포함하지 못함을 보여 주며, 큰 사각형이 지역에 없다는 결론을 반박한다.

이 결과는 이번 직선 체인 정책이 만든 작은 직사각형 고리의 결과다. 광안리에 3km 이상의 좋은 사각형이나 다른 모양이 없다는 증명은 아니다. 긴 corridor가 완만한 커브 또는 중간 교차점의 여러 선택지를 만나 분리되는 현상, 네 직선으로 제한된 표현이 실제 좋은 경로를 배제하는 현상은 별도로 검토할 수 있다. 다음 접근은 단순 threshold 완화보다 여러 직선·완만한 연결 구간으로 된 도로 skeleton의 실제 cycle을 생성하고 원래 점수로 검증하는 방향이 타당하다.

## 산출물·검증

### v4: maximal bidirectional 직선 추출의 구조 교정

v3의 global visited와 한 방향 시작은 긴 corridor 중간을 먼저 소비할 수 있었다. 또한 degree2는 각도와 상관없이 계속 추적했기 때문에 90도 굽은 전체 체인이 chord 검사에서 떨어지며 각 직선 부분까지 사라졌다. v4는 모든 degree에서 같은 ≤10도 기준을 적용하고, 역방향에서도 서로 유일한 incident-edge 쌍만 연결한다. predecessor 없는 끝점부터 maximal 체인을 추적하며 원형 component는 별도 기록한다. min80m와 chord ratio0.96 및 cycle48/3–8km 정책을 그대로 유지했다. node 번호/edge 열거 순서를 바꾼 grid에서 같은 물리 geometry가 나오고 degree2 90도 굽음을 두 직선으로 복원하는 계약 검사 2개가 통과했다.

| 지역 | v3→v4 incumbent 지지선 포함률(길이) | v4 선택 직선 | cycle 조합/최대길이 m | strict unique/선정 | 신규 최고 | incumbent |
|---|---:|---:|---:|---:|---:|---:|
| 광안리 | 82.34→95.44% | 212 | 1655 / 2410.808 | 0 / 0 | 없음 | 71 |
| 서면 | 46.15→97.41% | 287 | 1486 / 2866.543 | 0 / 0 | 없음 | 85 |
| 강남 | 25.01→75.13% | 344 | 1081 / 5053.181 | 25 / 25 | raw92.643264 / 표시93 | 98 |

광안리/서면은 모두 길이 미달이다. 강남의 길이 미달 조합은1031개이며 나머지는 역순 중복 제거 후25개다. 강남25개는 실제 간선과 원래 영역·도형 영역·3–8km·repeat.2·폐곡선 및 canonical native 평가를 모두 통과했고 pose/native 거절은0개다. geometry key 순서의 점수 독립 cap48 선택으로 후보를 골랐으며 실제로25개만 있었다. 추가 uniform refit 또는 저장 경로를 부모로 삼는 탐색은 실행하지 않았다. 모든 지역 기존 incumbent의 원래 점수와 canonical 점수 중 높은 값을 보존했고 새 최고 개선은 없었다.

전체 원래 간선은 광안리2347, 서면2649, 강남3138개 모두 분해에서 처리되었다. 원형 component는 모두0개였다. 너무 짧은 체인/최종 chord 비직선/영역밖 거절은 각각 광안리688/1/23, 서면476/4/17, 강남230/0/56이다. 이는 영역 밖을 통과하는 긴 corridor 전체를 버리는 등 남은 coverage 제약을 명시한다. 경계에서 실제 node별로 잘라내는 처리는 이번 v4에 포함하지 않았다.

v4는 새로운 배치 임계값을 지역에 맞게 조정한 실험이 아니라 추출 구조의 교정이다. 강남에서 이전에 없던3km 이상 strict actualcycle25개가 생성된 것은 교정의 실제 효과이며, 기존98점보다 낮으므로 목표 평균 개선의 증거가 아니다. v4 결과는 `eval/recognition/route-improvement/road-geometry-cycles-v4-20261013/{지역}/results.json`에 저장했다. harness는 API 객체를 얻기 위해 legacy v3 pose도 계산하지만 그 pose는 seed나 cycle에 사용하지 않는다. decomposition/사용하지 않은 legacy proposal/cycle 열거/native fit 시간을 별도로 기록했다.

### v4 기존 높은 점수 경로의 미표현 원인 진단

추출에 선택 결과를 바꾸지 않는 optional trace observer를 추가했다. 기본 호출과 관측 호출의 전체 return 객체가 같고, 기존 v4 분해 통계가 세 지역 모두 정확히 재현됨을 검사했다. 모든 graph edge는 하나의 raw chain에만 배정됨을 확인하고 각 기존 경로 간선을 체인의 선택/거절 원인으로 분류했다. 기존 경로는 positive control 진단에만 사용했고 search seed·좌표 제안에 사용하지 않았다.

- 강남98: 미표현 11간선/982.133m가 전부 `outside` 거절이다. 전체 길이1850.717m 체인의 일부가 원래 영역 밖이어서 영역 안 실제 경로982.133m 부분까지 함께 버려졌다. 기존 경로는 이 한 체인 구간과 선택된987.619/988.283/990.525m 세 체인 구간으로 이루어졌다. min80/비직선/원형 거절로 미표현된 기존 경로 간선은0개다. 이는 짧은 corner connector보다 전체 outside 체인 폐기가 먼저 해결해야 할 명확한 표현 문제다.
- 서면85: 미표현7간선/82.619m는 모두 `too-short` 체인이다. 폐곡선 경계의 연속된 짧은 connector run 하나이며 각각의 체인이80m미만이라 배제됐다. 이 run 전체는60m보다 길다.
- 광안리71: 미표현10간선/245.293m는 모두 `too-short`이다. 연속 run 길이는28.208/110.465/69.051/37.569m이다. 기존 경로가 여러 selected 체인을 거치므로 네 긴 직선 모델 자체가 충분하다는 근거는 없다.

원자료 `eval/recognition/route-improvement/road-corridor-coverage-20261013/`와 `tests/eval/road-corridor-coverage-diagnosis.test.ts`에 기록했다. 다음 독립 표현 교정은 outside maximal chain을 원래 영역 안 기존 node의 연속 run으로 잘라내고 같은 min80/chord0.96 검사를 다시 적용하는 방식이다. 경계 교차에 새 node/새 좌표를 삽입하거나 원래 bbox 밖 간선을 포함하는 방식은 제안하지 않는다. 이후 connector 정책의 효과를 따로 판단한다.

### v5: 기존 영역 안 실제 node run 보존

위 원인에 따라 별도 `clippedRoadCorridors.ts`를 추가했다. maximal 분해의 밖으로 연장된 체인을 원래 bbox 안 기존 node의 연속 run으로 잘랐고, 각 run의 실제 CSR 간선 길이를 다시 합산하여 기존 min80m/chord0.96를 검사했다. 밖/안 연결 간선과 밖 간선을 모두 버렸으며 경계에 새 좌표나 node를 넣지 않았다. 영역 안 기존 selected 체인을 모두 보존했고 short connector·영역 확대는 적용하지 않았다. 일부 전체 nonstraight 체인도 영역 밖을 포함한 경우 먼저 자른 실제 inside run에 같은 straightRatio를 검사한다. 실제 원래3지역에서는 새 clipped run의 비직선 거절은 아래와 같다.

| 지역 | 기존 selected→v5 selected | accepted clipped run | 길이/비직선 clipped run 거절 | strict cycle unique/선정/최종 valid | 신규 최고 정밀/표시 | incumbent |
|---|---:|---:|---:|---:|---:|---:|
| 광안리 | 212→219 | 7 | 9 / 0 | 2 / 2 / 2 | 약0 / 0 | 71 |
| 서면 | 287→293 | 6 | 11 / 1 | 0 / 0 / 0 | 없음 | 85 |
| 강남 | 344→376 | 32 | 34 / 0 | 62 / 48 / 46 | 98.098873 / 98 | 98 |

강남 incumbent 간선65/65 및 실제길이 coverage 약100%를 복구했다. 새 actualcycle 최고는 incumbent와 **같은 간선 geometry**였다. 기존 원래/canonical raw98.203693보다 낮으므로 새로운 geometry 개선이나 출발점 변경 이익으로 채택하지 않았다. 새 모양 배치가 같은 geometry의 기존 높은 점수를 재현했을 뿐이다. 광안리의 두 valid 고리는 길고 좁아 square 원식 점수가 거의0이다. 서면은 실제거리 조건에 맞는 고리가 없다. 강남의 pose 영역밖 거절2개/native 제약 거절0개이고 valid46개를 확인했다. 기존 원래 점수를 넘는 채택은 모든 지역0개다.

분해·cycle·fit 시간과 사용하지 않은 legacy pose 계산을 분리 기록했다. 강남 최종 측정은 decomposition12ms, cycle 열거834ms, uniform fit/native 평가81ms, 사용하지 않은 legacy pose 계산361ms였다. 후자는 search seed에 사용하지 않는다. 시간은 해당 실행의 측정이고 이전 실행 대비 속도 향상을 주장하지 않는다.

`tests/clipped-road-corridors.test.ts`는 경계0/450m에서 실제 기존 node40/130/220/310/400m만 남고 새 경계점이 생성되지 않는지, 실제간선·360m 길이·node/edge 순서 변경 후 같은 geometry·너무 짧은 inside run 거절을 검사했고 통과했다. 기존 bidirectional 분해 계약2개, 원래3지역 v5 native 평가3개, TypeScript 및 관련 lint가 통과했다. source hash와 `.source.txt` snapshots가 일치함을 확인했다. 결과는 `eval/recognition/route-improvement/road-geometry-cycles-v5-20261013/{지역}/results.json`이다. 합산 12조건의 최고 평균을 바꾸거나 앱에 적용하지 않았다.

### v6: 짧은 실제 corner connector

사전 고정한 정책은 이상적 두 corridor chord 교차점의 공간 radius60m, connector의 실제길이≤120m, 전체 routing 최대512회, 각 routing 확장≤18000, 최종 실제 고리 cap48이다. 길이60m를 connector의 길이 하한/상한으로 오해하지 않았다. 실제 shared node가 있으면 기존 방식대로 연결하고, 없으면 circle 안 각 chain의 실제 node들을 시작/목표 집합으로 둔 실제-edge 최단경로만 사용한다. 경로의 모든 node는 circle 및 원래 bbox 안이어야 한다. 기하학적 교차점은 계산용 중심이고 route에 삽입하지 않는다. 실제 chain segment와 네 corner connector의 전체 node sequence를 복원해 폐곡선·3–8km·repeat≤0.2를 검사한다. 네 corridor 구조와 기존80m/10도/0.96 정책은 유지했다.

기존 서면85의 missingrun82.619m는 이상교차점에서 최대59.540m 거리여서 고정 circle60/길이120 안에 들어간다는 positive-control 진단을 확인했다. 이 기존 좌표와 경로는 검색 씨앗으로 쓰지 않았다. 광안리의110.465m missingrun은 최대radius127.885m로 반경을 벗어났고 나머지는 이번 orthogonal pair 조건을 만족하는 endpoint chain 쌍이 없었다. 결과를 본 뒤 radius 또는 길이를 바꾸지 않았다.

| 지역 | shared links | 자동 routing calls/성공 links | 확장 node 총수 | native 고리 unique/선정/valid | 신규 최고 | incumbent |
|---|---:|---:|---:|---:|---:|---:|
| 광안리 | 323 | 81 / 33 | 272 | 3 / 3 / 3 | 거의0 | 71 |
| 서면 | 286 | 135 / 52 | 558 | 0 / 0 / 0 | 없음 | 85 |
| 강남 | 596 | 181 / 77 | 549 | 73 / 48 / 46 | 98.098873(같은 geometry) | 98 |

circle 안 endpoint가 없는 pair 거절은 광안리3538/서면5989/강남18360이고, routing 실패는48/83/104회다. 예산512회에 도달한 지역은 없다. native 전체 조합1968/1826/2702 중3km미달1962/1826/2552개이며8km초과와반복거절은 모두0이었다. 강남 pose밖 거절2/native 거절0이며 다른 두 지역은 둘 다0이다. cap 선정은 점수와 무관한 geometry key 순서다.

v5의 **최종 valid 고리 geometry**가 v6의 cap 이전 생성 집합에 모두 포함됨을 검사했다. cap 이후 남은 v5 valid 고리는 광안리2/2, 서면0/0, 강남40/46이며 새 후보가 기존 후보 일부를 밀어낼 수 있다. 따라서 v5 최종 incumbent를 별도 보존했다. 이번 세 지역의 v5 최종 acceptedCandidate는 원래 incumbent와 정확히 같음을 확인했다. 강남의 최고는 기존과 같은 geometry/원래보다 낮은 배치 점수라 채택하지 않았다. v6의 최종 valid 중 실제 connector를 포함한 후보는 광안리1개(거의0점), 강남6개(최고raw13.250019), 서면0개였다. 새 연결이 생성된 것과 좋은 최종 모양이 생성된 것을 구분해야 한다.

서면에서 positive-control corner가 고정 정책으로 표현 가능한데도3km 이상 고리가 생기지 않았으므로, 한 corner gap을 연결하는 것만으로 네 직선 corridor 표현 제약을 해결했다는 근거는 없다. 기존 서면 경로는 더 많은 selected chain 구간으로 이루어진다. 여러 chain으로 된 긴 side를 처리하는 후속 정책은 이번 v6와 섞지 않았다.

`roadConnectorCycles.ts`, `tests/eval/road-geometry-cycles-v6.test.ts` 및 `eval/recognition/route-improvement/road-geometry-cycles-v6-20261013/`에 코드·세 지역 결과·사전 protocol/source snapshot을 보존했다. 실제 curved corner 경로로 네 긴 변을 닫는 synthetic 계약검사와 그 실제 연결 간선을 제거했을 때 가짜 교차점 bridge를 만들지 않는 검사가 통과했다. 원3지역 strict 검사·TypeScript·관련 lint도 통과했다. 앱 또는12조건 평균의 변경은 없다.

### v6 서면85 경로의 정확한 표현·corner 선택 진단

새 정책을 구현하지 않고, frozen v6 함수를 literal 복제한 관측 전용 모듈에서 생성 link만 반환했다. 함수 이름과 반환 관측값을 제거한 복제 전체 본문이 원본과 같음을 검사했고, 원본 raw SHA가 frozen v6의 SHA와 일치하며 서면의 모든 생성 통계가 정확히 재현됨을 확인했다. 다음은 읽기 전용 positive control 진단이다.

| 실제 사용 chain ID | support heading(°; 역방향 동일축) | 사용 구간 m |
|---|---:|---:|
| 99 | 5.072743 | 87.707194 |
| 129 | 179.607718 | 274.480865 |
| 167 | 28.935603 | 321.272880 |
| 207 | 90.845837 | 127.155260 |
| 218 | 179.610090 | 60.803177 |
| 226 | 90.387822 | 758.844925 |
| 92 | 1.571154 | 761.415890 |
| 101 | 90.716537 | 711.565976 |

원래 경로는8개 서로 다른 selected chain run과82.619010m 미포함 run을 사용했다. 같은 chain 재사용은0회다. 원래 미포함 run은 node264→1135→1134→1133→1132→1131→1130→1101이며 양쪽 support는101/99다. 두 heading의 차85.643794°는 orthogonal tolerance10°를 만족한다. chord 이상교차점은 graph local XY(-375.569364,-765.192874)이고 원래 endpoint의 circle 거리59.539686/50.798403m, 전체run의 최대거리59.539686m이다. 좌표는 진단값이고 검색 씨앗으로 사용하지 않았다.

**이 pair에서 실제 v6가 선택한 것은 multi-source 최단 routing이 아니다.** 두 full support chain은 실제 node262를 공유하여 shared-node 우선 경로 `[262]`(0m)를 선택했다. 원래 사용 endpoint264/1101에서262로 이동하면 before side는59.734862m, after side는50.821748m **확장**된다. node262는 원래 사용했던 두 side 구간에 모두 없었다. 따라서82.619010m corner를 제거해도 전체길이는 줄지 않고27.937600m 증가한다. 원래 actual path에 이 실제 chain 연장과 shared corner만 넣은 읽기 전용 검증에서 native 길이는3185.865175→3213.802775m, 반복률0이고 모두 실제 간선이며3km미만으로 떨어지지 않았다. 이 진단 경로를 검색에 삽입하거나 새 후보로 채택하지 않았다.

별도로8개 실제 side run에서4개를 골라 순서대로 original edge path를 나누는70조합을 모두 검사했다. 각각 선택 side의 최대 사용 구간을 남기면 나머지 connector gap 길이가 최소가 된다. 이 완전 열거에서 최대gap 길이의 최소값도444.807068m여서, 모든 gap≤120m를 만족하는 조합은0개였다. 따라서 **이 원래 경로의 정확한 간선 geometry**는 현재4개 support chain과4개 길이≤120m corner로 표현할 수 없다. 다른 geometry의3km 이상85점 경로가 불가능하거나 connector shortcut 문제가 다른 pair에서도 없다는 주장은 하지 않는다. 이번 서면 positive-control corner에 관한 길이 하한 탈락 가설은 실제 node 연결로 반박됐고, 정확한 경로 표현의 chain 개수 제약은 별도 확인됐다.

원자료 `eval/recognition/route-improvement/road-connector-representation-20261013/results.json`, 관측 모듈 `roadConnectorCyclesDiagnostic.ts`, 검사 `tests/eval/road-connector-representation-diagnosis.test.ts`에 전체 chain IDs/노드/70조합/endpoint 이동을 보존했다. 원코드·원params·원평가식 변경은 없다. clone identity/원본SHA/생성통계 재현/actual-edge 거리 검사 및 TypeScript·관련lint가 통과했다.

- 코드: `src/lib/route/roadGeometrySeeds.ts`, `src/lib/route/roadGeometryCycles.ts`
- 실험: `tests/eval/road-geometry-seeds.test.ts`, `tests/eval/road-geometry-cycles.test.ts`
- 합성 연결 grid 계약 검사: `tests/road-geometry-seeds.test.ts`. uniform 배치와 실제 폐곡선 생성·48개 상한·determinism을 확인했고 통과했다. 실제 평가 품질의 증거로 사용하지 않는다.
- 결과: `eval/recognition/route-improvement/road-geometry-seeds-20261013/`와 `road-geometry-cycles-20261013/`
- 각 버전의 source는 `.source.txt`로 보존했고 기록된 원시 UTF-8 source hash와 비교할 수 있다. v1/v2/v3는 각각 별도 폴더, 현재 결과는 node sequence를 추가한 v3로 재실행했다.
- 각 실행 시작 전 protocol과 parameters/source hashes를 기록했다. 두 opt-in 실험 및 합성 계약 검사는 통과했다. TypeScript와 관련 lint 검사는 통과했다.
- shared global/fit/loops/shapes/quality/app 파일 변경 없음. 앱에 채택한 변경 없음. 12조건 평균 80점 달성을 주장하지 않는다.

실험 재현 환경 변수는 `ROAD_GEOMETRY_SEEDS=1` 또는 `ROAD_GEOMETRY_CYCLES=1`이다. Windows의 임시 import 파일 문제가 한 차례 발생해 `TMP`와 `TEMP`를 프로젝트의 `eval/recognition/tmp`로 설정하고 같은 실험을 재실행해 통과했다.
