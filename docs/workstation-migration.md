# 다른 데스크톱에서 이어가기

2026-10-14. 소스·환경변수 예제·실험 코드·보고서는 Git으로 이동한다. API 키, 약1GB의 도로 DB, 모델 설치 환경, 동결된 실험 입력·결과는 별도 로컬 자료다.

## 앱 실행

```powershell
git clone https://github.com/Frogrammer-dev/YORUN.git
cd YORUN
npm ci
Copy-Item .env.example .env.local
npm run dev -- --port 3002
```

Node24를 권장하며 로컬 도로 조회에는 Node22.13 이상이 필요하다. 기존 clone에서는 새로 복제하는 대신 `git pull` 후 `npm ci`를 실행한다. 현재 컴퓨터의 `node_modules/`, `.next/`, Windows Python 가상 환경을 그대로 옮기지 않는다.

`.env.local`의 `OPENAI_API_KEY=` 뒤에 본인의 키를 직접 입력하고 서버를 다시 시작한다. 이 파일은 Git에서 제외한다. 기본 모델은 GPT-5.4 Mini이며 외부 생성은 검색당 최대3회·자동 재시도 없음·프로세스당 기본60회/시간이다. [키 생성 공식 안내](https://developers.openai.com/api/docs/quickstart), [앱 API 설정·비용·개인정보](road-first-reference.md).

## 별도로 옮길 자료

| 목적 | 필요한 로컬 파일 | 참고 |
|---|---|---|
| 앱의 한국 도로 검색 | `data/roads/manifest.json`, manifest가 가리키는 `data/roads/roads-261009-b480965b.sqlite` | 현재 DB약1.04GB. 두 파일을 같은 폴더 구조로 복사하거나 `ROAD_DATA_DIR` 지정 |
| API·저장·검색 설정 | `.env.local`의 본인이 사용하는 항목 | 새 PC에서 직접 설정. 키를 Git·채팅에 넣지 않는다 |
| 고정12 평가 재현·목표 개선 | `eval/recognition/llm-routes-20261010/`, `eval/recognition/route-improvement/` | 원본 도로 JSON·최신 자동 결과·protocol·소스 스냅샷 필요. 원식과 자료 해시 유지 |
| 도로 기반 이름·참고 그림 시제품 판정 | `eval/recognition/road-first-reference-20261014/` | 공개 정규화 입력과 실제 좌표가 있는 private audit를 구분 |
| CLIP 로컬 fallback | `eval/recognition/model-cache/`와 새 PC에서 재설치한 Python 환경 | `CLIP_PYTHON`, `CLIP_MODEL_CACHE`로 지정. 외부 GPT 정상 사용 시 fallback까지 쓰려면 필요 |

도로 원본 `south-korea-261009.osm.pbf`는 앱 조회에 필수는 아니다. DB를 새로 만들거나 갱신할 때 사용한다. [도로 설치 문서](local-roads.md), [CLIP 설치 안내](clip-recognition.md)를 따른다. Supabase·카카오 키가 있다면 새 PC에서 별도로 설정한다.

동결 실험은 JSON·그림·`.source` 파일의 바이트 해시를 비교하므로 해당 폴더를 압축하거나 그대로 복사하고 포맷을 바꾸지 않는다. 일반 소스의 checkout 줄바꿈 때문에 옛 실행의 raw source hash가 달라질 수 있다. 동결 원본을 재현할 때는 저장된 `.source`와 비교하고, 새 실험은 새 source/input/parameter 해시를 기록한다. 원래 globalSearch와 두 복사본은 `.gitattributes`로 원래 실행 바이트의 줄바꿈을 보존한다. 과거 결과 폴더를 새 실행으로 덮어쓰지 않는다.

## 다음 에이전트의 시작점

먼저 `AGENTS.md`, [지정 인계 문서](recognition-route-handoff.md), [최신 인계 문서](recognition-route-agent-handoff.md)를 읽는다. 최신 원래12 평균은 **77.416667 / 정밀77.317593 / 실패0**, 목표80은 미달이다. 원래 평가식·도형·영역·실제 간선·3–8km·반복≤0.2를 유지한다. 이름과 참고 그림 생성은 별도 의미 해석이며 기하학 점수를 대신하지 않는다.

최근 크기 다양성8배치와 global 초기240배치의 크기 배분은 광안리4에서 모두 채택 향상0이었다. 다음 대안은 `nativeGuideWitness.ts`와 `shapeGuidedPortRolloutWitness.ts`의 실제 원본 그림 지지 거리 벡터 보존이다. helper·합성 native 기능 검증과 독립 검토는 완료했고, 실제 광안리 field 대조는 아직 실행하지 않았다. 이전 직전 전체 기본 테스트275개·타입 검사·프로덕션 빌드는 통과했다. 무거운 opt-in 평가87개는 기본 테스트에서 실행하지 않았다. lint는 오류0·이전 실험의 unused 경고3개였다. 전체12 향상이나 새 지역 검증을 완료한 것으로 해석하지 않는다.

실제 입력을 옮긴 뒤 준비된 대조:

```powershell
$env:SHAPE_GUIDED_WITNESS = '1'
$env:ROLLOUT_AREA = 'gwangalli'
node node_modules/vitest/vitest.mjs run tests/eval/shape-guided-witness-20261014.test.ts
Remove-Item Env:SHAPE_GUIDED_WITNESS
Remove-Item Env:ROLLOUT_AREA
```

출력 폴더가 이미 있으면 기존 결과를 보존하고 새 버전의 출력 경로를 준비한다. 대조 arm에는 같은8개 자동 배치와2개 시작점을 사용한다. 이전 최고 경로는 비교 기준으로만 읽으며 생성 seed로 주입하지 않는다. 512개 rescue 기록을 넘긴 미추적 수, 실제 엄격한 후손과 종료 상태 보존을 구분해 보고한다. 원래12 전체의 fresh 자동 평균80 이상·독립 감사·동결 새 지역 검증을 통과해야 목표가 완료된다.
