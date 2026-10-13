import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, Users, GraduationCap, FlaskConical } from "lucide-react";
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
import { getStoredToken } from "@/lib/auth-client";
import { seedTestData } from "@/lib/lms.functions";
import { snapshotQuery } from "@/lib/lms-client";

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
              <img
                src="/favicon.png"
                alt="Language Center"
                className="size-11 shrink-0 object-contain"
              />
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

      <div className="pointer-events-none fixed right-4 bottom-[92px] z-40 sm:right-6">
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <SeedButton />
          <AdminPadlock />
        </div>
      </div>
    </div>
  );
}

function SeedButton() {
  const { unlocked } = useAdmin();
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const seed = useServerFn(seedTestData);

  const mutation = useMutation({
    mutationFn: () => {
      const token = getStoredToken() ?? "";
      return seed({ data: { token } });
    },
    onSuccess: (snap) => {
      queryClient.setQueryData(snapshotQuery.queryKey, snap);
      toast.success("Test data loaded");
      setConfirming(false);
    },
    onError: () => toast.error("Could not seed"),
  });

  if (!unlocked) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={mutation.isPending}
        aria-label="Seed test data"
        className="flex h-12 min-w-12 items-center gap-2 rounded-2xl bg-brand-orange px-4 text-base font-semibold text-brand-orange-foreground shadow-md disabled:opacity-60"
      >
        <FlaskConical className="size-5" />
        <span className="hidden sm:inline">Test data</span>
      </button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace everything with test data?</AlertDialogTitle>
            <AlertDialogDescription>
              This wipes all groups, students, enrollments, sessions, and attendance in the
              sheet, then fills it with realistic test data — 5 groups, ~24 students, and
              randomized attendance and payment history. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-12 rounded-2xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-12 rounded-2xl bg-brand-orange text-brand-orange-foreground"
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Seeding…" : "Wipe and seed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}