import { queryOptions } from "@tanstack/react-query";

import { emitAuthExpired, getStoredToken } from "./auth-client";
import { getSnapshot } from "./lms.functions";
import type { LmsSnapshot } from "./lms-types";

export const snapshotQuery = queryOptions<LmsSnapshot>({
  queryKey: ["lms-snapshot"],
  queryFn: async () => {
    const token = getStoredToken();
    if (!token) throw new Error("UNAUTHORIZED");
    try {
      return await getSnapshot({ data: { token } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.toUpperCase().includes("UNAUTHORIZED")) {
        emitAuthExpired();
      }
      throw err;
    }
  },
  staleTime: 30_000,
  retry: false,
});