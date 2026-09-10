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
    { id: "g-spanish", name: "Beginner Spanish", level: "A1", teacher: "Ms. Lucia Ramos", schedule: "Mon/Wed 17:30", pricePerSession: 14, status: "active" },
    { id: "g-business", name: "Business English", level: "B2", teacher: "Mr. David Cole", schedule: "Tue/Thu 19:00", pricePerSession: 22, status: "active" },
    { id: "g-french", name: "French A1", level: "A1", teacher: "Mme. Claire Petit", schedule: "Sat 10:00", pricePerSession: 16, status: "active" },
    { id: "g-italian", name: "Conversational Italian", level: "B1", teacher: "Sig. Marco Rossi", schedule: "Fri 18:00", pricePerSession: 18, status: "archived" },
  ];

  const roster = [
    ["s-01", "Amina Haddad", "+1 202 555 0114", "A1", 28, "g-spanish", "2026-01-12"],
    ["s-02", "Youssef Barakat", "+1 202 555 0129", "A1", -14, "g-spanish", "2026-01-19"],
    ["s-03", "Lea Mansour", "+1 202 555 0137", "A1", 0, "g-spanish", "2026-02-02"],
    ["s-04", "Omar Chidiac", "+1 202 555 0142", "A1", 42, "g-spanish", "2026-02-14"],
    ["s-05", "Priya Nair", "+1 202 555 0158", "A1", 14, "g-spanish", "2026-03-03"],
    ["s-06", "Nour Fares", "+1 202 555 0163", "B2", -22, "g-business", "2026-01-27"],
    ["s-07", "Rami Kassem", "+1 202 555 0171", "B2", 66, "g-business", "2026-02-09"],
    ["s-08", "Dina Sleiman", "+1 202 555 0186", "B2", 0, "g-business", "2026-02-23"],
    ["s-09", "Karim Ayoub", "+1 202 555 0194", "B2", 44, "g-business", "2026-03-16"],
    ["s-10", "Elena Fischer", "+1 202 555 0208", "B2", -44, "g-business", "2026-04-06"],
    ["s-11", "Maya Rizk", "+1 202 555 0215", "A1", 32, "g-french", "2026-01-30"],
    ["s-12", "Hadi Nassar", "+1 202 555 0223", "A1", -16, "g-french", "2026-02-17"],
    ["s-13", "Sara Khoury", "+1 202 555 0231", "A1", 48, "g-french", "2026-03-09"],
    ["s-14", "Tomas Alvarez", "+1 202 555 0247", "A1", 0, "g-french", "2026-04-20"],
    ["s-15", "Jing Wei Liu", "+1 202 555 0256", "B1", 18, "g-italian", "2026-01-08"],
  ] as const;

  const students: Student[] = roster.map(([id, name, phone, level, balance, , createdAt]) => ({
    id,
    name,
    phone,
    level,
    balance,
    createdAt,
  }));

  const enrollments: Enrollment[] = roster.map(([id, , , , , groupId], i) => ({
    id: `e-${String(i + 1).padStart(2, "0")}`,
    studentId: id,
    groupId,
    status: "active",
  }));
  // A returning student also attends the evening business class.
  enrollments.push({ id: "e-16", studentId: "s-11", groupId: "g-business", status: "active" });

  const sessionDates: Record<string, string[]> = {
    "g-spanish": ["2026-08-24", "2026-08-26", "2026-08-31", "2026-09-02", "2026-09-07"],
    "g-business": ["2026-08-25", "2026-08-27", "2026-09-01", "2026-09-03", "2026-09-08"],
    "g-french": ["2026-08-22", "2026-08-29", "2026-09-05"],
  };

  const attendance: AttendanceRecord[] = [];
  let seq = 0;
  for (const enrollment of enrollments) {
    const group = groups.find((g) => g.id === enrollment.groupId);
    const dates = sessionDates[enrollment.groupId];
    if (!group || !dates) continue;
    const offset = Number(enrollment.studentId.slice(-2));
    dates.forEach((date, di) => {
      seq += 1;
      const present = (offset + di) % 5 !== 0;
      const paid = present && (offset + di) % 3 !== 2;
      attendance.push({
        id: `a-${String(seq).padStart(4, "0")}`,
        date,
        groupId: group.id,
        studentId: enrollment.studentId,
        status: present ? "present" : "absent",
        paid,
        amount: paid ? group.pricePerSession : 0,
      });
    });
  }

  // Standalone top-up payments recorded at the front desk.
  const topUps: [string, string, string, number][] = [
    ["s-04", "g-spanish", "2026-08-23", 70],
    ["s-07", "g-business", "2026-08-24", 110],
    ["s-13", "g-french", "2026-08-30", 80],
    ["s-01", "g-spanish", "2026-09-06", 56],
  ];
  topUps.forEach(([studentId, groupId, date, amount], i) => {
    attendance.push({
      id: `p-${String(i + 1).padStart(3, "0")}`,
      date,
      groupId,
      studentId,
      status: "absent",
      paid: true,
      amount,
    });
  });

  return { groups, students, enrollments, attendance };
}

const HEADERS: Record<string, string[]> = {
  GROUPS: ["id", "name", "level", "teacher", "schedule", "price_per_session", "status"],
  STUDENTS: ["id", "name", "phone", "level", "balance", "created_at"],
  ENROLLMENTS: ["id", "student_id", "group_id", "status"],
  ATTENDANCE: ["id", "date", "group_id", "student_id", "status", "paid", "amount"],
};

export async function seedDemoData(): Promise<LmsSnapshot> {
  const store = sampleStore();
  memoryStore = store;

  if (sheetsConnected()) {
    const cfg = sheetsConfig()!;
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchClear`, {
      method: "POST",
      body: JSON.stringify({
        ranges: ["GROUPS!A1:G20000", "STUDENTS!A1:F20000", "ENROLLMENTS!A1:D20000", "ATTENDANCE!A1:G20000"],
      }),
    });
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [
          { range: "GROUPS!A1", values: [HEADERS["GROUPS"]!, ...store.groups.map(groupRow)] },
          { range: "STUDENTS!A1", values: [HEADERS["STUDENTS"]!, ...store.students.map(studentRow)] },
          {
            range: "ENROLLMENTS!A1",
            values: [
              HEADERS["ENROLLMENTS"]!,
              ...store.enrollments.map((e) => [e.id, e.studentId, e.groupId, e.status]),
            ],
          },
          {
            range: "ATTENDANCE!A1",
            values: [
              HEADERS["ATTENDANCE"]!,
              ...store.attendance.map((a) => [
                a.id,
                a.date,
                a.groupId,
                a.studentId,
                a.status,
                a.paid ? "TRUE" : "FALSE",
                a.amount,
              ]),
            ],
          },
        ],
      }),
    });
  }

  invalidate();
  return loadSnapshot(true);
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

export async function upsertGroup(
  group: Omit<Group, "id"> & { id?: string | undefined },
): Promise<LmsSnapshot> {
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
  groupId?: string | undefined;
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
