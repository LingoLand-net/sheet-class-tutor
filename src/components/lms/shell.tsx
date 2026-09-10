import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Users, GraduationCap, DatabaseBackup, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AdminPadlock, useAdmin } from "@/components/lms/admin-lock";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { seedDemo } from "@/lib/lms.functions";
import { cn } from "@/lib/utils";

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
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <SeedDemoButton />
          <AdminPadlock />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</main>

      <nav className="grid grid-cols-3 gap-2 border-t border-border bg-card px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-sm font-semibold text-muted-foreground transition-colors [&.active]:bg-primary/10 [&.active]:text-primary"
            activeOptions={{ exact: tab.to === "/" }}
          >
            <tab.icon className="size-6" />
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function SampleBadge({ source }: { source: "sheets" | "sample" }) {
  return (
    <span
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold",
        source === "sheets" ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground",
      )}
    >
      {source === "sheets" ? "Google Sheets" : "Sample data"}
    </span>
  );
}
