import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UploadsController } from "./uploads.controller";
import { StorageService } from "./storage.service";
import { DepotService } from "./depot.service";
import { DepotHooksController, MediaController } from "./media.controller";

@Module({
  imports: [AuthModule],
  controllers: [UploadsController, MediaController, DepotHooksController],
  providers: [StorageService, DepotService],
  exports: [StorageService],
})
export class UploadsModule {}
