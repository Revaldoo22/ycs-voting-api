import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminService, ActivityFilters, VoterFilters } from "./admin.service";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

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

@Controller("admin")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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

  @Get("participants/:id/point-log")
  pointLog(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.pointLog(id);
  }

  @Get("participants/:id/supporters")
  supporters(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.supportersDetail(id);
  }
}
