import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { PmbTrackingJob, PmbTrackingJobItem } from "../../database/entities";

const TRACKING_URL = "https://pmb.stekom.ac.id/api/tracking/submit-direct";

/**
 * fetch() Node membungkus error jaringan asli di `cause`, dan pada kegagalan
 * DNS/koneksi ganda itu bisa berupa AggregateError (.message KOSONG, detail
 * ada di .errors[]). Tanpa penanganan ini, log job cuma menampilkan
 * "fetch failed —" tanpa info apa pun. Ambil errno (ECONNRESET/ETIMEDOUT/dst)
 * dan pesan dari lapisan cause/errors yang paling dalam.
 */
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts: string[] = [e.message || e.name];

  let cur: unknown = (e as { cause?: unknown }).cause;
  let depth = 0;
  while (cur && depth < 5) {
    depth++;
    if (cur instanceof AggregateError) {
      const sub = cur.errors
        .map((x) =>
          x instanceof Error
            ? `${x.name}:${x.message || (x as NodeJS.ErrnoException).code || ""}`
            : String(x),
        )
        .join(", ");
      parts.push(`AggregateError[${sub}]`);
      break;
    }
    if (cur instanceof Error) {
      const code = (cur as NodeJS.ErrnoException).code;
      parts.push(cur.message || code || cur.name);
      cur = (cur as { cause?: unknown }).cause;
      continue;
    }
    parts.push(String(cur));
    break;
  }

  return parts.filter(Boolean).join(" — ") || "Error tanpa pesan";
}

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
export class PmbTrackingService implements OnModuleInit {
  private readonly log = new Logger(PmbTrackingService.name);
  private runningJobId: string | null = null;
  private stopRequested = false;

  constructor(private readonly db: DataSource) {}

  /**
   * Loop job hidup di memori proses ini, jadi restart/crash container
   * membunuhnya tanpa sempat memperbarui baris di DB. Tanpa ini, job mati
   * tertinggal berstatus "running" selamanya: halaman admin terus memutar
   * spinner, dan pengecekan "hanya 1 job aktif" jadi tak bisa dipercaya
   * karena runningJobId sudah kosong setelah restart. Semua job "running"
   * yang tersisa saat startup pasti yatim — tak ada loop yang menjalankannya.
   */
  async onModuleInit() {
    const { affected } = await this.db
      .getRepository(PmbTrackingJob)
      .update({ status: "running" }, { status: "stopped" });
    if (affected) {
      this.log.warn(
        `${affected} job backfill tracking PMB ditandai berhenti: prosesnya hilang saat restart.`,
      );
    }
  }

  async start(opts: {
    intent?: string;
    awareness?: string;
    force: boolean;
    batchSize: number;
    delayMs: number;
    batchDelayMs: number;
    startedBy: string | null;
  }) {
    const jobs = this.db.getRepository(PmbTrackingJob);

    // Dicek dua lapis: memori (loop di proses ini) dan DB (baris "running"
    // yang mungkin ditinggalkan proses lain). Tanpa cek DB, dua replika
    // backend bisa sama-sama merasa kosong lalu membanjiri API PMB bersamaan.
    if (this.runningJobId || (await jobs.countBy({ status: "running" }))) {
      throw new ConflictException(
        "Ada job backfill tracking PMB yang masih berjalan. Hentikan dulu sebelum memulai yang baru.",
      );
    }
    const job = await jobs.save(
      jobs.create({
        status: "running",
        filterIntent: opts.intent || null,
        filterAwareness: opts.awareness || null,
        force: opts.force,
        batchSize: opts.batchSize,
        delayMs: opts.delayMs,
        batchDelayMs: opts.batchDelayMs,
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

  async stop(jobId: string) {
    if (this.runningJobId === jobId) {
      // Loop-nya ada di proses ini: minta berhenti baik-baik supaya batch
      // yang sedang jalan selesai dulu dan statusnya ditulis oleh run().
      this.stopRequested = true;
      return { ok: true };
    }

    // Job yatim: baris masih "running" tapi tak ada loop yang menjalankannya
    // (mis. proses lama sudah mati). Tutup barisnya langsung.
    const { affected } = await this.db
      .getRepository(PmbTrackingJob)
      .update({ id: jobId, status: "running" }, { status: "stopped" });
    if (!affected) {
      throw new NotFoundException("Job ini tidak sedang berjalan.");
    }
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

  private async sendOne(row: {
    id: string;
    name: string | null;
    email: string | null;
    phone_number: string | null;
  }) {
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
      return { status: "ok" as const, error: null as string | null };
    } catch (e) {
      return { status: "fail" as const, error: describeError(e).slice(0, 300) };
    }
  }

  private async run(
    jobId: string,
    opts: {
      intent?: string;
      awareness?: string;
      force: boolean;
      batchSize: number;
      delayMs: number;
      batchDelayMs: number;
    },
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

      const batchSize = Math.max(opts.batchSize, 1);
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);

        // Di dalam satu batch, data diproses BERURUTAN (bukan paralel) dengan
        // delayMs di antaranya -> lebih ramah ke server tujuan dibanding
        // burst paralel (yang pernah bikin gagal rate ~82% saat dicoba).
        for (const row of batch) {
          if (this.stopRequested) {
            await jobs.update(jobId, { status: "stopped" });
            return;
          }

          const { status, error } = await this.sendOne(row);
          await items.save(
            items.create({ jobId, profileId: row.id, name: row.name, status, error }),
          );
          await jobs.increment({ id: jobId }, "processed", 1);
          await jobs.increment({ id: jobId }, status === "ok" ? "ok" : "fail", 1);

          const isLastOfBatch = row === batch[batch.length - 1];
          if (!isLastOfBatch) {
            await new Promise((r) => setTimeout(r, opts.delayMs));
          }
        }

        // Batch selesai: jeda tambahan sebelum batch berikutnya (kecuali ini
        // batch terakhir, tak ada gunanya menunggu setelah semua selesai).
        if (i + batchSize < targets.length) {
          await new Promise((r) => setTimeout(r, opts.batchDelayMs));
        }
      }

      await jobs.update(jobId, { status: "done" });
    } finally {
      this.runningJobId = null;
      this.stopRequested = false;
    }
  }
}
