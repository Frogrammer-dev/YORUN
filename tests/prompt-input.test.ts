import { describe, expect, it } from "vitest";
import { parsePromptInput } from "@/lib/route/promptInput";

describe("내 그림 입력 해석", () => {
  it("맨 앞이 @이면 글자를 그린다", () => {
    expect(parsePromptInput("@LOVE")).toEqual({ kind: "text", text: "LOVE", tooLong: false });
    expect(parsePromptInput("  @ 별 ")).toEqual({ kind: "text", text: "별", tooLong: false });
    expect(parsePromptInput("＠520")).toEqual({ kind: "text", text: "520", tooLong: false });
  });
  it("@가 없거나 문장 중간에 있으면 설명이다", () => {
    expect(parsePromptInput("귀 접힌 토끼")).toEqual({ kind: "description", text: "귀 접힌 토끼" });
    expect(parsePromptInput("메일 a@b 모양")).toEqual({ kind: "description", text: "메일 a@b 모양" });
  });
  it("비었거나 공백뿐이면 아무것도 하지 않는다", () => {
    expect(parsePromptInput("   ")).toEqual({ kind: "empty" });
  });
  it("글자 수는 코드포인트로 세고 5자부터 너무 길다", () => {
    expect(parsePromptInput("@사랑해요").kind).toBe("text");
    expect(parsePromptInput("@사랑해요")).toMatchObject({ tooLong: false });
    expect(parsePromptInput("@사랑해요!")).toMatchObject({ tooLong: true });
    expect(parsePromptInput("@😀😀😀😀")).toMatchObject({ tooLong: false });
  });
  it("@만 있으면 글자를 기다리는 상태다", () => {
    expect(parsePromptInput("@")).toEqual({ kind: "text", text: "", tooLong: false });
  });
});
