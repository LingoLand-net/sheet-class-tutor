import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import {
  ErrorScreen,
  LoadingScreen,
  LockedScreen,
} from "@/components/lms/require-auth";
import { AppShell } from "@/components/lms/shell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getStoredToken } from "@/lib/auth-client";
import { snapshotQuery } from "@/lib/lms-client";
import {
  assignStudentToGroup,
  removeGroup,
  saveGroup,
  saveGroupSessionDates,
  toggleGroupStatus,
  unassignStudentFromGroup,
} from "@/lib/lms.functions";
import {
  TRIMESTER_SIZES,
  type Group,
  type LmsSnapshot,
  type Session,
  type Student,
} from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Groups | Language Center LMS" },
      { name: "description", content: "Manage class groups and rosters." },
    ],
  }),
  component: Page,
});

function Page() {
  const { unlocked } = useAdmin();
  const q = useQuery({ ...snapshotQuery, enabled: unlocked });
  if (!unlocked) return <LockedScreen title="Groups" />;
  if (q.isPending) return <LoadingScreen title="Groups" />;
  if (q.isError || !q.data) return <ErrorScreen title="Groups" />;
  return <Body data={q.data} />;
}

/* ---------- Schedule helpers ---------- */

const DAYS = [
  { short: "Mon", key: "Mon" },
  { short: "Tue", key: "Tue" },
  { short: "Wed", key: "Wed" },
  { short: "Thu", key: "Thu" },
  { short: "Fri", key: "Fri" },
  { short: "Sat", key: "Sat" },
  { short: "Sun", key: "Sun" },
] as const;
type DayKey = (typeof DAYS)[number]["key"];

/**
 * Day-of-week number mapping for JS `Date.getDay()`:
 *   0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
 */
const DAY_TO_JS: Record<DayKey, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const TIME_RE = /(\d{1,2}):(\d{2})/;

function parseSchedule(s: string): { days: DayKey[]; time: string } {
  const lower = s.toLowerCase();
  const days: DayKey[] = [];
  for (const d of DAYS) {
    if (lower.includes(d.short.toLowerCase())) days.push(d.key);
  }
  const m = s.match(TIME_RE);
  const time = m ? `${String(Number(m[1])).padStart(2, "0")}:${m[2]}` : "";
  return { days, time };
}

function buildSchedule(days: DayKey[], time: string): string {
  const parts: string[] = [];
  if (days.length > 0) parts.push(days.join("/"));
  if (time) parts.push(time);
  return parts.join(" ");
}

/* ---------- Page ---------- */

type Draft = Omit<Group, "id"> & { id?: string };

const emptyDraft: Draft = {
  name: "",
  level: "",
  teacher: "",
  schedule: "",
  status: "active",
};

function Body({ data }: { data: LmsSnapshot }) {
  const qc = useQueryClient();
  const token = getStoredToken() ?? "";
  const persist = useServerFn(saveGroup);
  const setStatus = useServerFn(toggleGroupStatus);
  const destroy = useServerFn(removeGroup);
  const assign = useServerFn(assignStudentToGroup);
  const unassign = useServerFn(unassignStudentFromGroup);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
  const [assignOpenFor, setAssignOpenFor] = useState<Group | null>(null);
  const [datesGroupId, setDatesGroupId] = useState<string | null>(null);

  const applySnapshot = (s: LmsSnapshot) =>
    qc.setQueryData(snapshotQuery.queryKey, s);

  const saveMut = useMutation({
    mutationFn: (g: Draft) => persist({ data: { token, ...g } }),
    onSuccess: (s) => {
      applySnapshot(s);
      setDraft(null);
      toast.success("Saved");
    },
    onError: () => toast.error("Could not save"),
  });
  const statusMut = useMutation({
    mutationFn: (i: { id: string; status: Group["status"] }) =>
      setStatus({ data: { token, ...i } }),
    onSuccess: applySnapshot,
    onError: () => toast.error("Could not update"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => destroy({ data: { token, id } }),
    onSuccess: (s) => {
      applySnapshot(s);
      setPendingDelete(null);
      toast.success("Deleted");
    },
    onError: () => toast.error("Could not delete"),
  });
  const assignMut = useMutation({
    mutationFn: (i: { studentId: string; groupId: string }) =>
      assign({ data: { token, ...i } }),
    onSuccess: (s) => {
      applySnapshot(s);
      toast.success("Added");
    },
    onError: () => toast.error("Could not add"),
  });
  const unassignMut = useMutation({
    mutationFn: (i: { studentId: string; groupId: string }) =>
      unassign({ data: { token, ...i } }),
    onSuccess: (s) => {
      applySnapshot(s);
      toast.success("Removed");
    },
    onError: () => toast.error("Could not remove"),
  });

  const studentsByGroup = useMemo(() => {
    const m = new Map<string, Student[]>();
    const studentsById = new Map(data.students.map((s) => [s.id, s]));
    for (const e of data.enrollments) {
      if (e.status !== "active") continue;
      const st = studentsById.get(e.studentId);
      if (!st) continue;
      const arr = m.get(e.groupId) ?? [];
      arr.push(st);
      m.set(e.groupId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [data.enrollments, data.students]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave =
    draft !== null &&
    draft.name.trim() !== "" &&
    draft.level.trim() !== "" &&
    draft.teacher.trim() !== "" &&
    draft.schedule.trim() !== "";

  return (
    <AppShell
      title="Groups"
      subtitle={`${data.groups.length} total`}
      actions={
        <button
          type="button"
          onClick={() => setDraft({ ...emptyDraft })}
          className="flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground"
        >
          <Plus className="size-5" /> New group
        </button>
      }
    >
      <div className="flex flex-col gap-2 pb-8">
        {data.groups.map((group) => {
          const roster = studentsByGroup.get(group.id) ?? [];
          const isOpen = expanded.has(group.id);
          return (
            <div
              key={group.id}
              className={cn(
                "overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
                group.status === "archived" && "opacity-60",
              )}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => toggleExpand(group.id)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="size-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-5 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {group.name}
                      <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                        {group.level}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {group.teacher} · {group.schedule} · {roster.length} students
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDatesGroupId(group.id)}
                  aria-label="Set session dates"
                  className="flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
                >
                  <CalendarDays className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...group })}
                  aria-label="Edit group"
                  className="flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
                >
                  <Pencil className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    statusMut.mutate({
                      id: group.id,
                      status: group.status === "active" ? "archived" : "active",
                    })
                  }
                  aria-label="Archive or restore"
                  className="flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
                >
                  {group.status === "active" ? (
                    <Archive className="size-5" />
                  ) : (
                    <RotateCcw className="size-5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(group)}
                  aria-label="Delete group"
                  className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
                >
                  <Trash2 className="size-5" />
                </button>
              </div>

              {isOpen ? (
                <div className="border-t border-border bg-muted/40 px-4 py-3">
                  {roster.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">
                      No students yet.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {roster.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center gap-3 rounded-xl bg-card px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {s.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {s.phone || "—"}
                              {s.guardianPhone ? ` · ${s.guardianPhone}` : ""}
                              {s.email ? ` · ${s.email}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              unassignMut.mutate({
                                studentId: s.id,
                                groupId: group.id,
                              })
                            }
                            aria-label={`Remove ${s.name}`}
                            className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
                          >
                            <UserMinus className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => setAssignOpenFor(group)}
                    className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground"
                  >
                    <UserPlus className="size-5" /> Add student
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {data.groups.length === 0 ? (
          <p className="text-muted-foreground">No groups yet.</p>
        ) : null}
      </div>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {draft?.id ? "Edit group" : "New group"}
            </DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-4">
              <Field label="Name">
                <Input
                  className="h-12"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Level">
                  <Input
                    className="h-12"
                    value={draft.level}
                    onChange={(e) =>
                      setDraft({ ...draft, level: e.target.value })
                    }
                  />
                </Field>
                <Field label="Teacher">
                  <Input
                    className="h-12"
                    value={draft.teacher}
                    onChange={(e) =>
                      setDraft({ ...draft, teacher: e.target.value })
                    }
                  />
                </Field>
              </div>

              <ScheduleEditor
                value={draft.schedule}
                onChange={(v) => setDraft({ ...draft, schedule: v })}
              />

              <button
                type="button"
                disabled={!canSave || saveMut.isPending}
                onClick={() => saveMut.mutate(draft)}
                className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
              >
                {saveMut.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Delete {pendingDelete?.name}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the group, its sessions, enrollments, and attendance
            history.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button
              onClick={() => setPendingDelete(null)}
              className="min-h-14 rounded-2xl bg-secondary font-bold"
            >
              Cancel
            </button>
            <button
              disabled={deleteMut.isPending}
              onClick={() => pendingDelete && deleteMut.mutate(pendingDelete.id)}
              className="min-h-14 rounded-2xl bg-destructive font-bold text-destructive-foreground"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AssignDialog
        group={assignOpenFor}
        snapshot={data}
        onClose={() => setAssignOpenFor(null)}
        onPick={(studentId) => {
          if (assignOpenFor) {
            assignMut.mutate({ studentId, groupId: assignOpenFor.id });
          }
        }}
      />

      <SessionDatesDialog
        group={data.groups.find((g) => g.id === datesGroupId) ?? null}
        sessions={data.sessions.filter((s) => s.groupId === datesGroupId)}
        onClose={() => setDatesGroupId(null)}
        token={token}
        onSaved={(snapshot) => qc.setQueryData(snapshotQuery.queryKey, snapshot)}
      />
    </AppShell>
  );
}

/* ---------- Schedule editor ---------- */

function ScheduleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const parsed = useMemo(() => parseSchedule(value), [value]);
  const [time, setTime] = useState(parsed.time);

  useEffect(() => {
    const next = parseSchedule(value).time;
    setTime((prev) => (prev === next ? prev : next));
  }, [value]);

  const toggleDay = (d: DayKey) => {
    const days = parsed.days.includes(d)
      ? parsed.days.filter((x) => x !== d)
      : [...parsed.days, d].sort(
          (a, b) =>
            DAYS.findIndex((x) => x.key === a) -
            DAYS.findIndex((x) => x.key === b),
        );
    onChange(buildSchedule(days, parsed.time));
  };

  const onTimeChange = (t: string) => {
    setTime(t);
    onChange(buildSchedule(parsed.days, t));
  };

  const unparsedWarning = value.trim() !== "" && parsed.days.length === 0;

  return (
    <div className="grid gap-3 rounded-2xl border border-border p-4">
      <Label className="text-sm font-semibold">Schedule</Label>

      {unparsedWarning ? (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          Couldn&apos;t detect days from &ldquo;{value}&rdquo;. Pick the days
          again below — saving will replace it.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {DAYS.map((d) => {
          const active = parsed.days.includes(d.key);
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => toggleDay(d.key)}
              className={cn(
                "min-h-11 min-w-14 rounded-xl px-3 text-sm font-semibold transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {d.short}
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
          value={time}
          onChange={(e) => onTimeChange(e.target.value)}
        />
      </div>

      {value ? (
        <p className="rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground">
          {value}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pick the days and a start time.
        </p>
      )}
    </div>
  );
}

/* ---------- Assign dialog ---------- */

function AssignDialog({
  group,
  snapshot,
  onClose,
  onPick,
}: {
  group: Group | null;
  snapshot: LmsSnapshot;
  onClose: () => void;
  onPick: (studentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const enrolledIds = useMemo(() => {
    if (!group) return new Set<string>();
    return new Set(
      snapshot.enrollments
        .filter((e) => e.groupId === group.id && e.status === "active")
        .map((e) => e.studentId),
    );
  }, [snapshot.enrollments, group]);

  const candidates = useMemo(() => {
    const term = query.trim().toLowerCase();
    return snapshot.students
      .filter((s) => !enrolledIds.has(s.id))
      .filter((s) => (term ? s.name.toLowerCase().includes(term) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot.students, enrolledIds, query]);

  return (
    <Dialog open={group !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Add student to {group?.name ?? ""}
          </DialogTitle>
        </DialogHeader>
        <Input
          className="h-12"
          placeholder="Search students"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          {candidates.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onPick(s.id);
                onClose();
              }}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-left"
            >
              <div>
                <p className="text-sm font-semibold">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.phone || "—"}</p>
              </div>
              <UserPlus className="size-5 text-primary" />
            </button>
          ))}
          {candidates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No matching students.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Session dates dialog ---------- */

type PatternDay = {
  js: number;
  label: string;
};

const PATTERN_DAYS: PatternDay[] = [
  { js: 1, label: "Mon" },
  { js: 2, label: "Tue" },
  { js: 3, label: "Wed" },
  { js: 4, label: "Thu" },
  { js: 5, label: "Fri" },
  { js: 6, label: "Sat" },
  { js: 0, label: "Sun" },
];

function SessionDatesDialog({
  group,
  sessions,
  onClose,
  token,
  onSaved,
}: {
  group: Group | null;
  sessions: Session[];
  onClose: () => void;
  token: string;
  onSaved: (snapshot: LmsSnapshot) => void;
}) {
  const save = useServerFn(saveGroupSessionDates);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [patternStart, setPatternStart] = useState("2026-09-08");
  const [patternWeekdays, setPatternWeekdays] = useState<number[]>([]);

  // Sync local state when the dialog opens for a group:
  //  - Dates come from the sessions array.
  //  - Weekday chips are preselected from the group's schedule string, so
  //    a Mon/Wed group doesn't default to Tue/Thu.
  useEffect(() => {
    if (!group) return;
    const next: Record<string, string> = {};
    for (const s of sessions) next[s.id] = s.date;
    setDates(next);

    const parsed = parseSchedule(group.schedule);
    const jsDays = parsed.days
      .map((k) => DAY_TO_JS[k])
      .sort((a, b) => a - b);
    setPatternWeekdays(jsDays.length > 0 ? jsDays : [2, 4]);

    // If a session already has a date, seed the start field from the earliest
    // one so the preview matches reality.
    const earliest = [...sessions]
      .filter((s) => s.date)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (earliest) setPatternStart(earliest.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const mutation = useMutation({
    mutationFn: () => save({ data: { token, groupId: group!.id, dates } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSaved(snapshot);
      toast.success("Dates saved");
      onClose();
    },
    onError: () => toast.error("Could not save dates"),
  });

  const sortedByTri = useMemo(() => {
    const m: Record<number, Session[]> = { 1: [], 2: [], 3: [] };
    for (const s of sessions) m[s.trimester].push(s);
    for (const t of [1, 2, 3]) m[t].sort((a, b) => a.sessionNumber - b.sessionNumber);
    return m;
  }, [sessions]);

  const applyPattern = () => {
    if (patternWeekdays.length === 0) {
      toast.error("Pick at least one weekday");
      return;
    }
    const ordered = [...sortedByTri[1]!, ...sortedByTri[2]!, ...sortedByTri[3]!];
    const next: Record<string, string> = { ...dates };
    const cursor = new Date(patternStart + "T00:00:00");
    if (Number.isNaN(cursor.getTime())) {
      toast.error("Start date is invalid");
      return;
    }
    let i = 0;
    let safety = 0;
    while (i < ordered.length && safety < 5000) {
      safety++;
      if (patternWeekdays.includes(cursor.getDay())) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        next[ordered[i]!.id] = `${y}-${m}-${d}`;
        i++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    setDates(next);
  };

  return (
    <Dialog open={group !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Session dates · {group?.name ?? ""}
          </DialogTitle>
        </DialogHeader>
        {group ? (
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm font-semibold">Quick pattern</Label>
                <span className="text-xs text-muted-foreground">
                  Group schedule: {group.schedule || "—"}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Start date
                  </Label>
                  <Input
                    type="date"
                    className="h-11"
                    value={patternStart}
                    onChange={(e) => setPatternStart(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Weekdays
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {PATTERN_DAYS.map((d) => {
                      const active = patternWeekdays.includes(d.js);
                      return (
                        <button
                          key={d.label}
                          type="button"
                          onClick={() =>
                            setPatternWeekdays((prev) =>
                              prev.includes(d.js)
                                ? prev.filter((x) => x !== d.js)
                                : [...prev, d.js].sort((a, b) => a - b),
                            )
                          }
                          className={cn(
                            "min-h-10 min-w-12 rounded-lg px-3 text-sm font-semibold",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-secondary-foreground",
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={applyPattern}
                className="min-h-11 rounded-xl bg-secondary font-semibold text-secondary-foreground"
              >
                Fill dates from pattern
              </button>
              <p className="text-xs text-muted-foreground">
                Fills all 26 sessions sequentially starting from the start date,
                only on the selected weekdays. Overwrites any dates already set.
              </p>
            </div>

            {[1, 2, 3].map((t) => (
              <div
                key={t}
                className="grid gap-2 rounded-2xl border border-border p-4"
              >
                <Label className="text-sm font-semibold">
                  Trimester {t} · {TRIMESTER_SIZES[t as 1 | 2 | 3]} sessions
                </Label>
                <div className="flex flex-col gap-2">
                  {sortedByTri[t]!.map((s) => (
                    <div key={s.id} className="flex items-center gap-3">
                      <span className="w-10 text-xs font-bold text-muted-foreground">
                        S{s.sessionNumber}
                      </span>
                      <Input
                        type="date"
                        className="h-10 flex-1"
                        value={dates[s.id] ?? ""}
                        onChange={(e) =>
                          setDates((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
            >
              {mutation.isPending ? "Saving…" : "Save dates"}
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
    </div>
  );
}