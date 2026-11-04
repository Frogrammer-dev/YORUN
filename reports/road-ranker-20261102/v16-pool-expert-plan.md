# v16 고정 풀 대안 표집: 전문가 설계 비판

2026-11-03. 읽기 전용 설계 검토이며 이 문서만 추가했다. 새 이미지·향후 판정은 읽지 않았고 표집·생성·추론·평가를 실행하지 않았다. 근거는 v11 `diversity-review.md`, `scripts/recognition-lab/road-pool-audit.py` 및 사용자의 v16 제안이다.

**판단:** 유용한 다음 진단이다. 기존 첫 후보 밖에서 읽히는 도로가 실제 발견되는지 시험하여, 추가 geometry 개발 전에 선택 누락의 존재 근거를 얻는다. 다만 정답을 보고 baseline+대안2개 중 하나를 고르는 union은 실행 가능한 top1 선택기가 아니다. 성공해도 sampled attainability의 관측 하한이며 전체1003개 풀 oracle·인간 성능·새 지역 일반화가 아니다. 실패해도 나머지 후보 부재를 증명하지 않는다.

## 실행 전 고정할 계약

- **표본:** source `diversity-v11.json`의 complete1003행·75 reviewSlots·25종×3지역 및 SHA를 고정한다. 각 요청의 baseline은 원래 slot ID로 찾고 현재 점수로 재선택하지 않는다. 같은 area/proposalShape에서 baseline의 무방향 edge-set geometry를 전부 제외한다. 남은 geometry별 최소 ID 대표를 먼저 고른 뒤, salt와 area·target·roadHash·정규화된 geometryKey를 포함한 UTF-8 문자열의 SHA256 순으로 첫2개를 고정한다. 직렬화·사전순·동률 규칙까지 기록한다. 배열 순서, AI/CLIP/head·generator score는 선택에 쓰지 않는다.
- **정체성:** edge key는 원본 snapshot의 node ID 기준으로 정의하고 좌표 반올림으로 합치지 않는다. 무방향 edge set은 경로의 순서·방문 횟수를 잃으므로 여기서의 중복 단위는 '같은 간선 집합'이다. 이를 같은 walk/pixel과 혼동하지 않는다. 반대로 가까운 road family는 exact dedup 뒤에도 남으므로 edge Jaccard를 해석용으로만 기록하고 표본 제외나 분모 변경에 쓰지 않는다.
- **분모:** 대안1·대안2 각각75슬롯, 총150슬롯을 유지한다. 후보 부족은 명시적 결측·보류이며 다른 종·지역으로 채우지 않는다. 25종과 동물33/사물42를 유지하고 rocket/head 미지원을 road 평가 실패와 섞지 않는다. source 원본 행은 보존한다. 대표 ID의 원래 pose canonical rotation만 쓰고 refit/회전 best-of를 하지 않는다.

## 가장 중요한 비교 위험

1. **baseline과 평가 조건의 일치:** baseline8/75는 기존3AI 다수결이며 primary는0/75다. union을 평가자별로 계산한 뒤 primary 개선과 보조 다수결 개선을 분리해야 한다. '다수결 clear인 이미지가 셋 중 하나 있음'과 '각 평가자가 셋 중 하나를 clear로 판정한 후 요청 다수결'은 서로 다른 통계다. 요청 간 이미지의 투표를 합쳐 한 이미지에 합의가 없는데 clear로 만드는 것을 막기 위해 **이미지별 target-clear 판정을 먼저 확정하고 그 후 union**을 주 보조 지표로 고정할 것을 권한다.
2. **orientation/pixel bridge:** baseline과 대안의 방향·선·bbox·본문 pixel hash를 보존한다. 같은 geometry라도 pose가 달라 pixel이 다르면 기존 판정을 옮기지 않는다. exact 본문 pixel만 기존3평가자별 판정에 연결하고, 이전 이름/clear 충돌 시 사전 bridge 규칙을 적용한다. 재사용과 새 평가를 별도 집계한다. 한쪽만 판정 시기·제시 문맥이 달라지는 한계를 명시한다. 기존 baseline8을 새 canonical rendering의 성적으로 조용히 대체하지 않는다.
3. **추가 기회의 효과:** union은 세 번의 발견 기회를 baseline 한 번과 비교한다. 증가만으로 ranking 개선이라고 할 수 없다. baseline 실패 요청에서 대안 단독1·단독2·union의 증가를 모두 보고, 전체 요청 중 실제1개/2개 대안이 있는 수 및 geometry별 고유 노출 수를 함께 기록한다. hash 표집은 score 중립이나 전체 도로망의 무작위 표집은 아니다. 생성기와 pool 구성의 선별 편향은 남는다.
4. **반복 노출·누수:** 두75슬롯 study는 중립 토큰·사전 고정 순서를 사용하고 target/방법/기존 답변을 숨긴다. 같은 종 대안을 나란히 놓거나 정답 목록을 알려주지 않는다. 동일 계열3AI·반복 프로젝트 노출은 독립성 한계다. 사람이 본다는 주장도 하지 않는다. mapping·개별 이미지·페이지·응답 fingerprint를 검증하고 누락/중복/다른 evaluator ID를 거절한다.

## 기준과 다음 결정

실행 전에 **baseline-failed 요청의 새 target-clear≥5/75, 그중 동물≥3/33이며 최소2종**이라는 제안의 판정 층(primary 또는 다수결)을 명시해야 한다. 권고는 primary 개선 기준을 주판정으로 두고 같은 조건의 보조 다수결을 별도로 보고하는 것이다. primary 실패를 다수결로 통과시키지 않는다. 원래 동물3종·사물3종 각각2지역 gate는 union에서도 별도 보고하되 top1/75의 기존 실패를 덮지 않는다. 약한 연상·다른 사물로의 clear도 보존하지만 target-clear 증가에 넣지 않는다.

새 clear가 나오면 **같은 개발 풀에서 기존 첫 후보가 놓친 사례가 있음**을 지지한다. 그 ID를 학습·규칙 개발에 쓰면 v16은 즉시 개발 자료가 되며, 다음 selector 성능은 별도의 동결 데이터/평가로 검증해야 한다. 증가가 작거나 없으면 이번2대안 표집에서 의미 근거 부족이라고 기록한다. 풀 전체 부재를 선언하거나 hash seed·표본 수·동의어·threshold를 재시도하여 성공을 찾지 않는다. geometry 개발을 재개하더라도 이번 점수만으로 세부 파라미터를 튜닝하지 않는다.

**이전42장 audit와 차이:** 실제 `road-pool-audit.py`는 v9의 area/intent별 최소 proposalPoolRank 하나와 지역별 natural baseline2개를 선택한다. 12사물×3+baseline6=42장으로, score-neutral 대안2개나25종·baseline 제외 표집이 아니다. 사용자 보고의 단일AI11clear는 이번3AI 대상일치 결과와 직접 비교할 수 없으며 여기서는 그 원본 판정을 재검산하지 않았다. v16은 동물 포함 범위와 후보 누락 질문을 개선하지만 여전히 전수 풀·독립 지역·사람 평가의 대체가 아니다.
