import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import {
  AdminService,
  ActivityFilters,
  VoteHistoryFilters,
  VoterFilters,
} from "./admin.service";
import { PmbTrackingService } from "./pmb-tracking.service";
import { JwtGuard, JwtPayload } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

function voterFilters(q: Record<string, string | undefined>): VoterFilters {
  return {
    participantId: q.participant_id || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    search: q.search || undefined,
    status: q.status || undefined,
    school: q.school || undefined,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
    sort: (q.sort as VoterFilters["sort"]) || undefined,
  };
}

function voteHistoryFilters(
  q: Record<string, string | undefined>,
): VoteHistoryFilters {
  return {
    participantId: q.participant_id || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    search: q.search || undefined,
    status: q.status || undefined,
    voterStatus: q.voter_status || undefined,
    school: q.school || undefined,
    includeBot: q.include_bot === "true",
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
    sort: (q.sort as VoteHistoryFilters["sort"]) || undefined,
  };
}

function activityFilters(q: Record<string, string | undefined>): ActivityFilters {
  return {
    kind: q.kind || undefined,
    participantId: q.participant_id || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    search: q.search || undefined,
    qstatus: q.qstatus || undefined,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  };
}

class StartPmbTrackingJobDto {
  @IsOptional()
  @IsString()
  intent?: string;

  @IsOptional()
  @IsString()
  awareness?: string;

  /** Kirim ulang meski pmb_tracked_at sudah terisi. Default: skip yang sudah. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  /** Jeda antar data dalam milidetik. Default 1000 (~5 jam utk 18rb data). */
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(60_000)
  delay_ms?: number;
}

@Controller("admin")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly pmbTracking: PmbTrackingService,
  ) {}

  @Get("stats")
  stats() {
    return this.admin.stats();
  }

  @Get("vote-series")
  voteSeries(
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("lifetime") lifetime?: string,
  ) {
    return this.admin.voteSeries({
      days: days ? parseInt(days, 10) : undefined,
      from,
      to,
      lifetime: lifetime === "true" || lifetime === "1",
    });
  }

  @Get("voter-growth")
  voterGrowth(
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("lifetime") lifetime?: string,
  ) {
    return this.admin.voterGrowth({
      days: days ? parseInt(days, 10) : undefined,
      from,
      to,
      lifetime: lifetime === "true" || lifetime === "1",
    });
  }

  @Get("leads")
  leads(
    @Query("intent") intent?: string,
    @Query("awareness") awareness?: string,
  ) {
    return this.admin.leads({ intent, awareness });
  }

  /** Mulai backfill kirim tracking PMB sebagai job background (bisa berjam-jam). */
  @Post("leads/submit-pmb/start")
  startPmbTracking(
    @Body() dto: StartPmbTrackingJobDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pmbTracking.start({
      intent: dto.intent,
      awareness: dto.awareness,
      force: dto.force ?? false,
      delayMs: dto.delay_ms ?? 1000,
      startedBy: user.name ?? user.sub,
    });
  }

  @Post("leads/submit-pmb/:jobId/stop")
  stopPmbTracking(@Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.pmbTracking.stop(jobId);
  }

  @Get("leads/submit-pmb/:jobId")
  pmbTrackingStatus(@Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.pmbTracking.status(jobId);
  }

  /** Job terakhir (buat halaman admin auto-tampil progress setelah reload). */
  @Get("leads/submit-pmb")
  pmbTrackingLatest() {
    return this.pmbTracking.latest();
  }

  @Get("pmb-insight")
  pmbInsight() {
    return this.admin.pmbInsight();
  }

  @Get("voters")
  voters(@Query() q: Record<string, string>) {
    return this.admin.voters(voterFilters(q));
  }

  @Get("voters/count")
  votersCount(@Query() q: Record<string, string>) {
    return this.admin.votersCount(voterFilters(q));
  }

  @Get("voters/distribution")
  distribution(@Query("phone") phone: string) {
    return this.admin.voterDistribution(phone ?? "");
  }

  @Get("activity-log")
  activityLog(@Query() q: Record<string, string>) {
    return this.admin.activityLog(activityFilters(q));
  }

  @Get("activity-log/count")
  activityLogCount(@Query() q: Record<string, string>) {
    return this.admin.activityLogCount(activityFilters(q));
  }

  /**
   * Histori vote mentah, satu baris per vote. Filter `participant_id` untuk
   * histori satu peserta. Paging: `limit`/`offset`, total dari
   * `vote-history/count` dengan filter yang sama.
   */
  @Get("vote-history")
  voteHistory(@Query() q: Record<string, string>) {
    return this.admin.voteHistory(voteHistoryFilters(q));
  }

  @Get("vote-history/count")
  voteHistoryCount(@Query() q: Record<string, string>) {
    return this.admin.voteHistoryCount(voteHistoryFilters(q));
  }

  @Get("participants/:id/point-log")
  pointLog(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.pointLog(id);
  }

  @Get("participants/:id/supporters")
  supporters(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.supportersDetail(id);
  }
}
