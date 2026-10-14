# 완료 거리 하한 탐색 순위와 알려진 경로 표현 진단 — 2026-10-14

원래 12조건 단일 자동 cascade의 확인된 평균은 **77.4167**이며 평균80 목표는 미달이다. 이번 독립 광안리4 pilot은 새 완성 경로를 만들지 못했다. 기존 실제 경로를 진단에 사용한 재생 결과는 신규 추천 성과로 집계하지 않는다.

## 고정된 대조

`shapeGuidedPortRolloutAStar.ts`는 고정 NoBacktrack 복사본에서 heap 우선순위만 `cost + orderedClosureBound / scale`로 바꿨다. 실제 proxy cost, 라벨 보존, 빔 선택, 자동 coarse 배치8개, 시작 포트2개, guide, 반경, unit당25,000/조건당400,000 전개 상한, Q 상한512는 유지했다. 두 arm 모두 동일한 완료 거리 하한을 사용하며 feedback 사용 여부만 선택에서 다르다.

하한은 원래 guide의 미래 checkpoint 방문과 시작점 복귀까지의 거리다. native/projected 비율 보정을 포함하며, **완성 suffix의 하한**이다. 단계별 prefix 목표의 최적성, 원래 기하학 점수의 최적성 또는 전체 탐색 완전성을 보장하지 않는다. 하한 준비 작업은 전개 예산 밖에서 별도 기록했다.

평가 전에 실제3200m 폐곡선, 지연된 연결선 반복 보존, 즉시 역방향 제외 및 synthetic native/projected .5 하한을 검증했다. 작은 기능 검증은 실제12조건 점수로 세지 않는다. 여러 suite 동시 실행 중 임시 Vite 변환 파일 ENOENT가 발생했고, 실패 suite를 단독 재실행해2개 테스트 통과했다. 나머지 하한2개 테스트, TypeScript, lint도 통과했다.

## 광안리4 결과

평가 프로세스는 종료 코드0, Vitest131.29초로 완료했고 전후 코드 바이트 해시가 일치했다. 두 arm 각각 총1,600,000 전개, 새 strict 완성0, 직접 Q 평가0, 기하학 개선0이었다. 평균 **72.75 → 72.75**, 정밀 평균72.471973이다. Q 후보가 없으므로 feedback의 품질 선택 효과를 검증한 결과가 아니다.

| 조건 | control 최대 도달 phase / 마지막 phase | 하한 준비 작업 | control 탐색 시간(ms) |
|---|---:|---:|---:|
| 네모 | 25 / 32 | 41,520 | 14,906 |
| 하트 | 68 / 102 | 117,120 | 47,617 |
| 별 | 29 / 40 | 46,192 | 5,405 |
| 고양이 | 27 / 44 | 48,912 | 4,928 |

개별 시간은 실행 당시 부하를 포함하며 이전 방식 대비 속도 인과 근거로 쓰지 않는다. 기록과 `.source` 스냅샷은 `eval/recognition/route-improvement/shape-guided-rollout-astar-20261014/gwangalli/`에 있다. AStar 코드 SHA256은 `cdd002cb865d783f91e73ac3b0b5c0379366c096a565ac925041d8ac4735afef`이다.

## 알려진 실제 경로의 표현 가능성

전문가 에이전트가 최신 자동12개 최고 경로를 **해당 경로의 원래 배치 그대로** 고정하고 native 간선별 phase union과 현재 macro endpoint cap을 적용한 재생을 비교했다. 경로 생성, 배치 튜닝, 저장 경로를 새 추천의 seed로 사용하는 작업은 하지 않았다.

최종 안정 재실행은 종료 코드0,41.81초, 전후 바이트 해시 통과다. 12/12 조건에서 어떤 동일 간선 경로 표현은 두 재생 모두 마지막 phase까지 실제로 닫혔다. endpoint cap 때문에 알려진 완성을 잃은 조건은0이었다. 실제 production 시작 포트2개 선택·full macro·depth128·즉시 역방향 제외까지 동시에 만족한 조건은9/12다. 나머지는 강남 하트·별·고양이로, 알려진 경로 위의 가까운 포트가 반경 안에 있지만 그래프 전체에서 고른 시작 포트2개가 그 경로 위에 없었다.

이 결과는 **알려진 최고 배치에서의 구조 진단**이다. pilot의 자동 coarse 배치8개가 같은 배치라는 뜻은 아니다. phase union은 고정 경로의 표현 가능성만 검증하며 예산·history 라벨 탈락을 재현하지 않고 exact continuous Fréchet도 아니다. 첫 실행은 `pairSegmentRepair.ts`의 CRLF→LF 변경으로 바이트 해시 검사에 실패해 보존했으며, 내용 동일성을 확인한 후 현재 바이트를 다시 고정한 별도 폴더 결과만 채택했다.

최종 결과: `eval/recognition/route-improvement/rollout-known-path-replay-20261014/stable-lf-rerun/results.json`. 다음 단계는 원래 continuousArcPhase 전이의 phase×포트 역방향 최단 비용을 계산하여, 선택된 자동 배치에서 실제 완료 연결이 존재하는지와 현재 위치의 남은 proxy 비용을 함께 확인하는 것이다. 준비 비용과 메모리를 별도로 측정한다. 기존 평가식·원본 그림·도로·거리·연결 제약과 untouched holdout은 유지한다.
