# 웹·PWA 배포

Vercel 기준 절차입니다. `next build`·`next start`가 되는 다른 Node 서버에도 같은 환경변수를 쓸 수 있습니다.

## 배포 전 확인

- **커밋 범위**: Git 연동 배포는 커밋된 파일만 빌드합니다. `src/lib/art/roadReferenceClient.ts`를 현재 수정본으로 커밋하면 `routeStructure.ts`, `routeParts.ts`, `routeHypotheses.ts`도 함께 커밋해야 빌드됩니다.
- **평가 자료**: `public/`의 파일은 주소만 알면 누구나 열 수 있습니다. 공개할 의도가 없다면 `public/eval/`을 커밋하지 않습니다 (`git add -A` 주의). Vercel CLI 배포에서는 `.vercelignore`가 제외합니다.
- **Node**: `node:sqlite` 때문에 22.13 이상이 필요합니다. CI는 Node 24를 씁니다.

## 환경변수

Vercel 프로젝트 설정의 Environment Variables에 넣습니다. `.env.local`은 올라가지 않습니다.

| 변수 | 필요 시점 | 비었을 때 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 로그인·저장 | 저장·공유 API가 503, 미리보기는 동작 |
| `SUPABASE_SERVICE_ROLE_KEY` | 공유 링크 조회 | 공유 조회 불가. 서버 전용 |
| `APP_ORIGIN` | 공유 링크 주소, 예: `https://배포주소` | 요청 주소를 사용 |
| `KAKAO_REST_API_KEY` | 장소 검색 | 검색창에 미설정 안내 |
| `OPENAI_API_KEY`, `ROAD_REFERENCE_MODEL`, `ROAD_REFERENCE_MAX_CALLS_PER_HOUR` | AI 선 그림 해석 | 외부 호출 없음 |

`NEXT_PUBLIC_*` 값은 빌드에 포함되므로 바꾼 뒤 다시 배포해야 합니다.

## 절차

1. GitHub 저장소를 Vercel에 가져옵니다. Framework는 Next.js, 명령은 기본값을 씁니다.
2. 환경변수를 넣고 배포합니다.
3. Supabase Auth의 Site URL과 Redirect URLs에 `https://배포주소/auth/callback`을 추가합니다.
4. Google 로그인을 쓴다면 Google Cloud 쪽 설정은 Supabase 콜백 주소 그대로 둡니다. 동의 화면이 테스트 상태면 등록한 사용자만 로그인할 수 있습니다.

## Vercel에서 달라지는 기능

| 기능 | 동작 |
|---|---|
| 도로 데이터 | SQLite(1.3GB)가 없어 공용 Overpass를 사용합니다. 혼잡하면 느리거나 실패합니다 (`docs/local-roads.md`). |
| CLIP 인식 (`/api/recognition`) | Python과 모델이 없어 503 `model_unavailable`을 반환합니다. |
| 요청 제한, OpenAI 시간당 상한 | 프로세스별 메모리 값이라 서버 인스턴스마다 따로 계산됩니다. 전체 과금 상한이 아니므로 OpenAI 쪽 사용 한도를 함께 설정합니다. |

## 배포 후 휴대폰 확인

- [ ] Android Chrome에서 설치하고 아이콘과 전체 화면을 확인
- [ ] iPhone Safari의 "홈 화면에 추가"로 설치하고 아이콘을 확인
- [ ] 코스 찾기에서 위치 권한과 도로 불러오기 확인
- [ ] 달리기를 시작해 기록·종료 확인 (화면을 켠 상태)
- [ ] 이메일·Google 로그인 후 `/room`으로 돌아오는지 확인
- [ ] 공유 링크를 다른 기기에서 열기

아이콘은 `public/icon.svg`를 바꾼 뒤 `node scripts/generate-pwa-icons.mjs`로 다시 만듭니다.
