import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { DataSource } from "typeorm";
import { Participant, Quest, Submission } from "../../database/entities";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

class ReviewDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@Controller("admin/submissions")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class SubmissionsAdminController {
  constructor(private readonly db: DataSource) {}

  /** Nested shape identical to the old Supabase select. */
  @Get()
  list(@Query("status") status?: string) {
    return this.db.query(
      `select s.*,
              json_build_object(
                'name', p.name, 'school_id', p.school_id,
                'schools', case when sch.id is null then null
                                else json_build_object('name', sch.name) end
              ) as participants,
              json_build_object('name', q.name, 'point', q.point,
                                'proof_type', q.proof_type) as quests,
              case when pc.id is null then null
                   else json_build_object('url', pc.url, 'kind', pc.kind) end
                as participant_contents,
              coalesce(
                (select json_agg(json_build_object('url', sp.url))
                 from submission_proofs sp where sp.submission_id = s.id),
                '[]'::json
              ) as submission_proofs
       from submissions s
       join participants p on p.id = s.participant_id
       left join schools sch on sch.id = p.school_id
       join quests q on q.id = s.quest_id
       left join participant_contents pc on pc.id = s.content_id
       where ($1::text is null or s.status = $1)
       order by s.created_at desc`,
      [status || null],
    );
  }

  @Get("counts")
  async counts() {
    const rows = await this.db.query(
      `select
         count(*) filter (where status = 'pending')::int  as pending,
         count(*) filter (where status = 'approved')::int as approved,
         count(*) filter (where status = 'rejected')::int as rejected,
         count(*)::int as all
       from submissions`,
    );
    return rows[0];
  }

  /** Review: on a real pending→approved flip, apply quest points once. */
  @Patch(":id")
  async review(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.db.transaction(async (em) => {
      const sub = await em
        .getRepository(Submission)
        .findOneBy({ id });
      if (!sub) throw new NotFoundException("Submission tidak ditemukan.");

      const wasApproved = sub.status === "approved";
      sub.status = dto.status;
      sub.reviewNote = dto.note ?? null;
      await em.getRepository(Submission).save(sub);

      if (dto.status === "approved" && !wasApproved) {
        const quest = await em.getRepository(Quest).findOneBy({ id: sub.questId });
        await em
          .getRepository(Participant)
          .increment({ id: sub.participantId }, "totalPoints", quest?.point ?? 0);
      }
      return { ok: true };
    });
  }
}
