import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Users, GraduationCap, DatabaseBackup, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import logoAsset from "@/assets/language-center-logo.png.asset.json";
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
      <header className="flex items-center justify-between gap-5 border-b border-border bg-card px-5 py-3.5 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={logoAsset.url}
            alt="Language Center"
            className="size-12 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold text-foreground">{title}</h1>
            {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <SeedDemoButton />
          <AdminPadlock />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
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
    </div>
  );
}

export function SampleBadge({ source }: { source: "sheets" | "sample" }) {
  return (
    <span
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold",
        source === "sheets"
          ? "bg-primary/10 text-primary"
          : "bg-brand-orange/10 text-brand-orange",
      )}
    >
      {source === "sheets" ? "Google Sheets" : "Sample data"}
    </span>
  );
}

function SeedDemoButton() {
  const { unlocked } = useAdmin();
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const seed = useMutation({
    mutationFn: () => seedDemo(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lms-snapshot"] });
      toast.success("Demo data loaded");
    },
    onError: () => toast.error("Could not load demo data"),
  });

  if (!unlocked) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={seed.isPending}
        aria-label="Seed or reset demo data"
        className="flex h-12 min-w-12 items-center gap-2 rounded-2xl bg-secondary px-4 text-base font-semibold text-secondary-foreground transition-colors disabled:opacity-60"
      >
        {seed.isPending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <DatabaseBackup className="size-5" />
        )}
        <span className="hidden lg:inline">Demo data</span>
      </button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Seed / reset demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This erases everything currently in your four sheet tabs and replaces it with a full
              set of sample classes, students, attendance and payments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-12 rounded-2xl">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-12 rounded-2xl" onClick={() => seed.mutate()}>
              Replace with demo data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
