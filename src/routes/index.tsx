import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  ArrowDownAZ,
  ArrowUpZA,
  Check,
  Search,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import {
  ErrorScreen,
  LoadingScreen,
  LockedScreen,
} from "@/components/lms/require-auth";
import { AppShell } from "@/components/lms/shell";
import { Input } from "@/components/ui/input";
import { getStoredToken } from "@/lib/auth-client";
import { snapshotQuery } from "@/lib/lms-client";
import { submitRollCall } from "@/lib/lms.functions";
import {
  TRIMESTER_LABELS,
  attendanceKey,
  blockState,
  type AttendanceRecord,
  type AttendanceStatus,
  type BlockState,
  type LmsSnapshot,
  type RollCallEntry,
  type Session,
} from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Roll Call | Language Center LMS" },
      {
        name: "description",
        content: "Attendance and yearly view for language center sessions.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const { unlocked } = useAdmin();
  const q = useQuery({ ...snapshotQuery, enabled: unlocked });
  if (!unlocked) return <LockedScreen title="Roll Call" />;
  if (q.isPending) return <LoadingScreen title="Roll Call" />;
  if (q.isError || !q.data) return <ErrorScreen title="Roll Call" />;
  return <Body data={q.data} />;
}

/** Draft value in the roll call table. `""` means "clear the record". */
type DraftValue = "present" | "absent" | "";

function Body({ data }: { data: LmsSnapshot }) {
  const qc = useQueryClient();
  const token = getStoredToken() ?? "";
  const submit = useServerFn(submitRollCall);

  const groups = useMemo(
    () => data.groups.filter((g) => g.status === "active"),
    [data.groups],
  );
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [sessionId, setSessionId] = useState<string>("");
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});

  const groupSessions = useMemo(
    () =>
      data.sessions
        .filter((s) => s.groupId === groupId)
        .sort(
          (a, b) =>
            a.trimester - b.trimester || a.sessionNumber - b.sessionNumber,
        ),
    [data.sessions, groupId],
  );

  const activeSession: Session | undefined =
    groupSessions.find((s) => s.id === sessionId) ?? groupSessions[0];

  const enrolled = useMemo(() => {
    const ids = new Set(
      data.enrollments
        .filter((e) => e.groupId === groupId && e.status === "active")
        .map((e) => e.studentId),
    );
    return data.students.filter((s) => ids.has(s.id));
  }, [data.enrollments, data.students, groupId]);

  const attendanceIndex = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const a of data.attendance) m.set(attendanceKey(a.sessionId, a.studentId), a);
    return m;
  }, [data.attendance]);

  /** Server-side status for the current session, per student. */
  const saved = useMemo(() => {
    const m = new Map<string, "present" | "absent">();
    if (!activeSession) return m;
    for (const s of enrolled) {
      const rec = attendanceIndex.get(attendanceKey(activeSession.id, s.id));
      if (rec?.status === "present" || rec?.status === "absent") {
        m.set(s.id, rec.status);
      }
    }
    return m;
  }, [activeSession, enrolled, attendanceIndex]);

  /** Effective status: draft wins; else server; else unset. */
  const statusFor = (studentId: string): "present" | "absent" | "unset" => {
    if (studentId in draft) {
      const v = draft[studentId];
      return v === "" ? "unset" : v;
    }
    return saved.get(studentId) ?? "unset";
  };

  const displayIndex = useMemo(() => {
    const m = new Map(attendanceIndex);
    if (!activeSession) return m;
    for (const s of enrolled) {
      if (!(s.id in draft)) continue;
      const key = attendanceKey(activeSession.id, s.id);
      const value = draft[s.id]!;
      if (value === "") {
        // Preview the "clear" state — hide any present/absent but keep the
        // record if it carries a payment flag.
        const existing = attendanceIndex.get(key);
        if (existing?.paid) {
          m.set(key, { ...existing, status: "" });
        } else {
          m.delete(key);
        }
      } else {
        const existing = attendanceIndex.get(key);
        m.set(key, {
          id: existing?.id ?? `draft-${s.id}`,
          sessionId: activeSession.id,
          studentId: s.id,
          status: value,
          paid: existing?.paid ?? false,
        });
      }
    }
    return m;
  }, [attendanceIndex, activeSession, enrolled, draft]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? enrolled.filter((s) => s.name.toLowerCase().includes(term))
      : enrolled;
    return [...list].sort((a, b) =>
      sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
    );
  }, [enrolled, search, sortAsc]);

  const mutation = useMutation({
    mutationFn: (entries: RollCallEntry[]) =>
      submit({ data: { token, sessionId: activeSession!.id, entries } }),
    onSuccess: (snap) => {
      qc.setQueryData(snapshotQuery.queryKey, snap);
      setDraft({});
      toast.success("Saved");
    },
    onError: () => toast.error("Could not save"),
  });

  const dirty = Object.keys(draft).length > 0;

  /** Cycle: unset → present → absent → unset. */
  const cycle = (studentId: string) => {
    const cur = statusFor(studentId);
    const next: DraftValue =
      cur === "unset" ? "present" : cur === "present" ? "absent" : "";

    setDraft((prev) => {
      const serverValue = saved.get(studentId);
      const out = { ...prev };
      const resultingStatus: "present" | "absent" | "unset" =
        next === "" ? "unset" : next;
      const serverOrUnset = serverValue ?? "unset";
      if (resultingStatus === serverOrUnset) delete out[studentId];
      else out[studentId] = next;
      return out;
    });
  };

  const markAll = (value: "present" | "absent") => {
    const out: Record<string, DraftValue> = {};
    for (const s of enrolled) {
      if (saved.get(s.id) !== value) out[s.id] = value;
    }
    setDraft(out);
  };

  const clearAll = () => {
    const out: Record<string, DraftValue> = {};
    for (const s of enrolled) {
      if (saved.has(s.id)) out[s.id] = "";
    }
    setDraft(out);
  };

  const saveAll = () => {
    if (!activeSession) return;
    const entries: RollCallEntry[] = Object.entries(draft).map(
      ([studentId, status]) => ({ studentId, status }),
    );
    if (entries.length === 0) {
      toast.info("Nothing to save");
      return;
    }
    mutation.mutate(entries);
  };

  return (
    <AppShell
      title="Roll Call"
      subtitle={
        activeSession
          ? `${TRIMESTER_LABELS[activeSession.trimester]} · S${activeSession.sessionNumber}${
              activeSession.date ? ` · ${activeSession.date}` : ""
            }`
          : "No sessions"
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              setGroupId(g.id);
              setSessionId("");
              setDraft({});
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
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active groups. Create one in the Groups tab.
          </p>
        ) : null}
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute top-3.5 left-4 size-5 text-muted-foreground" />
          <Input
            className="h-12 rounded-2xl pl-12 text-base"
            placeholder="Search students"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeSession?.id ?? ""}
            onChange={(e) => {
              setSessionId(e.target.value);
              setDraft({});
            }}
            className="h-12 rounded-2xl bg-secondary px-4 text-base font-semibold text-secondary-foreground"
          >
            {groupSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {TRIMESTER_LABELS[s.trimester]} · S{s.sessionNumber}
                {s.date ? ` · ${s.date}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSortAsc((v) => !v)}
            className="flex min-h-12 items-center gap-2 rounded-2xl bg-secondary px-4 font-semibold text-secondary-foreground"
          >
            {sortAsc ? (
              <ArrowDownAZ className="size-5" />
            ) : (
              <ArrowUpZA className="size-5" />
            )}
            {sortAsc ? "A–Z" : "Z–A"}
          </button>
        </div>
      </div>

      {enrolled.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => markAll("present")}
            className="flex min-h-11 items-center gap-2 rounded-2xl bg-emerald-500/15 px-4 font-semibold text-emerald-700"
          >
            <Check className="size-4" /> Mark all present
          </button>
          <button
            type="button"
            onClick={() => markAll("absent")}
            className="flex min-h-11 items-center gap-2 rounded-2xl bg-destructive/10 px-4 font-semibold text-destructive"
          >
            <X className="size-4" /> Mark all absent
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="flex min-h-11 items-center gap-2 rounded-2xl bg-secondary px-4 font-semibold text-secondary-foreground"
          >
            Clear all
          </button>
          {dirty ? (
            <button
              type="button"
              onClick={() => setDraft({})}
              className="ml-auto flex min-h-11 items-center gap-2 rounded-2xl bg-secondary px-4 font-semibold text-secondary-foreground"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="bg-secondary/60 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-3 py-3">Attendance</th>
              <th className="px-3 py-3">Year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((student) => {
              const st = statusFor(student.id);
              const changed = student.id in draft;
              return (
                <tr key={student.id} className={cn(changed && "bg-primary/5")}>
                  <td className="max-w-[240px] px-4 py-3">
                    <p className="truncate font-semibold text-foreground">
                      {student.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {student.level}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => cycle(student.id)}
                      className={cn(
                        "flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors",
                        st === "present" && "bg-emerald-500/15 text-emerald-700",
                        st === "absent" && "bg-destructive/15 text-destructive",
                        st === "unset" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {st === "present" && <UserCheck className="size-5" />}
                      {st === "absent" && <UserX className="size-5" />}
                      {st === "unset"
                        ? "Unmarked"
                        : st === "present"
                          ? "Present"
                          : "Absent"}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <YearGrid
                      sessions={groupSessions}
                      attendanceIndex={displayIndex}
                      studentId={student.id}
                    />
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-muted-foreground">
                  No students enrolled.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {enrolled.length > 0 ? (
        <div className="mt-4">
          <button
            type="button"
            disabled={mutation.isPending || !dirty}
            onClick={saveAll}
            className="min-h-14 w-full rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-40"
          >
            {mutation.isPending
              ? "Saving…"
              : dirty
                ? `Save ${Object.keys(draft).length} change${Object.keys(draft).length === 1 ? "" : "s"}`
                : "No changes to save"}
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}

export function YearGrid({
  sessions,
  attendanceIndex,
  studentId,
}: {
  sessions: Session[];
  attendanceIndex: Map<string, AttendanceRecord>;
  studentId: string;
}) {
  const byTrimester: Record<number, Session[]> = { 1: [], 2: [], 3: [] };
  for (const s of sessions) byTrimester[s.trimester].push(s);
  for (const t of [1, 2, 3]) {
    byTrimester[t].sort((a, b) => a.sessionNumber - b.sessionNumber);
  }

  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <div className="flex flex-col gap-1 py-0.5">
        {[1, 2, 3].map((t) => (
          <div key={t} className="flex items-center gap-2">
            <span className="w-6 text-[10px] font-bold text-muted-foreground">
              T{t}
            </span>
            <div className="flex gap-[3px]">
              {byTrimester[t].map((s) => {
                const rec = attendanceIndex.get(attendanceKey(s.id, studentId));
                const state = blockState(rec, s);
                return (
                  <TooltipPrimitive.Root key={s.id}>
                    <TooltipPrimitive.Trigger asChild>
                      <button
                        type="button"
                        aria-label={`T${t} Session ${s.sessionNumber}: ${meaningOf(state)}`}
                        className={cn(
                          "size-3.5 rounded-[3px] cursor-help",
                          blockClass(state),
                        )}
                      />
                    </TooltipPrimitive.Trigger>
                    <TooltipPrimitive.Portal>
                      <TooltipPrimitive.Content
                        side="top"
                        sideOffset={6}
                        className="z-[60] max-w-[240px] rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background shadow-lg"
                      >
                        <p className="font-bold">
                          T{t} · Session {s.sessionNumber}
                        </p>
                        <p className="mt-0.5 opacity-80">
                          {s.date || "No date set"}
                        </p>
                        <p className="mt-1">{meaningOf(state)}</p>
                        <TooltipPrimitive.Arrow className="fill-foreground" />
                      </TooltipPrimitive.Content>
                    </TooltipPrimitive.Portal>
                  </TooltipPrimitive.Root>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </TooltipPrimitive.Provider>
  );
}

function meaningOf(state: BlockState): string {
  switch (state) {
    case "present_paid":
      return "Present · Paid";
    case "present_unpaid":
      return "Present · Not paid";
    case "absent":
      return "Absent";
    case "unrecorded":
      return "Not recorded";
    case "future":
      return "Upcoming";
  }
}

export function blockClass(state: BlockState): string {
  switch (state) {
    case "present_paid":
      return "bg-emerald-500";
    case "present_unpaid":
      return "bg-amber-500";
    case "absent":
      return "bg-destructive";
    case "unrecorded":
      return "bg-transparent border border-destructive";
    case "future":
      return "bg-muted border border-border";
  }
}