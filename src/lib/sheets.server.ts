import type {
  AttendanceRecord,
  Enrollment,
  Group,
  LmsSnapshot,
  RollCallEntry,
  Student,
} from "./lms-types";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";
const CACHE_TTL_MS = 30_000;

type Store = {
  groups: Group[];
  students: Student[];
  enrollments: Enrollment[];
  attendance: AttendanceRecord[];
};

let memoryStore: Store | undefined;
let cache: { snapshot: LmsSnapshot; at: number } | undefined;

function sheetsConfig() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["GOOGLE_SHEETS_API_KEY"];
  const spreadsheetId = process.env["GOOGLE_SHEETS_SPREADSHEET_ID"];
  if (!lovableKey || !connectionKey || !spreadsheetId) return undefined;
  return { lovableKey, connectionKey, spreadsheetId };
}

export function sheetsConnected(): boolean {
  return sheetsConfig() !== undefined;
}

async function gateway(path: string, init?: RequestInit): Promise<unknown> {
  const cfg = sheetsConfig()!;
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${cfg.lovableKey}`,
      "X-Connection-Api-Key": cfg.connectionKey,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Sheets gateway failed [${response.status}]: ${body}`);
    throw new Error(`Sheets request failed [${response.status}]: ${body}`);
  }
  return response.json();
}

function num(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown): boolean {
  return ["true", "yes", "1", "paid"].includes(String(value ?? "").toLowerCase());
}

function rowsOf(result: unknown, index: number): string[][] {
  const ranges = (result as { valueRanges?: { values?: string[][] }[] }).valueRanges ?? [];
  const values = ranges[index]?.values ?? [];
  return values.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
}

async function readFromSheets(): Promise<Store> {
  const cfg = sheetsConfig()!;
  const ranges = ["GROUPS!A1:G500", "STUDENTS!A1:F2000", "ENROLLMENTS!A1:D5000", "ATTENDANCE!A1:G20000"]
    .map((r) => `ranges=${r}`)
    .join("&");
  const result = await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchGet?${ranges}`);

  return {
    groups: rowsOf(result, 0).map((r) => ({
      id: r[0] ?? "",
      name: r[1] ?? "",
      level: r[2] ?? "",
      teacher: r[3] ?? "",
      schedule: r[4] ?? "",
      pricePerSession: num(r[5]),
      status: (r[6] ?? "active").toLowerCase() === "archived" ? "archived" : "active",
    })),
    students: rowsOf(result, 1).map((r) => ({
      id: r[0] ?? "",
      name: r[1] ?? "",
      phone: r[2] ?? "",
      level: r[3] ?? "",
      balance: num(r[4]),
      createdAt: r[5] ?? "",
    })),
    enrollments: rowsOf(result, 2).map((r) => ({
      id: r[0] ?? "",
      studentId: r[1] ?? "",
      groupId: r[2] ?? "",
      status: (r[3] ?? "active").toLowerCase() === "inactive" ? "inactive" : "active",
    })),
    attendance: rowsOf(result, 3).map((r) => ({
      id: r[0] ?? "",
      date: r[1] ?? "",
      groupId: r[2] ?? "",
      studentId: r[3] ?? "",
      status: (r[4] ?? "present").toLowerCase() === "absent" ? "absent" : "present",
      paid: bool(r[5]),
      amount: num(r[6]),
    })),
  };
}

async function appendRows(tab: string, rows: (string | number)[][]) {
  const cfg = sheetsConfig()!;
  await gateway(
    `/spreadsheets/${cfg.spreadsheetId}/values/${tab}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}

async function writeRange(range: string, rows: (string | number)[][]) {
  const cfg = sheetsConfig()!;
  await gateway(`/spreadsheets/${cfg.spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: rows }),
  });
}

function groupRow(g: Group): (string | number)[] {
  return [g.id, g.name, g.level, g.teacher, g.schedule, g.pricePerSession, g.status];
}

function studentRow(s: Student): (string | number)[] {
  return [s.id, s.name, s.phone, s.level, s.balance, s.createdAt];
}

function sampleStore(): Store {
  const groups: Group[] = [
    { id: "g1", name: "Beginners A1 — Morning", level: "A1", teacher: "Ms. Nadia", schedule: "Mon/Wed 09:00", pricePerSession: 12, status: "active" },
    { id: "g2", name: "Intermediate B1 — Evening", level: "B1", teacher: "Mr. Karim", schedule: "Tue/Thu 18:00", pricePerSession: 15, status: "active" },
    { id: "g3", name: "IELTS Prep Intensive", level: "C1", teacher: "Ms. Lina", schedule: "Sat 10:00", pricePerSession: 20, status: "active" },
    { id: "g4", name: "Kids A0 — Summer", level: "A0", teacher: "Ms. Rana", schedule: "Fri 11:00", pricePerSession: 10, status: "archived" },
  ];

  const names = [
    ["s1", "Amina Haddad", "A1", "g1", 24],
    ["s2", "Youssef Barakat", "A1", "g1", -12],
    ["s3", "Lea Mansour", "A1", "g1", 0],
    ["s4", "Omar Chidiac", "A1", "g1", 36],
    ["s5", "Nour Fares", "B1", "g2", -15],
    ["s6", "Rami Kassem", "B1", "g2", 45],
    ["s7", "Dina Sleiman", "B1", "g2", 0],
    ["s8", "Karim Ayoub", "B1", "g2", 30],
    ["s9", "Maya Rizk", "C1", "g3", 60],
    ["s10", "Hadi Nassar", "C1", "g3", -20],
    ["s11", "Sara Khoury", "C1", "g3", 20],
    ["s12", "Tarek Zein", "A0", "g4", 0],
  ] as const;

  const students: Student[] = names.map(([id, name, level, , balance], i) => ({
    id,
    name,
    phone: `+961 3 ${100000 + i * 1111}`,
    level,
    balance,
    createdAt: "2026-01-15",
  }));

  const enrollments: Enrollment[] = names.map(([id, , , groupId], i) => ({
    id: `e${i + 1}`,
    studentId: id,
    groupId,
    status: "active",
  }));

  const attendance: AttendanceRecord[] = [];
  const dates = ["2026-09-02", "2026-09-04", "2026-09-07"];
  names.forEach(([id, , , groupId], si) => {
    const group = groups.find((g) => g.id === groupId)!;
    dates.forEach((date, di) => {
      const present = (si + di) % 4 !== 0;
      const paid = (si + di) % 3 === 0;
      attendance.push({
        id: `a${si}-${di}`,
        date,
        groupId,
        studentId: id,
        status: present ? "present" : "absent",
        paid,
        amount: paid ? group.pricePerSession : 0,
      });
    });
  });

  return { groups, students, enrollments, attendance };
}

function getMemoryStore(): Store {
  if (!memoryStore) memoryStore = sampleStore();
  return memoryStore;
}

export async function loadSnapshot(force = false): Promise<LmsSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;

  let snapshot: LmsSnapshot;
  if (sheetsConnected()) {
    try {
      snapshot = { ...(await readFromSheets()), source: "sheets" };
    } catch {
      snapshot = { ...getMemoryStore(), source: "sample" };
    }
  } else {
    snapshot = { ...getMemoryStore(), source: "sample" };
  }
  cache = { snapshot, at: Date.now() };
  return snapshot;
}

function invalidate() {
  cache = undefined;
}

async function currentStore(): Promise<Store> {
  if (!sheetsConnected()) return getMemoryStore();
  try {
    return await readFromSheets();
  } catch {
    return getMemoryStore();
  }
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export async function saveRollCall(input: {
  groupId: string;
  date: string;
  entries: RollCallEntry[];
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const group = store.groups.find((g) => g.id === input.groupId);
  const price = group?.pricePerSession ?? 0;

  const rows: AttendanceRecord[] = input.entries.map((entry) => ({
    id: newId("a"),
    date: input.date,
    groupId: input.groupId,
    studentId: entry.studentId,
    status: entry.status,
    paid: entry.paid,
    amount: entry.paid ? price : 0,
  }));

  const balanceDelta = new Map<string, number>();
  for (const entry of input.entries) {
    const delta = (entry.status === "present" ? -price : 0) + (entry.paid ? price : 0);
    balanceDelta.set(entry.studentId, delta);
  }

  store.attendance = [
    ...store.attendance.filter((a) => !(a.date === input.date && a.groupId === input.groupId)),
    ...rows,
  ];
  store.students = store.students.map((s) =>
    balanceDelta.has(s.id) ? { ...s, balance: s.balance + (balanceDelta.get(s.id) ?? 0) } : s,
  );

  if (sheetsConnected()) {
    try {
      await appendRows("ATTENDANCE", rows.map((r) => [r.id, r.date, r.groupId, r.studentId, r.status, r.paid ? "TRUE" : "FALSE", r.amount]));
      await writeRange("STUDENTS!A2:F2000", store.students.map(studentRow));
    } catch {
      /* keep local changes; surfaced through sample source */
    }
  } else {
    memoryStore = store;
  }
  invalidate();
  return loadSnapshot(true);
}

export async function upsertGroup(group: Omit<Group, "id"> & { id?: string }): Promise<LmsSnapshot> {
  const store = await currentStore();
  if (group.id) {
    store.groups = store.groups.map((g) => (g.id === group.id ? ({ ...g, ...group } as Group) : g));
  } else {
    store.groups = [...store.groups, { ...group, id: newId("g") } as Group];
  }
  if (sheetsConnected()) {
    try {
      await writeRange("GROUPS!A2:G500", store.groups.map(groupRow));
    } catch {
      /* fall back to memory */
    }
  } else {
    memoryStore = store;
  }
  invalidate();
  return loadSnapshot(true);
}

export async function setGroupStatus(id: string, status: Group["status"]): Promise<LmsSnapshot> {
  const store = await currentStore();
  const group = store.groups.find((g) => g.id === id);
  if (!group) return loadSnapshot(true);
  return upsertGroup({ ...group, status });
}

export async function createStudent(input: {
  name: string;
  phone: string;
  level: string;
  balance: number;
  groupId?: string;
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const student: Student = {
    id: newId("s"),
    name: input.name,
    phone: input.phone,
    level: input.level,
    balance: input.balance,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  store.students = [...store.students, student];
  const enrollment: Enrollment | undefined = input.groupId
    ? { id: newId("e"), studentId: student.id, groupId: input.groupId, status: "active" }
    : undefined;
  if (enrollment) store.enrollments = [...store.enrollments, enrollment];

  if (sheetsConnected()) {
    try {
      await appendRows("STUDENTS", [studentRow(student)]);
      if (enrollment)
        await appendRows("ENROLLMENTS", [
          [enrollment.id, enrollment.studentId, enrollment.groupId, enrollment.status],
        ]);
    } catch {
      /* fall back to memory */
    }
  } else {
    memoryStore = store;
  }
  invalidate();
  return loadSnapshot(true);
}

export async function recordPayment(studentId: string, amount: number): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.students = store.students.map((s) =>
    s.id === studentId ? { ...s, balance: s.balance + amount } : s,
  );
  const enrollment = store.enrollments.find((e) => e.studentId === studentId);
  const record: AttendanceRecord = {
    id: newId("a"),
    date: new Date().toISOString().slice(0, 10),
    groupId: enrollment?.groupId ?? "",
    studentId,
    status: "absent",
    paid: true,
    amount,
  };
  store.attendance = [...store.attendance, record];

  if (sheetsConnected()) {
    try {
      await appendRows("ATTENDANCE", [
        [record.id, record.date, record.groupId, record.studentId, "payment", "TRUE", record.amount],
      ]);
      await writeRange("STUDENTS!A2:F2000", store.students.map(studentRow));
    } catch {
      /* fall back to memory */
    }
  } else {
    memoryStore = store;
  }
  invalidate();
  return loadSnapshot(true);
}
