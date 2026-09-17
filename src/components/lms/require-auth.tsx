import { AlertCircle, Loader2, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/lms/shell";

export function LockedScreen({ title }: { title: string }) {
  return (
    <AppShell title={title} subtitle="Locked">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
          <Lock className="size-8 text-muted-foreground" />
        </div>
        <p className="text-lg font-semibold text-foreground">Content locked</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Tap the padlock button in the bottom-right corner and enter your PIN to view this page.
        </p>
      </div>
    </AppShell>
  );
}

export function LoadingScreen({ title }: { title: string }) {
  return (
    <AppShell title={title} subtitle="Loading…">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </AppShell>
  );
}

export function ErrorScreen({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <AppShell title={title} subtitle="Error">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertCircle className="size-8 text-destructive" />
        </div>
        <p className="text-lg font-semibold text-foreground">Could not load data</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {children ?? "Check your connection and try again."}
        </p>
      </div>
    </AppShell>
  );
}