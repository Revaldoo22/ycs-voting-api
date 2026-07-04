import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DailyVote, Participant, Profile, Submission } from "../../database/entities";

/** Shared identity checks ported from the old Postgres helpers (0012). */
@Injectable()
export class AntiCheatService {
  constructor(
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
    @InjectRepository(DailyVote)
    private readonly votes: Repository<DailyVote>,
    @InjectRepository(Submission)
    private readonly submissions: Repository<Submission>,
  ) {}

  /** Phone of the participant's linked login (for the self-vote block). */
  async participantPhone(participantId: string): Promise<string | null> {
    const row = await this.participants
      .createQueryBuilder("pa")
      .innerJoin(Profile, "pr", "pr.id = pa.profile_id")
      .select("pr.phone_number", "phone")
      .where("pa.id = :id", { id: participantId })
      .getRawOne<{ phone: string }>();
    return row?.phone ?? null;
  }

  /** One WhatsApp number must always use the same name (votes + submissions). */
  async phoneNameConflict(phone: string, name: string): Promise<boolean> {
    const norm = name.trim().toLowerCase();
    const inVotes = await this.votes
      .createQueryBuilder("dv")
      .where("dv.voter_phone = :phone", { phone })
      .andWhere("LOWER(TRIM(dv.voter_name)) <> :norm", { norm })
      .getExists();
    if (inVotes) return true;
    return this.submissions
      .createQueryBuilder("s")
      .where("s.voter_phone = :phone", { phone })
      .andWhere("LOWER(TRIM(s.voter_name)) <> :norm", { norm })
      .getExists();
  }
}
