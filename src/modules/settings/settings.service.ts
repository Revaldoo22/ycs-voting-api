import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppSettings } from "../../database/entities";

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSettings)
    private readonly settings: Repository<AppSettings>,
  ) {}

  /** Single settings row; created on first read if missing. */
  async get(): Promise<AppSettings> {
    let row = await this.settings.findOneBy({ id: true });
    if (!row) row = await this.settings.save(this.settings.create({ id: true }));
    return row;
  }

  /** Old API shape (snake_case) for the frontend. */
  async getPublic() {
    const s = await this.get();
    return {
      id: s.id,
      event_open: s.eventOpen,
      closed_message: s.closedMessage,
      ip_daily_limit: s.ipDailyLimit,
      updated_at: s.updatedAt,
    };
  }

  async isEventOpen(): Promise<boolean> {
    return (await this.get()).eventOpen;
  }

  async update(patch: {
    event_open?: boolean;
    closed_message?: string;
    ip_daily_limit?: number;
  }) {
    const s = await this.get();
    if (patch.event_open !== undefined) s.eventOpen = patch.event_open;
    if (patch.closed_message !== undefined) s.closedMessage = patch.closed_message;
    if (patch.ip_daily_limit !== undefined) s.ipDailyLimit = patch.ip_daily_limit;
    await this.settings.save(s);
    return { ok: true };
  }
}
