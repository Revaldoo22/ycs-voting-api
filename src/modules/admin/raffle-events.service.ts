import { Injectable, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";

export type RaffleEventType = "won" | "cancelled";

/**
 * Riwayat undian: tiap kupon yang ditarik sebagai pemenang dan tiap
 * pembatalan dicatat di sini. Tabel coupons sendiri tak bisa jadi sumber log
 * karena pembatalan menyetel won_at = null, sehingga jejak menangnya hilang.
 *
 * Karena DB_SYNC=false di produksi, tabelnya di-provision idempoten saat boot
 * (gaya raw-SQL codebase ini), tak perlu migrasi.
 */
@Injectable()
export class RaffleEventsService implements OnModuleInit {
  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    await this.db.query(`
      create table if not exists raffle_events (
        id uuid primary key default gen_random_uuid(),
        coupon_code text not null,
        profile_id uuid,
        event_type text not null,
        prize text,
        created_at timestamptz not null default now()
      )
    `);
    await this.db.query(
      `create index if not exists raffle_event_created on raffle_events (created_at desc)`,
    );
    await this.db.query(
      `create index if not exists raffle_event_code on raffle_events (coupon_code)`,
    );
  }

  /**
   * Catat satu kejadian undian. Dipakai lewat EntityManager bila pemanggil
   * sedang dalam transaksi, agar log tak tertinggal saat transaksi dibatalkan.
   */
  async record(
    ev: {
      couponCode: string;
      profileId: string | null;
      eventType: RaffleEventType;
      prize: string | null;
    },
    em?: EntityManager,
  ) {
    const runner = em ?? this.db;
    await runner.query(
      `insert into raffle_events (coupon_code, profile_id, event_type, prize)
       values ($1, $2, $3, $4)`,
      [ev.couponCode, ev.profileId, ev.eventType, ev.prize],
    );
  }
}
