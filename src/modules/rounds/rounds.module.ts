import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Round, RoundSchool } from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { RoundsService } from "./rounds.service";
import { PublicRoundsController, RoundsController } from "./rounds.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Round, RoundSchool]), AuthModule],
  controllers: [RoundsController, PublicRoundsController],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
