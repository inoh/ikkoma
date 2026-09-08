import Link from "next/link";

const TABS = [
  { href: "/", label: "今日" },
  { href: "/topics", label: "トピック" },
  { href: "/weaknesses", label: "弱点" },
  { href: "/dashboard", label: "記録" },
] as const;

export function TabBar({ active }: { active: string }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} data-active={t.href === active}>
          <i /><span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
