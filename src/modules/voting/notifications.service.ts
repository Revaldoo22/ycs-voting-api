import { Injectable, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";

/**
 * Notifikasi voter. Karena DB_SYNC=false di produksi, tabelnya di-provision
 * idempoten saat boot (gaya raw-SQL codebase ini), tak perlu migrasi.
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

  /**
   * Kirim satu notifikasi ke SEMUA akun (voter maupun peserta). Dipakai admin
   * untuk pengumuman, mis. ajakan mendaftar jadi peserta YCS.
   *
   * `onlyNonParticipants` membatasi ke akun yang belum tertaut record peserta,
   * supaya peserta tidak menerima ajakan yang tak relevan untuk mereka.
   *
   * Idempotensi ditangani `dedupeHours`: kalau notifikasi bertipe sama sudah
   * dikirim ke akun itu dalam N jam terakhir, akun itu dilewati. Tanpa ini
   * admin yang menekan tombol dua kali akan membanjiri lonceng voter.
   */
  async broadcast(payload: {
    type: string;
    title: string;
    body: string;
    onlyNonParticipants?: boolean;
    dedupeHours?: number;
  }) {
    const dedupe = Math.max(0, payload.dedupeHours ?? 24);
    const rows: { count: string }[] = await this.db.query(
      `with target as (
         insert into notifications (profile_id, type, title, body)
         select pr.id, $1, $2, $3
         from profiles pr
         where pr.role = 'voter'
           -- Akun peserta dikenali dari record peserta yang tertaut, baik
           -- lewat profile_id maupun kecocokan email.
           and (
             $4::boolean is not true
             or not exists (
               select 1 from participants p
               where p.profile_id = pr.id
                  or (pr.email is not null
                      and lower(p.email) = lower(pr.email))
             )
           )
           and not exists (
             select 1 from notifications n
             where n.profile_id = pr.id and n.type = $1
               and n.created_at > now() - ($5 || ' hours')::interval
           )
         returning 1
       )
       select count(*)::text as count from target`,
      [
        payload.type,
        payload.title,
        payload.body,
        payload.onlyNonParticipants ?? false,
        String(dedupe),
      ],
    );
    return { ok: true, sent: Number(rows[0]?.count ?? 0) };
  }
}
