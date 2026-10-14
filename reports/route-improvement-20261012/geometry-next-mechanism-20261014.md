# 다음 기하학 생성 대조: 실제 윤곽 지지 정보를 보존하는 경로 상태

2026-10-14. AI 전문가 에이전트의 읽기 전용 진단과 다음 실험 제안이다. 원래 자동 12조건 평균은 **77.416667 / 정밀77.317593 / 실패0**이며 목표80을 달성하지 못했다. 이번 작업은 저장 후보를 분석하고 이 문서만 추가했다. 경로 생성·앱 수정·holdout-v2 열람은 하지 않았다. 아래 대안의 품질 효과는 미검증이다.

## 확인한 병목

`shapeGuidedPortRolloutProductStages.ts`의 고정 단계 실험은 광안리4에서 control Q726, feedback Q725를 실제로 평가했다. control 밖 prefix와 그 선택 이후 전개도 있었지만 최고 품질은 개선되지 않았다. 따라서 현재 문제를 ‘완성 경로가 없음’이나 ‘feedback 뒤 계산이 전혀 없음’으로 계속 설명할 수 없다.

`continuousEdgePhase.ts`의 phase는 반경0.16×scale 안의 checkpoint를 실제 도로 선분 안에서 순서대로 만났다는 정보다. 선분 내 hit는 검색 대응이며 실제 경로 노드가 아니다. 이 전이는 경로의 일부가 현재 guide 선분에서 크게 이탈하지 않는지 확인하고 `nativeMeters + ∫road→assignedGuide/tol`을 비용에 더한다. **원식의 그림→전체 실제 경로 편차와 특징점 보존을 상태에 저장하지 않는다.** 실제 특징점 허용 거리는0.08×scale로 더 작다.

`shapeGuidedPortRolloutProductStages.ts:116`의 incoming arc×phase×500m 길이 bucket에는 비용 상위4개 상태만 남는다. 같은 자원 키라도 서로 다른 실제 경로 이력은 서로 다른 귀·별 꼭짓점·윤곽 구간을 지지할 수 있다. 저비용 상태가 원식의 양방향 편차나 특징 보존에서도 더 낫다는 관계는 없다. 이는 코드에서 확인한 손실 가능성이며, 특정 좋은 실제 prefix가 이 규칙 때문에 탈락했다는 인과 증거는 아직 없다.

`selectRolloutBeam`의 나머지4개와 `rolloutTestPrefixes`의 비대조 표본은 hash로 선택된다. hash 다양성은 실제 간선 이력이 다양하다는 수단일 뿐, 도형에서 현재 부족한 부분을 지지하는 다양성은 아니다. 완성 후 원식으로 고른 feedback도 첫 proxy suffix 하나가 원래 그림을 충분히 표현하지 못하면 좋은 prefix를 놓칠 수 있다. 이번 제안에서는 첫 suffix 종료 방식까지 동시에 바꾸지 않는다.

## 저장된 실제 경로를 원식으로 재계산한 근거

실행 입력은 `shape-guided-rollout-product-stages-20261014/gwangalli/results.json`과 원래 광안리 도로 스냅샷이다. 저장 node ID를 재사용하고 기준선은7자리 좌표의 유일한 정확 노드 대응으로 복원했다. 현재 원본 `evaluatePath`와 같은 `resample(max(8,round(perimeter/12)))`·point-to-finite-segment 방식으로 양방향 편차를 따로 계산했으며 `(d1+d2)/2`는 `meanDev`와1e-9 이내에서 일치했다. 아래 신규 후보는 control arm의 저장 pool 최고 또는 하네스가 공정하게 보정한 최고다. feedback 최고 수치도 같았다.

| 광안리 조건·후보 | 정밀 점수 | 경로→그림 d1(m) | 그림→경로 d2(m) | 그림 표본의 최대 미지지 거리(m) | 특징 보존 | 초과 급회전/km |
|---|---:|---:|---:|---:|---:|---:|
| 네모 기존 |70.669645|23.776427|17.537630|88.367221|1.0|4.093907|
| 네모 신규 보정 후 |60.940378|24.164488|21.461804|82.760739|1.0|3.822810|
| 하트 기존 |76.117988|19.031579|16.004810|62.202514|1.0|2.438149|
| 하트 신규 보정 후 |75.885448|16.122802|14.416996|56.807395|1.0|3.513643|
| 별 기존 |72.534088|13.535940|11.645462|51.885825|1.0|4.491919|
| 별 신규 보정 전 |56.021227|28.511015|39.397558|183.599247|0.7|2.714389|
| 별 신규 보정 후 |60.975426|25.127505|37.218583|177.134691|0.8|2.714389|
| 고양이 기존 |70.566172|17.189923|14.826960|49.049964|1.0|4.251375|
| 고양이 신규 보정 후 |44.509718|30.347060|21.519064|127.722956|0.5|5.788816|

위 후보는 모두 spikes0이다. 신규 별은 꺾임이 적지만 실제 경로에서 크게 떨어진 원본 윤곽 부분을 남겼다. 고양이는 편차·특징 누락·꺾임이 함께 악화했다. 네모는 보정 후 특징 보존을 회복했어도 작은 scale에서 정규화 편차가 커졌다. 이는 별도 자동 scale 다양성 실험과 구분한다.

하트 신규는 양방향 편차가 실제로 더 작다. 원식의 편차 Q항은0.202292→0.175730으로 개선됐지만 급회전 log항은0.070593→0.100216으로 악화해 원식 총점은 낮았다. 따라서 윤곽 지지 정보만으로 하트의 꺾임 문제까지 해결한다고 주장할 수 없다.

신규 pool 최고의 zero-native-meter phase 수는 네모2, 하트41, 별13, 고양이10이었다. 모든 최종 phase를 도달했지만 별·고양이의 특징은 누락됐다. **zero phase를 일괄 금지하면 안 된다.** 하트는41개 zero phase가 있어도 특징 보존1이며, 도로 선분 내부의 대응과 실제 경로 지지는 다른 정보다. 같은 도로가 여러 촘촘한 checkpoint를 표현하는 정상 사례도 보존해야 한다.

원래 최종12경로는 이미 특징 보존1이다. 따라서 특징 mask만 추가해서 기존12점수가 오를 것이라는 결론은 부적절하다. 아래 제안은 특징점을 넘어 원식의 모든 그림 표본에 대한 실제 거리 벡터를 보존해, 새 생성기가 원래 모양의 많은 부분을 빠뜨리는 문제를 줄이는 가설이다.

## 제안하는 메커니즘 하나

**실제 도로 간선이 원본 그림의 어느 부분을 지지했는지 상태에 보존하고, 제한된 기존 label·beam 슬롯을 그 지지 다양성에 배분한다.** 비용 계수·반경·전체 예산을 늘리지 않는다. 원래 평가식·원본 template·native 폐곡선·ROI·3–8km·반복≤0.2는 유지한다.

각 자동 pose의 원본 outline에서 원식과 정확히 같은12m 그림 표본 `S`를 만든다. 원래 features도 같은 균일 pose로 배치한다. 실제 macro arc별로 모든 실제 내부 선분을 사용해 다음 두 거리 벡터를 캐시한다.

```text
arcGuideDistance[j] = min distance(S[j], each actual native segment in arc)
arcFeatureDistance[f] = min distance(feature[f], each actual native segment in arc)
```

초기 prefix의 거리는 실제 시작 노드까지의 거리다. 새 arc를 붙이면 상태의 `nearestGuide[j]`, `nearestFeature[f]`를 elementwise min으로 갱신한다. feature support는 `nearestFeature[f] <= 0.08*scale`로 계산한다. 좌표·연결 간선·새 그림은 생성하지 않는다. phase label이 바뀌어도 같은 arc geometry의 거리 벡터는 같으므로 `continuousArcPhase` 본문을 바꿀 필요가 없다.

완성 시 `mean(nearestGuide)`는 해당 고정 pose의 **그림→전체 실제 경로 d2와 정확히 같은 표본·선분 거리**다. 특징 보존도 원식과 일치해야 한다. prefix의 d2는 앞으로 내려갈 수 있는 미완성 값이다. Q 하한·최적성 증명·prefix 확정 실패로 사용하지 않는다. 경로→그림의 최종 표본 간격은 전체 길이에 따라 바뀌고 RDP 꺾임도 비국소적이므로 이 벡터가 전체 Q를 대신하지 않는다.

첫 실험 정책을 결과 열람 전에 다음처럼 고정한다.

1. 자원 key당 기존4개 슬롯 중 proxy 비용 상위2개를 먼저 보존한다. 남은2개는 그 두 상태가 지지하지 못한 원본 그림 부분을 더 잘 지지하는 상태에 배분한다. 후보가 이미 선택된 실제 prefix와 같으면 중복 선택하지 않는다.
2. stage beam16 중 기존 proxy/feedback12개는 유지하고 hash4개 대신 같은 지지 다양성 규칙으로4개를 채운다. 실제 그림 지원이 같으면 기존 cost/hash tie-break를 사용한다.
3. prefix 평가4개는 기존 proxy 상위2개와 대조 beam 밖2개라는 수를 유지한다. 밖의2개를 hash 순서 대신 지지 다양성으로 고른다. 기존 suffix2profile·prefix/suffix caps·Q ceiling과 첫 유효 goal 종료는 그대로 둔다.

지지 다양성은 새 가중 합으로 cost를 바꾸지 않는다. 현재 stage까지 도달한 원본 guide station에 해당하는 그림 표본과 특징만 사용한다. 이미 선택된 prefix들이 만든 pointwise minimum 거리 벡터에 대한 후보의 거리 감소를 계산한다. 먼저 추가로 지지하는 원본 특징 수, 그다음 현재 지난 그림 표본에 대한 총 거리 감소, 마지막 기존 cost/hash를 사전 고정한 사전식 순서로 비교한다. 앞으로의 모든 표본을 이미 지난 것처럼 계산해 짧은 초기 prefix를 부당하게 벌주지 않는다. 동일 pose 내 표본 수·scale는 같으며 선택 당시 phase도 기록한다.

이 정책은 제한된 다양성 슬롯을 도형의 미지지 부분에 배분하는 휴리스틱이다. 비용과 지지 벡터의 수학적 Pareto 완전 보존이나 실제 Q 최적성을 주장하지 않는다. 두 슬롯을 나누는 때문에 기존 비용 상위3·4 label은 밀릴 수 있으므로 결과·반대 손실을 함께 계측한다.

## 먼저 필요한 양성 대조와 반증

작은 실제 연결 그래프에 두 개의3–8km 폐곡선을 구성한다. 하나는 원본 별/고양이의 끝부분을 생략한 싼 경로, 다른 하나는 같은 incoming arc·phase·500m bucket에 도달하지만 원본 해당 부분을 실제 간선으로 지지하는 조금 비싼 경로다. 싼 prefix를 최소4개 준비해 기존 비용4label 정책에서 좋은 prefix가 정말 탈락하게 만들고, 양쪽 모두 같은 최종 closure suffix를 통과하도록 한다. 수동 pose는 이 합성 기능 계약 안에서만 사용하고 실제12 생성 seed에는 넣지 않는다.

동일 cap에서 (a) 원래 정책이 지지 높은 prefix를 탈락시킴, (b) 새 정책은 동일 슬롯4 안에 그 prefix를 보존함, (c) 그 후손이 실제 폐곡선으로 완성됨, (d) 원식 Q가 실제로 더 좋음, (e) 실제 간선 집합이 다름을 확인한다. 단순히 helper가 mask를 계산한다거나 희망 prefix를 beam에 직접 넣는 것으로 양성 대조를 대신하지 않는다. 또한 sparse 한 간선이 여러 checkpoint를 정상 지지하는 네모에서 정확 경로·100점이 유지되는 음성 회귀와, 두 경로가 같은 support를 가진 경우 기존 tie-break가 유지되는 계약을 둔다.

저장된 자동12경로는 양성 **표현** 대조로만 재생한다. 전체 실제 arc의 거리 벡터를 min으로 합친 값이 원식 d2·특징 보존과 일치하는지 검증하며, 이 알려진 경로를 생성 seed·배치·donor로 넣지 않는다. 실제 신규 생성의 인과를 보려면 새 witness 슬롯으로 보존된 prefix hash뿐 아니라 그 후손 lineage를 기록한다. 해당 선택 뒤 전체 작업 수만으로 후손의 효과를 주장하지 않는다.

위 합성에서 보존을 확인하지 못하면 실제 도로 cap 확대부터 하지 않는다. 실제 도로에서 새로 보존한 witness prefix가 없거나 후손 Q 평가가 없으면 메커니즘 미실행으로 기록한다. 새로 보존한 후손은 있으나 기존보다 좋은 actual geometry가 없으면 품질 실패로 기록한다. feature support는 올랐으나 normalized meanDev/RDP turns가 악화하면 원식상 실패다.

## 공정한 실제 도로 대조

진행 중인 scale 다양성 대조가 종료된 뒤 그 소스·자동 pose 정책을 동결한다. 두 arm은 정확히 같은8개 자동 pose와2개 start, 동일 continuous transition·product bound·prefix/suffix caps·16beam·4label·512Q ceiling을 사용한다. 새 모듈은 독립 clone으로 작성하며 변경 역복원으로 parent 본문 보존을 검사한다. 기존 모듈·원식·원본 도형은 수정하지 않는다.

양 arm 모두 거리 벡터를 계측해 control의 추가 관찰 비용도 같은 조건으로 확보하되 control 선택은 원래 cost/hash 그대로다. arc/sample 실제 segment 검사, 캐시 setup/메모리, 상태 벡터 복사, proxy 전개, actual Q·refit 호출, wall time을 따로 보고한다. 같은400k expansion ceiling은 전체 비용 동등성이 아니다. 공유 immutable arc 거리 캐시를 쓰면 두 arm 모두 같은 사전 계산을 사용하고 캐시 생성 비용을 별도 기록한다.

광안리4 pilot의 기존 최종 후보는 비교·원래/canonical 동일128 보정에만 사용한다. 저장 후보가 들어가지 않는 신규 road-only 생성 pool과 기존 최고 보존 결과를 구분한다. 향상 시 원래12 전부를 도로부터 다시 생성하는 단일 pipeline, 정확 실제 간선/길이/반복/ROI/원식/분모12/이음매 감사, untouched 새 지역 검증을 이어간다. pilot 또는 저장 최고 합집합으로 평균80을 선언하지 않는다.

## Root가 별도로 검토하는 global scale 배분 대조

`globalSearch.ts`의 내부 coarse bucket은 원래8개 scale을2개씩 묶어 다양성을 가진다. 하지만 실제 초기 라우팅은 `seeds.slice(0,attempts)`의 flat 순위이고, 반환 placement48 절단과는 별개의 병목이다. 기존 보고서의 global 다양화·attempts1200·전방향 실험을 확인했지만 flat top240 대신 원래4scale tier에서60개씩 round-robin으로 실제 라우팅하는 동일 정책 실험은 찾지 못했다.

이는 generator·거리 field·원식·240초기 라우팅 호출을 유지하는 독립 allocation 대조로 타당하다. 다만 top6 local 부모가 바뀌므로 local 유효 호출 수·flex/cleanup 작업은 같다고 가정하지 않는다. global 함수는 표시용 반올림 거리·반복으로 후보를 거르는 부분과 경로 ROI1m 허용을 갖고 있으므로 최종 후보를 정확 native3–8km/repeat≤0.2/정확ROI로 다시 검증한다. global-only 개선을 전체 cascade 성능으로 확대하지 않고 후보 교체에 따라 뒤 단계 top8/top4가 바뀌는 효과까지 fresh 전체 실행에서 확인한다.

## 근거와 해시

- ProductStages 결과: `eval/recognition/route-improvement/shape-guided-rollout-product-stages-20261014/gwangalli/results.json`, SHA-256 `8c0f1671f235a27665402770310ee2e00a1b0bf01f032e3656ee6a86bf4ae6dc`.
- 원래 자동12 결과: `eval/recognition/route-improvement/offline-cascade-20261013/results.json`, SHA-256 `e3eef1f70792e5d75915724c1dc02e8b3775334515dd2ecb6794a58b79edcdf0`.
- ProductStages source: `3fd8205b351274692ba349cdd2a9268bc40437715be3b0018938ccdc67163093`.
- continuous phase source: `0c2c272203df3ee450f57e6e8446f71467053006fb7f30a42e0b63240d0921a5`.
- continuous integral source: `5dd953a96d48fd92b1e35c55d27eb365c7a6fc697a9721c0fa1f07f69e4d6381`.
- 현재 `fit.ts` SHA `c8f749824266ebc06452cce5cbfacd13a2859fbe5494f25a022328f2d95defb4`는 당시 snapshot과 다르다. 직접 diff는 type-only `ParsedRoadReferenceProposal` import와 `RouteCandidate.semanticExplanation` 선언 추가만 보여준다. `evaluatePath`·양방향 샘플·원식 의미는 동일하다. shapes/graph/osm/rdp 현재 바이트는 당시 protocol과 모두 일치했다.
- 이전 반증: `rollout-product-stages-pilot-20261014.md`, `rollout-product-bound-pilot-20261014.md`, `ordered-length-resource-hypothesis-20261013.md`, `progress.md`의 local arc·corrected arc·population·pair repair 절. 실제 원식으로 feedback을 준 시도도 이미 실패했으므로 이름만 바꾼 feedback 재실험이나 예산 확대를 새 접근으로 제안하지 않는다.

이 문서는 코드·저장자료에서 도출한 새 휴리스틱 가설이다. 외부 연구 성능을 이 제품 성능으로 가져오거나 품질 개선을 미리 보장하지 않는다.

## 구현과 데스크톱 이전 시점의 상태

`nativeGuideWitness.ts`, 독립 복사본 `shapeGuidedPortRolloutWitness.ts`, 원본 바이트 역복원 생성기, opt-in `shape-guided-witness-20261014.test.ts`를 준비했다. 2026-10-14 부모 실행에서 `rollout-witness-positive-control.test.ts`의7개 검증은 단독 exit0으로 통과했다. 비활성 정책의 원래 경로/Q/전개 일치, sparse/dense native3.2km 네모100점, 정상 self-loop와 지연 재사용을 포함한다.

합성 고양이에서는 두 검증을 구분한다. commonPort7은 정책 묶음의 실제 Q 개선과 다른 간선 집합, tested-prefix rescue의 엄격한 완성 후손 존재를 검사한다. 최고 Q 개선을 tested-prefix 하나의 단독 인과라고 주장하지 않는다. commonPort8은 같은 incoming·phase·길이 bucket의 실제4개 저비용 경쟁 상태보다 특징 지지가 높은 prefix를 보존하고, 그 엄격한 후손이 실제 native 폐곡선으로 완성되는 것을 검사한다. 이 label 검증만으로 전체 최고 Q의 개선을 보장하지 않는다. 수동 배치는 합성 계약에서만 사용했다.

실제 field 대조는 데스크톱 이전 요청 시점에 아직 실행하지 않았다. 준비된 하네스는 양 arm에 같은 legacy 자동8배치·2start·feedback=true를 사용하고, 비활성 광안리 arm이 이전 Q725/전개747813과 정확히 같은지 검사한다. 원래 점수·native 거리·반복·ROI·canonical 비교와, 기록된 모든 rescue ID를 가진 Q 완성의 실제 간선/점수/arc prefix를 감사한다. 512개의 trace 이후 미추적 rescue는 전수 계보 감사에 포함되지 않는다. field에서는 `witnessRescuesUntraced`를 반드시 보고하고 terminal retention과 엄격한 prefix 후손을 따로 센다.

독립 검토: `witness-independent-review-20261014.md`. 새 컴퓨터 준비·별도 도로 및 평가자료·API 설정·실행 명령: `docs/workstation-migration.md`. 원래12 평균80과 새 지역 검증은 여전히 미완료다.
