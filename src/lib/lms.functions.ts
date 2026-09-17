import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { LmsSnapshot } from "./lms-types";

async function requireAuth(token: string): Promise<void> {
  const { verifyToken, UnauthorizedError } = await import("./auth.server");
  if (!(await verifyToken(token))) throw new UnauthorizedError();
}

const tokenSchema = z.object({ token: z.string().min(1) });

/* ---------- Auth ---------- */

export const unlockAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ pin: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const {
      verifyPin,
      issueToken,
      authConfigured,
      rateLimitStatus,
      recordFailedAttempt,
      clearFailedAttempts,
    } = await import("./auth.server");

    if (!authConfigured()) {
      throw new Error("SERVER_MISCONFIGURED");
    }

    const status = rateLimitStatus();
    if (status.locked) {
      throw new Error(`RATE_LIMITED:${status.retryAfterSec}`);
    }

    if (!verifyPin(data.pin)) {
      recordFailedAttempt();
      const after = rateLimitStatus();
      if (after.locked) {
        throw new Error(`RATE_LIMITED:${after.retryAfterSec}`);
      }
      throw new Error("INVALID_PIN");
    }

    clearFailedAttempts();
    return await issueToken();
  });

/* ---------- Data ---------- */

export const getSnapshot = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => tokenSchema.parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { loadSnapshot } = await import("./sheets.server");
    return loadSnapshot();
  });

const statusEnum = z.enum(["present", "absent", "cancelled", "skipped"]);

const rollCallSchema = z.object({
  token: z.string().min(1),
  groupId: z.string().min(1),
  date: z.string().min(1),
  entries: z.array(
    z.object({
      studentId: z.string().min(1),
      status: statusEnum,
    }),
  ),
});

export const submitRollCall = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => rollCallSchema.parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { saveRollCall } = await import("./sheets.server");
    return saveRollCall({ groupId: data.groupId, date: data.date, entries: data.entries });
  });

export const cancelRollCallSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ token: z.string().min(1), groupId: z.string().min(1), date: z.string().min(1) })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { cancelSession } = await import("./sheets.server");
    return cancelSession({ groupId: data.groupId, date: data.date });
  });

export const clearRollCallSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ token: z.string().min(1), groupId: z.string().min(1), date: z.string().min(1) })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { clearSession } = await import("./sheets.server");
    return clearSession({ groupId: data.groupId, date: data.date });
  });

export const rescheduleRollCallSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(1),
        groupId: z.string().min(1),
        fromDate: z.string().min(1),
        toDate: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { rescheduleSession } = await import("./sheets.server");
    return rescheduleSession({
      groupId: data.groupId,
      fromDate: data.fromDate,
      toDate: data.toDate,
    });
  });

const groupSchema = z.object({
  token: z.string().min(1),
  id: z.string().optional(),
  name: z.string().min(1),
  level: z.string().min(1),
  teacher: z.string().min(1),
  schedule: z.string().min(1),
  pricePerMonth: z.number().min(0),
  sessionsPerMonth: z.number().min(1),
  status: z.enum(["active", "archived"]),
});

export const saveGroup = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => groupSchema.parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { upsertGroup } = await import("./sheets.server");
    const { token: _t, ...group } = data;
    return upsertGroup(group);
  });

export const toggleGroupStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(1),
        id: z.string().min(1),
        status: z.enum(["active", "archived"]),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { setGroupStatus } = await import("./sheets.server");
    return setGroupStatus(data.id, data.status);
  });

export const registerStudent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(1),
        name: z.string().min(1),
        phone: z.string().default(""),
        level: z.string().default(""),
        balance: z.number().default(0),
        groupId: z.string().optional(),
        email: z.string().default(""),
        guardianName: z.string().default(""),
        guardianPhone: z.string().default(""),
        address: z.string().default(""),
        notes: z.string().default(""),
        entranceFee: z.number().min(0).optional(),
        siblingIds: z.array(z.string()).optional(),
        familyPaymentTotal: z.number().min(0).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { createStudent } = await import("./sheets.server");
    const { token: _t, ...student } = data;
    return createStudent(student);
  });

export const removeGroup = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(1), id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { deleteGroup } = await import("./sheets.server");
    return deleteGroup(data.id);
  });

export const editStudent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(1),
        id: z.string().min(1),
        name: z.string().min(1),
        phone: z.string().default(""),
        level: z.string().default(""),
        balance: z.number().default(0),
        groupId: z.string().optional(),
        email: z.string().default(""),
        guardianName: z.string().default(""),
        guardianPhone: z.string().default(""),
        address: z.string().default(""),
        notes: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { updateStudent } = await import("./sheets.server");
    const { token: _t, ...student } = data;
    return updateStudent(student);
  });

export const removeStudent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(1), id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { deleteStudent } = await import("./sheets.server");
    return deleteStudent(data.id);
  });

export const getStudentHistory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(1), studentId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAuth(data.token);
    const { studentHistory } = await import("./sheets.server");
    return studentHistory(data.studentId);
  });

export const addPayment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ token: z.string().min(1), studentId: z.string().min(1), amount: z.number() })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { recordPayment } = await import("./sheets.server");
    return recordPayment(data.studentId, data.amount);
  });