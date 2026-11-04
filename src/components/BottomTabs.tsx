"use client";
// 앱 하단 탭 (데스크톱에서는 CSS로 상단 바가 된다)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark, Icon, type IconName } from "./Icon";

const TABS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "홈", icon: "home" },
  { href: "/running", label: "달리기", icon: "run" },
  { href: "/room", label: "작품방", icon: "frame" },
];

export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      <span className="tabbar-brand" aria-hidden="true">
        <BrandMark size={26} />
        요런
      </span>
      {TABS.map((t) => {
        const on = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className="tabbar-item" aria-current={on ? "page" : undefined}>
            <Icon name={t.icon} size={24} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
