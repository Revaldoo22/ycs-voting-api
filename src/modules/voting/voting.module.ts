import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  DailyVote,
  Participant,
  ParticipantContent,
  Profile,
  Quest,
  Submission,
  SubmissionProof,
} from "../../database/entities";
import { SettingsModule } from "../settings/settings.module";
import { RoundsModule } from "../rounds/rounds.module";
import { AuthModule } from "../auth/auth.module";
import { AntiCheatService } from "./anti-cheat.service";
import { VotesService } from "./votes.service";
import { SubmissionsService } from "./submissions.service";
import { NotificationsService } from "./notifications.service";
import { VotingController } from "./voting.controller";
import { VoterSelfController } from "./voter-self.controller";
import { VotesAdminController } from "./votes-admin.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyVote,
      Participant,
      Profile,
      Quest,
      Submission,
      SubmissionProof,
      ParticipantContent,
    ]),
    SettingsModule,
    RoundsModule,
    AuthModule,
  ],
  controllers: [VotingController, VoterSelfController, VotesAdminController],
  providers: [
    AntiCheatService,
    VotesService,
    SubmissionsService,
    NotificationsService,
  ],
  exports: [AntiCheatService],
})
export class VotingModule {}
