import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { LmsSnapshot } from "./lms-types";

async function requireAuth(token: string): Promise<void> {
  const { verifyToken, UnauthorizedError } = await import("./auth.server");
  if (!(await verifyToken(token))) throw new UnauthorizedError();
}

const tokenSchema = z.object({ token: z.string().min(1) });

export const unlockAdmin = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ pin: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const {
      verifyPin, issueToken, authConfigured,
      rateLimitStatus, recordFailedAttempt, clearFailedAttempts,
    } = await import("./auth.server");
    if (!authConfigured()) throw new Error("SERVER_MISCONFIGURED");
    const status = rateLimitStatus();
    if (status.locked) throw new Error(`RATE_LIMITED:${status.retryAfterSec}`);
    if (!verifyPin(data.pin)) {
      recordFailedAttempt();
      const after = rateLimitStatus();
      if (after.locked) throw new Error(`RATE_LIMITED:${after.retryAfterSec}`);
      throw new Error("INVALID_PIN");
    }
    clearFailedAttempts();
    return await issueToken();
  });

export const getSnapshot = createServerFn({ method: "POST" })
  .validator((input: unknown) => tokenSchema.parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { loadSnapshot } = await import("./sheets.server");
    return loadSnapshot();
  });

const groupSchema = z.object({
  token: z.string().min(1),
  id: z.string().optional(),
  name: z.string().min(1),
  level: z.string().min(1),
  teacher: z.string().min(1),
  schedule: z.string().min(1),
  status: z.enum(["active", "archived"]),
});

export const saveGroup = createServerFn({ method: "POST" })
  .validator((input: unknown) => groupSchema.parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { upsertGroup } = await import("./sheets.server");
    const { token: _t, ...group } = data;
    return upsertGroup(group);
  });

export const toggleGroupStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      id: z.string().min(1),
      status: z.enum(["active", "archived"]),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { setGroupStatus } = await import("./sheets.server");
    return setGroupStatus(data.id, data.status);
  });

export const removeGroup = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: z.string().min(1), id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { deleteGroup } = await import("./sheets.server");
    return deleteGroup(data.id);
  });

export const saveGroupSessionDates = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      groupId: z.string().min(1),
      dates: z.record(z.string(), z.string()),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { saveSessionDates } = await import("./sheets.server");
    return saveSessionDates({ groupId: data.groupId, dates: data.dates });
  });

export const registerStudent = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      name: z.string().min(1),
      phone: z.string().default(""),
      level: z.string().default(""),
      email: z.string().default(""),
      guardianName: z.string().default(""),
      guardianPhone: z.string().default(""),
      address: z.string().default(""),
      notes: z.string().default(""),
      enrollments: z.array(z.object({
        groupId: z.string().min(1),
        paidSessionIds: z.array(z.string()),
      })).optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { createStudent } = await import("./sheets.server");
    const { token: _t, ...student } = data;
    return createStudent(student);
  });

export const editStudent = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      id: z.string().min(1),
      name: z.string().min(1),
      phone: z.string().default(""),
      level: z.string().default(""),
      email: z.string().default(""),
      guardianName: z.string().default(""),
      guardianPhone: z.string().default(""),
      address: z.string().default(""),
      notes: z.string().default(""),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { updateStudent } = await import("./sheets.server");
    const { token: _t, ...student } = data;
    return updateStudent(student);
  });

export const removeStudent = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: z.string().min(1), id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { deleteStudent } = await import("./sheets.server");
    return deleteStudent(data.id);
  });

export const assignStudentToGroup = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      studentId: z.string().min(1),
      groupId: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { enrollStudent } = await import("./sheets.server");
    return enrollStudent(data.studentId, data.groupId);
  });

export const unassignStudentFromGroup = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      studentId: z.string().min(1),
      groupId: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { unenrollStudent } = await import("./sheets.server");
    return unenrollStudent(data.studentId, data.groupId);
  });

const attendStatus = z.union([z.literal("present"), z.literal("absent"), z.literal("")]);

export const submitRollCall = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      sessionId: z.string().min(1),
      entries: z.array(z.object({
        studentId: z.string().min(1),
        status: attendStatus,
      })),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { saveRollCall } = await import("./sheets.server");
    return saveRollCall({ sessionId: data.sessionId, entries: data.entries });
  });

export const setStudentSessions = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      token: z.string().min(1),
      studentId: z.string().min(1),
      updates: z.array(z.object({
        sessionId: z.string().min(1),
        status: attendStatus.optional(),
        paid: z.boolean().optional(),
        clear: z.boolean().optional(),
      })),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    await requireAuth(data.token);
    const { setStudentSessions: apply } = await import("./sheets.server");
    return apply({ studentId: data.studentId, updates: data.updates });
  });

export const getStudentHistory = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: z.string().min(1), studentId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAuth(data.token);
    const { studentHistory } = await import("./sheets.server");
    return studentHistory(data.studentId);
  });