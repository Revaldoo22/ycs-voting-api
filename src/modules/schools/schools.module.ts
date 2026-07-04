import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Participant, School } from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { SchoolsService } from "./schools.service";
import { SchoolsController } from "./schools.controller";

@Module({
  imports: [TypeOrmModule.forFeature([School, Participant]), AuthModule],
  controllers: [SchoolsController],
  providers: [SchoolsService],
  exports: [SchoolsService],
})
export class SchoolsModule {}
