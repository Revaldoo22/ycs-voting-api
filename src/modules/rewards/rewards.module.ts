import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AppSettings,
  Profile,
  RewardCatalog,
  RewardRedemption,
  SpinAccount,
  SpinPrize,
  SpinResult,
  PointAdjustment,
  SpinTarget,
} from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";
import {
  RewardsAdminController,
  RewardsIntegrationController,
} from "./rewards.controller";
import { RewardsService } from "./rewards.service";

/** Penukaran poin, hadiah spin, dan opsi spin untuk web kedua. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RewardCatalog,
      SpinPrize,
      RewardRedemption,
      SpinResult,
      SpinAccount,
      PointAdjustment,
  SpinTarget,
      AppSettings,
      Profile,
    ]),
    AuthModule,
  ],
  controllers: [RewardsAdminController, RewardsIntegrationController],
  providers: [RewardsService, ApiKeyGuard],
  exports: [RewardsService],
})
export class RewardsModule {}
