# 이미지 인식 경로 추천의 평가와 개선 실험

## 1. 지금 결과로 무엇을 판단할 수 있는가?

### Takeaway
현재 블라인드 결과는 표시된 코스 이름의 신뢰성에 대한 경고다. 후보 생성 가능성, 사람 인식률, 새 모델의 효과를 확정하는 증거는 아니다. 후보 풀이 알아볼 만한 그림을 포함하는지와 그 후보를 순위화하는 능력을 먼저 분리해야 한다.

### Cited Findings
- 현재 세트는 강남 두 지도 영역, 두 거리 범위, 방식별 상위 5개를 모아 총 60개로 구성한다. 고리 풀 크기는 300, discover StepBudget은 2500, shape는 500이므로 방식별 후보 수와 탐색 예산도 같다 할 수 없다. — [생성 코드](../../tests/eval/blind-set.test.ts)
- 저장된 판정은 VLM-A(Opus), VLM-B(Sonnet) 두 모델이며 doodle 0%, discover 35%, shape 15%이다. 기본 도형 제외 discover 분모는 5개에 불과하다. 따라서 0%를 사람 인식률이나 모든 지도 경로의 불가능성으로 해석해서는 안 된다. — [평가 결과](../../eval/labels/blind-2026-10-10/score.md)
- 현재 사람 페이지는 guess/agree만 저장하며 집계 스크립트는 match를 직접 읽는다. 사람 결과를 그대로 집계하면 누락된 match가 false가 된다. 별도 정답 동의어 매핑과 판정 검토 단계가 필요하다. — [판정 UI](../../tests/eval/blind-shots.mjs), [집계](../../tests/eval/blind-score.mjs)
- 이 문제는 사람 결과 import 경로의 결함이며 기존 VLM JSON에는 match가 존재하므로 기존 VLM 집계 자체를 무효화하지 않는다. — [VLM-A 실제 데이터](../../eval/labels/blind-2026-10-10/vlm-a.json)
- 품질 회귀 테스트는 같은 강남 두 영역의 자체 similarity, top5, 개수 및 실제 그래프 연결성을 본다. 자체 점수 상승은 사람이 알아보는 그림 증가를 보장하지 않는다. — [품질 회귀](../../tests/quality-baseline.test.ts)
- Sketchy 연구는 스케치와 사진의 공통 표현을 학습하는 실제 짝 데이터 기반 검색 과제를 다룬다. zero-shot 연구는 같은 범주 검색과 같은 모양 검색이 다름을 지적하며 미학습 범주 평가를 제안한다. 도로 선화는 별도 도메인이다. — [Sketchy 원 연구](https://patsorn.me/projects/sketchy/), [Zero-shot SBIR](https://arxiv.org/abs/1807.11724)

### Inferences
- 단순 도형을 포함한 전체 평균만 최적화하면 제품 핵심인 동물·사물 같은 의미 있는 모양이 개선되지 않아도 성공처럼 보일 수 있다. 의미 범주 결과와 기본 도형 결과를 별도 보고한다.
- 가장 먼저 두 종류 대조군을 만든다: 사람이 만든 인식 가능한 한 획 외곽선/실제 GPS 아트 양성, 임의 블록 고리/무작위 선 음성. 양성에서도 인식이 나쁘면 인식·렌더링 문제, 양성은 좋으나 실제 풀 oracle이 낮으면 생성 문제다.
- 고정 지도마다 후보 풀을 저장하고 이름·방법을 숨겨 사람에게 자유롭게 이름 붙이게 한다. 가장 좋은 후보도 알아볼 수 없는 조건은 ranker 개선 실험에서 별도 처리한다.

### Gaps
- 사람 판정, 실제 GPS 아트 양성, 전체 후보 풀의 oracle 라벨이 없다. VLM 두 개가 같은 계열이므로 독립 사람 평가를 대체할 수 없다.
- OSM edge 존재는 실시간 보행 접근 가능성·횡단 안전성·사유지 여부의 현장 검증까지 보장하지 않는다.

## 2. 어떤 실험으로 생성·인식·순위 병목을 분리할 것인가?

### Takeaway
고정 후보 풀 실험과 후보 생성 실험을 따로 실행한다. 최종 성공은 사람에게 알아볼 만한 이름의 추천을 보여 주는 정밀도이며, 아무것도 없을 때 거절하는 능력과 추천이 나오는 지역 비율을 함께 측정한다.

### Cited Findings
- 현재 pool은 inRange 고리를 일정 간격으로 뽑고, branchPool 옵션은 고리에 왕복 가지 1~2개를 추가한다. bbox IoU 60% 기반 중복 제거는 다른 모양도 같은 장소라는 이유로 지울 수 있다. — [후보 생성 및 중복 제거](../../src/lib/route/discover.ts), [가지 구현](../../src/lib/route/branches.ts)
- Selective classification은 예측 거절을 허용해 위험과 coverage를 교환하는 체계다. 평가에서 precision 하나만 보고 추천 수를 숨기면 거절만 하는 모델을 좋은 모델로 착각할 수 있다. — [Geifman & El-Yaniv 원 논문](https://arxiv.org/abs/1705.08500)
- 불확실성 자체의 보정이 잘못될 수 있으며 선택된 표본에서도 calibration을 평가해야 한다. — [Calibrated Selective Classification](https://arxiv.org/abs/2208.12084)

### Inferences
- 제안 파일럿: 격자 도심·비정형 구도심·해안·공원 등 비중첩 12개 지역 × 2개 거리 조건 = 24 query. 6개 개발, 3개 calibration, 3개 완전 보류 test로 지역 전체를 나눈다. 작은 파일럿 수치는 방향 판별용이며 출시 검증은 추가 지역으로 확장한다. 같은 후보/번역/회전 이미지를 여러 split에 넣지 않는다.
- 생성 실험: 고리 300 기준선, 고리 1000, 고리+가지 300, 다양성 샘플링 300을 동일 실제 시간/단계 예산으로 비교한다. 후보 수·길이·반복거리·turn/km·종류별 분포와 사람 oracle availability를 기록한다. 가지를 추가해 그림이 좋아져도 왕복량과 길이 제약이 악화되는지 같이 본다.
- 인식 실험: 같은 저장된 raw pool에 Doodle, frozen sketch embedding, image-text embedding, VLM 순위/이름 검증을 적용한다. 렌더링 해상도·선굵기·회전·padding은 고정하고 이름 없는 북쪽 고정 원본도 평가한다. 후보 개수와 렌더 조합을 바꿀 때는 별도 ablation으로 본다.
- 사람 프로토콜: 후보당 최소 3명, 순서 무작위, 방법·점수·예상 이름 숨김. 1단계 자유 이름 또는 '아무것도 안 보임'; 잠근 후 2단계 제안 이름 1~5 납득도, 마지막으로 달리고 싶은지 판단한다. 뜻이 같은 답을 두 검토자가 독립 매핑하며 애매하면 별도 표기한다. 제목 공개 후 납득과 사전 자유 인식은 섞지 않는다.
- pool availability = 조건별로 최소 한 개 이상 사람 합의로 이름 붙일 만한 후보가 있음. fixed-pool ranker recall@k = 그 후보를 top-k에서 찾는가. accepted-label precision = 표시된 이름을 사람 다수가 납득하는가. end-to-end useful-query rate = 전체 지역·거리 조건 중 적어도 한 개 유용한 추천을 제공하는 비율. negative false-positive rate, non-basic macro average, label diversity, rank nDCG, p50/p95 지연, 메모리·API 비용도 기록한다.
- 파일럿 실행량 예: 조건당 300개의 전체 후보 7200개를 모두 3명에게 맡기면 21600 판정으로 무겁다. 먼저 query당 점수·생성 방법별 층화 30~50개 + 각 ranker top-k union을 평가해 후보 가능성을 추정한다. 이 표본의 최고 결과는 '표본 oracle'이지 전체 풀 upper bound가 아니다. oracle이 낮은 4개 대표 query에서만 300개 전수 평가해 병목을 확인한다.
- 권장 성공 게이트(사업 목표로 협의 필요): non-basic accepted precision 80% 이상 및 Wilson 95% 하한 70% 이상, negative false positive 10% 이하, baseline 대비 useful-query rate 증가. 단 24 query 파일럿으로 일반화 확정하지 않고 최종 지역 홀드아웃에서 재검증한다. 조건별 bootstrap/지역 cluster 평가로 겹치는 경로를 독립 표본처럼 세지 않는다.

### Gaps
- 사람이 자유롭게 이름 붙이는 모호성에 대한 정답은 단일 클래스가 아니다. 모델이 붙인 이름 외에 사람이 알아본 다른 이름도 유효 후보로 저장해야 한다.
- 후보 풀 증대나 가지 확장이 개선할지는 실험 전 가설이며, 현재 저장 결과만으로 단정할 수 없다.

## 3. 어떻게 보정·거절·비용을 설계할 것인가?

### Takeaway
모델 확신을 사람 인식 확률로 직접 표시하지 않는다. 인식 검증에 실패한 후보는 이름 추천을 거절하고, 서버 AI는 위치를 제거한 소수 후보의 검증에 먼저 제한한다.

### Cited Findings
- 현재 calibration.json은 calibrated=false, labels=0이다. calibrate.ts는 목표 기준을 찾지 못하면 기존 threshold를 유지한다. 즉 전부 인식 실패해도 기존 표시 기준이 남는다. — [보정 설정](../../src/lib/eval/calibration.json), [보정 코드](../../src/lib/eval/calibrate.ts)
- calibration runner는 eval/labels 바로 아래 .json만 읽으므로 하위 blind-2026-10-10의 key/VLM 파일이 자동 유입되지는 않는다. 그러나 스키마·사람/VLM provenance 검증이 없고 labels=0이어도 calibrated=true로 기록한다. 같은 코스의 여러 사람 판정을 각각 n으로 세므로 관련 판정을 독립으로 전제한 Wilson 하한은 낙관적일 수 있다. — [보정 runner](../../tests/eval/calibrate-run.test.ts)
- 현재 presentation은 확신도 순으로 최대 8개, 이름당 최대 2개를 선택하고 인식 결과를 템플릿 앞에 둔다. '또렷함' 등의 등급도 보정 전 기준에서 나온다. — [표시 로직](../../src/lib/route/present.ts)
- Temperature scaling은 모델 확률 보정에 유효할 수 있지만 의미상 사람이 보는 모양의 정확도를 새로 만들지 않는다. — [Guo et al. ICML 2017](https://proceedings.mlr.press/v70/guo17a.html)
- 분포 변화에서 전통적 사후 보정은 실패할 수 있으므로 개발 지역에서 얻은 threshold만으로 새 지역에 같은 신뢰를 약속하기 어렵다. — [Ovadia et al. NeurIPS 2019](https://arxiv.org/abs/1906.02530)

### Inferences
- threshold를 못 찾으면 해당 명확도 등급/이름 추천을 unavailable로 처리한다. 이름 후보가 없을 때 '이 범위에서 알아볼 만한 그림 코스를 찾지 못했습니다'와 범위/거리 변경을 제공한다. 추천 거절은 핵심 품질 전략이다.
- VLM 자유 제안 단계와 독립 이름 검증 단계를 나눈다. verifier 입력에서 generator 설명·confidence·의도한 그림을 제거하고, 'none' 및 단순 다각형 선택을 허용한다. 그래도 VLM agreement를 사람 ground truth로 사용하지 않는다.
- 로컬/서버 pipeline 비교: 로컬 embedding 전수 cheap score → diversity shortlist 8/16/32개 → 서버 AI 이름 제안·검증. 모든 300/1000개를 VLM에 보내는 방식과 quality/cost curve를 비교한다. 24 query에서 shortlist 16이면 384개 이미지 검증이며 전체 300개라면 7200개로 18.75배다. 실제 비용은 이미지 처리 규칙·출력 길이·provider pricing에 따라 산정하고 가격을 추정으로 고정하지 않는다.
- API 비용 공식: query당 shortlist × cache miss rate × calls per candidate × 실측 평균 call 비용. 이미지 contact sheet가 개별 호출보다 유리한지는 순서 편향·격자 위치 편향·잘못된 ID 매핑·품질 저하까지 검증한다. 토큰 수, wall time, timeout rate를 log로 남긴다.
- 위치 최소화: 서버에는 좌표 원점·절대 크기를 제거한 정규화 선화와 불투명 candidate ID를 보낸다. 지도 타일·집 주소·원시 lat/lng·출발점·개인 러닝 기록은 기본 요청에 필요하지 않다. 정규화 모양도 공개 지도와 대조될 가능성은 있어 완전 익명화로 표현하지 않는다. 서버가 후보 생성까지 맡으면 원시 지역 위치 전송이 필요하므로 별도 데이터 흐름으로 명시한다.
- cache key는 normalized geometry fingerprint + raster config + model version + prompt version. 같은 경로가 다른 거리 요청에 반복되면 재사용하고, 모델/프롬프트가 바뀌면 재평가한다. 회전 불변 hash를 써도 방향별 명명 결과는 구분한다.

### Gaps
- 현재 모델별 실제 CPU/GPU 지연·배터리·API token 비용과 사람이 좋아하는 shortlist 크기는 실측하지 않았다. 이 자료 없이 특정 모델이 더 싸고 좋다고 단정할 수 없다.
- 이 노트는 연구 제안이며 앱 코드를 수정하거나 실제 사람 평가를 수행하지 않았다.
