import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { RaffleController } from "./raffle.controller";
import { RaffleEventsService } from "./raffle-events.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminController, RaffleController],
  providers: [AdminService, RaffleEventsService],
})
export class AdminModule {}
