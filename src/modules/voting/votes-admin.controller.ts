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
import { DailyVote, Participant, Profile, Rejection } from "../../database/entities";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { NotificationsService } from "./notifications.service";

class ReviewVoteDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  /** Alasan penolakan, masuk ke notifikasi voter. */
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
 * menerbitkan kupon, kupon undian HP adalah klaim terpisah, lihat
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

  /**
   * Daftar vote untuk direview. Pencarian dilakukan di SQL (bukan filter di
   * browser) karena hasilnya dibatasi 500 baris: tanpa ini, voter di luar 500
   * terbaru tak akan pernah ketemu walau namanya diketik di kotak cari.
   */
  @Get()
  list(@Query("status") status?: string, @Query("search") search?: string) {
    const q = search?.trim() || null;
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
         and ($2::text is null or (
              dv.voter_name ilike '%' || $2 || '%'
           or dv.voter_email ilike '%' || $2 || '%'
           or dv.voter_phone ilike '%' || $2 || '%'
           or dv.voter_school ilike '%' || $2 || '%'
           or p.name ilike '%' || $2 || '%'
           or sch.name ilike '%' || $2 || '%'
         ))
       order by dv.created_at desc
       limit 500`,
      [status || null, q],
    );
  }

  /** Riwayat penolakan (arsip). Baris asli sudah dihapus saat ditolak. */
  @Get("rejections")
  rejections(@Query("search") search?: string) {
    const q = search?.trim() || null;
    return this.db.query(
      `select r.id, r.reason, r.voter_name, r.voter_email, r.voter_phone,
              r.voter_school, r.proofs as follow_proofs,
              r.submitted_at as created_at, r.created_at as rejected_at,
              'rejected' as status, 0 as points,
              null::text as voter_status, null::text as voter_class,
              json_build_object(
                'id', r.participant_id, 'name',
                coalesce(r.participant_name, 'Peserta dihapus'),
                'schools', case when r.participant_school is null then null
                                else json_build_object(
                                  'name', r.participant_school) end
              ) as participants
       from rejections r
       where r.kind = $1
         and ($2::text is null or (
              r.voter_name ilike '%' || $2 || '%'
           or r.voter_email ilike '%' || $2 || '%'
           or r.voter_phone ilike '%' || $2 || '%'
           or r.voter_school ilike '%' || $2 || '%'
           or r.participant_name ilike '%' || $2 || '%'
           or r.participant_school ilike '%' || $2 || '%'
         ))
       order by r.created_at desc
       limit 500`,
      ["vote", q],
    );
  }

  @Get("counts")
  async counts() {
    const rows = await this.db.query(
      // rejected TIDAK dari daily_votes: baris vote dihapus saat ditolak
      // (unique index dibebaskan), jejaknya ada di arsip rejections.
      `select
         (select count(*) filter (where status = 'pending')
            from daily_votes
            where is_bot = false and follow_proofs is not null)::int as pending,
         (select count(*) filter (where status = 'approved')
            from daily_votes
            where is_bot = false and follow_proofs is not null)::int as approved,
         (select count(*) from rejections where kind = 'vote')::int as rejected`,
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

        // Notifikasi ke voter SEBELUM baris dihapus, alasan penolakan +
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

        // Arsipkan dulu: baris vote hilang setelah ini, jadi tanpa arsip
        // penolakan tak punya jejak yang bisa ditinjau admin.
        const sch = await em
          .getRepository(Participant)
          .createQueryBuilder("p")
          .leftJoin("schools", "s", "s.id = p.school_id")
          .select("s.name", "school")
          .where("p.id = :id", { id: vote.participantId })
          .getRawOne<{ school: string | null }>();
        await em.getRepository(Rejection).insert({
          kind: "vote",
          reason: reason?.trim() || null,
          voterName: vote.voterName,
          voterEmail: vote.voterEmail,
          voterPhone: vote.voterPhone,
          voterSchool: vote.voterSchool,
          participantId: vote.participantId,
          participantName: participant?.name ?? null,
          participantSchool: sch?.school ?? null,
          // followProofs bisa array (format baru) atau objek (format lama);
          // arsip menyimpannya sebagai array URL.
          proofs: Array.isArray(vote.followProofs)
            ? vote.followProofs
            : vote.followProofs
              ? Object.values(vote.followProofs)
              : null,
          submittedAt: vote.createdAt,
        });

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

      // Tandai follow-WA terverifikasi (bukan followedAt, field itu khusus
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
