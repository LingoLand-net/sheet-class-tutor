import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
  editStudent,
  registerStudent,
  removeStudent,
  setStudentSessions,
} from "@/lib/lms.functions";
import {
  TRIMESTER_LABELS,
  attendanceKey,
  type AttendanceRecord,
  type LmsSnapshot,
  type Session,
  type Student,
} from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/students")({
  head: () => ({
    meta: [
      { title: "Students | Language Center LMS" },
      { name: "description", content: "Student registry." },
    ],
  }),
  component: Page,
});

function Page() {
  const { unlocked } = useAdmin();
  const q = useQuery({ ...snapshotQuery, enabled: unlocked });
  if (!unlocked) return <LockedScreen title="Students" />;
  if (q.isPending) return <LoadingScreen title="Students" />;
  if (q.isError || !q.data) return <ErrorScreen title="Students" />;
  return <Body data={q.data} />;
}

/** A single session's picked state in the picker. */
type SessionPick = { status: "present" | "absent" | ""; paid: boolean };

const EMPTY_PICK: SessionPick = { status: "", paid: false };

type FormState = {
  name: string;
  phone: string;
  level: string;
  email: string;
  guardianName: string;
  guardianPhone: string;
  address: string;
  notes: string;
  enrollments: Record<string, Record<string, SessionPick>>;
};

const emptyForm: FormState = {
  name: "",
  phone: "",
  level: "",
  email: "",
  guardianName: "",
  guardianPhone: "",
  address: "",
  notes: "",
  enrollments: {},
};

function Body({ data }: { data: LmsSnapshot }) {
  const qc = useQueryClient();
  const token = getStoredToken() ?? "";
  const register = useServerFn(registerStudent);
  const update = useServerFn(editStudent);
  const destroy = useServerFn(removeStudent);

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editForm, setEditForm] = useState<Student | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);
  const [sessionsFor, setSessionsFor] = useState<Student | null>(null);

  const apply = (s: LmsSnapshot) => qc.setQueryData(snapshotQuery.queryKey, s);

  const registerMut = useMutation({
    mutationFn: () => {
      const enrollments = Object.entries(form.enrollments).map(([groupId, picks]) => ({
        groupId,
        // Only send sessions marked "paid" (that's all the server cares about
        // for a new registration).
        paidSessionIds: Object.entries(picks)
          .filter(([, p]) => p.paid)
          .map(([sid]) => sid),
      }));
      return register({
        data: {
          token,
          name: form.name,
          phone: form.phone,
          level: form.level,
          email: form.email,
          guardianName: form.guardianName,
          guardianPhone: form.guardianPhone,
          address: form.address,
          notes: form.notes,
          enrollments,
        },
      });
    },
    onSuccess: (s) => {
      apply(s);
      setOpenNew(false);
      setForm(emptyForm);
      toast.success("Registered");
    },
    onError: () => toast.error("Could not register"),
  });

  const updateMut = useMutation({
    mutationFn: (s: Student) =>
      update({
        data: {
          token,
          id: s.id,
          name: s.name,
          phone: s.phone,
          level: s.level,
          email: s.email,
          guardianName: s.guardianName,
          guardianPhone: s.guardianPhone,
          address: s.address,
          notes: s.notes,
        },
      }),
    onSuccess: (s) => {
      apply(s);
      setEditForm(null);
      toast.success("Saved");
    },
    onError: () => toast.error("Could not save"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => destroy({ data: { token, id } }),
    onSuccess: (s) => {
      apply(s);
      setPendingDelete(null);
      toast.success("Deleted");
    },
    onError: () => toast.error("Could not delete"),
  });

  const groupsByStudent = useMemo(() => {
    const m = new Map<string, string[]>();
    const nameById = new Map(data.groups.map((g) => [g.id, g.name]));
    for (const e of data.enrollments) {
      if (e.status !== "active") continue;
      const name = nameById.get(e.groupId);
      if (!name) continue;
      const arr = m.get(e.studentId) ?? [];
      arr.push(name);
      m.set(e.studentId, arr);
    }
    return m;
  }, [data.enrollments, data.groups]);

  const enrolledIdsInGroup = useMemo(() => {
    if (groupFilter === "all") return null;
    return new Set(
      data.enrollments
        .filter((e) => e.groupId === groupFilter && e.status === "active")
        .map((e) => e.studentId),
    );
  }, [data.enrollments, groupFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.students
      .filter((s) => (enrolledIdsInGroup ? enrolledIdsInGroup.has(s.id) : true))
      .filter((s) => (term ? s.name.toLowerCase().includes(term) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.students, search, enrolledIdsInGroup]);

  return (
    <AppShell
      title="Students"
      subtitle={`${data.students.length} total`}
      actions={
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm);
            setOpenNew(true);
          }}
          className="flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground"
        >
          <Plus className="size-5" /> Register
        </button>
      }
    >
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute top-3.5 left-4 size-5 text-muted-foreground" />
          <Input
            className="h-12 rounded-2xl pl-12 text-base"
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={groupFilter === "all"} onClick={() => setGroupFilter("all")}>
            All
          </FilterChip>
          {data.groups.map((g) => (
            <FilterChip
              key={g.id}
              active={groupFilter === g.id}
              onClick={() => setGroupFilter(g.id)}
            >
              {g.name}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 pb-8">
        {filtered.map((s) => {
          const groups = groupsByStudent.get(s.id) ?? [];
          return (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
            >
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-base font-semibold text-foreground">
                  {s.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {groups.length > 0 ? groups.join(" · ") : "No group"}
                  {s.level ? ` · ${s.level}` : ""}
                </p>
                {s.phone ? (
                  <p className="truncate text-xs text-muted-foreground">{s.phone}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSessionsFor(s)}
                aria-label={`Sessions for ${s.name}`}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-secondary px-3 font-semibold text-secondary-foreground"
              >
                <CalendarCheck className="size-5" />
                <span className="hidden sm:inline">Sessions</span>
              </button>
              <button
                type="button"
                onClick={() => setEditForm(s)}
                aria-label={`Edit ${s.name}`}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-secondary px-3 font-semibold text-secondary-foreground"
              >
                <Pencil className="size-5" />
                <span className="hidden sm:inline">Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(s)}
                aria-label={`Delete ${s.name}`}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-destructive/10 px-3 font-semibold text-destructive"
              >
                <Trash2 className="size-5" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-muted-foreground">
            No students match.
          </p>
        ) : null}
      </div>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Register student</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Full name">
              <Input
                className="h-12"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone">
                <Input
                  className="h-12"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Level">
                <Input
                  className="h-12"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Email">
              <Input
                className="h-12"
                inputMode="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Guardian name">
                <Input
                  className="h-12"
                  value={form.guardianName}
                  onChange={(e) =>
                    setForm({ ...form, guardianName: e.target.value })
                  }
                />
              </Field>
              <Field label="Guardian phone">
                <Input
                  className="h-12"
                  inputMode="tel"
                  value={form.guardianPhone}
                  onChange={(e) =>
                    setForm({ ...form, guardianPhone: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Address">
              <Input
                className="h-12"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label="Notes">
              <textarea
                rows={3}
                className="min-h-24 w-full rounded-xl border border-input bg-transparent px-4 py-3 text-base"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>

            <div className="grid gap-3 rounded-2xl border border-border p-4">
              <Label className="text-sm font-semibold">Groups & sessions</Label>
              <p className="text-xs text-muted-foreground">
                Tick a group to enroll. Then tap each session to mark it as
                paid (green) or leave it empty.
              </p>
              {data.groups.filter((g) => g.status === "active").map((g) => {
                const picks = form.enrollments[g.id];
                const sessions = data.sessions
                  .filter((s) => s.groupId === g.id)
                  .sort(
                    (a, b) =>
                      a.trimester - b.trimester ||
                      a.sessionNumber - b.sessionNumber,
                  );
                return (
                  <div key={g.id} className="rounded-xl border border-border p-3">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={Boolean(picks)}
                        onChange={(e) =>
                          setForm((f) => {
                            const next = { ...f.enrollments };
                            if (e.target.checked) next[g.id] = {};
                            else delete next[g.id];
                            return { ...f, enrollments: next };
                          })
                        }
                      />
                      <span className="text-sm font-semibold">{g.name}</span>
                    </label>
                    {picks ? (
                      <SessionPicker
                        sessions={sessions}
                        picks={picks}
                        onChange={(sessionId, pick) =>
                          setForm((f) => ({
                            ...f,
                            enrollments: {
                              ...f.enrollments,
                              [g.id]: { ...f.enrollments[g.id]!, [sessionId]: pick },
                            },
                          }))
                        }
                        onBulk={(ids, pick) =>
                          setForm((f) => {
                            const next = { ...(f.enrollments[g.id] ?? {}) };
                            for (const id of ids) next[id] = pick;
                            return {
                              ...f,
                              enrollments: { ...f.enrollments, [g.id]: next },
                            };
                          })
                        }
                      />
                    ) : null}
                  </div>
                );
              })}
              {data.groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No groups yet. Create one in the Groups tab.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              disabled={!form.name || registerMut.isPending}
              onClick={() => registerMut.mutate()}
              className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
            >
              {registerMut.isPending ? "Saving…" : "Register"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editForm !== null}
        onOpenChange={(o) => !o && setEditForm(null)}
      >
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Edit {editForm?.name}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <div className="grid gap-4">
              <Field label="Full name">
                <Input
                  className="h-12"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Phone">
                  <Input
                    className="h-12"
                    inputMode="tel"
                    value={editForm.phone}
                    onChange={(e) =>
                      setEditForm({ ...editForm, phone: e.target.value })
                    }
                  />
                </Field>
                <Field label="Level">
                  <Input
                    className="h-12"
                    value={editForm.level}
                    onChange={(e) =>
                      setEditForm({ ...editForm, level: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Email">
                <Input
                  className="h-12"
                  inputMode="email"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm({ ...editForm, email: e.target.value })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Guardian name">
                  <Input
                    className="h-12"
                    value={editForm.guardianName}
                    onChange={(e) =>
                      setEditForm({ ...editForm, guardianName: e.target.value })
                    }
                  />
                </Field>
                <Field label="Guardian phone">
                  <Input
                    className="h-12"
                    inputMode="tel"
                    value={editForm.guardianPhone}
                    onChange={(e) =>
                      setEditForm({ ...editForm, guardianPhone: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Address">
                <Input
                  className="h-12"
                  value={editForm.address}
                  onChange={(e) =>
                    setEditForm({ ...editForm, address: e.target.value })
                  }
                />
              </Field>
              <Field label="Notes">
                <textarea
                  rows={3}
                  className="min-h-24 w-full rounded-xl border border-input bg-transparent px-4 py-3 text-base"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setEditForm(null)}
                  className="min-h-14 rounded-2xl bg-secondary font-bold"
                >
                  Cancel
                </button>
                <button
                  disabled={!editForm.name || updateMut.isPending}
                  onClick={() => updateMut.mutate(editForm)}
                  className="min-h-14 rounded-2xl bg-primary font-bold text-primary-foreground disabled:opacity-50"
                >
                  {updateMut.isPending ? "Saving…" : "Save"}
                </button>
              </div>
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
            Removes the student and their enrollments and attendance.
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

      <StudentSessionsDialog
        student={sessionsFor}
        snapshot={data}
        token={token}
        onClose={() => setSessionsFor(null)}
        onSaved={(snap) => qc.setQueryData(snapshotQuery.queryKey, snap)}
      />
    </AppShell>
  );
}

function cyclePick(p: SessionPick): SessionPick {
  // unrecorded → present+paid → present+unpaid → absent → unrecorded
  if (p.status === "" && !p.paid) return { status: "present", paid: true };
  if (p.status === "present" && p.paid) return { status: "present", paid: false };
  if (p.status === "present" && !p.paid) return { status: "absent", paid: false };
  return { status: "", paid: false };
}

function pickClass(p: SessionPick): string {
  if (p.status === "absent") return "bg-destructive text-white";
  if (p.status === "present" && p.paid) return "bg-emerald-500 text-white";
  if (p.status === "present" && !p.paid) return "bg-amber-500 text-white";
  return "bg-muted text-muted-foreground border border-border";
}

function SessionPicker({
  sessions,
  picks,
  onChange,
  onBulk,
}: {
  sessions: Session[];
  picks: Record<string, SessionPick>;
  onChange: (sessionId: string, pick: SessionPick) => void;
  onBulk: (sessionIds: string[], pick: SessionPick) => void;
}) {
  const byTri = useMemo(() => {
    const m: Record<number, Session[]> = { 1: [], 2: [], 3: [] };
    for (const s of sessions) m[s.trimester].push(s);
    for (const t of [1, 2, 3]) m[t].sort((a, b) => a.sessionNumber - b.sessionNumber);
    return m;
  }, [sessions]);

  const pickOf = (id: string): SessionPick => picks[id] ?? EMPTY_PICK;

  return (
    <div className="mt-3 grid gap-2">
      {[1, 2, 3].map((t) => (
        <div key={t} className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-8 text-xs font-bold text-muted-foreground">
              {TRIMESTER_LABELS[t as 1 | 2 | 3]}
            </span>
            <button
              type="button"
              onClick={() =>
                onBulk(
                  byTri[t]!.map((s) => s.id),
                  { status: "present", paid: true },
                )
              }
              className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-700"
            >
              All paid
            </button>
            <button
              type="button"
              onClick={() =>
                onBulk(
                  byTri[t]!.map((s) => s.id),
                  { status: "absent", paid: false },
                )
              }
              className="rounded-lg bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive"
            >
              All absent
            </button>
            <button
              type="button"
              onClick={() => onBulk(byTri[t]!.map((s) => s.id), EMPTY_PICK)}
              className="rounded-lg bg-secondary px-2 py-1 text-[11px] font-semibold text-secondary-foreground"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1 pl-10">
            {byTri[t]!.map((s) => {
              const p = pickOf(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChange(s.id, cyclePick(p))}
                  className={cn(
                    "size-7 rounded-md text-[10px] font-bold transition-colors",
                    pickClass(p),
                  )}
                  title={`T${t} S${s.sessionNumber} · ${s.date || "no date"} · ${
                    p.status === "" && !p.paid
                      ? "not recorded"
                      : p.status === "absent"
                        ? "absent"
                        : p.paid
                          ? "present · paid"
                          : "present · not paid"
                  }`}
                >
                  {s.sessionNumber}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function StudentSessionsDialog({
  student,
  snapshot,
  token,
  onClose,
  onSaved,
}: {
  student: Student | null;
  snapshot: LmsSnapshot;
  token: string;
  onClose: () => void;
  onSaved: (s: LmsSnapshot) => void;
}) {
  const apply = useServerFn(setStudentSessions);

  const enrolledGroups = useMemo(
    () =>
      snapshot.enrollments
        .filter((e) => e.studentId === student?.id && e.status === "active")
        .map((e) => e.groupId),
    [snapshot.enrollments, student],
  );

  const attendanceIndex = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const a of snapshot.attendance)
      m.set(attendanceKey(a.sessionId, a.studentId), a);
    return m;
  }, [snapshot.attendance]);

  /** Local editing state, keyed by sessionId. */
  const [picks, setPicks] = useState<Record<string, SessionPick>>({});

  useEffect(() => {
    if (!student) return;
    const next: Record<string, SessionPick> = {};
    for (const gid of enrolledGroups) {
      const sessions = snapshot.sessions.filter((s) => s.groupId === gid);
      for (const s of sessions) {
        const rec = attendanceIndex.get(attendanceKey(s.id, student.id));
        next[s.id] = rec
          ? { status: rec.status, paid: rec.paid }
          : { status: "", paid: false };
      }
    }
    setPicks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  const mutation = useMutation({
    mutationFn: (
      updates: { sessionId: string; status: "present" | "absent" | ""; paid: boolean }[],
    ) => apply({ data: { token, studentId: student!.id, updates } }),
    onSuccess: (snap) => {
      onSaved(snap);
      toast.success("Sessions updated");
      onClose();
    },
    onError: () => toast.error("Could not update"),
  });

  const save = () => {
    if (!student) return;
    const updates: {
      sessionId: string;
      status: "present" | "absent" | "";
      paid: boolean;
    }[] = [];
    for (const [sessionId, pick] of Object.entries(picks)) {
      const rec = attendanceIndex.get(attendanceKey(sessionId, student.id));
      const curStatus = rec?.status ?? "";
      const curPaid = rec?.paid ?? false;
      if (pick.status !== curStatus || pick.paid !== curPaid) {
        updates.push({
          sessionId,
          status: pick.status,
          paid: pick.paid,
        });
      }
    }
    if (updates.length === 0) {
      onClose();
      return;
    }
    mutation.mutate(updates);
  };

  return (
    <Dialog open={student !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Sessions · {student?.name ?? ""}
          </DialogTitle>
        </DialogHeader>
        {student ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-3 rounded bg-emerald-500" /> Present · Paid
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded bg-amber-500" /> Present · Not paid
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded bg-destructive" /> Absent
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded border border-border bg-muted" /> Not
                recorded
              </span>
            </div>
            {enrolledGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This student is not in any group.
              </p>
            ) : (
              enrolledGroups.map((gid) => {
                const g = snapshot.groups.find((x) => x.id === gid);
                const sessions = snapshot.sessions
                  .filter((s) => s.groupId === gid)
                  .sort(
                    (a, b) =>
                      a.trimester - b.trimester ||
                      a.sessionNumber - b.sessionNumber,
                  );
                return (
                  <div
                    key={gid}
                    className="grid gap-2 rounded-2xl border border-border p-4"
                  >
                    <Label className="text-sm font-semibold">
                      {g?.name ?? "Group"}
                    </Label>
                    <SessionPicker
                      sessions={sessions}
                      picks={picks}
                      onChange={(sessionId, pick) =>
                        setPicks((prev) => ({ ...prev, [sessionId]: pick }))
                      }
                      onBulk={(ids, pick) =>
                        setPicks((prev) => {
                          const next = { ...prev };
                          for (const id of ids) next[id] = pick;
                          return next;
                        })
                      }
                    />
                  </div>
                );
              })
            )}
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={save}
              className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full px-4 text-sm font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </button>
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