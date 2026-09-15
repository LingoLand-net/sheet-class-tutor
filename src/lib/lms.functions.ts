import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { LmsSnapshot } from "./lms-types";

export const getSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<LmsSnapshot> => {
    const { loadSnapshot } = await import("./sheets.server");
    return loadSnapshot();
  },
);

const statusEnum = z.enum(["present", "absent", "cancelled", "skipped"]);

const rollCallSchema = z.object({
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
    const { saveRollCall } = await import("./sheets.server");
    return saveRollCall(data);
  });

export const cancelRollCallSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ groupId: z.string().min(1), date: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { cancelSession } = await import("./sheets.server");
    return cancelSession(data);
  });

export const clearRollCallSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ groupId: z.string().min(1), date: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { clearSession } = await import("./sheets.server");
    return clearSession(data);
  });

export const rescheduleRollCallSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        groupId: z.string().min(1),
        fromDate: z.string().min(1),
        toDate: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { rescheduleSession } = await import("./sheets.server");
    return rescheduleSession(data);
  });

const groupSchema = z.object({
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
    const { upsertGroup } = await import("./sheets.server");
    return upsertGroup(data);
  });

export const toggleGroupStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().min(1), status: z.enum(["active", "archived"]) }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { setGroupStatus } = await import("./sheets.server");
    return setGroupStatus(data.id, data.status);
  });

export const registerStudent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
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
    const { createStudent } = await import("./sheets.server");
    return createStudent(data);
  });

export const removeGroup = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { deleteGroup } = await import("./sheets.server");
    return deleteGroup(data.id);
  });

export const editStudent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
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
    const { updateStudent } = await import("./sheets.server");
    return updateStudent(data);
  });

export const removeStudent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { deleteStudent } = await import("./sheets.server");
    return deleteStudent(data.id);
  });

export const getStudentHistory = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ studentId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { studentHistory } = await import("./sheets.server");
    return studentHistory(data.studentId);
  });

export const addPayment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ studentId: z.string().min(1), amount: z.number() }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { recordPayment } = await import("./sheets.server");
    return recordPayment(data.studentId, data.amount);
  });