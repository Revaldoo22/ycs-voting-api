import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Participant,
  ParticipantContent,
  Profile,
  Region,
} from "../../database/entities";
import { SchoolsModule } from "../schools/schools.module";
import { IntegrationsController } from "./integrations.controller";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";

@Module({
  imports: [
    TypeOrmModule.forFeature([Participant, Profile, Region, ParticipantContent]),
    SchoolsModule,
  ],
  controllers: [IntegrationsController],
  providers: [ApiKeyGuard],
})
export class IntegrationsModule {}
