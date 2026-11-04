import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CONSENT_SUMMARY, OPERATOR, POLICY_VERSION, isPolicyDraft } from "@/lib/legal/policy";

export const metadata: Metadata = { title: "개인정보 처리방침 — 요런", description: "요런이 어떤 개인정보를 왜 모으고, 언제 지우는지 설명합니다." };

const Fill = ({ value, label }: { value: string | null; label: string }) =>
  value ? <>{value}</> : <span className="fill">{label} 입력 필요</span>;

const VENDORS: Array<[string, string, string]> = [
  ["Supabase", "로그인과 작품, 대결 기록 저장", "계정 정보, 위치를 뺀 작품 모양, 대결 능력치"],
  ["Vercel", "앱 서버 운영", "접속 정보, 위 항목이 서버를 거치는 동안의 처리"],
  ["Google", "Google 로그인 (선택)", "Google 계정 인증 정보"],
  ["OpenFreeMap", "바탕 지도 표시", "보고 있는 지도 범위, 접속 정보"],
  ["Overpass API", "도로 자료 조회 (사용할 때)", "지도 범위"],
  ["jsDelivr", "글꼴 제공", "접속 정보"],
  ["Open-Meteo", "코스 고도 계산", "고른 코스의 좌표"],
  ["카카오", "장소 검색 (선택)", "입력한 검색어"],
  ["OpenAI", "동네 추천 코스 해석 (선택, 끌 수 있음)", "위치를 뺀 코스 선 그림"],
];

export default function PrivacyPage() {
  return (
    <main className="hub-page policy-page">
      <header className="appbar">
        <Link href="/" className="icon-btn appbar-back" aria-label="메인으로 돌아가기">
          <Icon name="back" size={24} />
        </Link>
        <span className="appbar-title">
          <h1>개인정보 처리방침</h1>
        </span>
      </header>
      <div className="hub-body">
        {isPolicyDraft() && (
          <p className="auth-error" role="status">아직 초안이에요. 표시된 항목을 채우고 법률 검토를 마친 뒤 공개해야 해요.</p>
        )}
        <section>
          <h2>1. 처리 목적과 항목, 보유 기간</h2>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="처리 항목 표">
            <table className="policy-table">
              <thead><tr><th scope="col">목적</th><th scope="col">항목</th><th scope="col">보유 기간</th></tr></thead>
              <tbody>
                <tr><td>{CONSENT_SUMMARY.purpose}</td><td>{CONSENT_SUMMARY.items}, 동의 기록</td><td>회원 탈퇴 시까지</td></tr>
                <tr><td>작품방 저장과 공유</td><td>작품 제목, 위치를 뺀 상대 모양, 달린 거리와 시간</td><td>작품 삭제 또는 탈퇴 시까지</td></tr>
                <tr><td>1대1 대결과 8인 더비 (선택)</td><td>능력치, 전략, 대결 결과, 기록 확인용 해시와 시각. 참가할 때 위치를 뺀 코스와 달린 선을 검증에 쓰고 저장하지 않아요</td><td>탈퇴 시까지. 끝난 더비 능력치는 다른 참가자의 결과라서 누구의 기록인지 알 수 없게 바꿔 보관해요</td></tr>
              </tbody>
            </table>
          </div>
          <p>동의를 거부할 수 있어요. {CONSENT_SUMMARY.refusal}.</p>
        </section>

        <section>
          <h2>2. 위치정보</h2>
          <p>달리기 기록과 코스 안내를 위해 휴대폰의 위치를 받아요. 달리는 동안의 실제 좌표는 이 기기 안에 보관하고 서버로 보내지 않아요. 작품과 대결에는 출발 위치를 뺀 상대 좌표만 써요. 다만 모양이나 제목으로 장소를 짐작할 수 있어요.</p>
          <p>코스 찾기 때는 지도 범위가 도로 자료 서버로, 고른 코스의 좌표가 고도 서비스로 전달돼요.</p>
        </section>

        <section>
          <h2>3. 이 기기에만 저장하는 정보</h2>
          <p>고른 코스, 진행 중이거나 끝낸 달리기, 러닝 통계, 포인트, 임시 작품, 지도 캐시는 브라우저 또는 앱 안에 있어요. <Link href="/settings">데이터와 계정</Link>에서 직접 지울 수 있어요.</p>
        </section>

        <section>
          <h2>4. 파기 절차와 방법</h2>
          <p>탈퇴하거나 작품을 삭제하면 해당 정보를 데이터베이스에서 바로 지워요. 법령에 따라 따로 보관하는 정보는 없어요. 서비스 제공 업체의 백업에 남은 정보는 해당 업체의 주기에 따라 지워져요.</p>
        </section>

        <section>
          <h2>5. 제3자 제공</h2>
          <p>개인정보를 제3자에게 제공하지 않아요. 대결 상대에게는 계정에서 만든 무작위 러너 이름과 대결 결과만 보여요. 공유 링크는 사용자가 직접 만들 때만 생기고, 링크를 받은 사람은 그 작품방을 볼 수 있어요.</p>
        </section>

        <section>
          <h2>6. 처리 위탁과 외부 서비스</h2>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="외부 서비스 표">
            <table className="policy-table">
              <thead><tr><th scope="col">업체</th><th scope="col">하는 일</th><th scope="col">전달 항목</th></tr></thead>
              <tbody>{VENDORS.map(([name, work, items]) => <tr key={name}><th scope="row">{name}</th><td>{work}</td><td>{items}</td></tr>)}</tbody>
            </table>
          </div>
          <p>이들 중 일부는 해외에서 처리될 수 있어요. 국외 이전 국가, 시기, 방법은 <span className="fill">업체별 이전 국가와 거부 방법 입력 필요</span></p>
        </section>

        <section>
          <h2>7. 만 14세 미만 아동</h2>
          <p>만 14세 미만 아동의 개인정보를 처리하려면 법정대리인의 동의를 받고 확인해야 해요. 확인 방법을 갖추기 전까지 만 14세 미만은 가입을 받지 않아요. 로그인 없는 기능은 쓸 수 있어요.</p>
        </section>

        <section>
          <h2>8. 이용자의 권리</h2>
          <p>이용자와 법정대리인은 언제든 개인정보의 열람, 정정, 삭제, 처리 정지를 요구하고 동의를 철회할 수 있어요. 작품은 작품방에서, 계정은 <Link href="/settings">데이터와 계정</Link>에서 직접 삭제할 수 있고, 그 밖의 요청은 아래 연락처로 보내 주세요.</p>
        </section>

        <section>
          <h2>9. 자동 수집 장치</h2>
          <p>로그인 유지에 필요한 쿠키를 써요. 광고나 행동 분석용 쿠키는 쓰지 않아요. 쿠키를 막으면 로그인이 유지되지 않아요. 브라우저 설정에서 거부하거나 지울 수 있어요. 서버는 요청 수 제한을 위해 IP 주소를 잠시 메모리에서 쓰며, 데이터베이스에 저장하지 않아요.</p>
        </section>

        <section>
          <h2>10. 안전성 확보 조치</h2>
          <p>모든 통신은 HTTPS로 암호화해요. 비밀번호는 인증 서비스가 암호화해 보관하고 앱은 원문을 저장하지 않아요. 데이터베이스는 본인 데이터만 접근하도록 제한하고, 관리자 키는 서버에서만 써요.</p>
        </section>

        <section>
          <h2>11. 개인정보 보호책임자</h2>
          <p>책임자 <Fill value={OPERATOR.officer} label="이름 또는 부서" />, 연락처 <Fill value={OPERATOR.contact} label="전화 또는 이메일" /></p>
          <p>개인정보 침해 상담은 개인정보침해 신고센터(privacy.kisa.or.kr, 국번 없이 118)에도 할 수 있어요.</p>
        </section>

        <section>
          <h2>12. 방침 변경</h2>
          <p>내용이 바뀌면 시행 전에 이 화면에 알리고, 동의가 필요한 변경은 다시 동의를 받아요.</p>
          <p>개인정보처리자 <Fill value={OPERATOR.name} label="상호" />, 시행일 <Fill value={OPERATOR.effectiveDate} label="날짜" />, 판 {POLICY_VERSION}</p>
        </section>
      </div>
    </main>
  );
}
