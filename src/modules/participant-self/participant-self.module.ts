import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Participant, ParticipantContent } from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ParticipantSelfController } from "./participant-self.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Participant, ParticipantContent]),
    AuthModule,
  ],
  controllers: [ParticipantSelfController],
})
export class ParticipantSelfModule {}
