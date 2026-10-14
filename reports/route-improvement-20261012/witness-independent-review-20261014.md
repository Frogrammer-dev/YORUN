# 실제 도로 윤곽 증거 보존: 독립 검토

2026-10-14. `/root/witness_final_review`가 실행 모듈을 변경하지 않고 현재 소스와 고정 평가 규칙을 검토했다. 원래 12조건의 검증된 자동 평균은 **77.416667 / 정밀 77.317593 / 실패 0**이며 목표 80은 미달이다. 아래 계약 검토는 새 알고리즘의 실제 12조건 성능이나 새 지역 검증을 대신하지 않는다.

## 검토 결론

새 정책은 원본 그림의 실제 선분에 대한 거리·특징 지원을 중간 경로에 보존한다. 원식의 그림→경로 항에 대응하는 거리 벡터이며 전체 Q의 하한이나 완전한 Pareto pruning을 주장하지 않는다. 실제 도로 노드를 삽입·이동하거나 원본 그림·평가식을 수정하는 변경을 발견하지 않았다. 비활성 대조는 기존 비용·hash 선택과 탐색 cap을 그대로 사용하고 추가 계측만 수행한다.

원래 최고 경로는 비교 기준으로 읽을 뿐 생성 seed로 쓰지 않는다. 현재 field 하네스는 원래 도로에서 얻은 자동 coarse 8개 배치·배치당 가까운 실제 port 2개를 양 arm에 동일하게 전달한다. 이 단계는 저장 자동 결과 뒤에 새 후보 생성을 붙이는 대조이며 도로부터 전체 cascade를 새로 실행한 실험은 아니다.

## 거리 벡터와 실제 도로

`nativeGuideWitness.ts`는 배치된 원본 outline의 `max(8, round(perimeter / 12))` 표본을 `shapes.ts`의 원래 `resample`로 만든다. 이는 `fit.ts`의 `samplesAlong(outline, 12)`와 같은 규칙이다. 닫힌 끝점을 포함하는 실제 표본 배열 전체를 유지한다. 특징점은 원본 `shape.features`에 균일 배치를 적용하고 `0.08 * scale` 거리 조건을 사용한다.

각 압축 arc의 모든 실제 native 선분에 대해 `pointSegDist`를 계산하고, 전체 prefix와의 최소값을 누적한다. `hasEdge` 검사와 arc ID 재사용 시 실제 노드열 일치 검사가 있다. 완성 시 `guideToRoute`는 원식의 d2 항에 대응하고 `featureCoverage`도 원래 특징 항과 일치해야 한다. 노드가 드문 긴 간선, 세분된 간선, 실제 self-loop와 지연된 연결부 재사용을 다루는 계약 테스트가 존재한다.

선택 시에는 현재 guide station까지 지난 표본·특징만 사용한다. guide checkpoint는 검색용 원본 그림의 분할이며 실제 달리는 도로에 checkpoint를 삽입하지 않는다. vector·cache·선분 검사·선택 시간과 메모리는 별도 diagnostics로 기록하고 전개 cap에 포함하지 않는다. 따라서 같은 최대 전개 수는 같은 실제 시간·계산 비용의 증거가 아니다.

## 대조 조건과 변경 범위

- 비활성 label: 기존 비용·hash 상위 4개.
- 활성 label: 비용·hash 상위 2개와 원본 그림 지원 다양성 슬롯 2개.
- 비활성 stage beam: 원래 feedback/proxy 12개와 hash 다양성 4개.
- 활성 stage beam: 원래 앞 12개를 보존하고 실제 outline 지원 슬롯 최대 4개.
- 비활성 tested prefix: 원래 proxy 2개 및 hash 기준 추가 2개.
- 활성 tested prefix: proxy 2개를 보존하고 대조 beam 밖의 outline 지원 후보를 우선 평가.

이는 세 선택 정책을 함께 바꾸는 실험이다. 활성 arm의 점수가 높아져도 어느 한 선택 지점의 단독 효과로 해석하지 않는다. 기존 동일 history·낮은 비용 pruning과 고정 슬롯 cap이 남아 있으며 전역 최적성·모든 가능한 좋은 경로의 보존을 주장하지 않는다.

양 arm은 feedback을 켜고 조건당 최대 400,000 전개·512 직접 원식 호출, unit당 25,000 전개·32 직접 호출을 사용한다. prefix 1,875 / suffix 546 하위 cap과 최대 3개 phase branch 초과를 유지한다. field 비활성 광안리 arm은 과거 feedback 결과의 Q/전개를 정확히 재현하도록 요구한다: 네모 245/205,319, 하트 146/176,621, 별 104/147,145, 고양이 230/218,728.

## Rescue 계보와 결론의 한계

Rescue 기록은 hash나 arc 열만으로 합치지 않고 `(unit, 실제 stateId, reason)`으로 식별한다. 실제 전이에서 고유 state ID와 부모 ID를 만들고 rescue ID 배열을 자식에게 복사한다. 기록된 Q 완성은 모든 실제 native 노드와 goal arc 열을 보존한다. field 하네스는 실제 arc 열을 원래 port graph에서 복원해 canonical native 경로와 같음을 검증하고, 각 rescue의 실제 arc 열이 goal의 접두어인지 검사한다.

두 주의점은 root에 전달했다.

1. Rescue trace의 최대 512개 이후에는 `witnessRescuesUntraced`를 늘리고 ID를 붙이지 않는다. 따라서 `allRescuedQLineageAudited:true`는 현재 구현만으로는 **기록된 ID를 가진 모든 Q 완성**의 감사다. 실제 실행에서 untraced가 0인지 확인해야 하며, 양수이면 모든 rescue 및 후손을 전수 추적했다는 표현을 제한해야 한다.
2. field의 접두어·state 검사에는 같은 길이와 같은 state ID가 허용된다. terminal label 자체의 rescue도 Q 완성 기록으로 타당하다. 모든 항목을 엄격한 중간 prefix의 후속 연결로 세면 안 된다. 실제 후손 수는 `trace.arcPath.length < goalArcPath.length`와 `trace.stateId < goalStateId`를 함께 요구해 따로 계산해야 한다.

## 양성 대조의 증거 범위

`rollout-witness-positive-control.test.ts`의 commonPort 7 fixture는 새로 평가한 tested-prefix의 실제 완성 후손이 0보다 크고, 활성 정책 전체 최고 Q가 대조보다 높고 실제 간선 집합도 다름을 각각 요구한다. 현재 assert만으로는 전체 최고 후보 자체가 그 tested-prefix의 후손인지를 묶어 증명하지 않는다. 따라서 이를 tested-prefix 단독 인과 개선으로 보고하지 않는다.

commonPort 8 fixture는 같은 incoming·phase·500m 길이 bucket의 엄격히 더 싼 경쟁 경로 4개보다 특징 지원이 높은 실제 prefix가 보존되고, 그 엄격한 후손이 실제로 닫히는 것을 요구한다. `evicted`, `stronger`, `descendants`가 모두 양수여야 하므로 빈 배열의 전칭 검사로 통과하지 않는다. 이 fixture는 최고 Q 개선을 주장하지 않는다.

작은 fixture의 메커니즘과 실제 도로 품질은 별도다. field 후보에는 실제 간선·폐곡선·원래 영역·원본 그림의 균일 배치·native 및 projected 3–8km·반복률 0.2 이하·원식 정밀 Q를 검사한다. 기존 경로의 원래 이음매와 canonical 이음매에 같은 최대 128 배치 보정을 적용한 기준선보다 높은 **다른 실제 간선 집합**만 개선으로 채택한다. 새 후보는 top 8개에 각각 최대 128 보정하며 추가 원식 호출도 기록한다.

## 검토 시점의 실행 근거

독립 검토자가 직접 실행한 `create-witness-rollout.mjs --check`는 21개 고정 변환 anchor와 역변환을 검증했고, ProductStages의 원래 바이트 해시를 정확히 복원했다. 독립 검토 시점에는 새 field 결과가 아직 존재하지 않아 원래 도로 성능 개선을 확인하지 않았다. unit test·타입·lint·field 종료 여부는 root의 실제 실행 로그와 결과 JSON을 별도로 확인해야 한다.

`create-witness-pilot.mjs`는 `--check` 분기를 지원하지 않는다. 검토 중 이 인자로 실행하여 같은 바이트의 하네스를 다시 썼으며, 당시 field 폴더는 없었다. 실행 전후 하네스 SHA-256은 동일했다. 이후 해당 생성기를 다시 실행하지 않았다. 이는 실행 결과나 기존 산출물을 변경한 작업이 아니다.

| 검토 파일 | SHA-256 |
|---|---|
| `nativeGuideWitness.ts` | `a8fc4b512228adee862ccfea164197ae102c9319a0df908a006e72a388b7f288` |
| `shapeGuidedPortRolloutWitness.ts` | `8da3a40f6275a45b1d61abf4a8e2d92958f39b97242bd2252f9f91d22ceda42d` |
| `native-guide-witness.test.ts` | `615fe95c829406320810ef53ba911ae8c02c4a02c7df6b8ed402d11501f954e0` |
| `rollout-witness-positive-control.test.ts` | `02bbc775fa62b06248d0d773c660a092fe9e1d3aa342f83b6899abf4138f77c5` |
| `shape-guided-witness-20261014.test.ts` | `b3db181ac29d859d10f0e02347ba3eb65d4d25656bcfdfd3e86a155587fc2238` |
| `create-witness-rollout.mjs` | `f972549f9462484d432597398db6b49dace32e78eb2b215bc07618933dbf42c3` |
| `create-witness-pilot.mjs` | `860e00e0db702c88f457f197102f0efd0aa2b8a0a6ac6afbbbc3ac7cf4043332` |

## 다음 단계

먼저 원래 광안리 4조건의 paired field 종료와 동결 해시, 대조 Q·전개 재현, 기록된 전체 Q 계보·native 검사를 확인한다. 유효한 실제 품질 개선이 있으면 원래 12조건 전체에 이어 도로부터 자동 cascade를 새로 실행해야 한다. 독립 holdout-v2는 알고리즘 선택 전에 평가·튜닝하지 않는다. 앱 적용·새 지역 성공·목표 달성은 현재 검토의 결론이 아니다.
