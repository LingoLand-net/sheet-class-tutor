import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownAZ,
  ArrowUpZA,
  ChevronLeft,
  ChevronRight,
  Save,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import { AppShell, SampleBadge } from "@/components/lms/shell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { snapshotQuery } from "@/lib/lms-client";
import { getStudentHistory, submitRollCall } from "@/lib/lms.functions";
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

const WINDOW_OPTIONS = [4, 6, 8, 12] as const;

function RollCallPage() {
  const { data } = useSuspenseQuery(snapshotQuery);
  const { unlocked } = useAdmin();
  const queryClient = useQueryClient();
  const save = useServerFn(submitRollCall);

  const activeGroups = data.groups.filter((g) => g.status === "active");
  const [groupId, setGroupId] = useState(activeGroups[0]?.id ?? "");
  const [marks, setMarks] = useState<Record<string, RollCallEntry>>({});
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState("");
  const [boxCount, setBoxCount] = useState<number>(4);
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  const [historyStudent, setHistoryStudent] = useState<{ id: string; name: string } | null>(null);

  const group = data.groups.find((g) => g.id === groupId);

  // Every session date recorded for this group, plus today.
  const sessionDates = useMemo(() => {
    const dates = new Set(
      data.attendance.filter((a) => a.groupId === groupId).map((a) => a.date),
    );
    dates.add(todayIso());
    return [...dates].sort();
  }, [data.attendance, groupId]);

  const activeDate = sessionDate ?? sessionDates[sessionDates.length - 1] ?? todayIso();
  const dateIndex = sessionDates.indexOf(activeDate);

  // The window of sessions the boxes show: `boxCount` sessions ending on the selected date.
  const windowDates = useMemo(() => {
    const upTo = sessionDates.slice(0, dateIndex + 1);
    const slice = upTo.slice(-boxCount);
    return [...Array<null>(Math.max(0, boxCount - slice.length)).fill(null), ...slice];
  }, [sessionDates, dateIndex, boxCount]);

  const students = useMemo(() => {
    const ids = data.enrollments
      .filter((e) => e.groupId === groupId && e.status === "active")
      .map((e) => e.studentId);
    const term = search.trim().toLowerCase();
    const list = data.students.filter(
      (s) => ids.includes(s.id) && s.name.toLowerCase().includes(term),
    );
    return [...list].sort((a, b) =>
      sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
    );
  }, [data, groupId, sortAsc, search]);

  const recordFor = (studentId: string, date: string | null) =>
    date
      ? data.attendance.find(
          (a) => a.studentId === studentId && a.groupId === groupId && a.date === date,
        )
      : undefined;

  const mutation = useMutation({
    mutationFn: (entries: RollCallEntry[]) =>
      save({ data: { groupId, date: activeDate, entries } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      queryClient.setQueryData(snapshotQuery.queryKey, snapshot);
      setMarks({});
      toast.success("Session saved");
    },
    onError: () => toast.error("Could not save the session"),
  });

  // Current value for the selected session: unsaved mark, else saved record, else blank.
  const currentFor = (studentId: string): RollCallEntry | null => {
    const mark = marks[studentId];
    if (mark) return mark;
    const record = recordFor(studentId, activeDate);
    if (!record) return null;
    return { studentId, status: record.status, paid: record.paid };
  };

  const setEntry = (studentId: string, patch: Partial<RollCallEntry>) =>
    setMarks((prev) => {
      const base = currentFor(studentId) ?? {
        studentId,
        status: "present" as const,
        paid: false,
      };
      return { ...prev, [studentId]: { ...base, ...patch } };
    });

  const cycleAttendance = (studentId: string) => {
    const current = currentFor(studentId);
    if (!current) return setEntry(studentId, { status: "present" });
    return setEntry(studentId, { status: current.status === "present" ? "absent" : "present" });
  };

  const dirty = Object.keys(marks).length > 0;

  const stepDate = (delta: number) => {
    const next = sessionDates[dateIndex + delta];
    if (next) {
      setSessionDate(next);
      setMarks({});
    }
  };

  return (
    <AppShell
      title="Session Roll Call"
      subtitle={`${activeDate}${group ? ` · ${group.name}` : ""}`}
      actions={<SampleBadge source={data.source} />}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {activeGroups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              setGroupId(g.id);
              setMarks({});
              setSessionDate(null);
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

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute top-3.5 left-4 size-5 text-muted-foreground" />
          <Input
            className="h-12 rounded-2xl pl-12 text-base"
            placeholder="Search students by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl bg-secondary p-1">
            <button
              type="button"
              aria-label="Previous session"
              disabled={dateIndex <= 0}
              onClick={() => stepDate(-1)}
              className="flex size-11 items-center justify-center rounded-xl text-secondary-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-6" />
            </button>
            <select
              aria-label="Session date"
              value={activeDate}
              onChange={(e) => {
                setSessionDate(e.target.value);
                setMarks({});
              }}
              className="h-11 rounded-xl bg-transparent px-2 text-base font-semibold text-secondary-foreground"
            >
              {sessionDates.map((d) => (
                <option key={d} value={d}>
                  {d === todayIso() ? `${d} (today)` : d}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next session"
              disabled={dateIndex >= sessionDates.length - 1}
              onClick={() => stepDate(1)}
              className="flex size-11 items-center justify-center rounded-xl text-secondary-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-6" />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-2xl bg-secondary p-1">
            <span className="px-2 text-sm font-semibold text-muted-foreground">Sessions shown</span>
            {WINDOW_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setBoxCount(n)}
                className={cn(
                  "min-h-11 min-w-11 rounded-xl px-3 font-bold",
                  n === boxCount
                    ? "bg-primary text-primary-foreground"
                    : "text-secondary-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSortAsc((v) => !v)}
            className="flex min-h-12 items-center gap-2 rounded-2xl bg-secondary px-4 font-semibold text-secondary-foreground"
          >
            {sortAsc ? <ArrowDownAZ className="size-5" /> : <ArrowUpZA className="size-5" />}
            {sortAsc ? "A–Z" : "Z–A"}
          </button>
        </div>
      </div>

      {!unlocked ? (
        <p className="mb-4 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground">
          Tap the padlock and enter the PIN to record attendance and payments.
        </p>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setMarks(
                Object.fromEntries(
                  students.map((s) => [
                    s.id,
                    {
                      ...(currentFor(s.id) ?? { studentId: s.id, paid: false }),
                      studentId: s.id,
                      status: "present" as const,
                    },
                  ]),
                ),
              )
            }
            className="min-h-12 rounded-2xl bg-secondary px-5 font-semibold text-secondary-foreground"
          >
            Mark all present
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => setMarks({})}
            className="min-h-12 rounded-2xl bg-secondary px-5 font-semibold text-secondary-foreground disabled:opacity-40"
          >
            Undo changes
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-md bg-brand-orange" /> Present (top row)
        </span>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-md bg-sage" /> Absent (top) · Paid (bottom)
        </span>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-md bg-destructive" /> Unpaid (bottom row)
        </span>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-md bg-muted" /> Nothing recorded
        </span>
        <span>Top row is attendance, bottom row is payment.</span>
      </div>


      <div className="grid gap-3 pb-28 sm:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => {
          const current = currentFor(student.id);
          const changed = Boolean(marks[student.id]);
          return (
            <div
              key={student.id}
              className={cn(
                "rounded-3xl border border-border bg-card p-4",
                changed && "border-primary",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-foreground">{student.name}</p>
                  <p className="text-sm text-muted-foreground">{student.level}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryStudent({ id: student.id, name: student.name })}
                  className="min-h-11 shrink-0 rounded-full bg-secondary px-4 text-sm font-semibold text-secondary-foreground"
                >
                  Show
                </button>
              </div>

              <BoxRow
                label="Attendance"
                dates={windowDates}
                activeDate={activeDate}
                disabled={!unlocked}
                onToggle={() => cycleAttendance(student.id)}
                colorFor={(date) => {
                  const value =
                    date === activeDate ? current : recordFor(student.id, date) ?? null;
                  if (!value) return "bg-muted";
                  return value.status === "present" ? "bg-brand-orange" : "bg-sage";
                }}
              />

              <BoxRow
                label="Payment"
                dates={windowDates}
                activeDate={activeDate}
                disabled={!unlocked}
                onToggle={() =>
                  setEntry(student.id, { paid: !(currentFor(student.id)?.paid ?? false) })
                }
                colorFor={(date) => {
                  const value =
                    date === activeDate ? current : recordFor(student.id, date) ?? null;
                  if (!value) return "bg-muted";
                  return value.paid ? "bg-sage" : "bg-destructive";
                }}
              />
            </div>
          );
        })}
        {students.length === 0 ? (
          <p className="text-muted-foreground">
            {search ? "No student matches that name." : "No students enrolled in this group yet."}
          </p>
        ) : null}
      </div>

      {dirty && unlocked ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 flex justify-center px-5">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                Object.keys(marks)
                  .map((id) => currentFor(id))
                  .filter((entry): entry is RollCallEntry => entry !== null),
              )
            }
            className="pointer-events-auto flex min-h-14 items-center gap-3 rounded-full bg-primary px-8 text-lg font-bold text-primary-foreground shadow-lg disabled:opacity-60"
          >
            <Save className="size-6" />
            {mutation.isPending ? "Saving…" : `Save ${Object.keys(marks).length} change(s)`}
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}

function BoxRow({
  label,
  dates,
  activeDate,
  disabled,
  colorFor,
  onToggle,
}: {
  label: string;
  dates: (string | null)[];
  activeDate: string;
  disabled: boolean;
  colorFor: (date: string | null) => string;
  onToggle: () => void;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex gap-1.5">
        {dates.map((date, i) => {
          const editable = date === activeDate && !disabled;
          return (
            <button
              key={`${date ?? "empty"}-${i}`}
              type="button"
              disabled={!editable}
              title={date ?? "No session"}
              aria-label={`${label} ${date ?? "no session"}`}
              onClick={onToggle}
              className={cn(
                "h-9 flex-1 rounded-lg transition-colors",
                date ? colorFor(date) : "bg-muted/40",
                editable && "ring-2 ring-foreground/30",
                !date && "opacity-50",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
