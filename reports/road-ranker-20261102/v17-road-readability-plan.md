# v17 실제도로 읽힘 학습: 조건부 전문가 계획

2026-11-03. 문서 설계만 수행했다. 코드·라벨·모델·threshold를 바꾸거나 학습하지 않았다. 실제 읽은 근거는 `road_ranker.py`, `training-summary.json`, `sketch-head.py`, `v12-results.md`, v11/v16 집계와 source1003행, 두 사람 응답 파일이다. 원래12조건·holdout-v2는 사용하지 않는다.

## 현재 자료로 가능한 주장

**손그림 종 분류를 반복하지 말고, 실제 도로 선 그림이 설명 없이 일관된 사물로 읽히는지 예측하는 별도 목표를 검토한다. 단, 현재 사람 라벨은 학습·독립 검증에 턱없이 부족하다.** v16의 사람 명확1사례는 실제 긍정 근거지만 사후 선택된 개발 자료다. 기존 사람3사례는 clear0·weak1·none2이며 평가 방법·선택 모집단이 다르므로 이 넷을 임의 분할한 인간 test를 만들지 않는다. baseline dog-1의 인간 판정은 없다.

읽기 전용 계수 범위를 **v11 baseline+v16 대안1/2**로 한정하면 관측215행, 고유 source ID215, 고유 exact edge-set geometry215다. AI 다수결 target-clear17행/17 exact그룹이나, area×target으로는9요청·7종뿐이다. 분포는 바지6, 나머지5종 각2, 마지막1종1이며 지역별6/3/8이다. primary target-clear는 이 자료에서0이다. target 미일치198행을 실제 negative로 바꾸지 않는다. 그중104행은 두 평가자 이상 none이지만 역시 AI의 보수적 관측이지 사람이 아무것도 못 보는 정답이 아니다. 전체 source1003행의 exact geometry813개와도 구분한다. 다른 역사적 연구까지 합친 전체 라벨 수를 계산한 것은 아니다.

계수는 일회성 Python JSON 읽기·집계로 수행했다(tool chunk `35a06f`, exit0). exact 간선집합이 다르다고 독립 형태 계열인 것은 아니다. 인접 도로를 조금 바꾼17개를17독립 positive로 주장하지 않는다. 학습 전에는 area/roadHash·exact geometry·pixel·회전 view를 묶고, geometry만으로 사전 고정한 높은 edge-overlap 연결 계열도 같은 split에 둔다. area×target9는 계수 단위이지 완성된 누수 방지 그룹 정의가 아니다.

## 기존 실패와 다른 가장 작은 학습 설계

- v1 compact CNN은 apple/fish/bird+synthetic_none, Quick Draw590개, grid/axis-step 증강과2seed였다. seed17은 synthetic FAR 감소로 보조 통과했지만 seed29는 clean 정확도−5.62%p·grid−4.49%p, FAR 악화로 전체 실패했다. 더 많은 epoch·같은 synthetic negative·세 범주 forced classification은 재시도 근거가 없다.
- v12 frozen CLIP512 ridge는 실제24대상+8generic, train-only 균형 학습·val λ/거절·test 사후 집계다. 손그림 test macro .8841 대 prototype .7307을 얻었지만 실제도로 head4/75 대 baseline8/75로 실패했다. 클래스와의 일치가 읽힘의 정답이 아니며 원래 generic FAR도 도로 false accept가 아니다.
- 제안 모델은 **원본 도로를 바꾸지 않는, 사전 고정 view의 frozen CLIP 특징→정규화된 작은 선형 readability head** 하나다. 25종을 강제 출력하거나 intent-match로 제외하지 않는다. 생성 의도·기존 AI 이름·source ID·지역·human-positive 표시를 입력에 넣지 않는다. 종 정보가 필요한 요청별 평가와 target-independent 읽힘 순위는 별도다. 기존 semantic head·원래 기하 top1을 동결 비교군으로 남긴다. CNN/encoder fine-tuning은 이 라벨 규모에서 우선하지 않는다.

라벨은 새 자유 명명 절차에서 '동일 사물로 일관되게 clear', 'weak/이견', 'none'을 구별한다. 현재 target-clear17개는 **생성 의도와 맞은 AI proxy**이지 이 일반 읽힘 라벨과 동치가 아니다. 다른 사물로 일관되게 읽힌 도로를 negative로 만들지 않고, 기존 자유 답변을 보존한다. weak/이견은 unlabeled 또는 ordinal 중간값으로 사전 고정하며 clear가 아니란 이유만으로0을 부여하지 않는다. 만일 현 AI 자료로 먼저 훈련한다면 'AI 읽힘 판정의 개발용 모방'이라고 명시하고 인간 읽힘 모델이라 부르지 않는다. 인간1positive만으로 인간 지도 모델을 실행하는 것은 보류한다.

## 독립 검증을 확보한 뒤의 실행 계약

현재 본 세 지역·v16 positive 및 그 인접 계열은 전부 개발용이다. 새 지역의 실제 유효 후보를 모델 점수·기존 AI 성공 여부와 무관한 고정 표집으로 수집하여, **학습/검증용 라벨과 최종 평가용 라벨의 도로 지역·계열·가능하면 사람 평가자까지 분리**한다. train/val/test 후보·방향·label provenance를 결과 전에 동결한다. 같은 사람 positive의 회전·인접 경로를 test로 내보내지 않는다. 각 split의 독립 positive 계열·negative·이견 수를 먼저 공개하고 부족하면 범용 성능 실험을 실행하지 않는다. 임의70/15/15로 쪼개기보다 독립 집단 확보가 우선이다.

학습은 train만, 규제·거절 선택은 val만, 최종 test는 한 번 연다. 이 문서에서는 새 λ/거절값을 고르지 않는다. 기준은 독립 실제도로에서 동일 후보·동일 view·동일 추천 수/보류 규칙의 paired top1 비교로 고정해야 한다. 요청 전체 분모, clear와 target-clear, coverage, 동물/사물·지역별 결과를 보고하고 유효성100%를 요구한다. 기존25종×3지역75요청의 엄격 다양성 gate와 실패 기록은 유지한다. 새 benchmark를 만들면 별도 분모라고 명시하며 기존 성공으로 소급하지 않는다. AI 라벨 학습 시 최종 사람 판정을 재사용하지 않고, 성과 주장에는 새 독립 사람 근거가 필요하다.

**결정:** 지금 가능한 다음 작업은 라벨 계보·중복 계열·독립 데이터/평가 계약 설계다. 학습 실행이나 '이 한 사례를 찾도록' loss·threshold를 맞추는 단계가 아니다. 새 라벨의 독립 positive가 확보되지 않으면 손그림 보조 점수 또는 현재 성공 사례 재현을 실제도로 일반화로 보고하지 않는다. 개별 사람 명확 사례는 보존하되 최종 목표 달성은 아직 주장하지 않는다.

## 후속 우선 대안: 도로 라벨 없는 canonical view 대조

같은 날 추가 근거에 따라 **일반 readability 학습보다 먼저 작은 pooling ablation을 검토할 가치가 있다.** 앞의 라벨 부족 진단은 유지하되, 도로 라벨을 전혀 학습에 쓰지 않는 이 대조까지 보류할 필요는 없다. 실제 `v12-dataset/ranked-head.json`에서 dog-1은 chair/margin .0703269, 사람이 명확하게 읽은 dog-4도 chair/.2515442이며 둘 다 accepted=true다. 이는 intent gate가 이 개발 사례를 배제하는 원인임을 보여준다. 그러나 평균 pooling이 원인이라는 증거는 아직 아니며 dog-1의 인간 판정도 없다.

**읽은 실제 특징 계약:** `sketch-features.py`는 각 원본의0/90/180/270° view를 개별 L2 정규화하여 `features[N,4,512]`에 저장하고, `mean=normalize(sum(views))`를 별도로 저장한다. 손그림 view0은 y축을 뒤집어 정규화한 원래 그리기 방향이며 자동 upright 보정은 아니다. 도로 view0은 `-generatorPlacement.rotDeg` offset을 이미 적용한 generator canonical 방향이다. quarter-turn 후 offset이 적용되지만 둘 다 평면 회전이라 이 순서 자체가 방향 오류는 아니다. 두 NPZ metadata는 같은 checkpoint·renderer SHA·rotations4이며 dataset/roads와 NPZ 바이트 해시를 제공한다. revision=null은 별도 weight-file 동일성 증명은 아니지만 이번 제안은 바로 이 기존 cache만 사용한다.

`sketch-head.py`는 train/val/test 모두 mean을 사용하고, prototype도 train mean의 클래스 평균을 정규화한다. 도로 분류는 mean logits, 표시는 예측 클래스 per-view logit 최대 view를 별도로 선택한다. 따라서 다음 대조는 **분류 pooling과 표시 선택을 섞지 않아야 한다.**

- A: 기존 v12 mean4 학습 head/prototype·가중치·판정을 동결하고, 비교용 표시만 canonical view0으로 고정한다. 기존 v12의 best-view 화면 결과4/75와 이 A를 같은 조건의 새 baseline처럼 혼합하지 않는다. 같은 canonical pixel의 판정은 bridge 규칙대로 재사용한다.
- B: 같은2304개·32클래스·기존 split과 cache에서 학습/검증/test/도로 입력 벡터를 전부 `features[:,0,:]`로 선택한다. prototype도 이 train view0의 클래스 평균으로 새로 만든다. view0 head에 mean-trained 가중치를 그대로 적용하는 방식은 주 대조가 아니다. 원본 cache/mean은 덮어쓰지 않는다.
- λ 후보·train-only 균형 ridge/bias·val macro tie큰λ·val gate 선택 규칙은 그대로 유지한다. '같은 λ'가 **같은 후보/선택 규칙**인지 **v12의 선택값을 고정**한다는 뜻인지 실행 전에 구분한다. 권고는 같은 후보와 val 규칙을 사용하고 각 arm의 선택값을 모두 공개하는 것이다. gate도 margin 분포가 달라지므로 v12 수치의 무검증 복사가 아니라 같은 val-only 규칙을 사용한다. dog 결과를 보고 λ/gate를 고르지 않는다.
- head를 주 모델, prototype을 고정 보조 대조로 사전에 지정한다. 결과 후 더 좋은 쪽을 주 모델로 바꾸지 않는다. 모든1003개 후보·25종75요청·동의어·intent gate·후보 순위 규칙은 동일하다. rocket 학습 미지원3요청도 분모에서 삭제하거나 다른 클래스로 대체하지 않는다.

**구현 전 계약 위험:** 현재 `load_features()`는 mean이 네 view 합의 정규화와 같은지 검사한다. 이 검사를 속이려고 cache mean을 view0으로 바꾸면 안 된다. 원본 검증 후 별도 `featureAggregation=canonical_view0` 선택을 checkpoint/report에 명시해야 한다. 추출 view 수4와 모델이 사용한 view 수1을 혼동하지 않고, 같은512차원이라는 이유만으로 mean4/canonical checkpoint를 섞지 않는다. ID 없는 NPZ는 해시로 묶인 원본 JSON의 positional order를 유지해야 한다.

표시의 `displayViewIndex=0`은 **절대 rotation=0°가 아니다.** 도로 최종 표시각은 `(-generatorPlacement.rotDeg)%360`이다. 기존 `rank_records()`의 per-view argmax를 남겨두면 B만 canonical이라고 생각해도 다시 다른 방향이 표시될 수 있다. A/B 모두 이 규칙을 고정하고 좌표/sourcefields는 바꾸지 않는다. 손그림은 draw upright의 변이가 남으며 generator pose도 목표 의도를 아는 기준이므로 이 실험은 무의도 자연도로 발견 일반화가 아니다.

**사전 기준 제안:** 재사용 손그림 test에서는 head macro A 대비+3%p 이상, 동물 macro+5%p 이상, generic FAR 증가 없음 등을 보조 진단선으로 main이 출력 전에 고정할 수 있다. 이미 본 test이므로 통과해도 새 독립 일반화가 아니다. 도로는 canonical로 통일한 A 대비 고정 primary clearTarget+5/75·동물+3/33·최소2종을 제안하고, 기존 엄격 다양성 gate·보류·유효성100%를 모두 별도 유지한다. 보조 다수결 증가나 이 한 개발 사례 복구만으로 통과하지 않는다. 결과 후 수치를 바꾸지 않는다.

human-clear 사례는 사전 지정 dev sanity check로만 예측·gate·순위 변화를 기록한다. 다른 고정1003개 결과와 함께 보고하며 이 사례만 성공하도록 view/클래스/파라미터를 골라서는 안 된다. B가 손그림만 개선하면 도로 개선은 미입증, canonical A만 회복하면 표시 효과, B가 A보다 도로를 개선해야 이 자료에서 pooling 변경의 후속 근거다. 이 대조도 실패하면 cache의 정보 소실·원래 feature 표현·종 분류/읽힘 목표 차이를 다시 구분하며 CNN 재시도나 현재 positive 재학습으로 자동 전환하지 않는다. 현재 단락은 계획 제안뿐이며 코드·cache·모델 변경이나 학습은 실행하지 않았다.
