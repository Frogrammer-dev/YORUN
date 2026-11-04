# 실제 드로잉런을 표현하는 도로 패턴 탐색 설계

조사일: 2026-10-21. 담당: 알고리즘 설계 연구 에이전트. 코드·인계문서·논문·창작자 설명을 읽었으며, 코드 수정·알고리즘 실행·유료 API 호출·홀드아웃 열람은 하지 않았다. 아래 설계와 숫자로 제시한 예산은 검증 전 가설이다.

## 1. 기존 구현과 문헌이 이미 해결한 일, 아직 해결하지 못한 일

### Takeaway

템플릿을 사용하는 것 자체가 문제는 아니다. 실제 창작자의 핵심 부분 우선 배치와 반복 수정에 비해, 현재 앱은 하나의 고리 외곽을 우선 만들고 완성 후 이름을 붙이는 흐름에 편중되어 있다. 다만 복수 획·가지·순서 있는 윤곽 탐색은 이미 있으므로 이를 처음 제안하는 것처럼 설명하면 안 된다.

### Cited Findings

- Gene Lu는 간단한 스케치에서 대상을 알아보게 하는 핵심 부분을 먼저 고른 뒤 그 부분을 지도에서 찾고, Strava Routes에서 거리와 회전을 검토한다고 설명한다. 이는 작품 제작자의 실제 작업 설명이지 자동 탐색 알고리즘의 성능 실험은 아니다. — [Gene Lu, GPS Art Running](https://genelu.com/work/gps-art-running)
- Lenny Maughan의 공식 Strava 인터뷰(2024)는 지도에서 모양을 발견하는 접근과 미리 정한 그림을 도로에 맞추는 접근을 모두 소개한다. 교차·되돌아가기를 허용하고 출발·종료 지점을 고쳐 왕복을 줄인다고 한다. 일시정지 후 재개로 장애물을 우회하면서 표시선은 직선으로 이어지게 하는 방식도 설명하므로 공개 이미지가 전부 연속 도로 경로라는 가정은 틀릴 수 있다. — [Strava, Love Strava Art? How to Create Your Own Masterpiece](https://stories.strava.com/ea/articles/love-strava-art-how-to-create-your-masterpiece)
- 사례 담당이 제목을 알고 직접 본 Gene Lu 작품에서 Death Star는 외곽·가로선·내부 원/대각선·주변 작은 도형의 조합이며 C-3PO는 눈·입의 내부 획이 중요했다. C-3PO 표시는 17.3mi(약27.8km)다. Lenny의 Rose는 내부 나선·줄기·좌우 잎 관계이며 공식 표시 29.5mi(약47.5km)다. 이는 제목 선행 시각 관찰과 공개 거리 표시이지, 블라인드 인식이나 원본 GPX의 연속성·반복률 검증이 아니다. — [Gene Lu 작품](https://genelu.com/work/gps-art-running), [Strava Rose와 제작 설명](https://stories.strava.com/ea/articles/love-strava-art-how-to-create-your-masterpiece)
- Andre Waschk·Jens Krüger, **Automatic route planning for GPS art generation**, Computational Visual Media 5(3), 303–310, **2019**, DOI 10.1007/s41095-019-0146-z: 일반 최단거리 탐색이 그림의 특징을 지울 수 있음을 설명하고 목표 선분과 도로 간선 사이 편차를 라우팅 비용에 넣었다. 미세한 구조와 도로가 성긴 지역의 한계, 향후 사용자 연구 필요성을 명시한다. 우리 앱의 인식률이나 80점 달성을 보장하는 논문이 아니다. — [저자 소속 대학 원문](https://duepublico2.uni-due.de/servlets/MCRFileNodeServlet/duepublico_derivate_00072443/Waschk_et_al_Automatic_Route_Planning.pdf)
- Daniel Chen·Anne Driemel·Leonidas J. Guibas·Andy Nguyen·Carola Wenk, **Approximate Map Matching with respect to the Fréchet Distance**, ALENEX **2011**, 75–83: 그림 곡선을 내장 그래프 경로에 순서 보존 대응하는 문제를 다룬다. c-packed 곡선·낮은 밀도 그래프 가정 아래 근사법을 제시한다. 이 논문의 입력은 이미 주어진 곡선이며 의미 있는 대상의 발견·거리·반복 제약까지 해결한 것은 아니다. — [저자 원문](https://geometry.stanford.edu/paper/cdgnw-ammrfd-11/cdgnw-ammrfd-11.pdf)
- Wouter Meulemans, **Map Matching with Simplicity Constraints**, **2013**: 단순 닫힌 곡선과 주어진 Fréchet 거리 이내인 단순 그래프 사이클의 존재 판정이 평면 직선 그래프에서도 NP-complete임을 보인다. 따라서 연결·단순성·닮음 제약을 동시에 완벽히 푸는 빠른 최적해를 가정하면 안 된다. 이 결과를 현재 12조건의 80점 불가능 증명으로 읽을 수도 없다. — [저자 arXiv](https://arxiv.org/abs/1306.2827)
- Lumin Yang·Jiajie Zhuang·Hongbo Fu·Xiangzhi Wei·Kun Zhou·Youyi Zheng, **SketchGNN: Semantic Sketch Segmentation with Graph Neural Networks**, arXiv 최초 **2020**, 개정 2021: 벡터 스케치를 점·획·전체 그림 수준의 구조 그래프로 표현하고 의미 부분을 분할한다. 도로 그래프 데이터로 학습·평가한 결과는 아니다. — [저자 arXiv](https://arxiv.org/abs/2003.00678)
- `discoverRoutes`는 블록 합집합 고리를 기존 그림과 비교하며, `traceUnion`은 구멍·한 점 접촉·같은 교차점 재방문을 거절한다. `branchLoops`는 완성 고리에 대체로 곧은 가지 1~2개를 붙이는 실험이다. `findGroupRoutes`는 여러 폐곡선 획을 각각 찾고 이동 구간을 분리한다. `orderedContourPath`는 이미 도로 간선×윤곽 진행 상태를 탐색한다. — [discover.ts](../../src/lib/route/discover.ts), [loops.ts:181](../../src/lib/route/loops.ts#L181), [branches.ts](../../src/lib/route/branches.ts), [group.ts](../../src/lib/route/group.ts), [orderedContourPath.ts](../../src/lib/route/orderedContourPath.ts)
- `selectRoadReferenceInputs`는 자연 고리 중 최대 3개를 외곽 다양성으로 골라 보내지만 `branchMeters`, `moves`, `moveMeters`가 있는 후보를 거절한다. 따라서 가지 생성기를 켜는 것과 외부 AI가 가지 그림을 실제로 받는 것은 다르다. `qualitySearch`의 일반 추천은 기존 그림 계열 상위 3개를 개선하며, 최종 pool의 모든 결과가 서버 해석에 들어가는 것도 아니다. — [roadReferenceClient.ts:65](../../src/lib/art/roadReferenceClient.ts#L65), [qualitySearch.ts](../../src/lib/route/qualitySearch.ts)
- 도로 생성은 `pruneDeadEnds`를 적용한다. 단말 도로가 사라지면 후단 가지 생성기가 그 도로를 복원할 수 없다. 손실 없는 degree-2 압축은 `exactRoadPortGraph.ts`에 이미 있으므로 압축 자체를 새 알고리즘으로 제안하지 않는다. — [osm.ts:119](../../src/lib/route/osm.ts#L119), [osm.ts:170](../../src/lib/route/osm.ts#L170), [exactRoadPortGraph.ts](../../src/lib/route/exactRoadPortGraph.ts)
- 최신 fresh 자동 고정12조건 평균은 77.416667이며 80 미달이다. 특징 커버리지가 이미 1.0인데도 별·고양이 편차·불필요한 꺾임이 컸던 사례가 있다. 추가 배치·phase·macro 다양성·완료 하한 등이 실제로 실행되어도 품질 상승이 없었던 기록이 있다. — [최신 인계](../../docs/recognition-route-agent-handoff.md), [기존 결론](../../docs/recognition-route-handoff.md)

### Inferences

- **확인된 괴리**는 기존 생성·서버 입력의 표현 범위이며, **미확인인 괴리**는 공개 GPS 아트 중 그 범위를 벗어나는 작품의 비율이다. 이미지에 내부 선·분기·교차가 보인다고 실제 막다른 길 왕복이나 기록 중단을 확정할 수 없다. 원본 GPX가 있어야 시간 순서·정지·재방문·도로 지원을 판정할 수 있다.
- 템플릿 배치·Fréchet 순서 탐색·최단거리 비용 수정만 다시 구현하는 것은 우선순위가 낮다. 새 대조는 **부분이 실제 도로에서 지지되는지, 부분들이 알아볼 비례와 위치 관계를 이루는지, 그 조합을 한 번의 실제 이동으로 실행할 수 있는지**를 동시에 보존하는지에 초점을 둔다.
- 이름을 붙이는 것보다 후보 생성이 먼저라는 기존 결론은 유지한다. 동시에 현재 후보 풀 안에 이미 알아볼 만한 경로가 있으나 최종 3개에서 빠지는지 먼저 확인하면, 생성기를 크게 바꾸기 전 병목을 구별할 수 있다.
- Death Star·C-3PO·Rose의 구체적 관찰은 내부 선과 부분 관계를 폐기하지 않는 표현을 검토할 이유다. 다만 일부 작품은 우리 거리 상한보다 수 배 길다. 3~8km에서는 동일 복잡도의 축소판보다 2~3개 상징적 특징으로 읽히는 단순 해석을 우선하는 것이 가설이다. 큰 작품을 작은 도로망에 줄이면 같은 세부 정보를 유지할 수 있다는 근거는 없다.

### Gaps

- 현재 12조건의 반복 제한을 유지하며 새 표현이 더 높은 점수를 만드는지는 실행하지 않아 모른다.
- 공개 작품은 목적·거리·도시·이동 방식이 다양하다. 우리 제품의 3~8km 걷기/달리기·반복 ≤0.2·실제 간선 조건을 만족하는 성공 사례 수는 아직 확보하지 않았다.
- ContextSeg(CVPR 2024) 공식 검색 결과의 초록은 확인했으나 원문 URL은 403이어서 상세 방법 비교 근거에서는 제외했다. 대규모 학습을 해야 한다는 주장은 하지 않는다.

## 2. 어떤 구조와 탐색 상태로 설계할 것인가

### Takeaway

첫 구현 가설은 **도로에 있는 부분 구조 → 대상 가설 → 관계를 보존하는 실제 간선 경로 조립 → 독립 판정 → 작은 재연결**이다. 그림으로 보이는 간선 집합과 시간 순서대로 달리는 경로를 별개로 저장하되, 화면과 거리 계산에서는 실제 이동을 숨기지 않는다.

### Cited Findings

- Jack Edmonds·Ellis L. Johnson, **Matching, Euler tours and the Chinese postman**, Mathematical Programming 5, 88–124, **1973**: matching을 이용한 Chinese postman 해법과 Euler tour 알고리즘을 제시한다. 닮은 부분을 찾는 논문은 아니지만 선택한 간선들을 실제로 방문하는 비용을 분석하는 기초다. — [저자 소속 IBM 공식 서지·초록](https://research.ibm.com/publications/matching-euler-tours-and-the-chinese-postman), [논문 DOI](https://doi.org/10.1007/BF01580113)
- 공식 NIST 정의에서 Chinese postman은 각 간선을 적어도 한 번 지나는 최소 길이의 닫힌 walk이다. 방향·무방향 혼합 문제의 복잡도는 다르다. — [NIST Dictionary of Algorithms and Data Structures](https://xlinux.nist.gov/dads/HTML/chinesePostman.html)
- 현재 앱의 반복률은 실제 도로 간선의 두 번째 이후 이동 길이를 전체 이동 길이로 나눈다. 이 값은 단순히 특징선의 개수나 획 개수가 아니다. — [fit.ts:414](../../src/lib/route/fit.ts#L414), [fit.ts:461](../../src/lib/route/fit.ts#L461)

### Inferences

#### A. 지지 간선과 의미 부분을 같은 ID로 연결한다

새 데이터는 기존 native 도로 ID를 잃지 않는다. 아래 이름은 설계용이며 현재 구현된 타입이 아니다.

- `RoadPrimitive`: `id`, `nativeArcIds`, 실제 polyline, 시작·종료 port, 길이, 방향 변화열, 곡률, bbox. 단순 체인뿐 아니라 실제 V자·작은 고리·굽은 꼬리·분기 등으로 연결한다. 기존 압축 그래프를 재사용하되 압축선 안의 모든 굽음은 유지한다.
- `RoadMotif`: 선택 primitive 집합과 adjacency, terminal/branch/cycle 수, 실제 연결 거리, 상대 위치·크기·접선 관계. 처음에는 기존 자연 고리와 거기에 연결된 몇 개의 실제 chain만 쓴다. 모든 도로 부분그래프를 무제한 열거하지 않는다.
- `ObjectHypothesis`: 일반 이름 또는 `none`, `parts[{role, primitiveIds, arcRanges, importance}]`, `relations[{above, attachedTo, opposite, ratioInterval, angleInterval}]`, 부족한 부분, 상상한 부분을 별도 저장한다. '귀가 있다'는 주장에는 실제 arc 범위가 필요하다.
- `DrawableSupport`: 실제로 그림을 이루는 고유 도로 간선 union. `Traversal`: 시작·종료와 순서 있는 native arc walk, 간선별 방문 횟수, 연결 이동, 총 거리와 반복률. 두 구조는 다르다. 어떤 연결부가 그림선이 아닌 이동선인지 UI에 명시하고 총 이동 거리·엄격 원본 평가에서 제외하지 않는다.
- raw 보행 그래프와 cycle core를 별도 view로 둔다. 현재 반복12 평가용 그래프는 그대로 동결한다. 발견형 실험에서만 raw의 합법적 단말·가지 보존 여부를 비교한다. raw를 추가한다고 항상 인식이 좋아지는 것은 아니며, 불필요한 가지·검색량도 늘 수 있다.

#### B. AI의 역할은 대상 가설과 부분 설명, 실제 연결은 코드가 맡는다

1. 코드가 실제 motif를 정규화한 선 그림·부분 ID·위치 관계로 만든다. GPS·주소를 보내지 않고, 전체 도로 데이터 전송 대신 작은 후보만 전송한다. 위치 제거가 완전 익명화를 의미하지는 않는다.
2. 모델은 그림에서 보이는 부분 ID에 근거하여 넓은 대상 가설을 최대 몇 개 제안하거나 보류한다. 예: '오른쪽 아래의 곡선 P7이 꼬리로 읽힌다', '귀 쌍이 없어 고양이 해석은 약하다'. 도로 좌표와 연결 간선을 만들게 하지 않는다.
3. 코드가 해당 부분·관계를 유지하면서 실제 경로를 조립한다. 목표 대상마다 원형 하나를 비균일하게 휘게 만드는 방식보다 허용되는 상대 관계 범위를 이용한다. 이는 발견형 새 연구이며, 고정12 원본 도형을 변경하는 수단이 아니다.
4. VLM은 최종 경로를 이름 없이 다시 판정하거나 독립 사람 평가를 돕는다. 가설 생성기와 최종 판정기를 분리하며, 같은 모델의 다른 호출은 완전한 독립 사람 검증이 아니다.
5. 새로운 참고 그림은 최종 표시를 위한 설명이다. 그 참고 그림을 자기 경로에 맞게 만든 후 '비슷함 95점'이라고 보고하지 않는다. 실제 없는 눈·입은 imagined, 지원되는 선은 observed로 표시한다.

#### C. 닫힌 walk의 실행 가능성을 먼저 검사한다

- 현재 목표의 기본형은 **실제 간선, 연결된 닫힌 이동, 3~8km, 반복률 ≤0.2**다. 그림의 내부 선·교차가 있어도 이 조건을 만족할 수 있으나 단순 외곽 고리만으로는 표현할 수 없을 수 있다. 원래 고정12에서는 원본 조건을 그대로 쓴다.
- 연결된 지원 그래프 H의 고유 길이를 S라 하고, H 안의 도로만 이용해 모든 선을 방문하는 최소 closedwalk의 추가 중복 길이를 A라 하면 최단 총길이는 S+A다. 무방향 그래프에서는 홀수 차수 정점의 최소 T-join/짝짓기와 Euler tour로 분석할 수 있다. 이 **H 내부 이동 제한** 아래 최소 반복률은 A/(S+A)다. A/(S+A)>0.2 또는 S+A>8km면 해당 표현은 탈락시킬 수 있다.
- 예: 길이 C인 고리에 일방향 길이 B의 막다른 꼬리 하나를 붙이고 같은 길로 돌아온다면 총길이 C+2B, 반복길이 B이므로 B/(C+2B)≤0.2여야 한다. B≤C/3이다. 이 계산은 보편적 '고양이 가능 거리'가 아니라 해당 그래프 구조의 실행 제약이다.
- **주의:** H 밖의 새 연결 도로를 허용하는 전체 G의 T-join 추가거리는 고유 도로일 수 있다. 이를 전부 반복거리라고 놓고 탈락시키면 잘못이다. 전체 G에서는 추가거리 하한과 실제 multiplicity를 구별한다. 필요한 경우 전체 합법 도로의 bridge-cut으로 확실한 필수 왕복만 계산한다. 서로 떨어진 지원 컴포넌트의 연결비와 parity 보정비를 근거 없이 더해서도 안 된다.
- 출발·도착이 다른 openwalk는 odd set 조건이 바뀐다. pen-up은 실제 이동과 기록 중단을 요구한다. 이것들은 별도 제품 옵션·평가선으로 두며, closedwalk 성능을 올렸다고 주장하지 않는다.

#### D. 탐색 상태와 목적을 분리한다

후보 상태는 `(현재 port/유입 arc, part 진행 구간, 지원 primitive 집합, 관계 충족 상태, 누적 거리, 실제 방문 multiplicity, 그림↔선분 거리 요약, turn 통계, 지원 컴포넌트/parity)`로 둔다. 모든 값의 전수 조합은 폭발하므로 초기에는 motif 하나의 작은 주변 도로와 소수 가설로 제한한다.

- **hard feasibility**: native 연결·합법 보행·영역·정확한 거리·정확한 반복률·모드별 폐쇄 여부. 독립 재구성기로 최종 확인한다.
- **soft shape quality**: 전체 외곽과 비례, 양방향 거리, 중요 부분의 실제 지지, 부분 관계, 급회전/우회, 이름 없는 독립 인식. 한 특징점만 닿아 coverage=1이 되는 것을 충분 조건으로 쓰지 않는다.
- **목표가 서로 다른 후보 보존**: 길이·반복·전체 편차·부분 관계의 제한된 다목적 beam을 둔다. 같은 port와 비용이 비슷해도 귀를 보존한 경로와 귀가 사라진 경로는 같은 상태로 합치지 않는다. 제한된 beam은 완전한 Pareto 최적이나 최적해 보장이 아니다.
- **원본 순서 정보**: Fréchet/free-space 대응은 진행 순서를 다룰 근거가 있으나 현재 ordered contour에도 유사한 상태가 있다. phase 수만 늘리는 대조는 하지 않는다. 새로운 기여는 실제 지지 부분·관계·순서별 진행을 함께 유지하는지로 검증한다.
- **수정 방식**: 독립 판정의 '꼬리는 있으나 몸통과 비례가 안 맞음' 같은 실패에 대해 해당 native subpath만 몇 가지 실제 도로 대안으로 바꾼다. 전역 배치·원본 기준 그림은 고정하고 변경 전후 간선·길이·반복을 기록한다. 부분 개선이 전체 윤곽을 악화시키면 채택하지 않는다.
- **초기 제안 예산**: 같은 앱 총 검색 시간 안에서 motif 추출·가용성 20%, 소수 가설 구성 10%, 실제 조립 55%, 재평가·수정 15%를 우선 가설로 둔다. 서버 모델은 최대 3개 입력·1회 batch를 유지한다. 먼저 기존 자료와 수동 작성한 구조화 가설로 비용 없는 대조를 하며, 실제 CPU·전처리·API 지연을 측정한 뒤 비율을 결정한다. 기존 45~75초 동작에 추가 시간을 몰래 더하지 않는다.

### Gaps

- 어느 primitive/관계가 일반인 인식에 중요한지 도로 스케치 전용 라벨 데이터가 없다. 처음부터 GNN 대규모 학습이 필수라는 근거도 없다.
- 현재 원식의 RDP turn/seam 효과와 부분 기반 판정의 상관은 측정하지 않았다. semantic 점수로 원래 기하학 점수를 대체할 계획은 없다.
- 전 세계 GPS 아트 최적화의 일반해가 아니라 소수 실제 도로 motif를 조립하는 제한 탐색이다. 임의 조형을 항상 찾는다고 약속할 수 없다.

## 3. 가장 작은 검증 실험과 채택·중단 기준

### Takeaway

새 모델을 먼저 교체하거나 후보 수만 늘리지 않는다. **표현 손실 → 기존 후보 선별 → 새로운 후보 생성**의 세 작은 대조로 병목을 확인한다. 원래 12조건 기하학 목표와 새로운 발견형 사람 인식 실험은 계속 별도로 보고한다.

### Cited Findings

- 기존 인계는 기하학 점수·모델 cosine/확신도·사람 자유 인식률을 분리하고, 원래 12조건·분모·원식·거리·반복 제한·새 지역 홀드아웃을 보존하도록 규정한다. — [평가 규칙](../../docs/recognition-route-handoff.md), [최신 상태](../../docs/recognition-route-agent-handoff.md)
- 현재 코드의 서버 입력은 최대3개이며 첫 선택은 semantic 점수 없이 fingerprint 순서와 외곽 다양성에 의존한다. 따라서 동일 후보 풀·동일 선택 수로 선별 효과를 비교할 수 있다. — [roadReferenceClient.ts:65](../../src/lib/art/roadReferenceClient.ts#L65)

### Inferences

#### 실험 1 — 표현이 실제로 무엇을 지우는가

- 같은 도로 snapshot의 current graph와 raw 보행 graph를 비교하고, 단말 chain·작은 고리+꼬리·8자·내부 획의 알려진 소형 합성 계약을 먼저 둔다. 실제 archived 경로는 이미 존재하는 간선 목록만 사용한다.
- 측정: 그림에 필요하다고 미리 지정한 native arc 보존률, 연결 유형의 표현 가능 여부, 최저 실행 거리/반복률, strict 실제 경로 검증 실패 수. 단순한 길 존재와 사람이 대상처럼 읽는 것은 별도다.
- **채택:** 현재 제거된 구조 중 합법적이며 반복≤0.2인 표현이 존재하고, 보존 비용이 운영 예산 안일 때 raw/cycle-core view 분리를 다음 실험에 넣는다. **중단:** 추가된 것이 불필요한 길뿐이거나 실행 제약 때문에 모두 탈락하면 그래프 확장을 정답으로 주장하지 않는다.
- 공개 작품의 원본 GPX가 없으면 재현 성공률 항목에 넣지 않는다. 시각 관찰만 가능하면 모양 표현 사례로만 표시한다.

#### 실험 2 — 같은 후보 중 잘 보이는 것을 놓치고 있는가

- 기존 자료로 6개 지역·거리 query의 후보 pool을 동결한다. 현재 최대3개 selector, 모델 무관 표본, 부분·관계 기반 최대3개 selector를 비교한다. 각 arm 후보 수·API 호출 상한은 같다. 튜닝용6 query 뒤 별도6 query를 확인용으로 미리 잠근다. 원래 holdout-v2를 들여다보지 않는다.
- 먼저 이름·기준 그림·지도 배경을 숨긴 실제 전체 이동선에서 사람이 자유 명명/none을 기록한다. 사전 정의한 넓은 의미 동치 기준으로 복수 판정자의 일치를 본다. 이후 이름 공개 납득도, 마지막 꾸밈선 도움을 단계별로 측정한다. 노출 순서 오염을 줄이려면 판정자/후보를 나누거나 순서를 무작위화한다.
- 지표: pool 안의 인식 가능한 후보 비율(발견 상한), 선택3개의 자유 인식 일치율, selector recall, 보류율, 전체 query 중 추천 성공률, 지연/호출수. 추천을 거의 하지 않는 arm이 precision만 높이는 것을 막는다.
- **다음 결정:** pool 자체의 사람 인식 상한이 낮으면 생성 실험으로 간다. pool 상한이 괜찮은데 selector만 낮으면 선별을 먼저 수정한다. 새 reference로 만든 자기 유사도는 지표에서 제외한다.

#### 실험 3 — 부분을 보존한 실제 조립이 새 고리보다 나은가

- **가장 작은 opt-in 범위:** 앱 기본 흐름과 원래 12조건을 건드리지 않는 실험 옵션 하나에서, 기존 자연 고리의 실제 chain 2~3개와 의미 관계를 저장하고 동일 pool의 최대3개 선택만 먼저 바꾼다. 이것이 실험2다. 효과가 확인되면 하나의 관계가 빠진 native subpath만 소수 실제 대안으로 재연결한다. raw 단말 복원·복수 획·새 모델을 한꺼번에 켜지 않는다.
- **기존 단계와 다른 점:** existing branch는 고리 완성 후 1~2개의 대체로 곧은 왕복선을 무작위로 붙이고, group은 여러 폐곡선을 배치한 뒤 이동으로 잇고, contour는 하나의 기준 윤곽 진행을 따른다. 새 대조는 '이 arc 범위가 눈/꼬리를 지지하고 다른 부분과 이 관계를 가져야 한다'는 상태를 조립 중 보존하며, 그 구조의 최소 실행 비용을 함께 검사한다. 부분 이름만 최종 설명에 붙이는 변화라면 이 새 가설의 검증이 아니다.
- 6개 pilot query에서 기존 생성기와 `motif→구조화 대상 가설→실제 walk 조립`을 같은 실제 native 확장수·Q평가수 상한 및 전처리/실시간 비용으로 대조한다. 단순한 원본 고리, existing branch 실험, new part-relation 조립의 구분을 남겨 '가지를 추가했기 때문'과 '관계를 보존했기 때문'을 분리한다. 초기 구조 가설은 수동 고정 JSON으로 가능하며 유료 API가 선행 조건은 아니다.
- 가용성 하한을 넣은 arm/뺀 arm에서 완성율과 실제 소요를 비교한다. 지지 간선이 바뀌지 않은 출발점·방향 변경만으로 점수가 오른 것은 새 geometry 개선으로 세지 않는다.
- 사람 평가에서는 strict 실제 전체 walk를 기본으로 쓰고, 필요하면 creative stroke와 이동 구간을 색으로 나눠 추가 평가한다. 연결선·되돌아간 선을 숨겨 작품이 좋아 보이게 만들면 기본 성능으로 채택하지 않는다.
- **채택:** 독립 확인 query에서 사람 자유 인식과 추천 coverage가 함께 개선되고, hard 검증 실패0·거리/반복 유지·같은 예산을 충족할 때 앱 적용 후보로 본다. 표본이 작으면 효과 탐색 결과로만 쓴다.
- **기존 목표:** 원래 square/heart/star/cat×3지역의 12조건, 원본 `fit.ts`/`shapes.ts`, 3~8km·repeat≤0.2·폐곡선·실제 native 간선·영역 조건은 그대로 재평가한다. 새 탐색의 raw graph/복수 획/새 의미 기준 성과를 이 평균에 섞지 않는다. fresh 전체12에서 80이 넘고 별도 새 지역 확인까지 해야 기존 목표 달성을 검토할 수 있다.

#### 전문가 토의에서 수렴한 점

- 기존 구현 감사·평가 담당과 합의: 복수 획·가지·순서 탐색 자체를 새 발명으로 제안하지 않는다. 단말 pruning과 server 입력 필터는 실제 병목 후보지만, 실제 GPX 없이 작품 손실 빈도를 단정하지 않는다.
- 평가 담당의 반론을 반영: 부분 관계를 모델이 지어내고 같은 모델의 참고 그림으로 채점하면 쉬운 정답을 만드는 누수다. observed native arc ID를 먼저 고정하고 missing/imagined를 나누며, 이름 없는 독립 사람 판정이 최종 근거다.
- 총괄 검토의 반론을 반영: 원래 featureCoverage=1도 미달이므로 부분 추가 하나만으로 해결이라고 말하지 않는다. 전체 윤곽·비례·편차·불필요한 꺾임과 실제 이동 가용성을 함께 남긴다.
- 수학 검토에서 조정: 모든 추가 연결거리를 반복으로 간주하지 않는다. support 내부 closedwalk의 CPP 하한과 전체 도로의 새 연결 경로를 구별한다.

### Gaps

- 이 문서는 설계 검토이며 새 인식률·평균80 달성·사람 만족도 개선을 보고하지 않는다.
- 시각 사례 담당이 별도로 확보한 작품 목록·이미지 직접 관찰을 합치기 전, 특정 작품이 어느 표현 유형인지 여기서 확정하지 않는다.
- 참여 가능한 독립 사람 판정자 수가 정해지지 않아 신뢰구간·최소 검출 효과·출시 임계값은 아직 확정할 수 없다. 우선 소형 pilot으로 실패 원인을 분류한 뒤 확인 평가 규모를 고정한다.
