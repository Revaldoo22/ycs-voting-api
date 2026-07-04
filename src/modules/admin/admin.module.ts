import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { RaffleController } from "./raffle.controller";

@Module({
  imports: [AuthModule],
  controllers: [AdminController, RaffleController],
  providers: [AdminService],
})
export class AdminModule {}
