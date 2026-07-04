import {
  Body,
  Controller,
  HttpException,
  Post,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { VotesService, VoteError } from "./votes.service";
import { SubmissionsService } from "./submissions.service";
import { CastVoteDto, CreateSubmissionDto } from "./dto/voter-info.dto";
import { rateLimit } from "../../common/utils/rate-limit";
import {
  ipHashFromRequest,
  serverHashFromRequest,
} from "../../common/utils/server-hash";

/** Same user-facing messages as the old vote-errors.ts / API routes. */
const MESSAGES: Record<string, [string, number]> = {
  EVENTCLOSED: ["Event sedang ditutup.", 409],
  ROUND_ENDED: ["Periode gelombang ini sudah berakhir. Tunggu gelombang berikutnya.", 409],
  NOTFOUND: ["Peserta tidak ditemukan.", 400],
  SELFVOTE: ["Kamu tidak bisa mendukung dirimu sendiri.", 409],
  PHONE_NAME: [
    "Nomor WhatsApp ini sudah terdaftar dengan nama lain. Gunakan nama yang sama.",
    409,
  ],
  ALREADYVOTED: ["Kamu sudah vote peserta ini hari ini.", 409],
  FOLLOW_REQUIRED: ["Follow akun Universitas STEKOM dulu untuk vote pertamamu.", 409],
  FOLLOW_PROOF_REQUIRED: ["Upload screenshot bukti follow dulu.", 400],
  FAV_LIMIT: ["Kuota vote favorit harianmu sudah habis (maks 10 peserta).", 409],
  IPLIMIT: ["Batas vote harian dari jaringan ini tercapai.", 409],
  MISSINGDATA: ["Data tidak lengkap.", 400],
  TOOMANY: ["Maksimal 5 bukti per pengiriman.", 400],
  CONTENT_REQUIRED: ["Pilih konten peserta yang valid dulu.", 400],
  CONTENT_INVALID: ["Pilih konten peserta yang valid dulu.", 400],
  DUPLICATE_LINK: [
    "Link ini sudah pernah dikirim. Setiap link konten hanya bisa dipakai satu kali.",
    409,
  ],
  DAILY_DONE: ["Quest harian ini sudah kamu kerjakan hari ini.", 409],
  ALREADY_DONE: ["Kamu sudah mengerjakan quest ini untuk peserta tersebut.", 409],
  GLOBAL_DONE: [
    "Kamu sudah mengerjakan quest follow ini. Cukup follow sekali — tak perlu diulang di peserta lain.",
    409,
  ],
};

function mapError(err: unknown): never {
  if (err instanceof VoteError) {
    const hit = MESSAGES[err.code];
    if (hit) throw new HttpException({ error: hit[0] }, hit[1]);
  }
  throw err;
}

@Controller()
export class VotingController {
  constructor(
    private readonly votes: VotesService,
    private readonly submissions: SubmissionsService,
  ) {}

  /** Old path parity: POST /api/vote. */
  @Post("vote")
  async vote(@Body() dto: CastVoteDto, @Req() req: Request) {
    if (!rateLimit(`vote:${dto.fingerprint}`, 20, 60_000)) {
      throw new HttpException(
        { error: "Terlalu banyak percobaan. Coba lagi sebentar." },
        429,
      );
    }
    try {
      const participant = await this.votes.cast(
        dto,
        serverHashFromRequest(req),
        // IP soft-limit disabled for now (parity with the old app) — pass
        // ipHashFromRequest(req) to re-enable.
        null,
      );
      return { ok: true, participant };
    } catch (err) {
      mapError(err);
    }
  }

  /** Old path parity: POST /api/submissions. */
  @Post("submissions")
  async submit(@Body() dto: CreateSubmissionDto, @Req() req: Request) {
    const ipKey = ipHashFromRequest(req) ?? "noip";
    if (!rateLimit(`submit:${ipKey}`, 30, 60_000)) {
      throw new HttpException(
        { error: "Terlalu banyak percobaan. Coba lagi sebentar." },
        429,
      );
    }
    try {
      return await this.submissions.record(dto);
    } catch (err) {
      mapError(err);
    }
  }
}
