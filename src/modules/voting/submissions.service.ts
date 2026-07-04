import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  ParticipantContent,
  Quest,
  Submission,
  SubmissionProof,
} from "../../database/entities";
import { normalizeLink } from "../../common/utils/normalize";
import { SettingsService } from "../settings/settings.service";
import { AntiCheatService } from "./anti-cheat.service";
import { VoteError } from "./votes.service";
import { CreateSubmissionDto } from "./dto/voter-info.dto";

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Submission)
    private readonly submissions: Repository<Submission>,
    @InjectRepository(SubmissionProof)
    private readonly proofs: Repository<SubmissionProof>,
    @InjectRepository(Quest)
    private readonly quests: Repository<Quest>,
    @InjectRepository(ParticipantContent)
    private readonly contents: Repository<ParticipantContent>,
    private readonly settings: SettingsService,
    private readonly antiCheat: AntiCheatService,
  ) {}

  /** Port of record_submission v6 (migration 0026) — same rules & codes. */
  async record(d: CreateSubmissionDto) {
    const phone = d.phone_number.trim();
    const email = d.email.trim().toLowerCase();

    if (!(await this.settings.isEventOpen())) throw new VoteError("EVENTCLOSED");
    if (d.proof_urls.length < 1) throw new VoteError("MISSINGDATA");
    if (d.proof_urls.length > 5) throw new VoteError("TOOMANY");

    const pPhone = await this.antiCheat.participantPhone(d.participant_id);
    if (pPhone !== null && pPhone === phone) throw new VoteError("SELFVOTE");

    if (await this.antiCheat.phoneNameConflict(phone, d.name)) {
      throw new VoteError("PHONE_NAME");
    }

    const quest = await this.quests.findOneBy({ id: d.quest_id });
    if (!quest) throw new VoteError("NOTFOUND");

    // Content-bound quests must reference a valid content of that participant.
    if (quest.contentKind !== null) {
      if (!d.content_id) throw new VoteError("CONTENT_REQUIRED");
      const valid = await this.contents.findOneBy({
        id: d.content_id,
        participantId: d.participant_id,
        kind: quest.contentKind,
      });
      if (!valid) throw new VoteError("CONTENT_INVALID");
    }

    // Global link de-dup (link-proof quests only, non-rejected submissions).
    if (quest.proofType === "link") {
      for (const url of d.proof_urls) {
        const norm = normalizeLink(url);
        const dupe = await this.proofs
          .createQueryBuilder("sp")
          .innerJoin(Submission, "s", "s.id = sp.submission_id")
          .where("sp.url_norm = :norm", { norm })
          .andWhere("s.status <> 'rejected'")
          .getExists();
        if (dupe) throw new VoteError("DUPLICATE_LINK");
      }
    }

    // Frequency guard: once / daily / global.
    const base = this.submissions
      .createQueryBuilder("s")
      .where("s.quest_id = :qid", { qid: d.quest_id })
      .andWhere("s.voter_email = :email", { email })
      .andWhere("s.status <> 'rejected'");

    if (quest.frequency === "global") {
      // Once per (voter, quest) across ALL participants.
      if (await base.getExists()) throw new VoteError("GLOBAL_DONE");
    } else {
      base.andWhere("s.participant_id = :pid", { pid: d.participant_id });
      if (d.content_id) base.andWhere("s.content_id = :cid", { cid: d.content_id });
      if (quest.frequency === "daily") {
        base.andWhere("s.submit_date = CURRENT_DATE");
        if (await base.getExists()) throw new VoteError("DAILY_DONE");
      } else {
        if (await base.getExists()) throw new VoteError("ALREADY_DONE");
      }
    }

    await this.dataSource.transaction(async (em) => {
      const sub = await em.getRepository(Submission).save({
        participantId: d.participant_id,
        questId: d.quest_id,
        contentId: d.content_id ?? null,
        proofUrl: d.proof_urls[0],
        proofUrlNorm: normalizeLink(d.proof_urls[0]),
        status: "pending" as const,
        voterName: d.name.trim(),
        voterPhone: phone,
        voterEmail: email,
        voterStatus: d.status,
        voterSchool: d.school?.trim() || null,
        voterClass: d.class?.trim() || null,
      });
      await em.getRepository(SubmissionProof).insert(
        d.proof_urls.map((url) => ({
          submissionId: sub.id,
          url,
          urlNorm: normalizeLink(url),
        })),
      );
    });

    return { ok: true };
  }
}
