export type GroupStatus = "active" | "archived";
export type Trimester = 1 | 2 | 3;

export const TRIMESTER_SIZES: Record<Trimester, number> = { 1: 10, 2: 9, 3: 7 };
export const TRIMESTER_LABELS: Record<Trimester, string> = { 1: "T1", 2: "T2", 3: "T3" };
export const TRIMESTERS: readonly Trimester[] = [1, 2, 3];

export interface Group {
  id: string;
  name: string;
  level: string;
  teacher: string;
  schedule: string;
  status: GroupStatus;
}

export interface Student {
  id: string;
  name: string;
  phone: string;
  level: string;
  createdAt: string;
  email: string;
  guardianName: string;
  guardianPhone: string;
  address: string;
  notes: string;
}

export interface Enrollment {
  id: string;
  studentId: string;
  groupId: string;
  status: "active" | "inactive";
}

export interface Session {
  id: string;
  groupId: string;
  trimester: Trimester;
  sessionNumber: number;
  date: string;
}

/** "present" | "absent" | "" — empty means no attendance recorded. */
export type AttendanceStatus = "present" | "absent" | "";

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  paid: boolean;
}

export interface LmsSnapshot {
  groups: Group[];
  students: Student[];
  enrollments: Enrollment[];
  sessions: Session[];
  attendance: AttendanceRecord[];
  source: "sheets" | "sample";
}

export interface RollCallEntry {
  studentId: string;
  status: AttendanceStatus;
}

export function attendanceKey(sessionId: string, studentId: string): string {
  return `${sessionId}|${studentId}`;
}

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isPastSession(s: Session): boolean {
  if (!s.date) return false;
  return s.date < todayIso();
}

export type BlockState =
  | "present_paid"
  | "present_unpaid"
  | "absent"
  | "unrecorded"
  | "future";

/**
 * Visual state of a single year-grid box.
 *
 * Attendance and payment are independent facts on each record:
 *   - present + paid      -> solid emerald
 *   - present + not paid  -> solid amber
 *   - absent              -> solid red (regardless of payment)
 *   - past, no record     -> red-outlined empty
 *   - future              -> grey
 */
export function blockState(
  record: AttendanceRecord | undefined,
  session: Session,
): BlockState {
  const past = isPastSession(session);

  if (record) {
    if (record.status === "absent") return "absent";
    if (record.status === "present") {
      return record.paid ? "present_paid" : "present_unpaid";
    }
    // status is "" but a record exists (payment info only)
    if (record.paid) return "present_paid";
  }

  return past ? "unrecorded" : "future";
}