import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SubmissionsAdminController } from "./submissions-admin.controller";

@Module({
  imports: [AuthModule],
  controllers: [SubmissionsAdminController],
})
export class SubmissionsAdminModule {}
