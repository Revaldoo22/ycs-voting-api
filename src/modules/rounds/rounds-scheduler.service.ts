import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, Repository } from "typeorm";
import { Round } from "../../database/entities";
import { RoundsService } from "./rounds.service";

/**
 * Auto-close terjadwal. Setiap jam, tutup + gulirkan gelombang aktif yang
 * scheduled_close_at-nya sudah lewat. close() sudah menangani promosi
 * (top-N global/per-kabupaten), carry 50% ke gelombang berikut, dan
 * mengaktifkannya. Idempotent: setelah ditutup, status != 'active' jadi
 * tak akan diproses lagi.
 */
@Injectable()
export class RoundsScheduler {
  private readonly logger = new Logger(RoundsScheduler.name);

  constructor(
    @InjectRepository(Round) private readonly rounds: Repository<Round>,
    private readonly roundsService: RoundsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async autoCloseDue() {
    const due = await this.rounds.find({
      where: {
        status: "active",
        scheduledCloseAt: LessThanOrEqual(new Date()),
      },
    });
    for (const r of due) {
      try {
        const res = await this.roundsService.close(r.id);
        this.logger.log(
          `Auto-closed "${r.name}" (${r.id}); next round ${res.next_round_id}`,
        );
      } catch (e) {
        this.logger.error(
          `Auto-close gagal untuk "${r.name}" (${r.id}): ${
            e instanceof Error ? e.message : e
          }`,
        );
      }
    }
  }
}
