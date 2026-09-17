import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Plus, RotateCcw, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import {
  ErrorScreen,
  LoadingScreen,
  LockedScreen,
} from "@/components/lms/require-auth";
import { AppShell } from "@/components/lms/shell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getStoredToken } from "@/lib/auth-client";
import { snapshotQuery } from "@/lib/lms-client";
import { removeGroup, saveGroup, toggleGroupStatus } from "@/lib/lms.functions";
import { formatMoney, perSessionPrice, type Group, type LmsSnapshot } from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Group Moderator | Language Center LMS" },
      {
        name: "description",
        content:
          "Create, edit, and archive language class groups with teachers, schedules, and pricing.",
      },
      { property: "og:title", content: "Group Moderator | Language Center LMS" },
      {
        property: "og:description",
        content: "Manage class groups, teachers, schedules, and session pricing.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: GroupsPage,
});

type Draft = Omit<Group, "id"> & { id?: string };

const emptyDraft: Draft = {
  name: "",
  level: "",
  teacher: "",
  schedule: "",
  pricePerMonth: 100,
  sessionsPerMonth: 8,
  status: "active",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = (typeof DAYS)[number];

const TIME_RE = /(\d{1,2}):(\d{2})/;

function parseSchedule(s: string): { days: Day[]; time: string } {
  const days: Day[] = [];
  for (const d of DAYS) {
    if (s.includes(d)) days.push(d);
  }
  const m = s.match(TIME_RE);
  return { days, time: m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : "" };
}

function formatTimeDisplay(t: string): string {
  const m = t.match(TIME_RE);
  if (!m) return t;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${ampm}`;
}

function buildSchedule(days: Day[], time: string): string {
  const parts: string[] = [];
  if (days.length > 0) parts.push(days.join(" · "));
  if (time) parts.push(formatTimeDisplay(time));
  return parts.join(" · ");
}

function GroupsPage() {
  const { unlocked } = useAdmin();
  const query = useQuery({ ...snapshotQuery, enabled: unlocked });

  if (!unlocked) return <LockedScreen title="Group Moderator" />;
  if (query.isPending) return <LoadingScreen title="Group Moderator" />;
  if (query.isError || !query.data) return <ErrorScreen title="Group Moderator" />;

  return <GroupsBody data={query.data} />;
}

function GroupsBody({ data }: { data: LmsSnapshot }) {
  const { unlocked } = useAdmin();
  const queryClient = useQueryClient();
  const persist = useServerFn(saveGroup);
  const setStatus = useServerFn(toggleGroupStatus);
  const destroy = useServerFn(removeGroup);
  const token = getStoredToken() ?? "";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);

  const onSuccess = (snapshot: LmsSnapshot) => {
    queryClient.setQueryData(snapshotQuery.queryKey, snapshot);
  };

  const saveMutation = useMutation({
    mutationFn: (group: Draft) => persist({ data: { token, ...group } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setDraft(null);
      toast.success("Group saved");
    },
    onError: () => toast.error("Could not save the group"),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: Group["status"] }) =>
      setStatus({ data: { token, ...input } }),
    onSuccess,
    onError: () => toast.error("Could not update the group"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => destroy({ data: { token, id } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setPendingDelete(null);
      toast.success("Group deleted");
    },
    onError: () => toast.error("Could not delete the group"),
  });

  const enrollmentCountByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of data.enrollments) {
      if (e.status !== "active") continue;
      map.set(e.groupId, (map.get(e.groupId) ?? 0) + 1);
    }
    return map;
  }, [data.enrollments]);

  const countFor = (groupId: string) => enrollmentCountByGroup.get(groupId) ?? 0;

  const canSave =
    draft !== null &&
    draft.name.trim() !== "" &&
    draft.level.trim() !== "" &&
    draft.teacher.trim() !== "" &&
    draft.schedule.trim() !== "" &&
    draft.pricePerMonth >= 0 &&
    draft.sessionsPerMonth > 0;

  const parsedDraft = draft ? parseSchedule(draft.schedule) : { days: [], time: "" };

  const toggleDay = (d: Day) => {
    if (!draft) return;
    const { days, time } = parseSchedule(draft.schedule);
    const next = days.includes(d)
      ? days.filter((x) => x !== d)
      : [...days, d].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    setDraft({ ...draft, schedule: buildSchedule(next as Day[], time) });
  };

  const setTime = (time: string) => {
    if (!draft) return;
    const { days } = parseSchedule(draft.schedule);
    setDraft({ ...draft, schedule: buildSchedule(days, time) });
  };

  const preview = draft ? perSessionPrice(draft as Group) : 0;

  return (
    <AppShell
      title="Group Moderator"
      subtitle={`${data.groups.filter((g) => g.status === "active").length} active groups`}
      actions={
        <button
          type="button"
          disabled={!unlocked}
          onClick={() => setDraft({ ...emptyDraft })}
          className="flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-40"
        >
          <Plus className="size-5" /> New group
        </button>
      }
    >
      <div className="grid gap-3 pb-8 sm:grid-cols-2 xl:grid-cols-3">
        {data.groups.map((group) => (
          <div
            key={group.id}
            className={cn(
              "rounded-3xl border border-border bg-card p-5 shadow-sm",
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
              {formatMoney(group.pricePerMonth)} / month
            </p>
            <p className="text-xs text-muted-foreground">
              ≈ {formatMoney(perSessionPrice(group))} per session · {group.sessionsPerMonth}
              /month · {countFor(group.id)} students
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
            No groups yet. Unlock with the padlock and tap New group to add the first class.
          </p>
        ) : null}
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {draft?.id ? "Edit group" : "New group"}
            </DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-5">
              <Field label="Group name">
                <Input
                  className="h-12 text-base"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Level">
                  <Input
                    className="h-12 text-base"
                    placeholder="A1, B2…"
                    value={draft.level}
                    onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                  />
                </Field>
                <Field label="Teacher">
                  <Input
                    className="h-12 text-base"
                    value={draft.teacher}
                    onChange={(e) => setDraft({ ...draft, teacher: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid gap-3 rounded-2xl border border-border p-4">
                <Label className="text-sm font-semibold">Schedule</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => {
                    const active = parsedDraft.days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={cn(
                          "min-h-11 min-w-14 rounded-xl px-3 text-sm font-semibold transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Start time
                  </Label>
                  <Input
                    type="time"
                    className="h-12 w-40 text-base"
                    value={parsedDraft.time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
                {draft.schedule ? (
                  <p className="rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground">
                    {draft.schedule}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Pick days and a start time. The schedule shows in the group card.
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Price per month">
                  <Input
                    className="h-12 text-base"
                    inputMode="decimal"
                    value={String(draft.pricePerMonth)}
                    onChange={(e) =>
                      setDraft({ ...draft, pricePerMonth: Number(e.target.value) || 0 })
                    }
                  />
                </Field>
                <Field label="Sessions per month">
                  <Input
                    className="h-12 text-base"
                    inputMode="numeric"
                    value={String(draft.sessionsPerMonth)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sessionsPerMonth: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                </Field>
              </div>

              <p className="rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground">
                Each present or absent student is charged{" "}
                <span className="font-bold">{formatMoney(preview)}</span> per session.
              </p>

              <button
                type="button"
                disabled={!canSave || saveMutation.isPending}
                onClick={() => saveMutation.mutate(draft)}
                className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
              >
                {saveMutation.isPending ? "Saving…" : "Save group"}
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Delete {pendingDelete?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the group, its enrollments, and its attendance history from the sheet.
            This cannot be undone.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="min-h-14 rounded-2xl bg-secondary font-bold text-secondary-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
              className="min-h-14 rounded-2xl bg-destructive font-bold text-destructive-foreground disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
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