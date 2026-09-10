import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, X, Wallet, Save, ArrowDownAZ, ArrowUpZA } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import { AppShell, SampleBadge } from "@/components/lms/shell";
import { snapshotQuery } from "@/lib/lms-client";
import { submitRollCall } from "@/lib/lms.functions";
import { formatMoney, todayIso, type LmsSnapshot, type RollCallEntry } from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Session Roll Call | Language Center LMS" },
      {
        name: "description",
        content:
          "Take attendance and record payments for language class sessions on a tablet, synced to Google Sheets.",
      },
      { property: "og:title", content: "Session Roll Call | Language Center LMS" },
      {
        property: "og:description",
        content: "Tablet-first attendance and payment tracking for language centers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery),
  component: RollCallPage,
});

type TrackerBox = "present" | "unpaid" | "absent" | "empty";

function RollCallPage() {
  const { data } = useSuspenseQuery(snapshotQuery);
  const { unlocked } = useAdmin();
  const queryClient = useQueryClient();
  const save = useServerFn(submitRollCall);

  const activeGroups = data.groups.filter((g) => g.status === "active");
  const [groupId, setGroupId] = useState(activeGroups[0]?.id ?? "");
  const [marks, setMarks] = useState<Record<string, RollCallEntry>>({});
  const [sortAsc, setSortAsc] = useState(true);
  const date = todayIso();

  const group = data.groups.find((g) => g.id === groupId);
  const students = useMemo(() => {
    const ids = data.enrollments
      .filter((e) => e.groupId === groupId && e.status === "active")
      .map((e) => e.studentId);
    const list = data.students.filter((s) => ids.includes(s.id));
    return [...list].sort((a, b) =>
      sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
    );
  }, [data, groupId, sortAsc]);

  // Last four recorded sessions per student for the mini tracker.
  const trackerFor = (studentId: string) => {
    const recent = data.attendance
      .filter((a) => a.studentId === studentId && a.groupId === groupId)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-4);
    const boxes: TrackerBox[] = recent.map((a) =>
      a.status === "present" ? (a.paid ? "present" : "unpaid") : "absent",
    );
    while (boxes.length < 4) boxes.unshift("empty");
    return boxes;
  };

  const mutation = useMutation({
    mutationFn: (entries: RollCallEntry[]) => save({ data: { groupId, date, entries } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      queryClient.setQueryData(snapshotQuery.queryKey, snapshot);
      setMarks({});
      toast.success("Session saved");
    },
    onError: () => toast.error("Could not save the session"),
  });

  const entryFor = (id: string): RollCallEntry =>
    marks[id] ?? { studentId: id, status: "present", paid: false };

  const setEntry = (id: string, patch: Partial<RollCallEntry>) =>
    setMarks((prev) => ({ ...prev, [id]: { ...entryFor(id), ...patch } }));

  const dirty = Object.keys(marks).length > 0;

  return (
    <AppShell
      title="Session Roll Call"
      subtitle={`${date}${group ? ` · ${group.name}` : ""}`}
      actions={<SampleBadge source={data.source} />}
    >
      <div className="mb-5 flex flex-wrap gap-2">
        {activeGroups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              setGroupId(g.id);
              setMarks({});
            }}
            className={cn(
              "min-h-12 rounded-2xl px-5 text-base font-semibold transition-colors",
              g.id === groupId
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground",
            )}
          >
            {g.name}
          </button>
        ))}
      </div>

      {!unlocked ? (
        <p className="mb-4 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground">
          Tap the padlock and enter the PIN to record attendance.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!unlocked}
          onClick={() =>
            setMarks(
              Object.fromEntries(
                students.map((s) => [
                  s.id,
                  { ...entryFor(s.id), status: "present" as const },
                ]),
              ),
            )
          }
          className="min-h-12 rounded-2xl bg-secondary px-5 font-semibold text-secondary-foreground disabled:opacity-40"
        >
          Mark all present
        </button>
        <button
          type="button"
          disabled={!unlocked || !dirty}
          onClick={() => setMarks({})}
          className="min-h-12 rounded-2xl bg-secondary px-5 font-semibold text-secondary-foreground disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setSortAsc((v) => !v)}
          className="flex min-h-12 items-center gap-2 rounded-2xl bg-secondary px-5 font-semibold text-secondary-foreground"
        >
          {sortAsc ? <ArrowDownAZ className="size-5" /> : <ArrowUpZA className="size-5" />}
          {sortAsc ? "A–Z" : "Z–A"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs font-semibold text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-md bg-chart-2" /> Attended
        </span>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-md bg-destructive" /> Payment needed
        </span>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-md bg-muted" /> Absent / no session
        </span>
      </div>


      <div className="grid gap-3 pb-24 sm:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => {
          const entry = marks[student.id];
          return (
            <div
              key={student.id}
              className={cn(
                "rounded-3xl border border-border bg-card p-4",
                entry ? "border-primary" : "",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-foreground">{student.name}</p>
                  <p className="text-sm text-muted-foreground">{student.level}</p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-semibold",
                    student.balance < 0
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {formatMoney(student.balance)}
                </span>
              </div>

              <div className="mt-3 flex gap-1.5">
                {trackerFor(student.id).map((box, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-6 flex-1 rounded-md",
                      box === "present" && "bg-chart-2",
                      box === "unpaid" && "bg-destructive",
                      box === "absent" && "bg-muted",
                      box === "empty" && "bg-muted/50",
                    )}
                  />
                ))}
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() =>
                    setEntry(student.id, {
                      status: entryFor(student.id).status === "present" ? "absent" : "present",
                    })
                  }
                  className={cn(
                    "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-semibold disabled:opacity-40",
                    !entry
                      ? "bg-secondary text-secondary-foreground"
                      : entry.status === "present"
                        ? "bg-primary text-primary-foreground"
                        : "bg-destructive text-destructive-foreground",
                  )}
                >
                  {entry?.status === "absent" ? (
                    <>
                      <X className="size-5" /> Absent
                    </>
                  ) : (
                    <>
                      <Check className="size-5" /> {entry ? "Present" : "Mark present"}
                    </>
                  )}
                </button>
              </div>


              <button
                type="button"
                disabled={!unlocked}
                onClick={() => setEntry(student.id, { paid: !entryFor(student.id).paid })}
                className={cn(
                  "mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-semibold disabled:opacity-40",
                  entry?.paid
                    ? "bg-chart-2 text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                <Wallet className="size-5" />
                {entry?.paid
                  ? `Paid ${formatMoney(group?.pricePerSession ?? 0)}`
                  : "Mark payment"}
              </button>
            </div>
          );
        })}
        {students.length === 0 ? (
          <p className="text-muted-foreground">No students enrolled in this group yet.</p>
        ) : null}
      </div>

      {dirty && unlocked ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 flex justify-center px-5">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(students.map((s) => entryFor(s.id)))}
            className="pointer-events-auto flex min-h-14 items-center gap-3 rounded-full bg-primary px-8 text-lg font-bold text-primary-foreground shadow-lg disabled:opacity-60"
          >
            <Save className="size-6" />
            {mutation.isPending ? "Saving…" : `Save all (${Object.keys(marks).length})`}
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}
