# v17 canonical 표현 대조: 실행 전 전문가 검토

2026-11-03. `protocol-v17-canonical.md`, 실제 v12 특징 추출/학습 코드·metadata와 `v13-results.md`를 읽었다. 검토 시 `canonical-head.py`는 아직 존재하지 않아 구현을 승인하거나 검증한 기록은 아니다. 코드 변경·학습·렌더링·새 판정은 실행하지 않았다.

**범위 판단:** 이 실험은 도로 사람 라벨 학습이 아니라 손그림 분류의 pooling 표현 대조다. 일반 readability 모델의 라벨 부족 때문에 막을 이유가 없다. 같은2304개·32클래스·split1646/316/342와 기존1003개 도로 특징만 사용하면 새 라벨 없이 작고 반증 가능한 검사가 된다. 사람 명확 사례는 가설의 동기인 개발 sanity check이며 독립 test가 아니다.

## 구현에서 지켜야 할 계약

1. **특징 순서·호환성:** 기존 `load_features()`로 원본 features/mean의 shape·float32·L2·네 view 합 계약을 먼저 검증하고, dataset/roads JSON 순서와 각 NPZ의 metadata SHA를 확인한다. ID 없는 cache는 positional ordering이라는 한계를 명시하고 원본 JSON을 정렬하거나 필터링하지 않는다. train과 road checkpoint/revision/rendererCodeSHA/rotations 일치도 기존 검사를 재사용한다. `revision:null`은 같은 encoder weight 파일을 독립 검증했다는 뜻이 아니다. 원본 cache는 수정하지 않고 검증 이후 입력을 mean 또는 `features[:,0,:]`로 선택한다.
2. **A/B:** A는 실제 v12 checkpoint의 weights·bias·λ·val policy를 그대로 읽고 mean4로 분류한다. B만 view0으로 train/val/test를 학습·평가한다. prototype도 B train view0 평균으로 만들며 A prototype과 혼동하지 않는다. 동일 λ 후보·val 선택 규칙을 쓰되 B의 λ·gate는 B val에서만 선택한다. 도로 답변이나 sanity case로 선택하지 않는다. 새 B 학습을 A 재학습으로 대체하지 않는다.
3. **정직한 metadata:** extractor 저장 view 수4와 분류 used view 수1을 분리해 `featureAggregation=canonical_view0`·`classificationViewIndices=[0]` 등을 기록한다. mean4 모델은 별도 표시한다. 기존 호환 검사를 통과시키기 위해4개 동일 view를 복제하거나 NPZ mean을 덮어쓰면 안 된다. source NPZ/JSON/metadata·원본 checkpoint·프로토콜·새 wrapper와 재사용 head 코드 SHA를 남기고 checkpoint 로딩 때 aggregation을 강제한다.
4. **표시 통제:** road view0은 이미 generator 역회전된 canonical 방향이다. 양쪽 `displayViewIndex=0`, 절대 표시 rotation은 `(-generatorPlacement.rotDeg)%360`으로 고정한다. 절대0°를 쓰거나 기존 per-view argmax를 남기지 않는다. 실제 per-view logits를 기록하는 것은 가능하지만 분류/표시 선택에 다시 최대값을 쓰지 않는다. 원본 sourcefields·좌표는 보존한다.
5. **선택 계약:** 두 모델 모두 기존 frozen alias·intent matching·val gate·margin 최대·ID tie·75슬롯/보류를 동일하게 적용한다. 25종을 유지하고 rocket3요청은 미지원으로 남긴다. A의1003개 class/margin/accepted와 기존 결과를 허용오차를 명시해 대조하고, 선택17개 ID/75슬롯은 정확히 같아야 한다. A의 canonical 도로 화면은 v13과 같은 방향/pixel이어야 하며, v12 best-view4/75를 A의 canonical7/75로 오인하지 않는다.

## 프로토콜에서 명시할 한 점

현재 ≥13/75·엄격 다양성 기준과 'primary 실패를 다수결 성공으로 바꾸지 않는다'는 문장이 있지만, **어느 통계에13/75와 다양성 gate를 적용하는지** 더 명시할 필요가 있다. 예를 들어 primary를 주판정으로 삼는다면 해당 전체 기준을 primary에 적용하고 동일 다수결은 보조로 따로 집계한다고 적는다. 원래 v12 기준이 다수결이었다는 역사적 사실과 새로운 주판정 규칙을 섞지 않는다. 실행 전 선택이며 결과 후 변경하지 않는다.

현재 손그림 보조 기준인 macro 하락≤2%p 및 generic FAR 비증가도 그대로 사전 고정할 수 있다. 이미 본 test의 표현 진단이며 새 독립 성능은 아니다. v17 기준 통과와 canonical A 대비 증가를 따로 보고하여, 모델/표시의 이득을 분리한다. head가 주모델이고 prototype은 보조라는 지정도 유지한다.

sanity case를 제외한74요청은 특정 개발 요청 의존도를 보여주는 부진단이지 새 독립 holdout이 아니다. 같은 지역·인접 geometry의 노출은 그대로 남는다. 모든 반증은75분모와 함께 기록하고 도로·사람 라벨 fit, CNN 재훈련, 새 encoder 다운로드, threshold 사후 조정으로 확대하지 않는다. 구현 파일이 생긴 뒤에는 위 계약을 코드에서 별도로 검토해야 한다.
