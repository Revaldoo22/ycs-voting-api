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
    // Kolom penaut ke pengumuman: ditambah terpisah karena tabel
    // notifications sudah ada di produksi.
    await this.db.query(
      `alter table notifications
         add column if not exists announcement_id uuid`,
    );
    await this.db.query(`
      create table if not exists announcements (
        id uuid primary key default gen_random_uuid(),
        title text not null,
        body text not null,
        sent_count int not null default 0,
        only_non_participants boolean not null default true,
        sent_by text,
        created_at timestamptz not null default now()
      )
    `);
    await this.db.query(`
      create table if not exists announcement_clicks (
        id uuid primary key default gen_random_uuid(),
        announcement_id uuid not null,
        profile_id uuid,
        url text not null,
        created_at timestamptz not null default now()
      )
    `);
    await this.db.query(
      `create index if not exists announcement_click_ann
         on announcement_clicks (announcement_id)`,
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
    sentBy?: string | null;
  }) {
    const dedupe = Math.max(0, payload.dedupeHours ?? 24);

    // Catat pengirimannya dulu supaya tiap notifikasi bisa ditautkan; kalau
    // ternyata tak ada penerima, barisnya dihapus lagi di bawah.
    const [ann]: { id: string }[] = await this.db.query(
      `insert into announcements
         (title, body, only_non_participants, sent_by)
       values ($1, $2, $3, $4)
       returning id`,
      [
        payload.title,
        payload.body,
        payload.onlyNonParticipants ?? false,
        payload.sentBy ?? null,
      ],
    );

    const rows: { count: string }[] = await this.db.query(
      `with target as (
         insert into notifications
           (profile_id, type, title, body, announcement_id)
         select pr.id, $1, $2, $3, $6
         from profiles pr
         -- Kriteria HARUS sama dengan endpoint audience, kalau tidak jumlah
         -- terkirim berbeda dari yang dijanjikan ke admin sebelum mengirim.
         where pr.role <> 'admin'
           -- Sengaja TIDAK menyaring onboarded: notifikasi muncul di lonceng
           -- begitu mereka login, dan yang belum onboarding justru sasaran
           -- utama ajakan mendaftar.
           -- Peserta hasil sync punya role 'participant'; yang mendaftar
           -- sendiri sebagai voter dikenali lewat record peserta yang
           -- tertaut, baik via profile_id maupun kecocokan email.
           and (
             $4::boolean is not true
             or (
               pr.role <> 'participant'
               and not exists (
                 select 1 from participants p
                 where p.profile_id = pr.id
                    or (pr.email is not null
                        and lower(p.email) = lower(pr.email))
               )
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
        ann.id,
      ],
    );

    const sent = Number(rows[0]?.count ?? 0);
    if (sent === 0) {
      // Tak ada penerima: jangan tinggalkan baris riwayat yang menyesatkan.
      await this.db.query(`delete from announcements where id = $1`, [ann.id]);
      return { ok: true, sent: 0 };
    }
    await this.db.query(
      `update announcements set sent_count = $2 where id = $1`,
      [ann.id, sent],
    );
    return { ok: true, sent, announcement_id: ann.id };
  }
}
