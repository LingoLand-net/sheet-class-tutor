import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Users, GraduationCap } from "lucide-react";
import type { ReactNode } from "react";

import logoAsset from "@/assets/language-center-logo.png.asset.json";
import { AdminPadlock } from "@/components/lms/admin-lock";

const TABS = [
  { to: "/", label: "Roll Call", icon: ClipboardCheck },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/students", label: "Students", icon: GraduationCap },
] as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-6 sm:px-7 sm:pt-6">
        <div className="mx-auto w-full max-w-[1180px]">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold text-foreground sm:text-2xl">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="truncate text-xs text-muted-foreground sm:text-sm">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            </div>
            {actions ? (
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            ) : null}
          </header>
          {children}
        </div>
      </main>

      <nav className="grid grid-cols-3 gap-3 border-t border-border bg-card px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-7">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-sm font-semibold text-muted-foreground transition-colors [&.active]:bg-primary/10 [&.active]:text-primary [&.active]:after:absolute [&.active]:after:top-1.5 [&.active]:after:size-1.5 [&.active]:after:rounded-full [&.active]:after:bg-brand-orange"
            activeOptions={{ exact: tab.to === "/" }}
          >
            <tab.icon className="size-6" />
            {tab.label}
          </Link>
        ))}
      </nav>

      {/* Floating admin padlock, above the bottom nav */}
      <div className="pointer-events-none fixed right-4 bottom-[92px] z-40 sm:right-6">
        <div className="pointer-events-auto">
          <AdminPadlock />
        </div>
      </div>
    </div>
  );
}