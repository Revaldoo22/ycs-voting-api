import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { PmbTrackingJob, PmbTrackingJobItem } from "../../database/entities";

const TRACKING_URL = "https://pmb.stekom.ac.id/api/tracking/submit-direct";

/**
 * Backfill kirim tracking ke PMB untuk RIBUAN data (bisa berjam-jam).
 * Berjalan sebagai job in-process (bukan request-response biasa): admin
 * memicu start lewat HTTP lalu request itu langsung selesai, sementara
 * loop-nya jalan di background di server. Progress & log per item disimpan
 * ke DB supaya bertahan lintas restart proses dan bisa dipoll dari admin.
 *
 * Sengaja hanya 1 job aktif sekaligus (properti runningJobId) supaya tidak
 * ada dua loop membanjiri API PMB bersamaan.
 */
@Injectable()
export class PmbTrackingService {
  private runningJobId: string | null = null;
  private stopRequested = false;

  constructor(private readonly db: DataSource) {}

  async start(opts: {
    intent?: string;
    awareness?: string;
    force: boolean;
    delayMs: number;
    startedBy: string | null;
  }) {
    if (this.runningJobId) {
      throw new ConflictException(
        "Ada job backfill tracking PMB yang masih berjalan. Hentikan dulu sebelum memulai yang baru.",
      );
    }

    const jobs = this.db.getRepository(PmbTrackingJob);
    const job = await jobs.save(
      jobs.create({
        status: "running",
        filterIntent: opts.intent || null,
        filterAwareness: opts.awareness || null,
        force: opts.force,
        delayMs: opts.delayMs,
        startedBy: opts.startedBy,
      }),
    );

    this.runningJobId = job.id;
    this.stopRequested = false;
    // Sengaja tidak di-await: request start() harus langsung balas ke admin,
    // loop panjangnya jalan sendiri di background.
    void this.run(job.id, opts);

    return { job_id: job.id };
  }

  stop(jobId: string) {
    if (this.runningJobId !== jobId) {
      throw new NotFoundException("Job ini tidak sedang berjalan.");
    }
    this.stopRequested = true;
    return { ok: true };
  }

  async status(jobId: string) {
    const jobs = this.db.getRepository(PmbTrackingJob);
    const job = await jobs.findOneBy({ id: jobId });
    if (!job) throw new NotFoundException("Job tidak ditemukan.");

    const items = await this.db.getRepository(PmbTrackingJobItem).find({
      where: { jobId },
      order: { createdAt: "DESC" },
      take: 50,
    });

    return { job, recent_items: items, is_running: this.runningJobId === jobId };
  }

  /** Job terakhir (untuk halaman admin auto-resume tampilan progress setelah reload). */
  async latest() {
    const jobs = this.db.getRepository(PmbTrackingJob);
    const job = await jobs.findOne({ where: {}, order: { createdAt: "DESC" } });
    if (!job) return null;
    return this.status(job.id);
  }

  private async run(
    jobId: string,
    opts: { intent?: string; awareness?: string; force: boolean; delayMs: number },
  ) {
    const jobs = this.db.getRepository(PmbTrackingJob);
    const items = this.db.getRepository(PmbTrackingJobItem);

    try {
      const rows = (await this.db.query(
        `select id, name, email, phone_number, pmb_tracked_at
           from profiles
          where role = 'voter' and onboarded = true
            and ($1::text is null or college_intent = $1)
            and ($2::text is null or stekom_awareness = $2)
          order by created_at asc`,
        [opts.intent || null, opts.awareness || null],
      )) as {
        id: string;
        name: string | null;
        email: string | null;
        phone_number: string | null;
        pmb_tracked_at: Date | null;
      }[];

      const targets = opts.force ? rows : rows.filter((r) => !r.pmb_tracked_at);
      await jobs.update(jobId, { total: targets.length });

      for (const row of targets) {
        if (this.stopRequested) {
          await jobs.update(jobId, { status: "stopped" });
          return;
        }

        let status: "ok" | "fail" = "ok";
        let error: string | null = null;
        try {
          const res = await fetch(TRACKING_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Connection: "close" },
            body: JSON.stringify({
              source_page: "Idola Voter",
              nama: row.name ?? "",
              email: row.email ?? "",
              phone: row.phone_number ?? "",
              data: "admin_leads_submit",
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            // Potong body respons: server tujuan bisa balas halaman error HTML
            // panjang, dan ini disimpan ke DB lalu dikirim balik tiap polling
            // status (recent_items 50 baris) -> kalau tak dibatasi, payload
            // GET status bisa membengkak dan memicu limit ukuran di proxy.
            const body = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
          }
          await this.db.query(
            `update profiles set pmb_tracked_at = now() where id = $1`,
            [row.id],
          );
        } catch (e) {
          status = "fail";
          // fetch() Node membungkus error jaringan asli di `cause` (mis.
          // ENOTFOUND, ECONNRESET), sedangkan .message sendiri sering cuma
          // "fetch failed" yang tidak informatif. Sertakan keduanya.
          const base = e instanceof Error ? e.message : String(e);
          const rawCause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
          const cause = rawCause
            ? ` — ${rawCause instanceof Error ? rawCause.message : String(rawCause)}`
            : "";
          error = (base + cause).slice(0, 300);
        }

        await items.save(
          items.create({
            jobId,
            profileId: row.id,
            name: row.name,
            status,
            error,
          }),
        );

        await jobs.increment({ id: jobId }, "processed", 1);
        if (status === "ok") await jobs.increment({ id: jobId }, "ok", 1);
        else await jobs.increment({ id: jobId }, "fail", 1);

        await new Promise((r) => setTimeout(r, opts.delayMs));
      }

      await jobs.update(jobId, { status: "done" });
    } finally {
      this.runningJobId = null;
      this.stopRequested = false;
    }
  }
}
