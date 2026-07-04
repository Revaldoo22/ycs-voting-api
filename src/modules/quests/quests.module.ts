import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Quest } from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { QuestsController } from "./quests.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Quest]), AuthModule],
  controllers: [QuestsController],
})
export class QuestsModule {}
