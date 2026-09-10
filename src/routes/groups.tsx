import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Plus, RotateCcw, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import { AppShell, SampleBadge } from "@/components/lms/shell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { snapshotQuery } from "@/lib/lms-client";
import { saveGroup, toggleGroupStatus } from "@/lib/lms.functions";
import { formatMoney, type Group, type LmsSnapshot } from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Group Moderator | Language Center LMS" },
      {
        name: "description",
        content: "Create, edit, and archive language class groups with teachers, schedules, and pricing.",
      },
      { property: "og:title", content: "Group Moderator | Language Center LMS" },
      {
        property: "og:description",
        content: "Manage class groups, teachers, schedules, and session pricing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery),
  component: GroupsPage,
});

type Draft = Omit<Group, "id"> & { id?: string };

const emptyDraft: Draft = {
  name: "",
  level: "",
  teacher: "",
  schedule: "",
  pricePerSession: 10,
  status: "active",
};

function GroupsPage() {
  const { data } = useSuspenseQuery(snapshotQuery);
  const { unlocked } = useAdmin();
  const queryClient = useQueryClient();
  const persist = useServerFn(saveGroup);
  const setStatus = useServerFn(toggleGroupStatus);
  const [draft, setDraft] = useState<Draft | null>(null);

  const onSuccess = (snapshot: LmsSnapshot) => {
    queryClient.setQueryData(snapshotQuery.queryKey, snapshot);
  };

  const saveMutation = useMutation({
    mutationFn: (group: Draft) => persist({ data: group }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setDraft(null);
      toast.success("Group saved");
    },
    onError: () => toast.error("Could not save the group"),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: Group["status"] }) => setStatus({ data: input }),
    onSuccess,
    onError: () => toast.error("Could not update the group"),
  });

  const countFor = (groupId: string) =>
    data.enrollments.filter((e) => e.groupId === groupId && e.status === "active").length;

  return (
    <AppShell
      title="Group Moderator"
      subtitle={`${data.groups.filter((g) => g.status === "active").length} active groups`}
      actions={
        <>
          <SampleBadge source={data.source} />
          <button
            type="button"
            disabled={!unlocked}
            onClick={() => setDraft({ ...emptyDraft })}
            className="flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Plus className="size-5" /> New
          </button>
        </>
      }
    >
      <div className="grid gap-3 pb-8 sm:grid-cols-2 xl:grid-cols-3">
        {data.groups.map((group) => (
          <div
            key={group.id}
            className={cn(
              "rounded-3xl border border-border bg-card p-5",
              group.status === "archived" && "opacity-60",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-foreground">{group.name}</h2>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                {group.level}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{group.teacher}</p>
            <p className="text-sm text-muted-foreground">{group.schedule}</p>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {formatMoney(group.pricePerSession)} / session · {countFor(group.id)} students
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={!unlocked}
                onClick={() => setDraft({ ...group })}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-secondary font-semibold text-secondary-foreground disabled:opacity-40"
              >
                <Pencil className="size-5" /> Edit
              </button>
              <button
                type="button"
                disabled={!unlocked || statusMutation.isPending}
                onClick={() =>
                  statusMutation.mutate({
                    id: group.id,
                    status: group.status === "active" ? "archived" : "active",
                  })
                }
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-secondary font-semibold text-secondary-foreground disabled:opacity-40"
              >
                {group.status === "active" ? (
                  <>
                    <Archive className="size-5" /> Archive
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-5" /> Activate
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={!unlocked || deleteMutation.isPending}
                onClick={() => setPendingDelete(group)}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-destructive/10 font-semibold text-destructive disabled:opacity-40"
              >
                <Trash2 className="size-5" /> Delete
              </button>
            </div>
          </div>
        ))}
        {data.groups.length === 0 ? (
          <p className="text-muted-foreground">
            No groups yet. Unlock with the padlock and tap New to add your first class.
          </p>
        ) : null}
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">{draft?.id ? "Edit group" : "New group"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-4">
              <Field label="Group name">
                <Input
                  className="h-12 text-base"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Level">
                  <Input
                    className="h-12 text-base"
                    value={draft.level}
                    onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                  />
                </Field>
                <Field label="Price per session">
                  <Input
                    className="h-12 text-base"
                    inputMode="decimal"
                    value={String(draft.pricePerSession)}
                    onChange={(e) =>
                      setDraft({ ...draft, pricePerSession: Number(e.target.value) || 0 })
                    }
                  />
                </Field>
              </div>
              <Field label="Teacher">
                <Input
                  className="h-12 text-base"
                  value={draft.teacher}
                  onChange={(e) => setDraft({ ...draft, teacher: e.target.value })}
                />
              </Field>
              <Field label="Schedule">
                <Input
                  className="h-12 text-base"
                  placeholder="Mon/Wed 18:00"
                  value={draft.schedule}
                  onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                />
              </Field>
              <button
                type="button"
                disabled={!draft.name || saveMutation.isPending}
                onClick={() => saveMutation.mutate(draft)}
                className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
              >
                {saveMutation.isPending ? "Saving…" : "Save group"}
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
    </div>
  );
}
