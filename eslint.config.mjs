import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Playwright 준비물의 use()는 React 훅이 아니다
  { files: ["e2e/**"], rules: { "react-hooks/rules-of-hooks": "off" } },
  globalIgnores([
    // eslint-config-next 기본 제외
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 빌드 산출물·외부 배포본·테스트 결과
    "public/vendor/**",
    "public/models/**",
    "eval/recognition/**",
    "e2e/output/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
