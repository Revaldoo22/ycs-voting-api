export { School } from "./school.entity";
export { Participant, type ParticipantStatus } from "./participant.entity";
export { Profile, type Role } from "./profile.entity";
export {
  DailyVote,
  type VoteKind,
  type VoteStatus,
  type FollowProofs,
} from "./daily-vote.entity";
export {
  Quest,
  type QuestStatus,
  type ProofType,
  type QuestFrequency,
  type ContentKind,
} from "./quest.entity";
export { Submission, type SubmissionStatus } from "./submission.entity";
export { SubmissionProof } from "./submission-proof.entity";
export { ParticipantContent } from "./participant-content.entity";
export { AppSettings } from "./app-settings.entity";
export { Region } from "./region.entity";
export { Coupon } from "./coupon.entity";
export { Notification, type NotificationType } from "./notification.entity";
export {
  Round,
  RoundSchool,
  type RoundStatus,
  type RoundSchoolStatus,
} from "./round.entity";

import { School } from "./school.entity";
import { Participant } from "./participant.entity";
import { Profile } from "./profile.entity";
import { DailyVote } from "./daily-vote.entity";
import { Quest } from "./quest.entity";
import { Submission } from "./submission.entity";
import { SubmissionProof } from "./submission-proof.entity";
import { ParticipantContent } from "./participant-content.entity";
import { AppSettings } from "./app-settings.entity";
import { Region } from "./region.entity";
import { Coupon } from "./coupon.entity";
import { Notification } from "./notification.entity";
import { Round, RoundSchool } from "./round.entity";

/** Single registration point — add new entities here once. */
export const ENTITIES = [
  School,
  Participant,
  Profile,
  DailyVote,
  Quest,
  Submission,
  SubmissionProof,
  ParticipantContent,
  AppSettings,
  Region,
  Coupon,
  Notification,
  Round,
  RoundSchool,
];
