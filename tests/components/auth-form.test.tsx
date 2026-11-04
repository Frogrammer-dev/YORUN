// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthForm } from "@/components/AuthForm";
import { POLICY_VERSION, hasValidConsent } from "@/lib/legal/policy";
import { safeNext } from "@/lib/safeNext";

const auth = {
  signInWithPassword: vi.fn(), signUp: vi.fn(), signInWithOAuth: vi.fn(), signInWithOtp: vi.fn(), resetPasswordForEmail: vi.fn(),
};
const navigate = vi.fn();
const setup = (props = {}) => render(<AuthForm supabase={{ auth } as unknown as SupabaseClient} prepareNext={async () => "/room?draft=d1"} onNavigate={navigate} {...props} />);
const typeEmail = () => fireEvent.change(screen.getByLabelText("이메일"), { target: { value: " runner@example.com " } });
const typePassword = (value: string) => fireEvent.change(screen.getByLabelText(/^비밀번호/), { target: { value } });
const agree = () => {
  fireEvent.click(screen.getByRole("radio", { name: "만 14세 이상" }));
  fireEvent.click(screen.getByRole("checkbox"));
};
const submit = () => fireEvent.submit(document.querySelector("form")!);

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(auth)) fn.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

describe("AuthForm", () => {
  it("로그인 성공: 돌아갈 주소로 이동한다", async () => {
    setup();
    typeEmail();
    typePassword("password1");
    submit();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/room?draft=d1"));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "runner@example.com", password: "password1" });
  });

  it("로그인 실패: 이메일과 비밀번호를 구분하지 않고 알리며 이동하지 않는다", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: "invalid_credentials" } });
    setup();
    typeEmail();
    typePassword("wrong-password");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("이메일 또는 비밀번호");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("이메일").getAttribute("aria-invalid")).toBe("true");
  });

  it("회원가입: 짧은 비밀번호는 보내지 않는다", async () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "회원가입" }));
    agree();
    typeEmail();
    typePassword("short");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("8자 이상");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("회원가입: 메일 인증이 필요하면 안내하고, 인증 뒤 돌아올 주소를 함께 보낸다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "회원가입" }));
    agree();
    typeEmail();
    typePassword("password1");
    submit();
    expect((await screen.findByRole("status")).textContent).toContain("인증 메일");
    const options = auth.signUp.mock.calls[0][0].options;
    expect(options.emailRedirectTo).toContain("/auth/callback?next=" + encodeURIComponent("/room?draft=d1"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("회원가입: 나이와 동의 없이는 보내지 않고, 동의 기록을 함께 남긴다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "회원가입" }));
    typeEmail();
    typePassword("password1");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("동의");
    expect(auth.signUp).not.toHaveBeenCalled();
    agree();
    submit();
    await waitFor(() => expect(auth.signUp).toHaveBeenCalled());
    expect(auth.signUp.mock.calls[0][0].options.data.consent).toMatchObject({ ageGroup: "14+", version: POLICY_VERSION });
  });

  it("회원가입: 프로토타입에서는 만 14세 미만을 고를 수 없고 계정을 만들지 않는다", async () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "회원가입" }));
    const under14 = screen.getByRole("radio", { name: "만 14세 미만" }) as HTMLButtonElement;
    expect(under14.disabled).toBe(true);
    fireEvent.click(under14);
    expect(under14.getAttribute("aria-checked")).toBe("false");
    typeEmail();
    typePassword("password1");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("동의");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("회원가입: 메일 인증을 끈 프로젝트는 바로 이동한다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "회원가입" }));
    agree();
    typeEmail();
    typePassword("password1");
    submit();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/room?draft=d1"));
  });

  it("비밀번호 재설정: 재설정 화면으로 돌아오는 메일을 요청한다", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "비밀번호를 잊었어요" }));
    expect(screen.queryByLabelText(/^비밀번호/)).toBeNull();
    typeEmail();
    submit();
    expect((await screen.findByRole("status")).textContent).toContain("재설정 메일");
    expect(auth.resetPasswordForEmail.mock.calls[0][1].redirectTo).toContain(encodeURIComponent("/login/reset"));
  });

  it("Google은 기존처럼 돌아올 주소를 넘긴다", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalled());
    expect(auth.signInWithOAuth.mock.calls[0][0].provider).toBe("google");
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toContain(encodeURIComponent("/room?draft=d1"));
  });

  it("메일 링크 로그인은 기존처럼 동작한다", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "메일 링크로 로그인" }));
    typeEmail();
    submit();
    expect((await screen.findByRole("status")).textContent).toContain("로그인 링크");
  });

  it("비밀번호 표시 버튼은 입력 종류를 바꾼다", () => {
    setup();
    const input = screen.getByLabelText(/^비밀번호/) as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "입력한 글자 표시" }));
    expect(input.type).toBe("text");
  });
});

describe("safeNext", () => {
  it("같은 출처의 상대 경로만 허용한다", () => {
    expect(safeNext("/duel")).toBe("/duel");
    expect(safeNext("//evil.example")).toBe("/room");
    expect(safeNext("/\\evil.example")).toBe("/room");
    expect(safeNext("https://evil.example", "/")).toBe("/");
    expect(safeNext(null, "/")).toBe("/");
  });
});

describe("hasValidConsent", () => {
  it("현재 판의 만 14세 이상 동의만 유효하다", () => {
    expect(hasValidConsent({ consent: { version: POLICY_VERSION, ageGroup: "14+", at: "x" } })).toBe(true);
    expect(hasValidConsent({ consent: { version: POLICY_VERSION, ageGroup: "under14", at: "x" } })).toBe(false);
    expect(hasValidConsent({ consent: { version: "old", ageGroup: "14+", at: "x" } })).toBe(false);
    expect(hasValidConsent({})).toBe(false);
    expect(hasValidConsent(undefined)).toBe(false);
  });
});
