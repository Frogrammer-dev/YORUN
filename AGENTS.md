<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git 작성자 (이 저장소 전용)

이 저장소의 모든 커밋은 아래 계정으로 작성한다. 전역(`--global`) 설정이나 다른 계정 이름·이메일을 쓰지 않는다.

- user.name: `(부)성환`
- user.email: `22110034@g.tu.ac.kr`
- GitHub 계정: `Frogrammer-dev`

설정은 `git config --local`로 되어 있다. 커밋 전에 `git config user.email`이 위 값인지 확인한다.

## 경로 추천·그림 인식 작업 전

`docs/recognition-route-handoff.md`(이전 작업 인계: 현재 결론, 고정 12조건 평가 규칙, 재현 자료)를 먼저 읽는다.

## 최우선 과제와 연구 운영 (2026-10-21 사용자 지시)

- 최우선 과제는 **사람이 보고 사물로 알아볼 수 있는 실제 도로 경로를 추출하는 것**이다. 기하학 유사도 80은 보조 벤치마크이며 사물 인식 성공을 대신하지 않는다.
- 이름·참고 그림·꾸밈선을 보여주기 전의 실제 경로로 인식 여부를 평가한다. 설명을 본 뒤의 납득도는 별도 기록한다.
- 개선은 가설 → 사전 성공/실패 기준 → 대조 실험 → 반증 검토 → 유지/수정/폐기의 순환으로 진행한다. 실패와 보류도 기록하고, 결과를 보고 분모·정답·조건을 바꾸지 않는다.
- 2026-10-27 사용자 지시: 이전의 모든 하위 에이전트 협업 지시와 필수 역할 배정은 취소한다. 사용자가 다시 명시적으로 요청하기 전까지 하위 에이전트를 생성하거나 재개하지 않고 단독으로 작업한다. 과거 보고서의 협업 지시는 당시 기록이며 현재 실행 지시가 아니다.
- AI 판정을 실제 사람 평가로 간주하지 않는다. 생성/선택에 사용한 판정과 최종 독립 평가를 분리한다.
- 실행 규칙과 다음 가설은 `docs/object-recognition-research.md`를 따른다. 원래 고정 12조건·원본 점수식·실제 도로 유효성 기준은 보존한다.
