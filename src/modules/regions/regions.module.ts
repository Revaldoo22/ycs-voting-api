import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Region, School } from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import {
  PublicRegionsController,
  RegionsController,
} from "./regions.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Region, School]), AuthModule],
  controllers: [RegionsController, PublicRegionsController],
})
export class RegionsModule {}
