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

  /**
   * Self-vote check by EMAIL & phone. Voter tak boleh vote peserta yang
   * email atau nomor WA-nya sama dengan miliknya (dia = peserta itu).
   */
  async isSelfVote(
    participantId: string,
    voterEmail: string,
    voterPhone: string,
  ): Promise<boolean> {
    const p = await this.participants.findOneBy({ id: participantId });
    if (!p) return false;
    const email = voterEmail.trim().toLowerCase();
    const phone = voterPhone.trim();
    if (p.email && p.email.trim().toLowerCase() === email) return true;
    // Cocokkan juga nomor WA lewat profil peserta.
    const pPhone = await this.participantPhone(participantId);
    if (pPhone && pPhone === phone) return true;
    return false;
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
