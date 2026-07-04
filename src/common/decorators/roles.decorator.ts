import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";
/** Restricts a controller/handler to the given roles. Use with RolesGuard. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
