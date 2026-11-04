// Supabase Auth 오류 → 사용자가 다음에 할 일을 알 수 있는 문장.
// 계정 존재 여부가 드러나지 않게, 로그인 실패는 이메일과 비밀번호를 구분하지 않는다.

export const MIN_PASSWORD_LENGTH = 8;

export function authErrorMessage(error: { code?: string; message?: string; status?: number }): string {
  switch (error.code) {
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 맞지 않아요. 다시 입력하거나 비밀번호를 재설정해 주세요.";
    case "email_not_confirmed":
      return "아직 메일 인증을 하지 않았어요. 가입할 때 받은 메일의 링크를 눌러 주세요.";
    case "weak_password":
      return `더 긴 비밀번호를 써 주세요. ${MIN_PASSWORD_LENGTH}자 이상이고 쉽게 짐작할 수 없어야 해요.`;
    case "same_password":
      return "지금 쓰는 비밀번호와 달라야 해요.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "지금은 이메일 가입을 받을 수 없어요. Google로 계속해 주세요.";
    default:
      return "요청을 처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.";
  }
}
