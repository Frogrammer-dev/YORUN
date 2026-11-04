# v11 실행 예산 부록: 실행 중 코드 변경 없음

기록 시각 UTC: 2026-11-02T10:53:36.924249+00:00

초기 프로토콜과 실행 소스는 수정하지 않았다. 초기 프로토콜 SHA256: `0566f7f25dcf6acda488bed888c05789ba22d41d445deb5c8a2801b9b93297bb`.
실제로 적용한 예산은 실행 시작 전 코드에 정해졌으며 결과를 보고 수정하지 않았다.

- `const budget = new TimeBudget(1170000);`: 공유 탐색 예산 1,170,000ms (19분30초).
- `},1200000);`: Vitest 테스트 제한 1,200,000ms (20분).
- 요청별 독립 시간 상한은 없다. 동일한 TimeBudget 객체를 75요청이 공유한다.
- 공유 예산은 테스트 초기화 직후 시작하며 자료 읽기/그래프 구성/중간 저장 시간도 경과 시간에 포함한다.
- 남긴30초는 최종 전체 경로 감사/보존 확인/원자 게시용 여유다. 이전 회차의 무제한 탐색과 동일 예산 성능 비교가 아니다.
- 각 요청 attempts60/fullRotation=true/rankBySimilarity=true/preserveHypotheses=true/pool<=8은 고정이다.
- 예산은 generator의 가용성 확인 지점에서 협력적으로 적용된다. 단일 무거운 호출을 OS 수준에서 즉시 강제 종료하는 보장은 아니다.
- 예산 소진 후에도 남은 요청을 삭제하지 않는다. partial/budgetExhausted와 실패·빈 후보·검토 슬롯을 모두 분모75에 기록한다.
- 도중에 예산/상수/프로토콜/실행 소스/threshold를 바꾸거나 조건을 재시도하지 않는다.

실행 소스: `tests/eval/road-diversity-20261102.test.ts`

원본 바이트 스냅샷: `reports/road-ranker-20261102/code-snapshots/road-diversity-v11-executed.test.ts.txt`

실행 소스 SHA256: `0383a96b07e855a147a85600d83aa9c2ea2b85bb30944df8bc26f4d497ae2552`

Budget 구현 SHA256: `2137e887a7c702da101589bfdbf89ef98ca13736675ef466c1a80d214ea77320`

생성기 SHA256: `8d2ccd481557ab8e32074df47cd53a75a436980b420bd2fc589ad7137f321308`

이 부록은 실제 실행 조건의 명시이며 사물 인식 성과나 성공 판정이 아니다.
