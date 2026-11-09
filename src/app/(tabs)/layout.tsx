import { BottomTabs } from "@/components/BottomTabs";

// 탭이 있는 화면(홈·달리기·작품방)만 이 그룹에 둔다. /routes·/run·/contents·/share는 그룹 밖이라 탭이 아예 없고,
// 조건부 래핑이 없으므로 지도·GPS가 탭 표시 때문에 다시 만들어지지 않는다.
export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tab-shell">
      {children}
      <BottomTabs />
    </div>
  );
}
