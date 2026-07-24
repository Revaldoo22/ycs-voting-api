import { Injectable, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";

/**
 * Notifikasi voter. Karena DB_SYNC=false di produksi, tabelnya di-provision
 * idempoten saat boot (gaya raw-SQL codebase ini) — tak perlu migrasi.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    await this.db.query(`
      create table if not exists notifications (
        id uuid primary key default gen_random_uuid(),
        profile_id uuid not null,
        type text not null default 'vote_rejected',
        title text not null,
        body text not null,
        read_at timestamptz,
        created_at timestamptz not null default now()
      )
    `);
    await this.db.query(
      `create index if not exists notif_profile on notifications (profile_id)`,
    );
  }

  /**
   * Terbitkan notifikasi ke profil voter berdasarkan email/WA vote.
   * Dipakai transaksi yang sama dengan review vote (em) agar atomik.
   * Diam-diam no-op bila voter tak punya akun (mis. vote tamu lama).
   */
  async notifyByVoter(
    em: EntityManager,
    voter: { email?: string | null; phone?: string | null },
    payload: { type?: string; title: string; body: string },
  ) {
    const email = voter.email?.trim().toLowerCase() || null;
    const phone = voter.phone?.trim() || null;
    if (!email && !phone) return;

    const profile = await em.query(
      `select id from profiles
       where ($1::text is not null and lower(email) = $1)
          or ($2::text is not null and phone_number = $2)
       limit 1`,
      [email, phone],
    );
    const profileId: string | undefined = profile[0]?.id;
    if (!profileId) return;

    await em.query(
      `insert into notifications (profile_id, type, title, body)
       values ($1, $2, $3, $4)`,
      [profileId, payload.type ?? "vote_rejected", payload.title, payload.body],
    );
  }
}
