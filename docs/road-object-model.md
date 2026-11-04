# 실제 도로 사물 경로 모델 시제품

구현·9회 실험의 근거는 [보고서](../reports/road-ranker-20261102/README.md)에 있다. 명시적 외곽 사전·실제 도로 탐색·동결 CLIP·선택을 연결한 연구 시제품이다. 새 CNN의 우위와 실제 사람 인식률은 입증하지 못했다. 앱 기본은 교체하지 않았다.

## 생성 API

`src/lib/route/objectProposals.ts`의 `generateObjectProposals(graph, region, templates, options)`를 사용한다.

- `graph`, `region`: 실제 보행 도로 그래프와 탐색 영역.
- `templates`: `{key, shape}` 배열. 기존 `SHAPE_BY_ID`나 별도 `OBJECT_TEMPLATES`를 사용할 수 있다.
- `options`: `area`, 정확한 원본 스냅샷의 `roadHash`, `idPrefix`, 선택적인 `attempts`, 공유 `budget`, `onProgress`.
- 반환: 실제 노드·위경도·배치·유효성 검사에 통과한 후보와 모든 요청의 진단 기록.

기본 `preserveHypotheses:true`는 같은 도로라도 다른 사물 가설을 보존한다. 같은 사물/도로는 생성 유사도가 가장 높은 가설을 남긴다. 최종 추천에서는 실제 간선 집합당 하나만 선택한다. v7/v8 재현은 이전 정책을 보존하기 위해 `preserveHypotheses:false`를 명시한다. v9에서 새 정책을 비교했으나 그 자료에서는 후보와 결과가 같았다.

`geometryKey`는 지역·도로자료·간선 집합을 구분한다. `budgetBefore/After`, `budgetExhausted`, `partial`, `status`로 예산 소진과 정상적인 빈 결과를 구별한다. 겹쳐 보이는 서로 다른 OSM 노드를 합치거나 최근접 노드로 대체하지 않는다.

## 추론과 결과

검증된 `{results:[...]}` 후보 JSON을 입력한다. `status`가 있으면 `complete`여야 한다.

```powershell
eval/recognition/model-env/Scripts/python.exe scripts/recognition-lab/road-object-model.py --input eval/recognition/road-ranker-20261102/validation-v8.json --out eval/recognition/road-ranker-20261102/my-model-run --public-out public/eval/my-model-review --extended-templates
```

출력은 CLIP 회전별 비교·일치 선택·코드/자료 해시·시간·익명 HTML/PNG·진단 화면·원본 GPX다. 결과가 존재하는 출력 폴더는 거절하므로 새 경로를 지정한다. 점수는 사람 인식 확률이 아니다.

`--reuse-predictions`는 모델revision·사전·정책이 같고 ID 및 원본 필드도 정확히 같은 추론만 재사용한다. 다른 조건의 결과를 합쳐 최고 후보만 모은 성능을 단일 모델의 성능으로 주장하지 않는다.

기본 가설은 집/나무/자동차/로켓/컵/비행기다. `--extended-templates`는 티셔츠/바지/망치/병/열쇠/의자도 검증한다. 로켓은 현재 사전에 없어 보류된다. 모든 이름에 대한 범용 생성 모델은 아니다.

## 사람 검토

준비한 화면은 `public/eval/road-object-human-final-20261102/blind.html`이다. 이름·목표그림 없이 실제 경로를 자유 명명한다. 다음 평가자는 새 평가자 시작을 누르고 다른 코드를 사용한다. 이전 답변은 자동 노출되지 않는다. 임시 저장이 차단돼도 답변 파일을 다운로드할 수 있다.

답변은 `road-ranker-score.py --mapping ... --review ... --output ...`로 같은 fingerprint에 맞춰 집계한다. 다른 세트의 답변과 누락된 답변은 거절한다. 세 AI의 보조 다수결에는 `--additional-review` 두 개를 지정한다. 실제 사람의 결과와 AI 결과를 서로 바꾸어 기록하지 않는다.

## 검사와 환경

기존 Python 환경의 torch/transformers/numpy/Pillow 및 공식 로컬 CLIP 캐시를 사용한다. 버전은 보고서 `runtime.json`에 있다. 도로와 상세 실험 파일은 Git에서 제외된다.

```powershell
$env:TMP = Join-Path (Get-Location) 'eval/recognition/tmp'
$env:TEMP = $env:TMP
npm test -- --maxWorkers=4
npm run typecheck
eval/recognition/model-env/Scripts/python.exe -m unittest discover -s tests/python -p test_road*.py
```

생성 실험은 opt-in이다. 기존 결과를 덮어쓰지 않으므로 새 출력 경로와 사전 계획을 먼저 지정한다. `ROAD_RANKER_POOL`, `ROAD_RANKER_AUDIT`, `ROAD_OBJECT_TOOLS`, `ROAD_OBJECT_VALIDATION`, `ROAD_OBJECT_HYPOTHESES`가 각 테스트의 실행 스위치다.

원래 고정12조건과 점수식은 보존한다. holdout-v2로 튜닝하지 않는다. 실제 사람의 명확한 인식, 새 지역의 안정적인 제공률, 실시간 실행 성능은 추가 검증 과제다.
