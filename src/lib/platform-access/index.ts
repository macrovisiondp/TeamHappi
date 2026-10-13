import "server-only";

import { cache } from "react";

import { deploymentEnvironment } from "@/integrations/core/environment";
import { getCurrentUser } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

import {
  decidePlatformAccess,
  parseAllowList,
  type PlatformAccess,
} from "./policy";

export {
  assertPrivilegedPlatformAction,
  PlatformActionUnavailableError,
  PRIVILEGED_DISABLED_REASON,
  type PlatformAccess,
} from "./policy";

/**
 * Platform access for this request, from the server-validated session. Never
 * from a cookie, header or parameter the browser controls.
 */
export const getPlatformAccess = cache(async (): Promise<PlatformAccess> => {
  const user = await getCurrentUser();
  return decidePlatformAccess(
    user && { userId: user.userId, name: user.name, email: user.email },
    deploymentEnvironment(),
    parseAllowList(serverEnv().PLATFORM_PREVIEW_STAFF_EMAILS),
  );
});
