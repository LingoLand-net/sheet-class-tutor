import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarCheck,
  CalendarMinus,
  CalendarX,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wallet,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getStoredToken } from "@/lib/auth-client";
import { snapshotQuery } from "@/lib/lms-client";
import { addPayment, editStudent, registerStudent, removeStudent } from "@/lib/lms.functions";
import {
  formatMoney,
  type AttendanceStatus,
  type Enrollment,
  type LmsSnapshot,
  type Student,
} from "@/lib/lms-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/students")({
  head: () => ({
    meta: [
      { title: "Student Registry & Ledger | Language Center LMS" },
      {
        name: "description",
        content:
          "Register students, track balances, and review each learner's attendance and payment history.",
      },
      { property: "og:title", content: "Student Registry & Ledger | Language Center LMS" },
      {
        property: "og:description",
        content: "Balances, enrollments, and full attendance timelines for every student.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: StudentsPage,
});

function labelForStatus(status: AttendanceStatus): string {
  switch (status) {
    case "present":   return "Present";
    case "absent":    return "Absent";
    case "cancelled": return "Cancelled";
    case "skipped":   return "Skipped";
  }
}

function StudentsPage() {
  const { unlocked } = useAdmin();
  const query = useQuery({ ...snapshotQuery, enabled: unlocked });

  if (!unlocked) return <LockedScreen title="Student Registry" />;
  if (query.isPending) return <LoadingScreen title="Student Registry" />;
  if (query.isError || !query.data) return <ErrorScreen title="Student Registry" />;

  return <StudentsBody data={query.data} />;
}

function StudentsBody({ data }: { data: LmsSnapshot }) {
  const { unlocked } = useAdmin();
  const queryClient = useQueryClient();
  const register = useServerFn(registerStudent);
  const pay = useServerFn(addPayment);
  const update = useServerFn(editStudent);
  const destroy = useServerFn(removeStudent);
  const token = getStoredToken() ?? "";

  const [search, setSearch] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    level: "",
    balance: "0",
    groupId: "",
    email: "",
    entranceFeeEnabled: false,
    entranceFeeAmount: "50",
    familyEnabled: false,
    siblingIds: [] as string[],
    familyPaymentTotal: "",
  });
  const [payAmount, setPayAmount] = useState("");
  const [editForm, setEditForm] = useState<{
    id: string;
    name: string;
    phone: string;
    level: string;
    balance: string;
    groupId: string;
    email: string;
    guardianName: string;
    guardianPhone: string;
    address: string;
    notes: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);

  const onSuccess = (snapshot: LmsSnapshot) => {
    queryClient.setQueryData(snapshotQuery.queryKey, snapshot);
  };

  const resetForm = () =>
    setForm({
      name: "",
      phone: "",
      level: "",
      balance: "0",
      groupId: "",
      email: "",
      entranceFeeEnabled: false,
      entranceFeeAmount: "50",
      familyEnabled: false,
      siblingIds: [],
      familyPaymentTotal: "",
    });

  const registerMutation = useMutation({
    mutationFn: () => {
      const entranceFee =
        form.entranceFeeEnabled ? Math.max(0, Number(form.entranceFeeAmount) || 0) : 0;
      const familyPaymentTotal =
        form.familyEnabled ? Math.max(0, Number(form.familyPaymentTotal) || 0) : 0;
      return register({
        data: {
          token,
          name: form.name,
          phone: form.phone,
          level: form.level,
          balance: Number(form.balance) || 0,
          email: form.email,
          ...(form.groupId ? { groupId: form.groupId } : {}),
          ...(entranceFee > 0 ? { entranceFee } : {}),
          ...(form.familyEnabled && familyPaymentTotal > 0
            ? { siblingIds: form.siblingIds, familyPaymentTotal }
            : {}),
        },
      });
    },
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setOpenNew(false);
      resetForm();
      toast.success("Student registered");
    },
    onError: () => toast.error("Could not register the student"),
  });

  const payMutation = useMutation({
    mutationFn: (input: { studentId: string; amount: number }) =>
      pay({ data: { token, ...input } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setPayAmount("");
      toast.success("Payment recorded");
    },
    onError: () => toast.error("Could not record the payment"),
  });

  const editMutation = useMutation({
    mutationFn: (input: NonNullable<typeof editForm>) =>
      update({
        data: {
          token,
          id: input.id,
          name: input.name,
          phone: input.phone,
          level: input.level,
          balance: Number(input.balance) || 0,
          groupId: input.groupId,
          email: input.email,
          guardianName: input.guardianName,
          guardianPhone: input.guardianPhone,
          address: input.address,
          notes: input.notes,
        },
      }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setEditForm(null);
      toast.success("Student updated");
    },
    onError: () => toast.error("Could not update the student"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => destroy({ data: { token, id } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setPendingDelete(null);
      setSelectedId(null);
      toast.success("Student deleted");
    },
    onError: () => toast.error("Could not delete the student"),
  });

  const groupNameById = useMemo(
    () => new Map(data.groups.map((g) => [g.id, g.name] as const)),
    [data.groups],
  );

  const activeEnrollmentByStudent = useMemo(() => {
    const map = new Map<string, Enrollment>();
    for (const e of data.enrollments) {
      if (e.status === "active") map.set(e.studentId, e);
    }
    return map;
  }, [data.enrollments]);

  const groupName = (id: string) => groupNameById.get(id) ?? "—";

  const openEdit = (student: Student) => {
    const enrollment = activeEnrollmentByStudent.get(student.id);
    setEditForm({
      id: student.id,
      name: student.name,
      phone: student.phone,
      level: student.level,
      balance: String(student.balance),
      groupId: enrollment?.groupId ?? "",
      email: student.email,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      address: student.address,
      notes: student.notes,
    });
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.students;
    return data.students.filter((s) => s.name.toLowerCase().includes(term));
  }, [data.students, search]);

  const selected = useMemo(
    () => data.students.find((s) => s.id === selectedId) ?? null,
    [data.students, selectedId],
  );

  const { timeline, attended, sessionCount } = useMemo(() => {
    if (!selected) {
      return { timeline: [] as LmsSnapshot["attendance"], attended: 0, sessionCount: 0 };
    }
    const list = data.attendance
      .filter((a) => a.studentId === selected.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const present = list.filter((a) => a.status === "present").length;
    const sessions = list.filter((a) => a.status !== "cancelled").length;
    return { timeline: list, attended: present, sessionCount: sessions };
  }, [data.attendance, selected]);

  const attendancePct =
    sessionCount > 0 ? `${Math.round((attended / Math.max(sessionCount, 1)) * 100)}%` : "—";

  return (
    <AppShell
      title="Student Registry"
      subtitle={`${data.students.length} students`}
      actions={
        <button
          type="button"
          disabled={!unlocked}
          onClick={() => {
            resetForm();
            setOpenNew(true);
          }}
          className="flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-40"
        >
          <Plus className="size-5" /> Register
        </button>
      }
    >
      <div className="relative mb-5">
        <Search className="absolute top-3.5 left-4 size-5 text-muted-foreground" />
        <Input
          className="h-12 rounded-2xl pl-12 text-base"
          placeholder="Search students"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2 pb-8">
        {filtered.map((student) => {
          const enrollment = activeEnrollmentByStudent.get(student.id);
          const groupLabel = enrollment ? groupName(enrollment.groupId) : "No group";
          const overdue = student.balance < 0;

          return (
            <div
              key={student.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 shadow-sm sm:px-4"
            >
              <button
                type="button"
                onClick={() => {
                  setPayAmount("");
                  setSelectedId(student.id);
                }}
                className="flex min-w-0 flex-1 basis-48 flex-col text-left"
              >
                <span className="truncate text-base font-semibold text-foreground sm:text-lg">
                  {student.name}
                </span>
                <span className="truncate text-xs text-muted-foreground sm:text-sm">
                  {groupLabel}
                  {student.level ? ` · ${student.level}` : ""}
                </span>
              </button>

              <span
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
                  overdue
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary",
                )}
              >
                {formatMoney(student.balance)}
              </span>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => openEdit(student)}
                  aria-label={`Edit ${student.name}`}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary px-3 font-semibold text-secondary-foreground disabled:opacity-40"
                >
                  <Pencil className="size-5" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  type="button"
                  disabled={!unlocked || deleteMutation.isPending}
                  onClick={() => setPendingDelete(student)}
                  aria-label={`Delete ${student.name}`}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-destructive/10 px-3 font-semibold text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-5" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-muted-foreground">
            {search.trim()
              ? "No student matches that name."
              : "No students yet. Unlock with the padlock and tap Register to add one."}
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
                className="h-12 text-base"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone">
                <Input
                  className="h-12 text-base"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Level">
                <Input
                  className="h-12 text-base"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Email">
              <Input
                className="h-12 text-base"
                inputMode="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Starting balance">
              <Input
                className="h-12 text-base"
                inputMode="decimal"
                value={form.balance}
                onChange={(e) => setForm({ ...form, balance: e.target.value })}
              />
            </Field>

            <div className="rounded-2xl border border-border p-3">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={form.entranceFeeEnabled}
                  onChange={(e) =>
                    setForm({ ...form, entranceFeeEnabled: e.target.checked })
                  }
                />
                <span className="text-sm font-semibold text-foreground">
                  Entrance fee paid
                </span>
              </label>
              {form.entranceFeeEnabled ? (
                <div className="mt-3 grid gap-2">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Amount
                  </Label>
                  <Input
                    className="h-11 text-base"
                    inputMode="decimal"
                    value={form.entranceFeeAmount}
                    onChange={(e) =>
                      setForm({ ...form, entranceFeeAmount: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Credited to starting balance.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-border p-3">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={form.familyEnabled}
                  onChange={(e) => setForm({ ...form, familyEnabled: e.target.checked })}
                />
                <span className="text-sm font-semibold text-foreground">
                  Family / sibling payment
                </span>
              </label>
              {form.familyEnabled ? (
                <div className="mt-3 grid gap-3">
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Siblings in system (optional)
                    </Label>
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-border">
                      {data.students.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          No existing students.
                        </p>
                      ) : (
                        data.students.map((s) => (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                          >
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={form.siblingIds.includes(s.id)}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  siblingIds: e.target.checked
                                    ? [...form.siblingIds, s.id]
                                    : form.siblingIds.filter((id) => id !== s.id),
                                })
                              }
                            />
                            <span className="text-sm">{s.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Total paid by parent
                    </Label>
                    <Input
                      className="h-11 text-base"
                      inputMode="decimal"
                      placeholder="e.g. 300"
                      value={form.familyPaymentTotal}
                      onChange={(e) =>
                        setForm({ ...form, familyPaymentTotal: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Split equally across {form.siblingIds.length + 1}{" "}
                      {form.siblingIds.length + 1 === 1 ? "student" : "students"}.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <Field label="Group">
              <div className="flex flex-wrap gap-2">
                {data.groups
                  .filter((g) => g.status === "active")
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        setForm({ ...form, groupId: form.groupId === g.id ? "" : g.id })
                      }
                      className={cn(
                        "min-h-12 rounded-2xl px-4 font-semibold",
                        form.groupId === g.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {g.name}
                    </button>
                  ))}
              </div>
            </Field>

            <button
              type="button"
              disabled={!form.name || registerMutation.isPending}
              onClick={() => registerMutation.mutate()}
              className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
            >
              {registerMutation.isPending ? "Saving…" : "Register student"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Balance" value={formatMoney(selected.balance)} />
                <Stat label="Attendance" value={attendancePct} />
              </div>

              <div className="flex gap-2">
                <Input
                  className="h-12 text-base"
                  inputMode="decimal"
                  placeholder="Payment amount"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  disabled={!unlocked}
                />
                <button
                  type="button"
                  disabled={!unlocked || !payAmount || payMutation.isPending}
                  onClick={() =>
                    payMutation.mutate({
                      studentId: selected.id,
                      amount: Number(payAmount) || 0,
                    })
                  }
                  className="flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-40"
                >
                  <Wallet className="size-5" /> Add
                </button>
              </div>

              <div className="grid gap-2">
                <p className="text-sm font-semibold text-muted-foreground">History</p>
                {timeline.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                  >
                    {entry.status === "present" ? (
                      <CalendarCheck className="size-5 text-brand-orange" />
                    ) : entry.status === "absent" ? (
                      <CalendarX className="size-5 text-destructive" />
                    ) : (
                      <CalendarMinus className="size-5 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{entry.date}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {groupName(entry.groupId)} · {labelForStatus(entry.status)}
                      </p>
                    </div>
                    {entry.status !== "cancelled" ? (
                      <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
                        {formatMoney(entry.amount)}
                      </span>
                    ) : null}
                  </div>
                ))}
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No history yet.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editForm !== null} onOpenChange={(open) => !open && setEditForm(null)}>
        <DialogContent className="top-0 left-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none border-0 p-6 sm:max-w-none sm:rounded-none">
          <DialogHeader>
            <DialogTitle className="text-2xl">Edit student</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <div className="mx-auto grid w-full max-w-4xl gap-6 pb-8">
              <section className="grid gap-4">
                <h3 className="text-lg font-bold text-foreground">Student</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name">
                    <Input
                      className="h-12 text-base"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Level">
                    <Input
                      className="h-12 text-base"
                      value={editForm.level}
                      onChange={(e) => setEditForm({ ...editForm, level: e.target.value })}
                    />
                  </Field>
                </div>
              </section>

              <section className="grid gap-4">
                <h3 className="text-lg font-bold text-foreground">Contact details</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Phone">
                    <Input
                      className="h-12 text-base"
                      inputMode="tel"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      className="h-12 text-base"
                      inputMode="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    />
                  </Field>
                  <Field label="Parent / guardian name">
                    <Input
                      className="h-12 text-base"
                      value={editForm.guardianName}
                      onChange={(e) => setEditForm({ ...editForm, guardianName: e.target.value })}
                    />
                  </Field>
                  <Field label="Parent / guardian phone">
                    <Input
                      className="h-12 text-base"
                      inputMode="tel"
                      value={editForm.guardianPhone}
                      onChange={(e) => setEditForm({ ...editForm, guardianPhone: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Address">
                  <Input
                    className="h-12 text-base"
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  />
                </Field>
                <Field label="Notes">
                  <textarea
                    rows={3}
                    className="min-h-24 w-full rounded-xl border border-input bg-transparent px-4 py-3 text-base"
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </Field>
              </section>

              <section className="grid gap-4">
                <h3 className="text-lg font-bold text-foreground">Class and balance</h3>
                <Field label="Balance">
                  <Input
                    className="h-12 text-base"
                    inputMode="decimal"
                    value={editForm.balance}
                    onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })}
                  />
                </Field>
                <Field label="Group">
                  <div className="flex flex-wrap gap-2">
                    {data.groups
                      .filter((g) => g.status === "active")
                      .map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() =>
                            setEditForm({
                              ...editForm,
                              groupId: editForm.groupId === g.id ? "" : g.id,
                            })
                          }
                          className={cn(
                            "min-h-12 rounded-2xl px-4 font-semibold",
                            editForm.groupId === g.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-secondary-foreground",
                          )}
                        >
                          {g.name}
                        </button>
                      ))}
                  </div>
                </Field>
              </section>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setEditForm(null)}
                  className="min-h-14 rounded-2xl bg-secondary text-lg font-bold text-secondary-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!editForm.name || editMutation.isPending}
                  onClick={() => editMutation.mutate(editForm)}
                  className="min-h-14 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-50"
                >
                  {editMutation.isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
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
            This removes the student, their group enrollment, and their attendance and payment
            history from the sheet. This cannot be undone.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </div>
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