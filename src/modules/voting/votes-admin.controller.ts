import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import { DailyVote, Participant, Profile } from "../../database/entities";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { NotificationsService } from "./notifications.service";

class ReviewVoteDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  /** Alasan penolakan — masuk ke notifikasi voter. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class BulkReviewVoteDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200, { message: "Maksimal 200 vote per batch" })
  @IsUUID("4", { each: true })
  ids!: string[];
}

/**
 * Review vote pertama voter (bukti follow 2 saluran WhatsApp). Approve =
 * poin masuk ke peserta + voter ditandai follow-WA terverifikasi (TIDAK
 * menerbitkan kupon — kupon undian HP adalah klaim terpisah, lihat
 * CouponClaimsAdminController). Reject = baris vote DIHAPUS agar hak vote
 * voter kembali (bisa vote ulang dengan bukti yang benar).
 */
@Controller("admin/votes")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class VotesAdminController {
  constructor(
    private readonly db: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  list(@Query("status") status?: string) {
    return this.db.query(
      `select dv.id, dv.status, dv.points, dv.created_at,
              dv.voter_name, dv.voter_phone, dv.voter_email,
              dv.voter_status, dv.voter_school, dv.voter_class,
              dv.follow_proofs,
              json_build_object(
                'id', p.id, 'name', p.name,
                'schools', case when sch.id is null then null
                                else json_build_object('name', sch.name) end
              ) as participants
       from daily_votes dv
       join participants p on p.id = dv.participant_id
       left join schools sch on sch.id = p.school_id
       where dv.is_bot = false
         and dv.follow_proofs is not null
         and ($1::text is null or dv.status = $1)
       order by dv.created_at desc
       limit 500`,
      [status || null],
    );
  }

  @Get("counts")
  async counts() {
    const rows = await this.db.query(
      `select
         count(*) filter (where status = 'pending')::int  as pending,
         count(*) filter (where status = 'approved')::int as approved
       from daily_votes
       where is_bot = false and follow_proofs is not null`,
    );
    return rows[0];
  }

  @Patch(":id")
  async review(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReviewVoteDto,
  ) {
    return this.db.transaction(async (em) => {
      const result = await this.reviewOne(em, id, dto.status, dto.reason);
      if (!result) throw new NotFoundException("Vote tidak ditemukan.");
      return result;
    });
  }

  /** Review massal (approve/tolak banyak sekaligus) dalam satu transaksi. */
  @Post("bulk")
  async bulk(@Body() dto: BulkReviewVoteDto) {
    return this.db.transaction(async (em) => {
      let processed = 0;
      for (const id of dto.ids) {
        // Id yang sudah hilang (mis. direview admin lain) di-skip saja.
        if (await this.reviewOne(em, id, dto.status, dto.reason)) processed++;
      }
      return { ok: true, processed };
    });
  }

  /** Inti review satu vote. Return null bila vote tak ditemukan. */
  private async reviewOne(
    em: EntityManager,
    id: string,
    status: "approved" | "rejected",
    reason?: string,
  ) {
      const vote = await em
        .getRepository(DailyVote)
        .createQueryBuilder("dv")
        .setLock("pessimistic_write")
        .where("dv.id = :id", { id })
        .getOne();
      if (!vote) return null;

      if (status === "rejected") {
        // Hapus baris → unique index (email/WA) bebas lagi, voter bisa
        // vote ulang. Poin belum pernah masuk (pending), jadi tak perlu
        // rollback poin.
        if (vote.status === "approved") {
          await em
            .getRepository(Participant)
            .increment({ id: vote.participantId }, "totalPoints", -vote.points);
        }

        // Notifikasi ke voter SEBELUM baris dihapus — alasan penolakan +
        // ajakan vote ulang. Baris vote hilang, jadi ini satu-satunya jejak.
        const participant = await em
          .getRepository(Participant)
          .findOne({ where: { id: vote.participantId }, select: ["name"] });
        const who = participant?.name ?? "peserta";
        const alasan = reason?.trim()
          ? ` Alasan: ${reason.trim()}.`
          : " Bukti follow tidak sesuai.";
        await this.notifications.notifyByVoter(
          em,
          { email: vote.voterEmail, phone: vote.voterPhone },
          {
            type: "vote_rejected",
            title: "Vote kamu ditolak",
            body:
              `Vote kamu untuk ${who} belum bisa kami terima.${alasan}` +
              " Kamu bisa vote lagi dengan bukti yang benar.",
          },
        );

        await em.getRepository(DailyVote).delete({ id });
        return { ok: true, removed: true };
      }

      // Approve: hanya flip pending→approved yang memberi poin (idempoten).
      if (vote.status === "approved") return { ok: true };
      vote.status = "approved";
      await em.getRepository(DailyVote).save(vote);
      await em
        .getRepository(Participant)
        .increment({ id: vote.participantId }, "totalPoints", vote.points);

      // Tandai follow-WA terverifikasi (bukan followedAt — field itu khusus
      // klaim kupon IG/TikTok, terpisah dari vote). Tidak menerbitkan kupon.
      if (vote.voterEmail) {
        const profile = await em
          .getRepository(Profile)
          .createQueryBuilder("p")
          .where("lower(p.email) = lower(:email)", { email: vote.voterEmail })
          .getOne();
        if (profile) {
          await em.getRepository(Profile).update(
            { id: profile.id },
            { waFollowedAt: profile.waFollowedAt ?? new Date() },
          );
        }
      }

      const participant = await em
        .getRepository(Participant)
        .findOne({ where: { id: vote.participantId }, select: ["name"] });
      await this.notifications.notifyByVoter(
        em,
        { email: vote.voterEmail, phone: vote.voterPhone },
        {
          type: "vote_approved",
          title: "Vote kamu disetujui",
          body:
            `Vote kamu untuk ${participant?.name ?? "peserta"} sudah disetujui,` +
            " poin sudah masuk. Terima kasih sudah mendukung!",
        },
      );
      return { ok: true };
  }
}
