# 경로 이미지 인식 실험실

동일 후보에서 **입력 표현 → 인식 모델 → 추천 순위**를 분리해 비교합니다. 운영 화면·추천 정책은 자동 변경하지 않습니다. Node 24 이상과 기존 프로젝트 의존성이 필요합니다.

## 바로 시작

```powershell
npm run lab -- all --run experiment-01 --limit 24 --channel msedge
```

4개 지도·거리 조건에서 조건당 24개를 고정하고, 진단용 그림 8개를 섞습니다. DoodleNet의 현재 이진 입력과 같은 두께·여백의 회색 경계 입력을 동일 후보·동일 모델·동일 회전으로 비교합니다. 외부 AI 호출·모델 다운로드는 없습니다. PNG 생성에는 설치된 Edge를 사용합니다. Playwright Chromium을 설치한 환경은 `--channel`을 생략할 수 있습니다.

출력은 `eval/recognition/experiment-01/`입니다.

| 파일 | 용도 |
|---|---|
| `dataset.json` | 고정 후보·원본 데이터 해시·코드 해시·단계 예산·분할 |
| `predictions/*.json` | 방법별 원점수·top-5·제외 클래스·표시 여부·지연 |
| `images/` | 위치를 제거한 224px 선화와 실제 28×28 입력 확대 |
| `pixels/` | 인식기에 넣은 0도 입력 숫자 |
| `judge.html` | 사람이 이름 없이 답하고, 답을 잠근 뒤 이름을 평가 |
| `comparison.html` | 분석자용 방법·점수·모델 입력 비교 |
| `summary.md`, `summary.json` | 사람 판정 집계. 판정 전에는 미측정 |
| `vocabulary.json` | 현재 345종 명칭·제외 여부. 임베딩 비교용 |

`judge.html`을 브라우저로 열어 별명을 입력하고 평가합니다. 이름·점수·출처는 숨겨져 있습니다. 자유 판정은 모든 후보에 먼저 완료하며 나중에 수정할 수 없습니다. 같은 이름을 두 방법이 제안한 경우 한 번만 평가해 양쪽 방법에 적용합니다. ‘아무것도 안 보임’, 동의어 때문에 맞힘 판정이 애매한 상태, 진행 저장·이어하기를 지원합니다. 분석 화면은 블라인드 판정 전에 판정자에게 보여주지 마세요.

판정 JSON을 실험의 `reviews/` 폴더에 넣고 실행합니다.

```powershell
npm run lab -- score --run experiment-01
```

기본은 경로당 **사람 3명 이상의 다수결**입니다. 동률과 누락은 미판정이고, 실패로 계산하지 않습니다. 동일 별명의 중복 파일, 다른 후보 세트·모델 결과의 판정, 다른 이름을 평가한 데이터는 거부합니다. 중간 저장본과 완료본을 동시에 넣지 말고 한 사람당 최종 파일 하나를 사용하세요. 스모크 시험용으로 `--min-judges 1`을 쓸 수 있지만 품질 검증으로 보고하면 안 됩니다.

## 후보 생성과 평가를 따로 실행

```powershell
npm run lab -- prepare --run experiment-02 --limit 80 --steps 2500 --branches
npm run lab -- infer --run experiment-02
npm run lab -- render --run experiment-02 --channel msedge
npm run lab -- review --run experiment-02 --count all
npm run lab -- score --run experiment-02 --min-judges 3 --top-k 8
```

- 기존 데이터·모델별 결과는 덮어쓰지 않습니다. 비교 설정을 바꾸면 새 `--run` 또는 새 방법 ID를 쓰세요.
- 기본 영역은 강남 두 곳입니다. 각 영역의 두 거리 조건은 같은 분할에 둡니다. **근접한 두 강남 영역만으로 지역 일반화를 입증할 수 없습니다.**
- `--branches`는 고리·왕복 가지 후보를 함께 생성합니다. 같은 후보에서 모델을 비교할 때는 생성 설정을 바꾸지 마세요.
- 후보는 모델 점수 없이 출처별 고정 시드 표본으로 뽑습니다. 따라서 이 풀은 생성기의 전수 후보가 아니라 **고정 표본**입니다. `partial`과 생성 예산을 확인하세요.
- 기본 평가 화면은 상위 후보와 고정 시드 표본 최대 64개입니다. 풀에 좋은 그림이 전혀 없는지 확인하려면 `--count all`로 고정 풀을 전부 판정해야 합니다. 일부 판정으로 전체 oracle을 주장하지 않습니다.
- `--split development` / `--split holdout`으로 평가 화면을 나눌 수 있습니다. 단, 모델 결과를 추가하면 study fingerprint가 바뀝니다. 최종 비교 방법들을 정한 뒤 평가를 배포하세요.
- 합성 윤곽·애매한 다각형은 입력 진단용이며 사람이 검증한 정답이 아닙니다. 실제 도로 지표에 포함하지 않습니다.

## 선택형 SigLIP 2·CLIP 비교

추가 Python 환경이 필요합니다. 앱의 Node 의존성에는 추가하지 않았습니다. `torch`, `transformers`, `pillow`가 설치된 환경에서 사용하세요. 최신 라이브러리 API와 실제 체크포인트는 실행 환경에서 검증해야 합니다.

```powershell
# 별도 실험 환경에서 한 번 설치; 모델 파일은 최초 실행 시 다운로드됩니다.
python -m pip install torch transformers pillow
python scripts/recognition-lab/embeddings.py --run experiment-01 --method siglip2-text
npm run lab -- import --run experiment-01 --file eval/recognition/experiment-01/siglip2-text-import.json

python scripts/recognition-lab/embeddings.py --run experiment-01 --checkpoint openai/clip-vit-base-patch32 --method clip-text
npm run lab -- import --run experiment-01 --file eval/recognition/experiment-01/clip-text-import.json
npm run lab -- review --run experiment-01 --count all
```

이 실행기는 동결 이미지–텍스트 **코사인 유사도**를 비교합니다. SigLIP의 sigmoid 확률이나 사람이 알아보는 확률로 표현하지 않습니다. 기본은 모든 최고 이름을 평가하는 naming baseline입니다. `--threshold`를 지정하면 명시적인 미보정 표시 기준을 적용합니다. 문장·단어 사전 변경은 새 방법으로 기록하세요. `--revision`에 모델 커밋을 지정하면 재현성을 높일 수 있고, 해석된 커밋·라이브러리 버전·사전 해시를 저장합니다. `--local-only`는 이미 받은 모델만 사용합니다.

다른 모델·스케치 예시 이미지 검색 결과도 같은 JSON 계약으로 `import`할 수 있습니다. 파일에는 `schemaVersion=1`, `datasetId`, `datasetFingerprint`, 고유 `method`, `model`, `renderer`, `createdAt`, `metadata`, `predictions`가 필요합니다. 각 예측은 `candidateId`, `label`(없으면 null), `accepted`, `rawScore`(없으면 null), `rankingScore`, `topK`, `latencyMs`, `reason`을 포함합니다. 예시는 기존 `predictions/doodle-binary.json`입니다. 알 수 없는 후보·중복 행·다른 데이터의 결과는 수입하지 않습니다. 부분 풀 결과는 허용하되 평가 범위가 보고서에 나타납니다.

## 선택형 서버 VLM

Gemini Interactions REST의 이미지·JSON Schema 인터페이스를 사용합니다. 모델 ID는 계정에서 사용 가능한 것을 직접 지정합니다. 기본은 **호출 없는 계획 출력**입니다.

```powershell
npm run lab -- vlm --run experiment-01 --model YOUR_MODEL_ID --limit 4 --max-calls 16
# process 환경의 GEMINI_API_KEY 설정 후, 계획을 실행할 때:
npm run lab -- vlm --run experiment-01 --model YOUR_MODEL_ID --limit 4 --max-calls 16 --execute
npm run lab -- review --run experiment-01 --count all
```

`--limit`는 조건당 후보 수입니다. 방법별 상위 순위와 모델 무관 표본을 번갈아 선택하므로 앞단 모델이 특정 그림을 완전히 차단하지 않게 합니다. 모델 간 원점수를 직접 섞지 않습니다. 요청은 후보별 한 장이고, 기존 이름을 알려주지 않습니다. 자유 명명과 거절을 지원하며 VLM 자기 확신을 순위 점수로 사용하지 않습니다. 이번 실행기는 **부분 풀 명명 시험**이며 학습된 순위 모델이 아닙니다.

좌표·지도·지역명·기존 이름·사용자 식별자는 보내지 않고 정규화 선화 PNG만 전송합니다. `store=false`를 지정하지만 선화는 지역 추정 가능성이 있고 공급자 처리·악용 탐지 정책은 별도입니다. 개인 러닝 기록을 이 장치에 넣지 마세요. API 키는 과정 환경에서만 읽으며 생성물·브라우저에 저장하지 않습니다.

PNG·모델·프롬프트·설정이 같은 성공 응답은 로컬 캐시에 재사용합니다. 한 실행의 캐시 미스가 `--max-calls`를 넘으면 호출 전에 중단합니다. HTTP/JSON 실패는 음성 판정으로 넣지 않고 즉시 중단하며 자동 재시도하지 않습니다. 재실행 시 성공 캐시를 재사용합니다. 요청 시도는 `call-ledger.json`, 완료 응답의 사용량은 prediction metadata에 남습니다. 토큰 사용량으로 현재 단가에 맞춰 비용을 계산하세요. 호출 수 제한은 달러 지출 상한이 아니며 실패한 요청도 과금될 수 있습니다.

공식 인터페이스: [이미지 입력](https://ai.google.dev/gemini-api/docs/image-understanding), [구조화 출력](https://ai.google.dev/gemini-api/docs/structured-output), [저장 설정](https://ai.google.dev/gemini-api/docs/interactions-overview), [SigLIP 2 입력](https://huggingface.co/docs/transformers/model_doc/siglip2).

## 지표와 다음 판단

보고서는 실제 도로만으로 표시 대상 이름의 납득 정밀도·자유 인식 맞힘, 아무것도 안 보이는 경로에 이름을 표시한 비율, 조건별 후보 가능성, top-k 결과, 공통 평가 후보의 방법별 납득 수를 계산합니다. 개발·보류 영역을 나눕니다. 누락이 있는 정밀도는 부분집합 수치이고, 보고서에 전체 표시 후보 판정 완료 여부가 나옵니다. 신뢰구간은 설명용이며 인접 경로 상관을 보정한 출시 검증이 아닙니다.

좋은 후보가 풀에 있는데 모델이 놓치면 입력·인식·순위 개선을, 풀에도 없으면 생성·가지·다양성 실험을 진행합니다. 이 장치는 사람 정답을 생성하지 않고 운영의 보정 파일을 자동 변경하지 않습니다.

기존 보정 도구는 별도로 보완했습니다. 이제 사람 판정 출처·별명·입력 구조를 확인하고, 동일 코스의 반복 판정을 독립 표본으로 부풀리지 않으며, 자료가 없으면 파일을 쓰지 않습니다. 자료는 있으나 표시 기준을 검증하지 못하면 기준을 101로 두어 해당 등급을 거절합니다. 기존 형식의 보정 파일은 새 판정 페이지에서 다시 저장하거나 `judgeType: "human"`, 실제 판정자 `who`를 명시해야 합니다. 자동 VLM 결과를 사람 판정으로 바꾸어 넣으면 안 됩니다. lab JSON은 `eval/labels/`가 아니라 해당 run의 `reviews/`에 넣습니다.

검증: `npm run typecheck`, `npm run lint`, `npm run test:lab-api`, `npx vitest run tests/recognition-lab.test.ts tests/calibrate.test.ts tests/present.test.ts`. Windows 샌드박스 임시 폴더 문제가 있으면 TEMP/TMP/TMPDIR을 작업 폴더의 `eval/recognition/tmp`로 맞추고 worker 하나로 실행하세요. lab의 prepare/infer는 이를 자동 설정합니다.
