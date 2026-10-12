# AI 전문가: 현재 이미지 인식 경로 추천 진단

## 현재 실패에서 확정된 것은 무엇인가?

### Takeaway
현재 핵심 문제는 이미지 인식을 포기할 근거가 아니라, 모델의 345종 분류 점수를 사람이 알아보는 정도로 취급하는 연결 구조와 제한적인 후보 생성이다. 입력 렌더링 차이는 확인됐지만 그 영향량은 실험 전이며, 좌표 회전 오류나 모델 클래스 순서 오류는 확인되지 않았다.

### Cited Findings
- `src/lib/art/recognize.ts`는 -12/0/12도 이미지 확률 평균을 내고 DOODLE_SKIP을 제외한 최고 클래스를 반드시 고른다. 허용 클래스가 모두 0이 아닌 이상 null을 반환하지 않는다. `present.ts`에서 .35 이상을 표시하며 calibration.json은 calibrated=false, labels=0이다. — [recognize.ts](../../src/lib/art/recognize.ts), [present.ts](../../src/lib/route/present.ts), [calibration](../../src/lib/eval/calibration.json)
- 클래스 제외 후 확률을 재정규화하지 않는다. 따라서 단순 도형을 제외한다고 무조건 높은 사물 확률이 생기는 것은 아니다. 다만 '네모가 가장 적합하니 사물 이름은 거부'하는 정책도 없다. — [recognize.ts](../../src/lib/art/recognize.ts)
- 현재 고확률 오인 사례: blind c57 양 94점, c14 고슴도치 90점도 두 VLM 모두 모름 판정. 20개 doodle은 두 판정자 0/20이다. 작은 표본이고 인간 판정이 아니므로 전체 모형의 0% 성능이나 가능한 후보의 부재를 의미하지 않는다. — [평가](../../eval/labels/blind-2026-10-10/score.md)
- 모델 입력은 [28,28,1], 최종 345 softmax, 로컬 class_names는 345개다. 첫 여섯 이름은 원본 데모와 일치한다. 전체 파일 해시 대조는 수행하지 않았으며, 틀린 순서라는 증거는 없다. — [로컬 모델](../../public/models/doodlenet/model.json), [로컬 이름](../../public/models/doodlenet/class_names.txt), [원본 데모](https://raw.githubusercontent.com/yining1023/doodleNet/master/demo/DoodleClassifier_345/sketch.js)
- 모델 원저자는 345종 각 50k QuickDraw 이미지 학습을 설명한다. 이는 일반적인 코스 실루엣이나 인간 코스 닮음 평가에 학습됐다는 뜻이 아니다. — [DoodleNet 원저자](https://github.com/yining1023/doodleNet)

### Inferences
- 전역 원점 회전은 확정 버그가 아니다: R(p+t)=Rp+Rt이며 rasterize의 min 차감으로 상수 Rt는 상쇄된다. 중심 회전으로 바꾸는 것은 수치 안정성과 가독성 개선이지만 성능 향상을 약속할 수 없다.
- 반경 수 km에서 cos(latitude) 보정은 국소 근사로 합리적이다. 지도 투영 일치 검증은 가능하지만 현 0/20의 주원인이라는 증거가 없다.
- .35→.70 임계값 인상만으로 c57 같은 오류를 해결할 수 없다. 정답 여부와 점수 관계를 검증하고 거부 정책을 별도로 학습해야 한다.

### Gaps
- 원본 모델 및 가중치의 byte hash 전수 비교, QuickDraw 검증셋 성능 재현, 실제 브라우저 CPU/WebGL별 추론 시간은 미실시.

## 입력과 후보 생성에 어떤 구조적 제약이 있는가?

### Takeaway
경로는 실제 도로를 따라 연속적으로 움직이는 선인데 QuickDraw는 여러 붓질과 내부 디테일이 있는 낙서다. 현재 후보는 대체로 블록 합집합의 단순 폐곡선이므로 모델을 바꾸기 전에 '사람이 이름 붙일 만한 후보가 풀 안에 있는가'를 분리해서 봐야 한다.

### Cited Findings
- QuickDraw 원자료는 여러 stroke의 좌표를 포함하며 28x28 bitmap은 grayscale·bounding box 중앙 정렬이다. — [공식 데이터](https://github.com/googlecreativelab/quickdraw-dataset)
- 원본 DoodleNet 데모는 280px canvas 검정 선을 28px로 축소하고 (255-bright)/255를 입력한다. 현재 rasterizeLoop는 선 1/바탕 0의 이진 픽셀, pad=2, halfWidth=.85이다. polarity·크기·중앙정렬은 대체로 맞지만 grayscale 경계, 두께와 여백 분포는 같다고 입증되지 않았다. — [원본 코드](https://raw.githubusercontent.com/yining1023/doodleNet/master/demo/DoodleClassifier_345/sketch.js), [현재 렌더링](../../src/lib/art/doodle.ts)
- 원본 학습 notebook에도 0과255 사이의 중간 픽셀 값이 확인된다. 따라서 binary rendering과 학습 input 차이는 실재한다. — [학습 notebook](https://raw.githubusercontent.com/yining1023/doodleNet/master/doodleNet.ipynb)
- growLoops.canAdd는 구멍·점 접촉을 막아 하나의 단순 고리를 유지한다. 무작위 성향 및 둘레 변화 기준으로 확장하며 이미지 모델 점수는 확장 중 쓰지 않는다. — [loops.ts](../../src/lib/route/loops.ts)
- discover의 인식 풀은 템플릿 평가 잔여와 길이 범위 내 고리의 index stride 표본이다. worker poolSize=300, branches 플래그 때 300 가지 후보 추가. RouteFinderApp는 최종 템플릿 후보도 인식 풀에 더한다. — [discover.ts](../../src/lib/route/discover.ts), [worker](../../src/lib/route/finder.worker.ts), [UI 연결](../../src/components/route/RouteFinderApp.tsx)
- 가지 실험은 서로 다른 모델 이름 증가와 최고 확신만 기록한다. 사람에게 더 닮게 보인다는 검증은 없다. — [가지 실험](../../eval/branch-preview/summary.md)

### Inferences
- 단순 실루엣에서 알아보는 클래스(고래·머그컵·왕관 등)와 눈/얼굴/바퀴 내부 디테일 의존 클래스를 나눠 학습·평가해야 한다. 모든 345종을 같은 성공 가능성으로 보는 것은 비효율적이다.
- 사각 격자 고리의 톱·양·고슴도치 반복은 모델이 요철을 해당 질감으로 읽는 것으로 보이지만 saliency/ablation 전에는 가설이다.
- 가지를 무조건 늘리는 대신 반복거리, 돌출 위치, 내부 선 존재를 지표로 다양성 확보하고 인간 후보 oracle로 가치 확인이 필요하다.

### Gaps
- 풀 전체에서 인간이 알아본 후보 비율·위치별 유효 추천 가능성·거부 이후 남는 추천 수는 현재 결과로 모른다.

## 최소 실험과 코드 통합은 어떻게 진행할 것인가?

### Takeaway
먼저 후보 풀을 고정하고 인식만 비교하여 개선 근거를 만든다. 이후 이미지 인식이 후보를 평가하고 좋은 모양을 더 탐색하는 구조를 단계적으로 적용한다. 템플릿은 후보의 한 공급원으로 활용하며 제품을 템플릿 전용으로 바꾸지 않는다.

### Cited Findings
- 기존 연결은 recognizeCourses → pickDoodles → nameDiscoveries이다. 이 경계에서 인식 엔진·거부·표시 순위를 교체할 수 있고 도로 그래프 생성은 그대로 유지할 수 있다. — [recognize](../../src/lib/art/recognize.ts), [presentation](../../src/lib/route/present.ts)
- 기존 `tests/doodle.test.ts`는 기린/왕관/머그컵/번개 이상적 윤곽의 top1 예상값을 확인한다. 도로 변형·음성 후보·거부 성능을 다루지 않는다. 이번 연구에서는 재실행하지 않았다. — [테스트](../../tests/doodle.test.ts)
- 평가 전문가 결과를 교차확인했다. 사람 평가 페이지 저장 JSON은 guess/agree만 포함하지만 blind-score는 match를 읽는다. 그대로 집계하면 누락된 match는 false로 취급된다. 기존 VLM JSON과 사람 export 경로를 구별해야 한다. — [페이지 생성](../../tests/eval/blind-shots.mjs), [집계](../../tests/eval/blind-score.mjs)
- calibration pickThreshold가 목표 품질 기준을 충족하지 못해 null이어도 current.show가 유지된다. E0에 '기준을 충족하는 임계값 없음 = semantic 추천 표시 중단' 상태를 추가해야 한다. — [calibrate.ts](../../src/lib/eval/calibrate.ts)

### Inferences
- 제안 E0(엔지니어 0.5~1일, 추정): 345 차원 raw logits/probs, skip top1, entropy, margin, rotation disagreement, 후보 provenance, 입력 bitmap 저장. 클래스/모델 해시 검증. 지역별 후보 풀 고정. 결과 재현이 성공 조건.
- 제안 E1(1~2일, 추정): 동일 200~500 고정 후보 + 이상적 양성 윤곽 + 의미 없는 폐곡선 음성으로 binary vs supersample grayscale, 두께/여백 ablation. 배경 흰 검정 선의 224/256 canonical도 저장하되 DoodleNet은 28로 입력. 한꺼번에 모든 조합 적용하지 말고 각 변수 효과 비교.
- 제안 E2(2~4일, 추정): 같은 풀에서 Doodle, 고해상도 frozen image-text encoder, image-image 윤곽 예시 retrieval, 상위 후보 VLM 검증 비교. VLM에는 이름 유도 없이 먼저 자유명명/없음 답을 받고, 이후 제안 이름 수용 여부 평가. 돈/시간은 실제 요청 수와 선택 모델 가격으로 계산하며 현재 단가를 추정해 쓰지 않는다.
- Recognized 확장안: labels(topK), rawScores, recognizableProbability, rejectReason, orientation, evidence/provenance. `prob`를 인간 닮음 확률로 쓰지 말고 독립 calibration을 넣는다. simple-class top1이면 사물 후보 억제하는 baseline, entropy+margin+view consistency 거부 baseline 비교.
- 제안 E3(후보 생성 실험 2~5일, 추정): 고리 + 가지 + 그림 유도 + 자유 graph walk를 동일 길이/도로 제약으로 비교. 위치별 사람 oracle 후보 수를 측정. oracle이 낮으면 탐색을 개선하고, 높지만 top5가 낮으면 인식/순위를 개선한다.
- 제안 E4: 선택된 encoder에 실제 route-human 정답/없음 및 pair preference를 모아 lightweight ranker 또는 adapter 학습. 지역·거리 단위 holdout으로 평가. 데이터량·GPU 비용은 E2의 학습 곡선 전에는 확정할 수 없다.
- 생성 중 모델 점수의 직접 최적화는 모델만 속이는 모양을 만들 수 있다. 후보 다양성·실제 달리기 제약을 먼저 적용하고 고정 인간 평가셋으로 검증해야 한다.

### Gaps
- 위 기간은 한 명의 숙련 엔지니어가 기존 데이터·실험 도구를 재활용하는 계획 추정이다. 개선율, 최종 모델, 인간 평가 예산은 실험 전 확약할 수 없다.
