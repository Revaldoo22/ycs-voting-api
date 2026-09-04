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
export {
  CouponClaim,
  type CouponClaimStatus,
} from "./coupon-claim.entity";
export { Notification, type NotificationType } from "./notification.entity";
export {
  Round,
  RoundParticipant,
  type RoundStatus,
  type RoundParticipantStatus,
} from "./round.entity";
export { Rejection, type RejectionKind } from "./rejection.entity";
export { Announcement, AnnouncementClick } from "./announcement.entity";
export {
  RewardCatalog,
  SpinPrize,
  RewardRedemption,
  SpinResult,
  SpinAccount,
  PointAdjustment,
  type RedeemKind,
  type SpinSource,
} from "./reward.entity";

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
import { CouponClaim } from "./coupon-claim.entity";
import { Notification } from "./notification.entity";
import { Round, RoundParticipant } from "./round.entity";
import { Rejection } from "./rejection.entity";
import { Announcement, AnnouncementClick } from "./announcement.entity";
import {
  RewardCatalog,
  SpinPrize,
  RewardRedemption,
  SpinResult,
  SpinAccount,
  PointAdjustment,
} from "./reward.entity";

/** Single registration point, add new entities here once. */
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
  CouponClaim,
  Notification,
  Round,
  RoundParticipant,
  Rejection,
  Announcement,
  AnnouncementClick,
  RewardCatalog,
  SpinPrize,
  RewardRedemption,
  SpinResult,
  SpinAccount,
  PointAdjustment,
];
