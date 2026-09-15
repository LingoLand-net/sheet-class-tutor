export type GroupStatus = "active" | "archived";

export interface Group {
  id: string;
  name: string;
  level: string;
  teacher: string;
  schedule: string;
  /** Total monthly fee for the group. Per-session fee is derived. */
  pricePerMonth: number;
  /** How many sessions the group holds per month. Used to split the
   *  monthly fee into a per-session charge. */
  sessionsPerMonth: number;
  status: GroupStatus;
}

export interface Student {
  id: string;
  name: string;
  phone: string;
  level: string;
  balance: number;
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

/**
 * Session attendance status:
 * - present:   student attended; session fee is charged.
 * - absent:    student didn't show; session fee is still charged (monthly model).
 * - cancelled: the whole session did not happen; no fee.
 * - skipped:   one student exempted for this session (pre-arranged); no fee.
 */
export type AttendanceStatus = "present" | "absent" | "cancelled" | "skipped";

export interface AttendanceRecord {
  id: string;
  date: string;
  groupId: string;
  studentId: string;
  status: AttendanceStatus;
  /** Fee charged for this session. 0 when cancelled/skipped. */
  amount: number;
}

export interface LmsSnapshot {
  groups: Group[];
  students: Student[];
  enrollments: Enrollment[];
  attendance: AttendanceRecord[];
  source: "sheets" | "sample";
}

export interface RollCallEntry {
  studentId: string;
  status: AttendanceStatus;
}

/** The per-session fee derived from a group's monthly price. */
export function perSessionPrice(group: Group | undefined): number {
  if (!group || group.sessionsPerMonth <= 0) return 0;
  return group.pricePerMonth / group.sessionsPerMonth;
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/** Local-time YYYY-MM-DD. `toISOString()` is UTC and rolls to tomorrow in
 *  the evening for anyone west of UTC, filing sessions on the wrong day. */
export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}