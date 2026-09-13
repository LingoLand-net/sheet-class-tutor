import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Search, Wallet, CalendarCheck, CalendarX, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAdmin } from "@/components/lms/admin-lock";
import { AppShell, SampleBadge } from "@/components/lms/shell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { snapshotQuery } from "@/lib/lms-client";
import { addPayment, editStudent, registerStudent, removeStudent } from "@/lib/lms.functions";
import { formatMoney, type LmsSnapshot, type Student } from "@/lib/lms-types";
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
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery),
  component: StudentsPage,
});

function StudentsPage() {
  const { data } = useSuspenseQuery(snapshotQuery);
  const { unlocked } = useAdmin();
  const queryClient = useQueryClient();
  const register = useServerFn(registerStudent);
  const pay = useServerFn(addPayment);
  const update = useServerFn(editStudent);
  const destroy = useServerFn(removeStudent);

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

  const registerMutation = useMutation({
    mutationFn: () =>
      register({
        data: {
          name: form.name,
          phone: form.phone,
          level: form.level,
          balance: Number(form.balance) || 0,
          email: form.email,
          ...(form.groupId ? { groupId: form.groupId } : {}),
        },
      }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setOpenNew(false);
      setForm({ name: "", phone: "", level: "", balance: "0", groupId: "", email: "" });
      toast.success("Student registered");
    },
    onError: () => toast.error("Could not register the student"),
  });

  const payMutation = useMutation({
    mutationFn: (input: { studentId: string; amount: number }) => pay({ data: input }),
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
    mutationFn: (id: string) => destroy({ data: { id } }),
    onSuccess: (snapshot: LmsSnapshot) => {
      onSuccess(snapshot);
      setPendingDelete(null);
      setSelectedId(null);
      toast.success("Student deleted");
    },
    onError: () => toast.error("Could not delete the student"),
  });

  const openEdit = (student: Student) => {
    const enrollment = data.enrollments.find(
      (e) => e.studentId === student.id && e.status === "active",
    );
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

  const filtered = useMemo(
    () =>
      data.students.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase())),
    [data.students, search],
  );

  const selected = data.students.find((s) => s.id === selectedId) ?? null;
  const timeline = selected
    ? data.attendance
        .filter((a) => a.studentId === selected.id)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];
  const attended = timeline.filter((a) => a.status === "present").length;
  const sessions = timeline.filter((a) => a.status !== "absent" || !a.paid).length;

  const groupName = (id: string) => data.groups.find((g) => g.id === id)?.name ?? "—";

  return (
    <AppShell
      title="Student Registry"
      subtitle={`${data.students.length} students`}
      actions={
        <>
          <SampleBadge source={data.source} />
          <button
            type="button"
            disabled={!unlocked}
            onClick={() => setOpenNew(true)}
            className="flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Plus className="size-5" /> Register
          </button>
        </>
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

      <div className="grid gap-3 pb-8 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((student) => {
          const enrollment = data.enrollments.find(
            (e) => e.studentId === student.id && e.status === "active",
          );
          return (
            <div
              key={student.id}
              className="rounded-3xl border border-border bg-card p-4"
            >
              <button
                type="button"
                onClick={() => setSelectedId(student.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-foreground">{student.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {enrollment ? groupName(enrollment.groupId) : "No group"}
                  </p>
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
              </button>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => openEdit(student)}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-secondary font-semibold text-secondary-foreground disabled:opacity-40"
                >
                  <Pencil className="size-5" /> Edit
                </button>
                <button
                  type="button"
                  disabled={!unlocked || deleteMutation.isPending}
                  onClick={() => setPendingDelete(student)}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-destructive/10 font-semibold text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-5" /> Delete
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <p className="text-muted-foreground">
            No students yet. Unlock with the padlock and tap Register to add one.
          </p>
        ) : null}
      </div>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-lg rounded-3xl">
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
                <Stat
                  label="Attendance"
                  value={
                    sessions > 0 ? `${Math.round((attended / Math.max(sessions, 1)) * 100)}%` : "—"
                  }
                />
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
                      <CalendarCheck className="size-5 text-primary" />
                    ) : (
                      <CalendarX className="size-5 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{entry.date}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {groupName(entry.groupId)} · {entry.status}
                      </p>
                    </div>
                    {entry.paid ? (
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                        +{formatMoney(entry.amount)}
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
        <DialogContent
          className="top-0 left-0 h-[100dvh] content-start w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 p-6 sm:max-w-none"
        >
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
