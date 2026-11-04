# v18 조건부 IMAGE 검색: 실행 전 전문가 검토

2026-11-03. `protocol-v18-image-query.md`, 기존 `sketch-features.py`, `sketch-head.py`의 prototype 구현, `road-clip-ranker.py`, v17 감사·v15 결과를 읽었다. 이 문서만 추가했다. 코드 구현·특징 추출·학습·새 이미지 열람은 하지 않았다.

**판단:** G/H/I를 동일 대표풀·canonical 방향·75개 반환으로 비교하는 것은 합리적인 작은 기계적 대조다. 기존 v7의TEXT345 winner gate 및 v10/v12의손그림 클래스 평균과 구별된다. 검토한 관련 기록에서 '원본25개 템플릿 IMAGE query의 요청별 cosine top1'을 완료한 정확한 실험은 찾지 못했다. 저장소 전체의 미시도를 증명한 것은 아니다. 이번 I는 target을 아는 조건부 검색이며 무라벨 자연도로에서 사물을 발견하는 능력과 다르다.

## 대조군이 분리하는 것과 남는 혼합

- **G**는 같은 대표풀의 원래 기하 유사도 최대값이다. v11 최초 후보8/75는 별도 참조이며 G와 같다고 가정하지 않는다. 최소ID 대표를 먼저 고르므로 같은 geometry의 다른 pose·더 높은 점수를 나중에 고를 수 없다.
- **H 대 I**는 같은 도로 벡터·후보·top1 수·무거절 조건에서, 손그림 train 평균 query와 원본 템플릿 단일 image query를 비교한다. 이는 I의 상대적 query 표현 이득을 판단하는 핵심이다. I가G보다 좋아도 H와 같거나 뒤지면 원본 IMAGE query만의 효용은 입증되지 않는다. 두 pairwise 차이를 그대로 보고해야 한다.
- 세 방식의75개 반환을 고정하므로 **G/H/I 내부의 단순 coverage 차이**는 통제한다. 하지만 H를 v17 head와 비교하면 class/generic gate 제거뿐 아니라 head→prototype·query 조건화도 함께 바뀐다. 그 차이를 '거절 제거 단독 효과'로 부르지 않는다. v17과75개 강제 반환 모델의 숫자를 직접 비교해 표현 효과로 결론내리지 않는다.

## 구현 감사 체크포인트

1. source1003행·75요청과 source SHA, geometryKey의 roadHash를 동결한다. 같은 area/proposalShape 안에서 geometry별 최소ID 대표를 고정하고 **세 방법 모두 같은 ID 목록**을 사용한다. 배열 순서·score에 대표를 의존시키지 않으며 모두 비어 있지 않은 요청인지 확인한다. 누락은 즉시 명시하고 다른 pool·종으로 채우지 않는다.
2. 도로 입력은 기존 road feature `features[:,0,:]`와 같은 source 행 순서다. ID 없는 NPZ의 positional 의존성을 source/NPZ/metadata 해시로 묶는다. 원래 mean4를 잘못 쓰거나 canonical을 두 번 역회전하지 않는다. 선택 행의 pose·좌표/sourcefields는 그대로 보존한다.
3. H의 `prototype_weights`는 `(D,C)`이므로 classLabels의 frozen key로 열을 선택한다. 실제 `fit_prototype`은 train view0의 클래스 평균을 L2 정규화한 뒤 전치한다. ridge의 head_weights 또는 val/test 포함 평균과 혼동하지 않는다. 가능하면 기존 train cache만으로 저장 prototype과 동등성 확인을 기록한다. alias는 turtle/sea_turtle·mug/coffee_cup·bottle/wine_bottle·tshirt/t-shirt의 고정 계약을 사용하고 rocket3은 G와 ID·pose·좌표가 정확히 같은 fallback임을 남긴다.
4. I는 현재25개 원본 외곽 전체와 명시적 key 순서를 그대로 저장하고 `sketch-features.render([points],turn=0)` 및 같은 processor를 사용한다. 임의로 query를 수정·단순화·획 추가·회전 선택하지 않는다. 원본 템플릿이 닫힌다는 사실과 실제도로 조건은 별개다. query별 L2 norm·차원·유한성과 D=512를 확인하고 cosine 동률은 ID 사전순이다. cosine는 사람 읽힘 확률이 아니다.
5. 새 query 추출은 encoder/processor/renderer의 **실제 파일 SHA**를 기존 snapshot 근거와 비교한다. 같은 model 이름·512차원·revision=null만으로 동일 embedding 공간이라고 보장하지 않는다. 과거 road 특징에 대한 독립 weight-file hash가 없다면 그 provenance 한계를 명시한다. 새25개 query cache/원본 외곽/catalog/코드/프로토콜·H checkpoint hash와 모든 행/key 순서를 저장한다. 새 도로 특징 추출·weights fit은 필요 없다.
6. 리뷰는 세 방법 모두 원래 pose 기준 canonical, 같은 bbox·선·익명 형식이다. 이름/참고query/score·방법은 평가자에게 전달하지 않는다. 같은 body pixel만 판정 연결하고, 같은 geometry라도 방향·stroke가 다르면 자동 재사용하지 않는다. source/selection/mapping/catalog를 판정 읽기 전 lock으로 묶고 token·ID·raw rating 연결과 중복/결측을 검증한다.

## 사전 판정과 반증

프로토콜의 **I primary 대G +5/75·그중 동물+3/33·2종**, 다수결≥13/75·엄격 다양성 보조 기준,25종75분모를 유지한다. I가H를 이긴다는 조건이 현재 주기준은 아니므로, I>G·I≤H라면 '조건부 검색의 개발상 가능성'과 'template IMAGE만의 우위 미입증'을 나눠 보고한다. H rocket fallback3의 성과를 손그림 지원으로 부풀리지 않는다. 결과 후 주방법·동의어·방향·seed를 바꾸지 않는다.

v15에서 템플릿 다수결16/25·primary5/25로 양성 대조 기준 자체가 실패했다. 따라서 I의 query가 인간에게 명확한 이상형이라는 전제가 없다. cosine가 높아도 의미 인식은 별도다. 사람이 확인한 한 도로의 재선택은 개발 sanity check로만 기록하고 해당 요청 제외74조건도 독립 holdout으로 부르지 않는다. 주기준 실패를 그 한 사례나 보조 다수결로 덮지 않는다. 성공해도 기존 개발3지역·반복 AI이며 새 독립 사람 검증 전 일반화·최종 목표 달성을 주장할 수 없다. 현재 계획은 추가 모델 튜닝이나 query 수정의 근거가 아니다.
