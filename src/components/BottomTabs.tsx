"use client";
// 앱 하단 탭 (데스크톱에서는 CSS로 상단 바가 된다)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark, Icon, type IconName } from "./Icon";

const TABS: Array<{ href: string; label: string; icon: IconName; also: string[] }> = [
  { href: "/", label: "메인", icon: "home", also: [] },
  { href: "/routes", label: "러닝", icon: "route", also: ["/running"] },
  { href: "/hub", label: "콘텐츠", icon: "grid", also: ["/room", "/duel", "/derby", "/settings"] },
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
        const on = t.href === "/" ? pathname === "/" : [t.href, ...t.also].some((p) => pathname.startsWith(p));
        return (
          <Link key={t.href} href={t.href} className="tabbar-item" aria-current={on ? "page" : undefined}>
            <span className="tabbar-pill">
              <Icon name={t.icon} size={22} />
            </span>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
