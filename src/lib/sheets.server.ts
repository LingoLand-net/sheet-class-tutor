import {
  perSessionPrice,
  todayIso,
  type AttendanceRecord,
  type AttendanceStatus,
  type Enrollment,
  type Group,
  type LmsSnapshot,
  type RollCallEntry,
  type Student,
} from "./lms-types";

const SHEETS_API = "https://sheets.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const CACHE_TTL_MS = 300_000;

type Store = {
  groups: Group[];
  students: Student[];
  enrollments: Enrollment[];
  attendance: AttendanceRecord[];
};

type Tab = "groups" | "students" | "enrollments" | "attendance";
const ALL_TABS: readonly Tab[] = ["groups", "students", "enrollments", "attendance"];

type SheetsConfig = {
  clientEmail: string;
  privateKey: string;
  spreadsheetId: string;
};

let memoryStore: Store | undefined;
let cache: { snapshot: LmsSnapshot; at: number } | undefined;

// Cached across requests in the same server process. Google tokens live
// for 1h; we refresh 60s early to avoid using one mid-flight.
let tokenCache: { token: string; expiresAt: number } | undefined;
let keyCache: CryptoKey | undefined;

function sheetsConfig(): SheetsConfig | undefined {
  const clientEmail = process.env["GOOGLE_SHEETS_CLIENT_EMAIL"];
  // Private keys are multiline. Hosting panels usually store them with
  // literal "\n" sequences — turn those back into real newlines.
  const rawKey = process.env["GOOGLE_SHEETS_PRIVATE_KEY"];
  const spreadsheetId = process.env["GOOGLE_SHEETS_SPREADSHEET_ID"];
  if (!clientEmail || !rawKey || !spreadsheetId) return undefined;
  return {
    clientEmail,
    privateKey: rawKey.replace(/\\n/g, "\n"),
    spreadsheetId,
  };
}

export function sheetsConnected(): boolean {
  return sheetsConfig() !== undefined;
}

/* ---------- Web Crypto helpers (no external deps) ---------- */

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
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return keyCache;
}

/** Build + sign a JWT assertion and exchange it for an OAuth access token. */
async function getAccessToken(cfg: SheetsConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: cfg.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const signingInput = `${stringToBase64Url(JSON.stringify(header))}.${stringToBase64Url(
    JSON.stringify(claim),
  )}`;

  const key = await getSigningKey(cfg.privateKey);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
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
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

/** Authenticated request against the Google Sheets v4 REST API. */
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

/* ---------- Everything below is unchanged from the previous version ---------- */

function num(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStatus(value: unknown): AttendanceStatus {
  const s = String(value ?? "").toLowerCase();
  if (s === "absent") return "absent";
  if (s === "cancelled") return "cancelled";
  if (s === "skipped") return "skipped";
  return "present";
}

function rowsOf(result: unknown, index: number): string[][] {
  const ranges = (result as { valueRanges?: { values?: string[][] }[] }).valueRanges ?? [];
  const values = ranges[index]?.values ?? [];
  return values.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
}

async function readFromSheets(): Promise<Store> {
  const cfg = sheetsConfig()!;
  const ranges = ["GROUPS!A1:H500", "STUDENTS!A1:K2000", "ENROLLMENTS!A1:D5000", "ATTENDANCE!A1:G20000"]
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
      pricePerMonth: num(r[5]),
      sessionsPerMonth: num(r[6]) || 8,
      status: (r[7] ?? "active").toLowerCase() === "archived" ? "archived" : "active",
    })),
    students: rowsOf(result, 1).map((r) => ({
      id: r[0] ?? "",
      name: r[1] ?? "",
      phone: r[2] ?? "",
      level: r[3] ?? "",
      balance: num(r[4]),
      createdAt: r[5] ?? "",
      email: r[6] ?? "",
      guardianName: r[7] ?? "",
      guardianPhone: r[8] ?? "",
      address: r[9] ?? "",
      notes: r[10] ?? "",
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
      status: parseStatus(r[4]),
      amount: num(r[6]),
    })),
  };
}

async function appendRows(tab: string, rows: (string | number)[][]) {
  const cfg = sheetsConfig()!;
  await gateway(
    `/spreadsheets/${cfg.spreadsheetId}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}

async function writeRange(range: string, rows: (string | number)[][]) {
  const cfg = sheetsConfig()!;
  await gateway(`/spreadsheets/${cfg.spreadsheetId}/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: rows }),
  });
}

function groupRow(g: Group): (string | number)[] {
  return [
    g.id,
    g.name,
    g.level,
    g.teacher,
    g.schedule,
    g.pricePerMonth,
    g.sessionsPerMonth,
    g.status,
  ];
}

function studentRow(s: Student): (string | number)[] {
  return [
    s.id, s.name, s.phone, s.level, s.balance, s.createdAt,
    s.email, s.guardianName, s.guardianPhone, s.address, s.notes,
  ];
}

/** Column 5 ("paid") is legacy; kept for sheet-layout compat, ignored on read. */
function attendanceRow(a: AttendanceRecord): (string | number)[] {
  return [a.id, a.date, a.groupId, a.studentId, a.status, "TRUE", a.amount];
}

function emptyStore(): Store {
  return { groups: [], students: [], enrollments: [], attendance: [] };
}

function getMemoryStore(): Store {
  if (!memoryStore) memoryStore = emptyStore();
  return memoryStore;
}

export async function loadSnapshot(force = false): Promise<LmsSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;

  let snapshot: LmsSnapshot;
  if (sheetsConnected()) {
    // Propagate read failures. Silently serving an empty store hid
    // connectivity problems as data loss and would let subsequent writes
    // persist a partial store over the real sheet.
    snapshot = { ...(await readFromSheets()), source: "sheets" };
  } else {
    snapshot = { ...getMemoryStore(), source: "sample" };
  }
  cache = { snapshot, at: Date.now() };
  return snapshot;
}

function cloneStore(store: Store): Store {
  return {
    groups: [...store.groups],
    students: [...store.students],
    enrollments: [...store.enrollments],
    attendance: [...store.attendance],
  };
}

async function currentStore(): Promise<Store> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cloneStore(cache.snapshot);
  if (!sheetsConnected()) return getMemoryStore();
  const store = await readFromSheets();
  cache = { snapshot: { ...cloneStore(store), source: "sheets" }, at: Date.now() };
  return store;
}

function commit(store: Store, synced: boolean): LmsSnapshot {
  const source: LmsSnapshot["source"] = synced && sheetsConnected() ? "sheets" : "sample";
  if (source === "sample") memoryStore = store;
  const snapshot: LmsSnapshot = { ...cloneStore(store), source };
  cache = { snapshot, at: Date.now() };
  return snapshot;
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function replaceTabs(store: Store, tabs: readonly Tab[]): Promise<boolean> {
  if (!sheetsConnected()) {
    memoryStore = store;
    return false;
  }
  const cfg = sheetsConfig()!;
  const clearRanges: string[] = [];
  const updates: { range: string; values: (string | number)[][] }[] = [];

  if (tabs.includes("groups")) {
    clearRanges.push("GROUPS!A2:H20000");
    updates.push({ range: "GROUPS!A2", values: store.groups.map(groupRow) });
  }
  if (tabs.includes("students")) {
    clearRanges.push("STUDENTS!A2:K20000");
    updates.push({ range: "STUDENTS!A2", values: store.students.map(studentRow) });
  }
  if (tabs.includes("enrollments")) {
    clearRanges.push("ENROLLMENTS!A2:D20000");
    updates.push({
      range: "ENROLLMENTS!A2",
      values: store.enrollments.map((e) => [e.id, e.studentId, e.groupId, e.status]),
    });
  }
  if (tabs.includes("attendance")) {
    clearRanges.push("ATTENDANCE!A2:G20000");
    updates.push({ range: "ATTENDANCE!A2", values: store.attendance.map(attendanceRow) });
  }

  try {
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchClear`, {
      method: "POST",
      body: JSON.stringify({ ranges: clearRanges }),
    });
    await gateway(`/spreadsheets/${cfg.spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: updates.filter((d) => d.values.length > 0),
      }),
    });
    return true;
  } catch {
    memoryStore = store;
    return false;
  }
}

function feeFor(status: AttendanceStatus, price: number): number {
  return status === "cancelled" || status === "skipped" ? 0 : -price;
}

export async function saveRollCall(input: {
  groupId: string;
  date: string;
  entries: RollCallEntry[];
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const group = store.groups.find((g) => g.id === input.groupId);
  const price = perSessionPrice(group);

  const enrolled = store.enrollments
    .filter((e) => e.groupId === input.groupId && e.status === "active")
    .map((e) => e.studentId);
  const marked = new Map(input.entries.map((e) => [e.studentId, e.status]));
  const allEntries: RollCallEntry[] = [
    ...input.entries,
    ...enrolled
      .filter((id) => !marked.has(id))
      .map((id) => ({ studentId: id, status: "absent" as const })),
  ];

  const prior = new Map<string, AttendanceRecord>();
  for (const record of store.attendance) {
    if (record.date === input.date && record.groupId === input.groupId) {
      prior.set(record.studentId, record);
    }
  }

  const rows: AttendanceRecord[] = allEntries.map((entry) => ({
    id: prior.get(entry.studentId)?.id ?? newId("a"),
    date: input.date,
    groupId: input.groupId,
    studentId: entry.studentId,
    status: entry.status,
    amount: entry.status === "cancelled" || entry.status === "skipped" ? 0 : price,
  }));

  const balanceDelta = new Map<string, number>();
  for (const entry of allEntries) {
    const before = prior.get(entry.studentId);
    const previous = before ? feeFor(before.status, price) : 0;
    balanceDelta.set(entry.studentId, feeFor(entry.status, price) - previous);
  }

  const touched = new Set(allEntries.map((e) => e.studentId));
  store.attendance = [
    ...store.attendance.filter(
      (a) => !(a.date === input.date && a.groupId === input.groupId && touched.has(a.studentId)),
    ),
    ...rows,
  ];
  store.students = store.students.map((s) =>
    balanceDelta.has(s.id) ? { ...s, balance: s.balance + (balanceDelta.get(s.id) ?? 0) } : s,
  );

  return commit(store, await replaceTabs(store, ["students", "attendance"]));
}

export async function cancelSession(input: {
  groupId: string;
  date: string;
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const studentIds = store.enrollments
    .filter((e) => e.groupId === input.groupId && e.status === "active")
    .map((e) => e.studentId);

  return saveRollCall({
    groupId: input.groupId,
    date: input.date,
    entries: studentIds.map((studentId) => ({ studentId, status: "cancelled" as const })),
  });
}

export async function clearSession(input: {
  groupId: string;
  date: string;
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const group = store.groups.find((g) => g.id === input.groupId);
  const price = perSessionPrice(group);

  const records = store.attendance.filter(
    (a) => a.groupId === input.groupId && a.date === input.date,
  );
  if (records.length === 0) return commit(store, true);

  const balanceDelta = new Map<string, number>();
  for (const r of records) {
    balanceDelta.set(r.studentId, (balanceDelta.get(r.studentId) ?? 0) - feeFor(r.status, price));
  }

  store.attendance = store.attendance.filter(
    (a) => !(a.groupId === input.groupId && a.date === input.date),
  );
  store.students = store.students.map((s) =>
    balanceDelta.has(s.id) ? { ...s, balance: s.balance + (balanceDelta.get(s.id) ?? 0) } : s,
  );

  return commit(store, await replaceTabs(store, ["students", "attendance"]));
}

export async function rescheduleSession(input: {
  groupId: string;
  fromDate: string;
  toDate: string;
}): Promise<LmsSnapshot> {
  if (input.fromDate === input.toDate) return loadSnapshot();
  const store = await currentStore();

  const records = store.attendance.filter(
    (a) => a.groupId === input.groupId && a.date === input.fromDate,
  );

  store.attendance = [
    ...store.attendance.filter(
      (a) => !(a.groupId === input.groupId && a.date === input.toDate),
    ),
    ...store.attendance.filter(
      (a) => !(a.groupId === input.groupId && a.date === input.fromDate),
    ),
    ...records.map((r) => ({ ...r, date: input.toDate })),
  ];

  return commit(store, await replaceTabs(store, ["attendance"]));
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
  let synced = false;
  if (sheetsConnected()) {
    try {
      await writeRange("GROUPS!A2:H500", store.groups.map(groupRow));
      synced = true;
    } catch {
      /* fall back to memory */
    }
  }
  return commit(store, synced);
}

export async function setGroupStatus(id: string, status: Group["status"]): Promise<LmsSnapshot> {
  const store = await currentStore();
  const group = store.groups.find((g) => g.id === id);
  if (!group) return loadSnapshot();
  return upsertGroup({ ...group, status });
}

export async function createStudent(input: {
  name: string;
  phone: string;
  level: string;
  balance: number;
  groupId?: string | undefined;
  email?: string | undefined;
  guardianName?: string | undefined;
  guardianPhone?: string | undefined;
  address?: string | undefined;
  notes?: string | undefined;
  entranceFee?: number | undefined;
  siblingIds?: string[] | undefined;
  familyPaymentTotal?: number | undefined;
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  const entranceFee = Math.max(0, input.entranceFee ?? 0);
  const familyTotal = Math.max(0, input.familyPaymentTotal ?? 0);
  const siblingIds = (input.siblingIds ?? []).filter((id) =>
    store.students.some((s) => s.id === id),
  );

  const newIdValue = newId("s");
  const familyMembers = familyTotal > 0 ? [newIdValue, ...siblingIds] : [];
  const familyShare = familyMembers.length > 0 ? familyTotal / familyMembers.length : 0;

  const student: Student = {
    id: newIdValue,
    name: input.name,
    phone: input.phone,
    level: input.level,
    balance: input.balance + entranceFee + familyShare,
    createdAt: todayIso(),
    email: input.email ?? "",
    guardianName: input.guardianName ?? "",
    guardianPhone: input.guardianPhone ?? "",
    address: input.address ?? "",
    notes: input.notes ?? "",
  };
  store.students = [...store.students, student];

  if (familyShare > 0 && siblingIds.length > 0) {
    store.students = store.students.map((s) =>
      siblingIds.includes(s.id) ? { ...s, balance: s.balance + familyShare } : s,
    );
  }

  const enrollment: Enrollment | undefined = input.groupId
    ? { id: newId("e"), studentId: student.id, groupId: input.groupId, status: "active" }
    : undefined;
  if (enrollment) store.enrollments = [...store.enrollments, enrollment];

  let synced = false;
  if (sheetsConnected()) {
    try {
      await appendRows("STUDENTS", [studentRow(student)]);
      if (familyShare > 0 && siblingIds.length > 0) {
        await writeRange("STUDENTS!A2:K2000", store.students.map(studentRow));
      }
      if (enrollment)
        await appendRows("ENROLLMENTS", [
          [enrollment.id, enrollment.studentId, enrollment.groupId, enrollment.status],
        ]);
      synced = true;
    } catch {
      /* fall back to memory */
    }
  }
  return commit(store, synced);
}

export async function deleteGroup(id: string): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.groups = store.groups.filter((g) => g.id !== id);
  store.enrollments = store.enrollments.filter((e) => e.groupId !== id);
  store.attendance = store.attendance.filter((a) => a.groupId !== id);
  return commit(store, await replaceTabs(store, ["groups", "enrollments", "attendance"]));
}

export async function updateStudent(input: {
  id: string;
  name: string;
  phone: string;
  level: string;
  balance: number;
  groupId?: string | undefined;
  email?: string | undefined;
  guardianName?: string | undefined;
  guardianPhone?: string | undefined;
  address?: string | undefined;
  notes?: string | undefined;
}): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.students = store.students.map((s) =>
    s.id === input.id
      ? {
          ...s,
          name: input.name,
          phone: input.phone,
          level: input.level,
          balance: input.balance,
          email: input.email ?? s.email,
          guardianName: input.guardianName ?? s.guardianName,
          guardianPhone: input.guardianPhone ?? s.guardianPhone,
          address: input.address ?? s.address,
          notes: input.notes ?? s.notes,
        }
      : s,
  );
  if (input.groupId !== undefined) {
    store.enrollments = store.enrollments.filter((e) => e.studentId !== input.id);
    if (input.groupId) {
      store.enrollments = [
        ...store.enrollments,
        { id: newId("e"), studentId: input.id, groupId: input.groupId, status: "active" },
      ];
    }
  }
  return commit(store, await replaceTabs(store, ["students", "enrollments"]));
}

export async function deleteStudent(id: string): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.students = store.students.filter((s) => s.id !== id);
  store.enrollments = store.enrollments.filter((e) => e.studentId !== id);
  store.attendance = store.attendance.filter((a) => a.studentId !== id);
  return commit(store, await replaceTabs(store, ["students", "enrollments", "attendance"]));
}

export async function recordPayment(studentId: string, amount: number): Promise<LmsSnapshot> {
  const store = await currentStore();
  store.students = store.students.map((s) =>
    s.id === studentId ? { ...s, balance: s.balance + amount } : s,
  );
  return commit(store, await replaceTabs(store, ["students"]));
}

export async function studentHistory(studentId: string): Promise<{
  student: Student | undefined;
  records: AttendanceRecord[];
}> {
  const snapshot = await loadSnapshot();
  return {
    student: snapshot.students.find((s) => s.id === studentId),
    records: snapshot.attendance
      .filter((a) => a.studentId === studentId)
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}