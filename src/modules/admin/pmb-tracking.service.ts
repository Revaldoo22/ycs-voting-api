import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
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
export class PmbTrackingService {
  private runningJobId: string | null = null;
  private stopRequested = false;

  constructor(private readonly db: DataSource) {}

  async start(opts: {
    intent?: string;
    awareness?: string;
    force: boolean;
    batchSize: number;
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
        batchSize: opts.batchSize,
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
        if (this.stopRequested) {
          await jobs.update(jobId, { status: "stopped" });
          return;
        }

        const batch = targets.slice(i, i + batchSize);
        // Dalam satu batch, semua data dikirim PARALEL (batchSize=1 = persis
        // perilaku lama satu-per-satu). Delay dikenakan antar BATCH, bukan
        // antar data, supaya batchSize besar tidak ikut kelipatan delay.
        const results = await Promise.all(batch.map((row) => this.sendOne(row)));

        let batchOk = 0;
        let batchFail = 0;
        for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const { status, error } = results[j];
          await items.save(
            items.create({
              jobId,
              profileId: row.id,
              name: row.name,
              status,
              error,
            }),
          );
          if (status === "ok") batchOk++;
          else batchFail++;
        }

        await jobs.increment({ id: jobId }, "processed", batch.length);
        if (batchOk > 0) await jobs.increment({ id: jobId }, "ok", batchOk);
        if (batchFail > 0) await jobs.increment({ id: jobId }, "fail", batchFail);

        if (i + batchSize < targets.length) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
      }

      await jobs.update(jobId, { status: "done" });
    } finally {
      this.runningJobId = null;
      this.stopRequested = false;
    }
  }
}
