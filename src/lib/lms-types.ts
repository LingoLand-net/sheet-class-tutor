export type GroupStatus = "active" | "archived";

export interface Group {
  id: string;
  name: string;
  level: string;
  teacher: string;
  schedule: string;
  pricePerSession: number;
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

export interface AttendanceRecord {
  id: string;
  date: string;
  groupId: string;
  studentId: string;
  status: "present" | "absent";
  paid: boolean;
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
  status: "present" | "absent";
  paid: boolean;
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
