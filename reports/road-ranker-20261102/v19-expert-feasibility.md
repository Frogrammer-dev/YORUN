# v19 새 혼합 지역 검증: 가용성·코드 실행 전 감사

2026-11-03. 기존 진입점·지역 메타데이터와 새 `protocol-v19-new-geography.md`, `tests/eval/road-new-geography-20261103.test.ts`를 읽었다. 지역 도로 조회·다운로드·후보 생성·특징 추출·이미지 열람은 하지 않았다. holdout-v2 내용도 읽지 않았다. 이 문서만 추가한다.

## 세 지역: 변경을 요구할 알려진 겹침 없음

| 사전 고정 지역 | south / west / north / east | 선정 가설 |
|---|---|---|
| 춘천 중심부 |37.86 /127.71 /37.90 /127.76|도심과 수변 인접 입지|
| 창원 중심부 |35.21 /128.65 /35.25 /128.70|계획도시·산업 입지|
| 부산 영도 |35.065 /129.04 /35.105 /129.09|구릉·항만 입지|

main이 출력 전에 제안한 세 bbox를 그대로 권고한다. 사용자가 지역을 직접 고른 것으로 기록하지 않는다. 모두 .04위도×.05경도이며 서로 겹치지 않고, 확인한 기존 천안·전주·울산 및 수원·청주·광주·대전·대구·송파의 개발 구역과도 겹치지 않는다. 부산은 기존 개발 도시이므로 **새 도시 완전 독립**이라고 하지 않는다. 다만 기존 서면 bbox35.145–35.170, 확대 bbox35.135–35.180과 영도 북단35.105는 분리된다. 광안리 확대 bbox35.1338–35.1752와도 분리된다. 확대 범위는 `eval/recognition/route-improvement/wide-roads/protocol.json`의 지역 메타데이터만 읽어 확인했다. 지역명 검색에서도 과거 춘천·창원·영도 개발 기록을 찾지 못했지만, 검색되지 않은 전 저장 자료의 미사용을 증명한 것은 아니다. holdout-v2와의 대조를 수행했다고 주장하지 않는다.

위 입지 설명은 **관측된 그래프 구조·밀도·경사 측정치가 아니다.** bbox가 같아도 위도에 따라 면적·해수/산지 비중·통행망 밀도는 다르다. 공원·수변의 쉬운 결과만 사후 채택하거나 실패 지역을 확대/교체하지 않는다. 조회 뒤 노드/간선·교차점 차수·도로 태그·연결성 등을 기술할 수 있으나 모양/의미 결과를 보고 선정 기준을 바꾸지 않는다.

## 로컬 가용성과 정확한 재사용 진입점

`data/roads/manifest.json`은 South Korea 전국 extract `roads-261009-b480965b.sqlite`, timestamp `2026-10-09T20:21:04Z`를 가리킨다. DB 파일 존재·크기1,041,162,240bytes를 확인했다. 기존 `data/fresh-v8-roads/`는 천안/전주/울산, `eval/recognition/road-ranker-20261102/fresh-roads/`는 수원/청주/광주 snapshot이다. 이들을 새 검증으로 재사용하지 않는다. 제안 bbox의 실제 ways 수·연결성·유효 후보 존재는 조회하지 않았으므로 아직 미확인이다.

- snapshot: `src/lib/route/roadData.server.ts::readLocalRoads(bbox, directory)`는 SQLite readOnly CSR 전단 자료를 반환한다. ways30000·vertices500000 안전 상한이 있어 초과/오류도75분모에 남긴다. 전국 자료가 이미 있어 `scripts/prepare-roads.py` 재실행은 불필요하다. 이 importer는 시작부터 네트워크 checksum 요청을 하므로 오프라인 검증 진입점이 아니다.
- graph: `graphFromOverpass(snapshot,bbox,{detail:'simple',excludeSteps:true})`와 원래 project/Region을 사용한다.
- generator: `generateObjectProposals(g,region,[catalogItem],{area,roadHash,idPrefix,attempts:60,preserveHypotheses:true,budget:new TimeBudget(15000)})`. `auditObjectPath`와 path→xy/latlon 정확 일치 검사를 별도로 유지한다. 전25종×3=75, 각 pool≤8, 모두 실패해도 슬롯75개다. 새 풀은 최대600개 후보이며 과거1003개나453대표를 강제하지 않는다. natural360 추가는 이 conditional25종 비교의 필수 조건이 아니다.
- 기존 v11 eval test는 source550/1003·이전지역이 고정돼 있어 그대로 실행하면 새 실험이 아니다. 새로 작성된 v19 runner가 적절한 orchestration 위치다. G/H/I 재사용 함수도 `image-query-retrieval.py::retrieve()`의 source1003·빈 pool 거절과 `select()`의 queryProtocol 동일 조건을 그대로 쓰면 새 scope/실패 슬롯에 맞지 않는다. 별도 adapter에서 동결 v18 query/checkpoint/protocol 계보를 보존하면서 v19 생성·평가 프로토콜을 분리하고 새 source 행 수 및 결측75계약을 검사해야 한다. 원본 wrapper를 몰래 완화하거나 query metadata를 v19로 다시 이름 붙이지 않는다.

## 새 runner 감사: 실행 전 데이터 계보 보완 필요

**차단 사항:** 코드의 hashes는 기본 `data/roads/manifest.json`만 기록하지만 snapshot 호출은 `readLocalRoads(area.bbox)`로 디렉터리를 생략한다. reader는 `ROAD_DATA_DIR`가 있으면 그것을 우선하므로 lock에 기록한 manifest와 실제 DB가 달라질 수 있다. 또한 프로토콜이 요구한 SQLite SHA가 현재 없다. 실제 data directory를 한 번 resolve하고 그 디렉터리의 manifest를 lock에 넣은 뒤 `readLocalRoads(bbox, resolvedDirectory)`로 고정해야 한다. manifest가 가리키는 DB 실제 경로·크기·SHA256 및 manifest 바이트 동일성을 snapshot 전후 확인해 기록할 것을 권고한다. manifest의 checksum은 PBF의 MD5이며 SQLite SHA256 대신이 아니다.

그 외 확인한 구현은25catalog×3지역, 요청마다 독립 TimeBudget15000, attempts60/preserveHypotheses:true, pool≤8, 실제 도로 감사·정확한 graph좌표, 실패 구역의 null 슬롯 보존에 맞는다. base 폴더가 이미 있으면 거절하므로 partial을 삭제·재시작하지 않는다. 사람12요청은 도로 조회 전 지역별 animal2/object2를 `sha256('v19-human|area|key')`로 고정해 input-lock에 저장한다. catalog25의 unique key·11/14종 및 human12 고유 요청도 명시 assert하면 계약이 더 분명하다. 현재 generation.json은 running/complete를 같은 경로에 직접 쓰므로 소비자는 complete와 완전 파싱을 필수로 확인해야 한다. 최종 원자 게시는 권고하되 이 검토에서 코드를 수정하지 않았다.

15초는 generator에 전달된 시간 budget이며 전체 감사/저장까지 하드15초로 제한하는 구현은 아니다. 실제 elapsed·budget exhausted/partial·coarseSeeds/evaluated·전처리/저장 비용을 따로 보고한다. 과거 v11의 공유19분30초·원본550행 보존 방식과 달라 새 지역 대비 과거의 절대점수 차이를 동일 생성 예산 효과로 해석하지 않는다.

## 권고 실행 순서 — 여기서는 미실행

1. 위 데이터 계보 보완 후 프로토콜·runner/core/catalog·manifest/DB·세 bbox·human12 요청을 동결한다. 개발75 결과는 별도 경로로 그대로 둔다. 오류 시 새 지역으로 교체하지 않는다.
2. main이 기존 단위검사·타입 및 opt-in 미설정 skip을 확인한 뒤 실제 generation은 다음 하나만 실행한다: PowerShell에서 `$env:ROAD_NEW_GEOGRAPHY='1'`; `npx vitest run tests/eval/road-new-geography-20261103.test.ts`. Windows TMP/TEMP는 기존 workspace tmp를 사용한다. 이는 조건 보완 뒤의 명령 제안이며 이 문서 작성 중 실행하지 않았다.
3. snapshot·원래 간선·native/projected3–8km·반복≤.2·영역·폐곡선·좌표와75슬롯을 검증한다. 고정 renderer/encoder로 **새 도로 특징만** 추출하고, 기존25 query·v17 train-only prototype을 그대로 연결한다. 새 weights/threshold/query/seed를 fit하지 않는다. 각 요청의 같은 최소ID geometry 대표에서 G/H/I를 선택하고 빈 요청은 세 방법 모두 결측으로 유지한다. H rocket은 G fallback이며 G도 결측이면 그대로 결측이다.
4. source/selection/catalog/mapping/pages·code를 새 판정 읽기 전 lock으로 묶고, 고정3AI와 사전 human12 요청을 별도로 평가한다. 지역·방법·이름·query·점수를 숨기고 같은 pixel만 재사용한다. 선택 그림이 다르다고 나란히 보여 정답을 유도하지 않는다. 실패/보류를 분모에서 빼지 않는다. main의 primary I−G·동물 개선 기준과 다수결 엄격 gate를 분리하고 I−H도 그대로 보고한다. 사람 참여가 없으면 미측정이다. 기존 한 사람 개발 positive는 새 독립 test에 넣지 않는다.

**결론:** 알려진 bbox 중복 때문에 지역을 바꿀 필요는 발견하지 못했다. 전국 로컬 자료와 생성 core로 실행 가능성이 높지만 새 지역 도로를 조회해 실현 가능성을 확인한 것은 아니다. 위 SQLite/환경변수 계보 문제를 먼저 해소하고 동결된 비교만 수행해야 한다. 새 지역·같은 계열AI 결과는 독립 사람 검증을 대신하지 않으며 앱 기본 변경·최종 목표 달성의 근거로 단독 사용하지 않는다.

## 후속 추가: 이미 시작한 실행의 무재시작 계보 보완

2026-11-03. main은 본 보고서 완료 전에 generation session96002를 시작했다고 알렸다. 실행 중 runner·lock·파라미터·기존 snapshot을 바꾸거나 실행을 재시작하지 않는다는 방침을 유지한다. 위 본문은 실행 전 검토 당시의 발견과 권고이며 소급 수정하지 않는다. 지역 제안 주체만 main으로 정정했다.

main 보고에 따르면 시작 shell과 현재 확인한 환경에 ROAD_DATA_DIR가 없었고 기본 data/roads를 사용했다. 실행 도중 측정한 SQLite SHA256은 `5d7d2d7abdd3fc04e729b1bc22e657fde4bb5c1446519e60c02cc494b0775ced`다. 이는 **main이 보고한 실행 중 근거**이며 본 전문가가 직접 확인한 해시나 실행 전 동결값이 아니다. 현재 환경만으로 과거 process 환경을 독립 증명했다고 하지 않는다.

제안된 보완은 타당하다. 완료 후 별도 source supplement에 실제 resolve된 directory·manifest/DB 경로·크기·SHA·측정 시각/실행 단계·사용 명령과 실행 환경의 근거를 기록한다. 명시 디렉터리를 전달해 같은 reader·bbox·serialization으로 각 snapshot을 읽기 전용 재조회하고, 새 bytes를 원래 snapshot과 정확 비교한다. 재조회 전후 DB·manifest hash가 같은지, DB hash가 실행 중 보고값과도 같은지 확인한다. 기존 snapshot·generation 출력은 덮어쓰지 않고 supplement에서 원래 lock·출력 SHA에 연결한다.

이 검사가 모두 통과하면 '최종 snapshot이 기록된 명시 DB에서 정확히 재현되며, 관측한 시점들의 DB hash가 같다'는 강한 사후 일관성 근거가 된다. 성공 기준·지역·생성 정책을 바꾸지 않으므로 **이 계보 문제만을 이유로 동일 실험을 재시작할 필요는 없다.** 다만 시작 전부터 DB가 한 번도 바뀌지 않았다는 연속 감시 증명이나 사전 SHA 등록으로 소급하지 않는다. SQL 반환 순서는 명시적 ORDER BY 계약이 없으므로 byte 차이가 생기면 실패 사실을 남기고 순서/내용 차이를 별도 설명해야 한다. 구조 동등성을 byte 동일성으로 바꿔 쓰거나 기존 snapshot을 재조회값으로 교체해서는 안 된다. 불일치가 있으면 원본을 보존한 채 영향 범위와 검증 보류를 보고한다.

이번 추가는 보완 방법의 평가뿐이다. 본 전문가는 재조회·DB 해시 계산·generation 재실행을 하지 않았으며 live runner나 다른 파일을 수정하지 않았다.

## 후속 추가: 별도 retrieval adapter·사후 감사 코드 검토

2026-11-03. `scripts/recognition-lab/geography-retrieval.py`, `tests/python/test_geography_retrieval.py`, `tests/eval/road-new-geography-audit-20261103.test.ts`를 정적으로 읽었다. 실행하지 않았고 live runner/protocol은 수정하지 않았다.

일반적인 비어 있지 않은 source에서는 새 adapter가 최소ID geometry 대표·G 점수/H train prototype/I query cosine·ID tie·canonical 각도를 기존 v18과 동일하게 계산한다. source1003 고정 검사를 제거하는 대신 실제25×3 grid와 행 범위를 검사하며, 요청별 빈 pool은 다른 intent에서 채우지 않고 null/validRoad=false로 유지한다. 기존 query protocol과 새 평가 protocol을 별도 인자로 기록하고 renderer/encoder·canonical checkpoint 호환을 검사하므로 프로토콜 계보 분리도 적절하다. 제공된 동등성 테스트는 이 선택 계산을 비교하되 CLI 전체의 입력 검증을 실행한 테스트는 아니다.

**보완1 — 전체 source가 빈 경우의 CLI:** helper `retrieve()`는 `(0,D)` 특징으로75개 결측을 만들지만 `select()`는 먼저 기존 `head.load_features(..., expected_ids=[])`를 호출한다. 이 함수는 빈 expected_ids를 명시적으로 거절한다. 따라서 'all-empty75 지원'은 현재 helper에만 성립한다. 완전 실패 source도 프로토콜대로 보존하려면 adapter CLI에서 빈 결과 경로를 별도로 처리해 가짜 특징 없이75개 NA를 내보내고, 가능하면 그 CLI 경로를 테스트해야 한다. 기존 extractor 역시 빈 road batch를 정상 특징 파일로 만들 수 있다고 가정하면 안 된다. 비어 있지 않은 현 실행의 결과를 바꾸는 문제는 아니며, 이를 이유로 generation을 재시작하지 않는다.

**보완2 — 사후 감사의 DB hash 범위:** 새 감사 테스트는 명시 `path.resolve('data/roads')` 재조회와 snapshot byte/hash·실제 도로/좌표·거리/반복을 확인한다. 하지만 SQLite 자체 SHA의 재조회 전후 비교와 실행 중 supplement hash와의 비교는 코드에 없다. supplement의 `ROAD_DATA_DIR:null`과 manifest hash만 assert하는 것으로 DB hash 검증을 대신하지 않는다. main이 별도 명령으로 DB hash를 확인한다면 그 명령·시각·값을 감사 결과에 연결하고, 그렇지 않으면 감사 측에 이를 추가해야 한다. 시작 전 hash로 소급하지 않는다.

**실패 자료의 감사 한계:** 독립 감사 테스트는 sourceSnapshots3개 모두 sourceFile/roadHash/graph를 가진 성공 snapshot이라고 가정한다. runner는 구역 실패 시 error-only 항목을 남기므로, 그런 결과에서는 테스트가 파일 접근 오류로 중단될 수 있다. 실제 실패가 있으면 해당 영역의 오류·미검증 범위·25결측을 명시해 보존하고, 성공 snapshot만의 검증 수를 전체3지역 감사로 표현하지 않는다. 마지막 reviewSlot 검사는 ID 존재만 보므로 각 slot과 실제 행의 area/proposalShape 일치도 사후 retrieval 연결 감사에서 확인하는 편이 안전하다.

검토 범위에서 새로운 의미 label fit·좌표 변경·새 prototype 학습은 발견하지 못했다. 위 사항은 별도 adapter/감사 계약의 보완이며 locked generation의 변경·재실행이나 출력 삭제를 요구하지 않는다. 이 문서 외의 파일은 수정하지 않았다.
