import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import { PublicService } from "./public.service";

@Controller("public")
export class PublicController {
  constructor(private readonly pub: PublicService) {}

  @Get("schools")
  schools(@Query("with_participants") withParticipants?: string) {
    return withParticipants
      ? this.pub.schoolsWithParticipants()
      : this.pub.schools();
  }

  /**
   * Cari sekolah untuk wizard voter (searchable). Filter opsional by wilayah
   * (regency/district code) + keyword nama/npsn. Dibatasi agar ringan.
   */
  @Get("schools/search")
  searchSchools(
    @Query("q") q?: string,
    @Query("regency_code") regencyCode?: string,
    @Query("district_code") districtCode?: string,
  ) {
    return this.pub.searchSchools({
      q: q?.trim() || undefined,
      regencyCode: regencyCode?.trim() || undefined,
      districtCode: districtCode?.trim() || undefined,
    });
  }

  @Get("participants")
  participants(@Query("school_id") schoolId?: string) {
    return this.pub.participants(schoolId || undefined);
  }

  @Get("leaderboard")
  leaderboard(
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.pub.leaderboard(limit);
  }

  @Get("top-voters")
  topVoters(
    @Query("limit", new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ) {
    return this.pub.topVoters(limit);
  }

  @Get("quests")
  quests(@Query("active") active?: string) {
    return this.pub.quests(!!active);
  }

  @Get("done-content")
  doneContent(
    @Query("participant_id", ParseUUIDPipe) participantId: string,
    @Query("quest_id", ParseUUIDPipe) questId: string,
    @Query("email") email: string,
  ) {
    return this.pub.doneContentIds(participantId, questId, email ?? "");
  }

  @Get("participants/:id")
  participant(@Param("id", ParseUUIDPipe) id: string) {
    return this.pub.participant(id);
  }

  @Get("participants/:id/contents")
  contents(@Param("id", ParseUUIDPipe) id: string) {
    return this.pub.contents(id);
  }

  @Get("participants/:id/point-history")
  pointHistory(@Param("id", ParseUUIDPipe) id: string) {
    return this.pub.pointHistory(id);
  }

  @Get("participants/:id/top-supporters")
  topSupporters(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.pub.topSupporters(id, limit);
  }

  @Get("participants/:id/supporter-count")
  supporterCount(@Param("id", ParseUUIDPipe) id: string) {
    return this.pub.supporterCount(id);
  }

  @Get("participants/:id/rank")
  rank(@Param("id", ParseUUIDPipe) id: string) {
    return this.pub.rank(id);
  }
}
