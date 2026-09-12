import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { LmsSnapshot } from "./lms-types";

export const getSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<LmsSnapshot> => {
  const { loadSnapshot } = await import("./sheets.server");
  return loadSnapshot();
});

export const seedDemo = createServerFn({ method: "POST" }).handler(async (): Promise<LmsSnapshot> => {
  const { seedDemoData } = await import("./sheets.server");
  return seedDemoData();
});

const rollCallSchema = z.object({
  groupId: z.string().min(1),
  date: z.string().min(1),
  entries: z.array(
    z.object({
      studentId: z.string().min(1),
      status: z.enum(["present", "absent"]),
      paid: z.boolean(),
    }),
  ),
});

export const submitRollCall = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => rollCallSchema.parse(input))
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { saveRollCall } = await import("./sheets.server");
    return saveRollCall(data);
  });

const groupSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  level: z.string().min(1),
  teacher: z.string().min(1),
  schedule: z.string().min(1),
  pricePerSession: z.number().min(0),
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

export const addPayment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ studentId: z.string().min(1), amount: z.number() }).parse(input),
  )
  .handler(async ({ data }): Promise<LmsSnapshot> => {
    const { recordPayment } = await import("./sheets.server");
    return recordPayment(data.studentId, data.amount);
  });
