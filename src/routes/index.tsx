import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownAZ,
  ArrowUpZA,
  CalendarClock,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Save,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import { AppShell } from "@/components/lms/shell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { snapshotQuery } from "@/lib/lms-client";
import {
  cancelRollCallSession,
  clearRollCallSession,
  getStudentHistory,
  rescheduleRollCallSession,
  submitRollCall,
} from "@/lib/lms.functions";
import {
  formatMoney,
  perSessionPrice,
  todayIso,
  type AttendanceRecord,
  type AttendanceStatus,
  type LmsSnapshot,
  type RollCallEntry,
} from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Session Roll Call | Language Center LMS" },
      {
        name: "description",
        content:
          "Take attendance and view payment status for language class sessions on a tablet, synced to Google Sheets.",
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

type MarkStatus = "present" | "absent" | "skipped";
const CYCLE: readonly (MarkStatus | null)[] = [null, "present", "absent", "skipped"];

function labelFor(status: AttendanceStatus | null): string {
  switch (status) {
    case "present":   return "Present";
    case "absent":    return "Absent";
    case "skipped":   return "Skipped";
    case "cancelled": return "Cancelled";
    default:          return "Not set";
  }
}

function RollCallPage() {
  const { data } = useSuspenseQuery(snapshotQuery);
  const { unlocked } = useAdmin();
  const queryClient = useQueryClient();
  const save = useServerFn(submitRollCall);
  const cancelSession = useServerFn(cancelRollCallSession);
  const clearSession = useServerFn(clearRollCallSession);
  const rescheduleSession = useServerFn(rescheduleRollCallSession);

  const activeGroups = data.groups.filter((g) => g.status === "active");
  const [groupId, setGroupId] = useState(activeGroups[0]?.id ?? "");
  const [marks, setMarks] = useState<Record<string, MarkStatus>>({});
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState("");
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  const [historyStudent, setHistoryStudent] = useState<{ id: string; name: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");

  const group = data.groups.find((g) => g.id === groupId);
  const perSession = perSessionPrice(group);

  const sessionDates = useMemo(() => {
    const dates = new Set(
      data.attendance.filter((a) => a.groupId === groupId).map((a) => a.date),
    );
    dates.add(todayIso());
    return [...dates].sort();
  }, [data.attendance, groupId]);

  const activeDate = sessionDate ?? sessionDates[sessionDates.length - 1] ?? todayIso();
  const dateIndex = sessionDates.indexOf(activeDate);

  const historyDates = useMemo(() => {
    const upTo = sessionDates.slice(0, dateIndex + 1);
    return upTo.slice(-12);
  }, [sessionDates, dateIndex]);

  const attendanceIndex = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const a of data.attendance) {
      if (a.groupId !== groupId) continue;
      map.set(`${a.studentId}|${a.date}`, a);
    }
    return map;
  }, [data.attendance, groupId]);

  const enrolled = useMemo(() => {
    const ids = new Set(
      data.enrollments
        .filter((e) => e.groupId === groupId && e.status === "active")
        .map((e) => e.studentId),
    );
    return data.students.filter((s) => ids.has(s.id));
  }, [data.enrollments, data.students, groupId]);

  const visibleStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term ? enrolled.filter((s) => s.name.toLowerCase().includes(term)) : enrolled;
    return [...list].sort((a, b) =>
      sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
    );
  }, [enrolled, sortAsc, search]);

  const recordFor = (studentId: string, date: string | null) =>
    date ? attendanceIndex.get(`${studentId}|${date}`) : undefined;

  const statusFor = (studentId: string): AttendanceStatus | null => {
    const mark = marks[studentId];
    if (mark) return mark;
    return recordFor(studentId, activeDate)?.status ?? null;
  };

  const sessionCancelled = useMemo(() => {
    if (!activeDate || enrolled.length === 0) return false;
    let cancelled = 0;
    for (const s of enrolled) {
      if (attendanceIndex.get(`${s.id}|${activeDate}`)?.status === "cancelled") cancelled++;
    }
    return cancelled === enrolled.length;
  }, [enrolled, activeDate, attendanceIndex]);

  const dirty = Object.keys(marks).length > 0;
  const hasSaved = enrolled.some((s) => recordFor(s.id, activeDate) !== undefined);

  const applySnapshot = (snapshot: LmsSnapshot) => {
    queryClient.setQueryData(snapshotQuery.queryKey, snapshot);
    setMarks({});
  };

  const saveMutation = useMutation({
    mutationFn: (entries: RollCallEntry[]) =>
      save({ data: { groupId, date: activeDate, entries } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      applySnapshot(snapshot);
      toast.success("Session saved");
    },
    onError: () => toast.error("Could not save the session"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelSession({ data: { groupId, date: activeDate } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      applySnapshot(snapshot);
      setCancelOpen(false);
      toast.success("Session cancelled");
    },
    onError: () => toast.error("Could not cancel the session"),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearSession({ data: { groupId, date: activeDate } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      applySnapshot(snapshot);
      setClearOpen(false);
      toast.success("Session cleared");
    },
    onError: () => toast.error("Could not clear the session"),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (toDate: string) =>
      rescheduleSession({ data: { groupId, fromDate: activeDate, toDate } }),
    onSuccess: (snapshot: LmsSnapshot, toDate) => {
      applySnapshot(snapshot);
      setSessionDate(toDate);
      setRescheduleOpen(false);
      toast.success("Session rescheduled");
    },
    onError: () => toast.error("Could not reschedule the session"),
  });

  const saveAll = () => {
    const entries: RollCallEntry[] = enrolled.map((s) => ({
      studentId: s.id,
      status: statusFor(s.id) ?? "absent",
    }));
    saveMutation.mutate(entries);
  };

  const cycleStatus = (studentId: string) => {
    const current = statusFor(studentId);
    setMarks((prev) => {
      const effective: MarkStatus | null =
        current === "cancelled" ? null : (current as MarkStatus | null);
      const idx = CYCLE.indexOf(effective);
      const next = CYCLE[(idx + 1) % CYCLE.length] ?? null;
      const out = { ...prev };
      if (next === null) delete out[studentId];
      else out[studentId] = next;
      return out;
    });
  };

  const setAll = (status: MarkStatus) =>
    setMarks(Object.fromEntries(enrolled.map((s) => [s.id, status])));

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
      subtitle={
        group
          ? `${activeDate} · ${group.name} · ${formatMoney(perSession)}/session`
          : activeDate
      }
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
          Tap the padlock and enter the PIN to record attendance and manage sessions.
        </p>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAll("present")}
            className="min-h-12 rounded-2xl bg-brand-orange/15 px-5 font-semibold text-brand-orange"
          >
            Mark all present
          </button>
          <button
            type="button"
            onClick={() => setAll("absent")}
            className="min-h-12 rounded-2xl bg-destructive/10 px-5 font-semibold text-destructive"
          >
            Mark all absent
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => setMarks({})}
            className="min-h-12 rounded-2xl bg-secondary px-5 font-semibold text-secondary-foreground disabled:opacity-40"
          >
            Undo changes
          </button>

          <div className="flex-1" />

          <button
            type="button"
            disabled={rescheduleMutation.isPending || cancelMutation.isPending}
            onClick={() => {
              setRescheduleDate(activeDate);
              setRescheduleOpen(true);
            }}
            className="flex min-h-12 items-center gap-2 rounded-2xl bg-secondary px-5 font-semibold text-secondary-foreground disabled:opacity-40"
          >
            <CalendarClock className="size-5" />
            Reschedule
          </button>
          <button
            type="button"
            disabled={cancelMutation.isPending || saveMutation.isPending}
            onClick={() => setCancelOpen(true)}
            className="flex min-h-12 items-center gap-2 rounded-2xl bg-destructive/10 px-5 font-semibold text-destructive disabled:opacity-40"
          >
            <CalendarX className="size-5" />
            Cancel session
          </button>
        </div>
      )}

      {sessionCancelled ? (
        <p className="mb-4 rounded-2xl bg-muted px-4 py-3 text-sm font-medium text-muted-foreground">
          This session is cancelled. No fees were charged. Tap any student to restore attendance.
        </p>
      ) : null}

      <div className="overflow-x-auto border border-border bg-card shadow-sm">
        <table className="w-full min-w-[780px] border-collapse text-sm">
          <thead className="bg-secondary/60 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-3 py-3">Attendance</th>
              <th className="px-3 py-3">Payment</th>
              <th className="px-4 py-3">Recent sessions</th>
              <th className="px-4 py-3 text-right">History</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleStudents.map((student) => {
              const status = statusFor(student.id);
              const changed = student.id in marks;
              const owes = student.balance < 0;

              return (
                <tr
                  key={student.id}
                  className={cn("transition-colors", changed && "bg-primary/5")}
                >
                  <td className="max-w-[260px] px-4 py-3">
                    <p className="truncate font-semibold text-foreground">{student.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{student.level}</p>
                  </td>

                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={!unlocked}
                      onClick={() => cycleStatus(student.id)}
                      aria-label={`Cycle attendance for ${student.name}: currently ${labelFor(status)}`}
                      title="Tap to cycle: Present → Absent → Skipped → Not set"
                      className={cn(
                        "min-h-11 min-w-32 rounded-xl px-4 font-semibold transition-colors disabled:opacity-40",
                        status === "present"
                          ? "bg-brand-orange/15 text-brand-orange"
                          : status === "absent"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted text-muted-foreground",
                        status === "skipped" && "border border-dashed border-muted-foreground/40",
                      )}
                    >
                      {labelFor(status)}
                    </button>
                  </td>

                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold",
                        owes
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {owes ? `Owes ${formatMoney(-student.balance)}` : "Paid"}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <div
                      className="flex items-center gap-1.5"
                      aria-label={`${student.name} recent sessions`}
                    >
                      {historyDates.map((date) => {
                        const record = recordFor(student.id, date);
                        const color =
                          !record || record.status === "cancelled" || record.status === "skipped"
                            ? "bg-muted"
                            : record.status === "absent"
                              ? "bg-destructive"
                              : "bg-brand-orange";
                        return (
                          <span
                            key={date}
                            title={record ? `${date}: ${labelFor(record.status)}` : `${date}: No record`}
                            className={cn("size-4 rounded-[4px] sm:size-5", color)}
                          />
                        );
                      })}
                      {historyDates.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No sessions</span>
                      ) : null}
                    </div>
                    {historyDates.length > 0 ? (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {historyDates[0]} to {historyDates[historyDates.length - 1]}
                      </p>
                    ) : null}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setHistoryStudent({ id: student.id, name: student.name })}
                      className="min-h-10 rounded-xl bg-secondary px-3 font-semibold text-secondary-foreground"
                    >
                      History
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleStudents.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-muted-foreground">
                  {search
                    ? "No student matches that name."
                    : "No students enrolled in this group yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {unlocked && enrolled.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={saveAll}
            className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-60"
          >
            <Save className="size-6" />
            {saveMutation.isPending ? "Saving…" : hasSaved ? "Save changes" : "Save session"}
          </button>
          <button
            type="button"
            disabled={!hasSaved || clearMutation.isPending}
            onClick={() => setClearOpen(true)}
            className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-secondary text-lg font-bold text-secondary-foreground disabled:opacity-40"
          >
            <Eraser className="size-6" />
            Clear this session
          </button>
        </div>
      ) : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Cancel session on {activeDate}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Everyone in {group?.name ?? "this group"} will be marked as cancelled. No fees will be
            charged for this session. You can undo by taking attendance again.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="min-h-14 rounded-2xl bg-secondary font-bold text-secondary-foreground"
            >
              Keep session
            </button>
            <button
              type="button"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
              className="min-h-14 rounded-2xl bg-destructive font-bold text-destructive-foreground disabled:opacity-50"
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel session"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Clear session on {activeDate}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Every attendance record for this session will be removed and any fees charged will be
            refunded to student balances. This cannot be undone.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setClearOpen(false)}
              className="min-h-14 rounded-2xl bg-secondary font-bold text-secondary-foreground"
            >
              Keep records
            </button>
            <button
              type="button"
              disabled={clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
              className="min-h-14 rounded-2xl bg-destructive font-bold text-destructive-foreground disabled:opacity-50"
            >
              {clearMutation.isPending ? "Clearing…" : "Clear session"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Reschedule session</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label className="text-sm font-semibold">New date</Label>
              <Input
                type="date"
                className="h-12 text-base"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Any attendance already recorded on {activeDate} will move to the new date.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRescheduleOpen(false)}
                className="min-h-14 rounded-2xl bg-secondary font-bold text-secondary-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !rescheduleDate ||
                  rescheduleDate === activeDate ||
                  rescheduleMutation.isPending
                }
                onClick={() => rescheduleMutation.mutate(rescheduleDate)}
                className="min-h-14 rounded-2xl bg-primary font-bold text-primary-foreground disabled:opacity-50"
              >
                {rescheduleMutation.isPending ? "Moving…" : "Reschedule"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <StudentHistoryDialog
        student={historyStudent}
        onClose={() => setHistoryStudent(null)}
      />
    </AppShell>
  );
}

function StudentHistoryDialog({
  student,
  onClose,
}: {
  student: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const fetchHistory = useServerFn(getStudentHistory);
  const history = useQuery({
    queryKey: ["student-history", student?.id],
    queryFn: () => fetchHistory({ data: { studentId: student!.id } }),
    enabled: Boolean(student),
    staleTime: 60_000,
  });

  return (
    <Dialog open={Boolean(student)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{student?.name ?? "Student"}</DialogTitle>
        </DialogHeader>

        {history.isPending ? (
          <p className="text-muted-foreground">Loading history…</p>
        ) : history.isError ? (
          <p className="text-destructive">Could not load this student&apos;s history.</p>
        ) : (
          <div className="space-y-3">
            <p className="rounded-2xl bg-secondary px-4 py-3 font-semibold text-secondary-foreground">
              Balance: {formatMoney(history.data?.student?.balance ?? 0)}
            </p>
            {(history.data?.records.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">No sessions recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.data?.records.map((record) => (
                  <li
                    key={record.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
                  >
                    <span className="font-semibold text-foreground">{record.date}</span>
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-sm font-semibold",
                        record.status === "present"
                          ? "bg-brand-orange/15 text-brand-orange"
                          : record.status === "absent"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {labelFor(record.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}