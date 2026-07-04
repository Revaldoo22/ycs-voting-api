import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { JwtPayload } from "../guards/jwt.guard";

/** Injects the verified JWT payload: `me(@CurrentUser() user: JwtPayload)`. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest().user,
);
