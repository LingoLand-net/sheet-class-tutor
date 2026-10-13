import {
  TRIMESTER_SIZES,
  todayIso,
  type AttendanceRecord,
  type AttendanceStatus,
  type Enrollment,
  type Group,
  type LmsSnapshot,
  type RollCallEntry,
  type Session,
  type Student,
  type Trimester,
} from "./lms-types";

const SHEETS_API = "https://sheets.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const CACHE_TTL_MS = 300_000;

type Store = {
  groups: Group[];
  students: Student[];
  enrollments: Enrollment[];
  sessions: Session[];
  attendance: AttendanceRecord[];
};

type Tab = "groups" | "students" | "enrollments" | "sessions" | "attendance";
const ALL_TABS: readonly Tab[] = ["groups", "students", "enrollments", "sessions", "attendance"];

type SheetsConfig = { clientEmail: string; privateKey: string; spreadsheetId: string };

let memoryStore: Store | undefined;
let cache: { snapshot: LmsSnapshot; at: number } | undefined;
let tokenCache: { token: string; expiresAt: number } | undefined;
let keyCache: CryptoKey | undefined;

function sheetsConfig(): SheetsConfig | undefined {
  const clientEmail = process.env["GOOGLE_SHEETS_CLIENT_EMAIL"];
  const rawKey = process.env["GOOGLE_SHEETS_PRIVATE_KEY"];
  const spreadsheetId = process.env["GOOGLE_SHEETS_SPREADSHEET_ID"];
  if (!clientEmail || !rawKey || !spreadsheetId) return undefined;
  return { clientEmail, privateKey: rawKey.replace(/\\n/g, "\n"), spreadsheetId };
}

export function sheetsConnected(): boolean {
  return sheetsConfig() !== undefined;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function stringToBase64Url(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input));
}
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getSigningKey(pem: string): Promise<CryptoKey> {
  if (keyCache) return keyCache;
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(body);
  keyCache = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  return keyCache;
}

async function getAccessToken(cfg: SheetsConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now };
  const signingInput = `${stringToBase64Url(JSON.stringify(header))}.${stringToBase64Url(JSON.stringify(claim))}`;
  const key = await getSigningKey(cfg.privateKey);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token exchange failed [${response.status}]: ${body}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function gateway(path: string, init?: RequestInit): Promise<unknown> {
  const cfg = sheetsConfig()!;
  const token = await getAccessToken(cfg);
  const response = await fetch(`${SHEETS_API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Sheets API failed [${response.status}]: ${body}`);
    throw new Error(`Sheets request failed [${response.status}]: ${body}`);
  }
  return response.json();
}

function rowsOf(result: unknown, index: number): string[][] {
  const ranges = (result as { valueRanges?: { values?: string[][] }[] }).valueRanges ?? [];
  const values = ranges[index]?.values ?? [];
  return values.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
}

function parseTrimester(v: unknown): Trimester {
  const n = Number(String(v ?? "1").replace(/[^0-9]/g, ""));
  return n === 2 ? 2 : n === 3 ? 3 : 1;
}

function parseAttendanceStatus(v: unknown): AttendanceStatus {
  const s = String(v ?? "").toLowerCase();
  if (s === "absent") return "absent";
  if (s === "present") return "present";
  return "";
}

function parseBool(v: unknown): boolean {
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

async function readFromSheets(): Promise<Store> {
  const cfg = sheetsConfig()!;
  const ranges = [
    "GROUPS!A1:F500",
    "STUDENTS!A1:K2000",
    "ENROLLMENTS!A1:D5000",
    "SESSIONS!A1:E10000",
    "ATTENDANCE!A1:E50000",
  ].map((r) => `ranges=${r}`).join("&");
  const result = await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchGet?${ranges}`);

  return {
    groups: rowsOf(result, 0).map((r) => ({
      id: r[0] ?? "", name: r[1] ?? "", level: r[2] ?? "",
      teacher: r[3] ?? "", schedule: r[4] ?? "",
      status: (r[5] ?? "active").toLowerCase() === "archived" ? "archived" : "active",
    })),
    students: rowsOf(result, 1).map((r) => ({
      id: r[0] ?? "", name: r[1] ?? "", phone: r[2] ?? "", level: r[3] ?? "",
      createdAt: r[4] ?? "", email: r[5] ?? "",
      guardianName: r[6] ?? "", guardianPhone: r[7] ?? "",
      address: r[8] ?? "", notes: r[9] ?? "",
    })),
    enrollments: rowsOf(result, 2).map((r) => ({
      id: r[0] ?? "", studentId: r[1] ?? "", groupId: r[2] ?? "",
      status: (r[3] ?? "active").toLowerCase() === "inactive" ? "inactive" : "active",
    })),
    sessions: rowsOf(result, 3).map((r) => ({
      id: r[0] ?? "", groupId: r[1] ?? "",
      trimester: parseTrimester(r[2]),
      sessionNumber: Number(r[3]) || 1,
      date: r[4] ?? "",
    })),
    attendance: rowsOf(result, 4).map((r) => ({
      id: r[0] ?? "", sessionId: r[1] ?? "", studentId: r[2] ?? "",
      status: parseAttendanceStatus(r[3]),
      paid: parseBool(r[4]),
    })),
  };
}

function groupRow(g: Group): (string | number)[] {
  return [g.id, g.name, g.level, g.teacher, g.schedule, g.status];
}
function studentRow(s: Student): (string | number)[] {
  return [s.id, s.name, s.phone, s.level, s.createdAt, s.email, s.guardianName, s.guardianPhone, s.address, s.notes];
}
function enrollmentRow(e: Enrollment): (string | number)[] {
  return [e.id, e.studentId, e.groupId, e.status];
}
function sessionRow(s: Session): (string | number)[] {
  return [s.id, s.groupId, s.trimester, s.sessionNumber, s.date];
}
function attendanceRow(a: AttendanceRecord): (string | number)[] {
  return [a.id, a.sessionId, a.studentId, a.status, a.paid ? "TRUE" : "FALSE"];
}

function emptyStore(): Store {
  return { groups: [], students: [], enrollments: [], sessions: [], attendance: [] };
}
function getMemoryStore(): Store {
  if (!memoryStore) memoryStore = emptyStore();
  return memoryStore;
}
function cloneStore(store: Store): Store {
  return {
    groups: [...store.groups], students: [...store.students],
    enrollments: [...store.enrollments], sessions: [...store.sessions],
    attendance: [...store.attendance],
  };
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function ensureAllSessions(store: Store): { store: Store; added: number } {
  const have = new Set(store.sessions.map((s) => `${s.groupId}|${s.trimester}|${s.sessionNumber}`));
  const additions: Session[] = [];
  for (const g of store.groups) {
    for (const trimester of [1, 2, 3] as Trimester[]) {
      const size = TRIMESTER_SIZES[trimester];
      for (let n = 1; n <= size; n++) {
        if (!have.has(`${g.id}|${trimester}|${n}`)) {
          additions.push({ id: newId("sess"), groupId: g.id, trimester, sessionNumber: n, date: "" });
        }
      }
    }
  }
  if (additions.length === 0) return { store, added: 0 };
  return { store: { ...store, sessions: [...store.sessions, ...additions] }, added: additions.length };
}

async function replaceTabs(store: Store, tabs: readonly Tab[]): Promise<boolean> {
  if (!sheetsConnected()) { memoryStore = store; return false; }
  const cfg = sheetsConfig()!;
  const clearRanges: string[] = [];
  const updates: { range: string; values: (string | number)[][] }[] = [];

  if (tabs.includes("groups")) {
    clearRanges.push("GROUPS!A2:F20000");
    updates.push({ range: "GROUPS!A2", values: store.groups.map(groupRow) });
  }
  if (tabs.includes("students")) {
    clearRanges.push("STUDENTS!A2:K20000");
    updates.push({ range: "STUDENTS!A2", values: store.students.map(studentRow) });
  }
  if (tabs.includes("enrollments")) {
    clearRanges.push("ENROLLMENTS!A2:D20000");
    updates.push({ range: "ENROLLMENTS!A2", values: store.enrollments.map(enrollmentRow) });
  }
  if (tabs.includes("sessions")) {
    clearRanges.push("SESSIONS!A2:E20000");
    updates.push({ range: "SESSIONS!A2", values: store.sessions.map(sessionRow) });
  }
  if (tabs.includes("attendance")) {
    clearRanges.push("ATTENDANCE!A2:E50000");
    updates.push({ range: "ATTENDANCE!A2", values: store.attendance.map(attendanceRow) });
  }

  try {
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchClear`, {
      method: "POST", body: JSON.stringify({ ranges: clearRanges }),
    });
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: updates.filter((d) => d.values.length > 0),
      }),
    });
    return true;
  } catch { memoryStore = store; return false; }
}

function commit(store: Store, synced: boolean): LmsSnapshot {
  const source: LmsSnapshot["source"] = synced && sheetsConnected() ? "sheets" : "sample";
  if (source === "sample") memoryStore = store;
  const snapshot: LmsSnapshot = { ...cloneStore(store), source };
  cache = { snapshot, at: Date.now() };
  return snapshot;
}

async function currentStore(): Promise<Store> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cloneStore(cache.snapshot);
  if (!sheetsConnected()) return getMemoryStore();
  const store = await readFromSheets();
  cache = { snapshot: { ...cloneStore(store), source: "sheets" }, at: Date.now() };
  return store;
}

export async function loadSnapshot(force = false): Promise<LmsSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    const healed = ensureAllSessions(cloneStore(cache.snapshot as unknown as Store));
    if (healed.added === 0) return cache.snapshot;
    await replaceTabs(healed.store, ["sessions"]);
    return commit(healed.store, true);
  }

  let store: Store;
  if (sheetsConnected()) store = await readFromSheets();
  else store = getMemoryStore();

  const healed = ensureAllSessions(store);
  if (healed.added > 0 && sheetsConnected()) {
    await replaceTabs(healed.store, ["sessions"]);
  }
  cache = { snapshot: { ...cloneStore(healed.store), source: sheetsConnected() ? "sheets" : "sample" }, at: Date.now() };
  return cache.snapshot;
}

export async function upsertGroup(
  group: Omit<Group, "id"> & { id?: string | undefined },
): Promise<LmsSnapshot> {
  const store = await currentStore();
  let groupId: string;
  if (group.id) {
    groupId = group.id;
    store.groups = store.groups.map((g) => (g.id === group.id ? ({ ...g, ...group } as Group) : g));
  } else {
    groupId = newId("g");
    store.groups = [...store.groups, { ...group, id: groupId } as Group];
  }
  const healed = ensureAllSessions(store);
  return commit(healed.store, await replaceTabs(healed.store, ["groups", "sessions"]));
}

export async function setGroupStatus(id: string, status: Group["status"]): Promise<LmsSnapshot> {
  const store = await currentStore();
  const group = store.groups.find((g) => g.id === id);
  if (!group) return loadSnapshot();
  return upsertGroup({ ...group, status });
}

export async function deleteGroup(id: string): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.groups = store.groups.filter((g) => g.id !== id);
  const sessionIds = new Set(store.sessions.filter((s) => s.groupId === id).map((s) => s.id));
  store.sessions = store.sessions.filter((s) => s.groupId !== id);
  store.enrollments = store.enrollments.filter((e) => e.groupId !== id);
  store.attendance = store.attendance.filter((a) => !sessionIds.has(a.sessionId));
  return commit(store, await replaceTabs(store, ["groups", "sessions", "enrollments", "attendance"]));
}

export async function saveSessionDates(input: {
  groupId: string;
  dates: Record<string, string>;
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.sessions = store.sessions.map((s) =>
    s.groupId === input.groupId && s.id in input.dates
      ? { ...s, date: input.dates[s.id] ?? "" }
      : s,
  );
  return commit(store, await replaceTabs(store, ["sessions"]));
}

export async function createStudent(input: {
  name: string;
  phone?: string;
  level?: string;
  email?: string;
  guardianName?: string;
  guardianPhone?: string;
  address?: string;
  notes?: string;
  enrollments?: { groupId: string; paidSessionIds: string[] }[];
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const student: Student = {
    id: newId("s"),
    name: input.name,
    phone: input.phone ?? "",
    level: input.level ?? "",
    createdAt: todayIso(),
    email: input.email ?? "",
    guardianName: input.guardianName ?? "",
    guardianPhone: input.guardianPhone ?? "",
    address: input.address ?? "",
    notes: input.notes ?? "",
  };
  store.students = [...store.students, student];

  for (const pick of input.enrollments ?? []) {
    store.enrollments = [
      ...store.enrollments,
      { id: newId("e"), studentId: student.id, groupId: pick.groupId, status: "active" },
    ];
    for (const sessionId of pick.paidSessionIds) {
      store.attendance = [
        ...store.attendance,
        { id: newId("a"), sessionId, studentId: student.id, status: "", paid: true },
      ];
    }
  }

  return commit(store, await replaceTabs(store, ["students", "enrollments", "attendance"]));
}

export async function updateStudent(input: {
  id: string;
  name: string;
  phone: string;
  level: string;
  email: string;
  guardianName: string;
  guardianPhone: string;
  address: string;
  notes: string;
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.students = store.students.map((s) => (s.id === input.id ? { ...s, ...input } : s));
  return commit(store, await replaceTabs(store, ["students"]));
}

export async function deleteStudent(id: string): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.students = store.students.filter((s) => s.id !== id);
  store.enrollments = store.enrollments.filter((e) => e.studentId !== id);
  store.attendance = store.attendance.filter((a) => a.studentId !== id);
  return commit(store, await replaceTabs(store, ["students", "enrollments", "attendance"]));
}

export async function enrollStudent(studentId: string, groupId: string): Promise<LmsSnapshot> {
  const store = await currentStore();
  const existing = store.enrollments.find(
    (e) => e.studentId === studentId && e.groupId === groupId,
  );
  if (existing) {
    if (existing.status !== "active") {
      store.enrollments = store.enrollments.map((e) =>
        e.id === existing.id ? { ...e, status: "active" } : e,
      );
    }
  } else {
    store.enrollments = [
      ...store.enrollments,
      { id: newId("e"), studentId, groupId, status: "active" },
    ];
  }
  return commit(store, await replaceTabs(store, ["enrollments"]));
}

export async function unenrollStudent(studentId: string, groupId: string): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.enrollments = store.enrollments.map((e) =>
    e.studentId === studentId && e.groupId === groupId ? { ...e, status: "inactive" } : e,
  );
  return commit(store, await replaceTabs(store, ["enrollments"]));
}

/**
 * Save roll call. An empty status means "no record" — the record is deleted
 * unless it carries a payment flag we don't want to lose.
 */
export async function saveRollCall(input: {
  sessionId: string;
  entries: RollCallEntry[];
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const session = store.sessions.find((s) => s.id === input.sessionId);
  if (!session) return loadSnapshot();

  const prior = new Map<string, AttendanceRecord>();
  for (const a of store.attendance) {
    if (a.sessionId === input.sessionId) prior.set(a.studentId, a);
  }

  const touched = new Set(input.entries.map((e) => e.studentId));
  store.attendance = store.attendance.filter(
    (a) => !(a.sessionId === input.sessionId && touched.has(a.studentId)),
  );

  for (const entry of input.entries) {
    const prev = prior.get(entry.studentId);
    // If the caller cleared attendance but there's a payment flag, keep the
    // record with an empty status so the payment isn't lost.
    if (entry.status === "" && !prev?.paid) continue;
    store.attendance.push({
      id: prev?.id ?? newId("a"),
      sessionId: input.sessionId,
      studentId: entry.studentId,
      status: entry.status,
      paid: prev?.paid ?? false,
    });
  }

  return commit(store, await replaceTabs(store, ["attendance"]));
}

export async function setStudentSessions(input: {
  studentId: string;
  updates: {
    sessionId: string;
    status?: AttendanceStatus;
    paid?: boolean;
    clear?: boolean;
  }[];
}): Promise<LmsSnapshot> {
  const store = await currentStore();

  const clearIds = new Set(input.updates.filter((u) => u.clear).map((u) => u.sessionId));
  if (clearIds.size > 0) {
    store.attendance = store.attendance.filter(
      (a) => !(a.studentId === input.studentId && clearIds.has(a.sessionId)),
    );
  }

  const existing = new Map<string, AttendanceRecord>();
  for (const a of store.attendance) {
    if (a.studentId === input.studentId) existing.set(a.sessionId, a);
  }

  for (const u of input.updates) {
    if (u.clear) continue;
    const prev = existing.get(u.sessionId);
    const nextStatus = u.status !== undefined ? u.status : (prev?.status ?? "");
    const nextPaid = u.paid !== undefined ? u.paid : (prev?.paid ?? false);

    // If both are empty, drop the row entirely.
    if (nextStatus === "" && nextPaid === false) {
      if (prev) {
        store.attendance = store.attendance.filter((a) => a.id !== prev.id);
      }
      continue;
    }

    if (prev) {
      store.attendance = store.attendance.map((a) =>
        a.id === prev.id ? { ...a, status: nextStatus, paid: nextPaid } : a,
      );
    } else {
      store.attendance = [
        ...store.attendance,
        {
          id: newId("a"),
          sessionId: u.sessionId,
          studentId: input.studentId,
          status: nextStatus,
          paid: nextPaid,
        },
      ];
    }
  }

  return commit(store, await replaceTabs(store, ["attendance"]));
}

export async function studentHistory(studentId: string): Promise<{
  student: Student | undefined;
  records: AttendanceRecord[];
}> {
  const snapshot = await loadSnapshot();
  return {
    student: snapshot.students.find((s) => s.id === studentId),
    records: snapshot.attendance.filter((a) => a.studentId === studentId),
  };
}

/* ---------- Test seed ---------- */

const SEED_GROUPS = [
  { name: "Beginner Spanish", level: "A1", teacher: "Ms. Lucía Ramos", schedule: "Mon/Wed 17:30" },
  { name: "Business English", level: "B2", teacher: "Mr. David Cole", schedule: "Tue/Thu 19:00" },
  { name: "French A1", level: "A1", teacher: "Mme. Claire Petit", schedule: "Sat 10:00" },
  { name: "Informati9", level: "Beginners", teacher: "Ali", schedule: "Fri 18:00" },
  { name: "Communication Path", level: "B1", teacher: "Mr. Bessem", schedule: "Sun 16:00" },
];

const SEED_STUDENTS = [
  "Amina Haddad", "Youssef Barakat", "Lea Mansour", "Omar Chidiac", "Priya Nair",
  "Nour Fares", "Rami Kassem", "Dina Sleiman", "Karim Ayoub", "Elena Fischer",
  "Maya Rizk", "Hadi Nassar", "Sara Khoury", "Tomas Alvarez", "Jing Wei Liu",
  "Lina Trabelsi", "Mehdi Bouazizi", "Yasmine Gharbi", "Khalil Ben Amor", "Ines Chaabane",
  "Ayoub Ferchichi", "Salma Hammami", "Rania Bouhlel", "Wassim Jendoubi",
];

export async function seedTestData(): Promise<LmsSnapshot> {
  const store: Store = emptyStore();

  const groups: Group[] = SEED_GROUPS.map((g) => ({
    id: newId("g"),
    name: g.name,
    level: g.level,
    teacher: g.teacher,
    schedule: g.schedule,
    status: "active",
  }));
  store.groups = groups;

  // Sessions: Tue/Thu cadence starting Sep 8 2026.
  const baseDate = new Date("2026-09-08T00:00:00");
  for (const g of groups) {
    let cursor = new Date(baseDate);
    for (const trimester of [1, 2, 3] as Trimester[]) {
      const size = TRIMESTER_SIZES[trimester];
      for (let n = 1; n <= size; n++) {
        while (cursor.getDay() !== 2 && cursor.getDay() !== 4) {
          cursor.setDate(cursor.getDate() + 1);
        }
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        store.sessions.push({
          id: newId("sess"),
          groupId: g.id,
          trimester,
          sessionNumber: n,
          date: `${y}-${m}-${d}`,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      cursor.setDate(cursor.getDate() + 14);
    }
  }

  const students: Student[] = SEED_STUDENTS.map((name, i) => {
    const parts = name.toLowerCase().split(/\s+/);
    return {
      id: newId("s"),
      name,
      phone: `+216 ${20 + (i % 10)} ${100 + i} ${200 + i}`,
      level: ["A1", "A2", "B1", "B2"][i % 4]!,
      createdAt: todayIso(),
      email: `${parts.join(".")}@example.com`,
      guardianName: "",
      guardianPhone: "",
      address: "",
      notes: "",
    };
  });
  store.students = students;

  for (const s of students) {
    const primary = groups[Math.floor(Math.random() * groups.length)]!;
    store.enrollments.push({
      id: newId("e"),
      studentId: s.id,
      groupId: primary.id,
      status: "active",
    });
    if (Math.random() < 0.3) {
      const secondary = groups[Math.floor(Math.random() * groups.length)]!;
      if (secondary.id !== primary.id) {
        store.enrollments.push({
          id: newId("e"),
          studentId: s.id,
          groupId: secondary.id,
          status: "active",
        });
      }
    }
  }

  const today = todayIso();
  for (const e of store.enrollments) {
    const sessions = store.sessions.filter((s) => s.groupId === e.groupId);
    for (const sess of sessions) {
      if (!sess.date || sess.date > today) continue;
      // 25% of past sessions left with no record at all — simulates a
      // session the desk lady hasn't recorded, so the year grid shows
      // red-outlined empty boxes.
      if (Math.random() < 0.25) continue;
      const present = Math.random() < 0.85;
      const paid = Math.random() < 0.7;
      store.attendance.push({
        id: newId("a"),
        sessionId: sess.id,
        studentId: e.studentId,
        status: present ? "present" : "absent",
        paid,
      });
    }
  }

  if (sheetsConnected()) {
    const cfg = sheetsConfig()!;
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchClear`, {
      method: "POST",
      body: JSON.stringify({
        ranges: [
          "GROUPS!A2:F20000",
          "STUDENTS!A2:K20000",
          "ENROLLMENTS!A2:D20000",
          "SESSIONS!A2:E20000",
          "ATTENDANCE!A2:E50000",
        ],
      }),
    });
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: [
          { range: "GROUPS!A2", values: store.groups.map(groupRow) },
          { range: "STUDENTS!A2", values: store.students.map(studentRow) },
          { range: "ENROLLMENTS!A2", values: store.enrollments.map(enrollmentRow) },
          { range: "SESSIONS!A2", values: store.sessions.map(sessionRow) },
          { range: "ATTENDANCE!A2", values: store.attendance.map(attendanceRow) },
        ],
      }),
    });
  }

  return commit(store, sheetsConnected());
}