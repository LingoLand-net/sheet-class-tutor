import { queryOptions } from "@tanstack/react-query";

import { getSnapshot } from "./lms.functions";
import type { LmsSnapshot } from "./lms-types";

export const snapshotQuery = queryOptions<LmsSnapshot>({
  queryKey: ["lms-snapshot"],
  queryFn: () => getSnapshot(),
  staleTime: 30_000,
});
