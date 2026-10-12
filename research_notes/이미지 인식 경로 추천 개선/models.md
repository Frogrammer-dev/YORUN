# 경로 그림 인식 모델 개선 조사

## 어떤 모델 선택지가 실제로 가능한가?

### Takeaway
추천하는 첫 실험은 현재 후보 풀을 고정하고 DoodleNet, 동결 CLIP/SigLIP 임베딩, 서버 VLM을 비교하는 것이다. 어느 논문도 도로 고리에서 사람이 납득하는 사물 이름을 붙이는 성능을 입증하지 않았으므로 모델 이름만으로 교체를 결정할 수 없다.

### Cited Findings
- DoodleNet은 QuickDraw 345개 클래스, 클래스당 5만 그림으로 학습하고 TensorFlow.js로 변환한 CNN이다. KNN 예제도 제공한다. [공식 구현](https://github.com/yining1023/doodleNet)
- QuickDraw는 사람이 주어진 단어를 그린 345종, 5천만 그림이며, 28×28 비트맵과 벡터 형식을 제공한다. 데이터 라이선스는 CC BY 4.0이다. [데이터 원본](https://github.com/googlecreativelab/quickdraw-dataset)
- CLIP은 이미지와 문장 유사도를 계산하는 구현과 MIT 라이선스를 제공한다. 공식 카드가 세밀한 분류의 한계, 후보 클래스 설계에 따른 성능 변화, 도메인 검증 필요성을 명시한다. [구현](https://github.com/openai/CLIP), [모델 카드](https://github.com/openai/CLIP/blob/main/model-card.md)
- SigLIP 2 base 공식 카드는 이미지-텍스트 검색과 zero-shot 분류, 이미지 임베딩 추출을 지원하며 Apache-2.0을 표시한다. WebLI로 사전학습한 모델이다. [공식 모델 카드](https://huggingface.co/google/siglip2-base-patch16-224/blob/main/README.md)
- CVPR 2023 Sketch_LVM은 CLIP에 스케치 전용 prompt 학습을 적용하며 fine-grained 형태 대응에는 추가 손실과 patch shuffling을 사용한다. 이는 스케치-사진 검색 실험이며 도로 그림 이름붙이기 실험이 아니다. 공식 구현은 MIT이지만 fine-grained 코드의 추후 공개 문구가 남아 있어 전체 재현성 확인이 필요하다. [논문](https://openaccess.thecvf.com/content/CVPR2023/papers/Sain_CLIP_for_All_Things_Zero-Shot_Sketch-Based_Image_Retrieval_Fine-Grained_or_CVPR_2023_paper.pdf), [공식 코드](https://github.com/aneeshan95/Sketch_LVM)
- Gemini API는 이미지 입력과 문장 기반 이미지 설명을 지원한다. [공식 문서](https://ai.google.dev/gemini-api/docs/image-understanding)

### Inferences
| 선택 | 데이터/학습 | 실행 위치 | 역할과 한계 |
|---|---|---|---|
| A. 현재 CNN 보정 | 실제 경로 긍정·부정 표본으로 임계값/보정; 추후 작은 head 학습 | 현재 브라우저 tfjs 유지 | 가장 작은 변경. 345종 한계를 유지하므로 자유로운 발견을 단독 담당하기 어렵다 |
| B. CLIP/SigLIP 동결 임베딩 + 스케치 예시 검색 | 초기 무학습, 문장/outline exemplar 사전; 이후 실제 경로로 adapter 또는 ranking head | 우선 로컬 Python/서버에서 비교, 검증 후 ONNX 브라우저 검토 | 사전의 단어를 확장할 수 있으나 제공한 후보 안에서만 고름. cosine/logit는 사람이 납득할 확률이 아님 |
| C. 서버 VLM 이름 제안 + 재순위 | 초기 prompt만, 실제 사람 평가 데이터로 보정/학생 모델 증류 | 서버/API | 자유 명명과 의미 근거 제안 가능. 아무 모양에나 그럴듯한 이름을 붙일 위험, 호출 비용·변동·지연 존재 |

- B는 사진 예시보다 단선 outline/스케치 예시와 비교하는 실험이 핵심이다. 눈·다리 같은 내부 획 없는 외곽선은 QuickDraw 사물과 다르다. 학습 없는 일반 임베딩이 이 차이를 해결한다고 가정하지 않는다.
- C는 후보 전체 호출 대신 저렴한 기하/임베딩 단계의 상위 10~20개에 적용하는 구조를 우선 검토한다. 단, 이 전단계가 좋은 경로를 제거하지 않는지 raw-pool oracle recall로 확인해야 한다.
- VLM 출력은 `label`, `none`, `visibleFeatures`, `missingFeatures`, `orientation`으로 구조화하고 없는 눈·다리를 지어내면 탈락시킨다. 자기 confidence를 확률로 사용하지 않는다.

### Gaps
- 실제 도로 이미지에 대한 DoodleNet/CLIP/SigLIP/VLM 상대 성능, 추론 시간, 개선 폭은 미측정이다.
- DoodleNet 코드/가중치 라이선스는 살펴본 저장소 페이지에서 명시 파일을 확인하지 못했다. 데이터 CC BY와 모델 권리를 동일시하면 안 된다.
- Sketch_LVM의 논문 성능 숫자는 프로젝트 성능 예상치로 옮길 수 없다. 스케치-사진 검색과 경로 그림 발견은 다른 문제다.

## 도입 이전에 무엇을 실험해야 하는가?

### Takeaway
제품 구조를 바꾸기 전에 같은 raw 후보를 사용하는 작은 오프라인 실험으로 생성 실패와 인식 실패를 분리한다. 좋은 모양이 후보에 없으면 더 큰 인식 모델로도 해결되지 않는다.

### Cited Findings
- CLIP 공식 카드는 taxonomy 변경으로 성능이 달라지므로 특정 도메인 테스트 필요성을 명시한다. [모델 카드](https://github.com/openai/CLIP/blob/main/model-card.md)
- 스케치에 특화한 prompt 학습과 구조 보존 학습이 스케치 검색 연구에서 사용된다. [Sketch_LVM](https://github.com/aneeshan95/Sketch_LVM)

### Inferences
1. 여러 도로 환경·거리에서 추천 직전 raw 후보와 점수·필터 이유를 저장한다. 같은 고리의 회전본과 겹치는 지역은 같은 데이터 분할에 둔다.
2. 28×28 현재 입력과 종횡비 유지 224/256 이미지, 선 굵기/anti-alias 변형을 비교한다. 지도·주소·좌표는 입력에서 제거한다. 회전은 평균만 보지 말고 각 view의 점수와 이름 일관성도 기록한다.
3. 사람에게 이름을 먼저 보여주지 않고 무엇처럼 보이는지/아무것도 아님을 기록하게 한다. 이후 제시된 이름의 납득도를 평가한다. 한 모양의 복수 이름도 허용한다.
4. 같은 후보에서 A/B/C를 비교하며 상위 3개 납득률, 이름 없이 떠올릴 수 있는 비율, none 정확도, 좋은 후보를 찾은 지역 비율, 다양성, 비용·지연을 함께 측정한다.
5. 미학습 임베딩이 이기면 실제 경로-이름 긍정쌍, 비슷하지만 틀린 hard negative, 사람의 쌍별 선호를 모은다. encoder를 전부 재학습하기 전에 작은 ranking head/adapter를 비교한다. VLM을 teacher로 사용할 때 사람 동의 없는 pseudo-label을 정답으로 취급하지 않는다.
6. VLM이 사람 판단에서 개선을 보이지 않으면 운영 호출을 추가하지 않는다. 반대로 raw-pool 좋은 모양 비율이 낮으면 후보 생성 다양성 개선이 먼저다.

### Gaps
- 권장 표본 수와 통과 임계값은 제품 목표/평가 비용에 맞춰 사전 합의해야 한다. 논문에서 이 제품의 적절한 기준을 얻을 수는 없다.

## 비용·개인정보·브라우저 제약은 무엇인가?

### Takeaway
서버 AI 허용 조건에서는 서버에서 재현 가능한 임베딩 benchmark와 상위 후보 VLM 실험이 빠르다. 운영 선택은 품질 증가량 대비 호출 수·지연·정보 전송을 측정한 뒤 결정한다.

### Cited Findings
- Transformers.js는 ONNX Runtime Web 기반 WebGPU 실행을 제공한다. 공식 문서는 브라우저별 지원과 문제가 남을 수 있음을 설명한다. 특정 SigLIP 2 checkpoint의 변환·성능·모바일 메모리는 별도 검증해야 한다. [공식 WebGPU 문서](https://huggingface.co/docs/transformers.js/en/guides/webgpu)
- 조사일 2026-10-10 공식 가격표에서 Gemini 2.5 Flash standard 입력(text/image/video)은 100만 토큰당 $0.30, 출력(thinking 포함)은 $2.50; Flash-Lite는 $0.10/$0.40이다. Batch는 각각 절반 가격으로 표시되어 있다. 이 수치는 품질 추천이나 모델 수명 보장을 뜻하지 않는다. [공식 가격표](https://ai.google.dev/gemini-api/docs/pricing)
- Gemini 무료 서비스는 입력/응답을 제품 개선에 사용하고 사람이 검토할 수 있다. 유료 서비스는 개선에 사용하지 않지만 제한 기간의 악용 탐지 로그와 국외 일시 저장 가능성을 명시한다. [공식 약관](https://ai.google.dev/gemini-api/terms)

### Inferences
- 실제 총비용은 `요청 수 × (측정 inputTokens × 입력단가 + 측정 output/thinkingTokens × 출력단가) / 1,000,000 + 서버비 + 재시도`로 계산한다. 이미지당 고정 가격을 가정하지 않는다.
- 예시일 뿐인 Flash 계산: 한 요청 input 10,000, output/thinking 1,000 토큰이면 $0.0055. 1만 요청은 $55. 실제 경로 10개가 이 토큰 수라는 주장은 아니다. usage 필드 측정, cache hit, 회전 횟수, 재시도율을 포함해야 한다.
- 브라우저 모델은 API 호출비를 없애지만 다운로드·초기 로딩·배터리·모바일 메모리 비용이 있다. 자체 서버 임베딩은 GPU/CPU 시간·배치 처리량·동시 요청을 측정한다.
- 경로 그림은 좌표를 없애도 도로 모양으로 지역을 유추할 수 있으므로 익명정보라고 보장하지 않는다. 필요한 외곽선만 전송하고 지명·위치·사용자 식별자·GPS 기록은 보내지 않는 기본값을 제안한다.
- 모양 정규화 hash에 모델 버전·렌더러 버전·prompt 버전을 붙여 중복 호출을 줄인다. 운영 API는 서버의 비밀키로 호출하고 timeout 시 local 결과 또는 none을 반환한다.

### Gaps
- 현재 계정의 모델 접근 가능 여부, 실제 토큰 수와 환율, 지역별 과금, API latency는 확인하지 않았다. 가격표는 변경될 수 있으므로 실험 시점에 재확인한다.
- 서버 AI가 허용되어도 외부 업체 저장 정책과 데이터 처리 조건에 대한 제품 운영 결정은 필요하다. 이번 조사는 외부 모델에 프로젝트 경로를 업로드하지 않았다.
