import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { randomUUID } from "crypto";
import { normalizePhone } from "../../common/utils/normalize";
import {
  AppSettings,
  Profile,
  RewardCatalog,
  RewardRedemption,
  SpinAccount,
  SpinPrize,
  SpinResult,
  type SpinSource,
  PointAdjustment,
  SpinTarget,
} from "../../database/entities";

/** Saldo yang bisa dibelanjakan oleh satu akun. */
export type Balance = {
  email: string;
  name: string | null;
  /** Poin dari vote yang masuk (1 vote = 1 poin). TIDAK pernah berkurang. */
  points_earned: number;
  /** Penyesuaian manual admin; bisa negatif. */
  points_adjusted: number;
  /** Poin yang sudah dipakai untuk menukar hadiah / membeli spin. */
  points_spent: number;
  /** Sisa poin yang bisa dibelanjakan. */
  points_available: number;
  /** Kunci yang didapat dari hadiah spin. */
  keys_earned: number;
  keys_spent: number;
  keys_available: number;
  /** Jatah spin gratis dari penukaran, dikurangi yang sudah dipakai. */
  spins_available: number;
};

@Injectable()
export class RewardsService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(RewardCatalog)
    private readonly catalog: Repository<RewardCatalog>,
    @InjectRepository(SpinPrize)
    private readonly prizes: Repository<SpinPrize>,
    @InjectRepository(RewardRedemption)
    private readonly redemptions: Repository<RewardRedemption>,
    @InjectRepository(SpinResult)
    private readonly spins: Repository<SpinResult>,
    @InjectRepository(AppSettings)
    private readonly settings: Repository<AppSettings>,
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
    @InjectRepository(SpinAccount)
    private readonly accounts: Repository<SpinAccount>,
    @InjectRepository(PointAdjustment)
    private readonly adjustments: Repository<PointAdjustment>,
    @InjectRepository(SpinTarget)
    private readonly targets: Repository<SpinTarget>,
  ) {}

  /**
   * DB_SYNC mati di produksi, jadi tabel baru di-provision idempoten saat
   * boot, mengikuti pola NotificationsService.
   */
  async onModuleInit() {
    await this.db.query(`
      create table if not exists point_adjustments (
        id uuid primary key default gen_random_uuid(),
        email text not null,
        points int not null,
        reason text not null,
        created_by text,
        created_at timestamptz not null default now()
      )
    `);
    await this.db.query(
      `create index if not exists point_adj_email
         on point_adjustments (email)`,
    );
    // DB_SYNC=false di production, jadi kolom baru disediakan di sini.
    await this.db.query(
      `alter table spin_prizes
         add column if not exists is_locked boolean not null default false`,
    );
    await this.db.query(
      `alter table reward_redemptions add column if not exists batch_id uuid`,
    );
    await this.db.query(`
      create table if not exists spin_targets (
        id uuid primary key default gen_random_uuid(),
        email text,
        phone text,
        prize_code text not null,
        at_spin int,
        reason text not null,
        created_by text,
        used_at timestamptz,
        used_by_email text,
        created_at timestamptz not null default now()
      )
    `);
    await this.db.query(
      `create index if not exists spin_target_email on spin_targets (email)`,
    );
    await this.db.query(
      `create index if not exists spin_target_phone on spin_targets (phone)`,
    );
  }

  // ----------------------------- Setelan -----------------------------

  private async appSettings(): Promise<AppSettings> {
    let row = await this.settings.findOneBy({ id: true });
    if (!row) row = await this.settings.save(this.settings.create({ id: true }));
    return row;
  }

  /** Opsi spin yang dipakai UI web kedua: 1x atau paket 5x + bonus. */
  async getSpinOptions() {
    const s = await this.appSettings();
    const options: {
      code: string;
      label: string;
      spins: number;
      bonus: number;
      point_cost: number;
    }[] = [
      {
        code: "single",
        label: "1x Spin",
        spins: 1,
        bonus: 0,
        point_cost: s.spinPointCost,
      },
    ];
    if (s.spinBundleEnabled && s.spinBundleCount > 0) {
      const bonus = Math.max(0, s.spinBundleBonus);
      options.push({
        code: "bundle",
        label:
          bonus > 0
            ? `${s.spinBundleCount}x Spin + ${bonus} Bonus`
            : `${s.spinBundleCount}x Spin`,
        spins: s.spinBundleCount,
        bonus,
        // Bonus gratis: yang dibayar hanya spin berbayarnya.
        point_cost: s.spinPointCost * s.spinBundleCount,
      });
    }
    return {
      // Web kedua wajib memeriksa ini: kalau false, sembunyikan roda dan
      // tampilkan pesan spin sedang ditutup.
      spin_enabled: s.spinEnabled,
      spin_point_cost: s.spinPointCost,
      spin_first_cost: s.spinFirstCost,
      options,
    };
  }

  async updateSpinOptions(patch: {
    spin_enabled?: boolean;
    spin_point_cost?: number;
    spin_first_cost?: number;
    spin_bundle_enabled?: boolean;
    spin_bundle_count?: number;
    spin_bundle_bonus?: number;
  }) {
    const s = await this.appSettings();
    if (patch.spin_enabled !== undefined) s.spinEnabled = patch.spin_enabled;
    if (patch.spin_point_cost !== undefined) s.spinPointCost = patch.spin_point_cost;
    if (patch.spin_first_cost !== undefined) s.spinFirstCost = patch.spin_first_cost;
    if (patch.spin_bundle_enabled !== undefined)
      s.spinBundleEnabled = patch.spin_bundle_enabled;
    if (patch.spin_bundle_count !== undefined)
      s.spinBundleCount = patch.spin_bundle_count;
    if (patch.spin_bundle_bonus !== undefined)
      s.spinBundleBonus = patch.spin_bundle_bonus;
    await this.settings.save(s);
    return this.getSpinOptions();
  }

  // ----------------------------- Saldo -------------------------------

  /**
   * Hitung saldo satu akun by email.
   *
   * Poin diperoleh dari vote yang masuk untuk PESERTA pemilik email ini
   * (1 vote = 1 poin), hanya vote berstatus approved dan bukan bot. Angka
   * ini murni hasil hitung, jadi menukar poin tidak akan pernah menyentuh
   * jumlah vote yang jadi dasar peringkat.
   */
  async getBalance(
    emailRaw: string,
    /**
     * Manager transaksi pemanggil. Wajib diisi bila dipanggil dari dalam
     * transaksi: tanpa ini query jalan di koneksi lain dan tidak melihat
     * baris yang baru ditulis tapi belum di-commit, sehingga saldo yang
     * dikembalikan masih yang lama.
     */
    manager?: EntityManager,
  ): Promise<Balance> {
    const email = emailRaw.trim().toLowerCase();
    if (!email) throw new BadRequestException("Email wajib diisi.");

    const runner = manager ?? this.db;
    const rows = (await runner.query(
      `select
         (select coalesce(count(*), 0)
            from daily_votes dv
            join participants p on p.id = dv.participant_id
           where lower(p.email) = $1
             and dv.status = 'approved'
             and dv.is_bot = false)::int as points_earned,
         -- Penyesuaian manual admin. Terpisah dari vote supaya menambah
         -- saldo tak menaikkan statistik event maupun klasemen. Bisa negatif.
         (select coalesce(sum(points), 0)
            from point_adjustments
           where lower(email) = $1)::int as points_adjusted,
         (select coalesce(sum(point_cost), 0)
            from reward_redemptions
           where lower(email) = $1 and status <> 'canceled')::int as points_spent,
         (select coalesce(sum(key_cost), 0)
            from reward_redemptions
           where lower(email) = $1 and status <> 'canceled')::int as keys_spent,
         (select coalesce(sum(key_grant), 0)
            from spin_results where lower(email) = $1)::int as keys_earned,
         (select coalesce(sum(spin_grant), 0)
            from reward_redemptions
           where lower(email) = $1 and status <> 'canceled')::int as spins_granted,
         (select coalesce(count(*), 0)
            from spin_results
           where lower(email) = $1 and is_bonus = false)::int as spins_used`,
      [email],
    )) as {
      points_earned: number;
      points_adjusted: number;
      points_spent: number;
      keys_spent: number;
      keys_earned: number;
      spins_granted: number;
      spins_used: number;
    }[];

    const r = rows[0];
    const profile = await (manager
      ? manager.getRepository(Profile).findOneBy({ email })
      : this.profiles.findOneBy({ email }));

    return {
      email,
      name: profile?.name ?? null,
      points_earned: r.points_earned,
      points_adjusted: r.points_adjusted,
      points_spent: r.points_spent,
      // Penyesuaian admin ikut menambah/mengurangi saldo. Dijaga minimal 0
      // supaya penyesuaian negatif yang berlebihan tak bikin saldo minus.
      points_available: Math.max(
        0,
        r.points_earned + r.points_adjusted - r.points_spent,
      ),
      keys_earned: r.keys_earned,
      keys_spent: r.keys_spent,
      keys_available: r.keys_earned - r.keys_spent,
      // Jatah gratis yang belum dipakai; bisa negatif kalau spin dibayar
      // pakai poin, jadi dijaga minimal 0.
      spins_available: Math.max(0, r.spins_granted - r.spins_used),
    };
  }

  // ------------------- Penyesuaian poin manual ------------------------

  /**
   * Tambah / kurangi saldo poin sebuah akun tanpa membuat vote.
   *
   * Dipakai untuk testing dan koreksi. Sengaja bukan lewat vote: poin belanja
   * dihitung dari vote approved, jadi vote palsu akan menaikkan statistik
   * event, klasemen, dan Vote Masuk.
   */
  async adjustPoints(input: {
    email: string;
    points: number;
    reason: string;
    createdBy?: string | null;
  }) {
    const email = input.email.trim().toLowerCase();
    if (!email) throw new BadRequestException("Email wajib diisi.");
    if (!Number.isInteger(input.points) || input.points === 0) {
      throw new BadRequestException("Jumlah poin harus bilangan bulat bukan 0.");
    }
    if (!input.reason.trim()) {
      throw new BadRequestException("Alasan wajib diisi.");
    }

    await this.adjustments.save(
      this.adjustments.create({
        email,
        points: input.points,
        reason: input.reason.trim(),
        createdBy: input.createdBy ?? null,
      }),
    );
    // Saldo terbaru langsung dikembalikan supaya admin tak perlu memuat ulang.
    return { ok: true, balance: await this.getBalance(email) };
  }

  /** Riwayat penyesuaian; tanpa email berarti seluruh akun. */
  listAdjustments(email?: string) {
    const e = email?.trim().toLowerCase() || null;
    return this.db.query(
      `select a.id, a.email, a.points, a.reason, a.created_by, a.created_at,
              pr.name as account_name
       from point_adjustments a
       left join profiles pr on lower(pr.email) = a.email
       where ($1::text is null or a.email = $1)
       order by a.created_at desc
       limit 200`,
      [e],
    );
  }

  /** Batalkan satu penyesuaian. Saldo kembali seperti sebelum baris ini. */
  async removeAdjustment(id: string) {
    const row = await this.adjustments.findOneBy({ id });
    if (!row) throw new NotFoundException("Penyesuaian tidak ditemukan.");
    await this.adjustments.delete({ id });
    return { ok: true, balance: await this.getBalance(row.email) };
  }

  // --------------------------- Katalog tukar --------------------------

  /** Katalog untuk UI web kedua (hanya yang aktif). */
  async listCatalog(includeInactive = false) {
    const where = includeInactive ? {} : { active: true };
    const items = await this.catalog.find({
      where,
      order: { sortOrder: "ASC", pointCost: "DESC" },
    });
    return items.map((i) => this.catalogView(i));
  }

  private catalogView(i: RewardCatalog) {
    return {
      id: i.id,
      code: i.code,
      name: i.name,
      description: i.description,
      point_cost: i.pointCost,
      key_cost: i.keyCost,
      kind: i.kind,
      spin_grant: i.spinGrant,
      stock: i.stock,
      active: i.active,
      sort_order: i.sortOrder,
    };
  }

  async createCatalog(dto: Partial<RewardCatalog> & { code: string; name: string }) {
    const code = dto.code.trim().toLowerCase();
    const clash = await this.catalog.findOneBy({ code });
    if (clash) throw new ConflictException(`Kode "${code}" sudah dipakai.`);
    const saved = await this.catalog.save(
      this.catalog.create({ ...dto, code }),
    );
    return this.catalogView(saved);
  }

  async updateCatalog(id: string, patch: Partial<RewardCatalog>) {
    const item = await this.catalog.findOneBy({ id });
    if (!item) throw new NotFoundException("Item katalog tidak ditemukan.");
    // Kode tidak boleh bentrok kalau ikut diubah.
    if (patch.code && patch.code !== item.code) {
      const code = patch.code.trim().toLowerCase();
      if (await this.catalog.findOneBy({ code }))
        throw new ConflictException(`Kode "${code}" sudah dipakai.`);
      patch.code = code;
    }
    Object.assign(item, patch);
    return this.catalogView(await this.catalog.save(item));
  }

  async removeCatalog(id: string) {
    const item = await this.catalog.findOneBy({ id });
    if (!item) throw new NotFoundException("Item katalog tidak ditemukan.");
    await this.catalog.delete({ id });
    return { ok: true };
  }

  // --------------------------- Hadiah spin ----------------------------

  /**
   * Daftar hadiah untuk digambar di roda web kedua.
   *
   * Hadiah TERKUNCI tetap ikut walau `active: false`. Justru itu gunanya
   * kunci: hadiah utama tetap tampil di roda sebagai pemikat, tapi dijamin
   * tak bisa didapat. Kalau ikut disaring di sini, hadiahnya hilang dari
   * roda dan pemikatnya ikut hilang. `chance`-nya tetap 0 karena drawable()
   * menolak yang terkunci, jadi pembagian peluang tidak terganggu.
   */
  async listPrizes(includeInactive = false) {
    const where = includeInactive
      ? {}
      : [{ active: true }, { isLocked: true }];
    const items = await this.prizes.find({
      where,
      order: { sortOrder: "ASC", label: "ASC" },
    });
    // Peluang dihitung dari bobot hadiah yang benar-benar bisa keluar.
    const pool = items.filter((p) => this.drawable(p));
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    return items.map((p) => ({
      id: p.id,
      code: p.code,
      label: p.label,
      weight: p.weight,
      is_empty: p.isEmpty,
      key_grant: p.keyGrant,
      stock: p.stock,
      winner_quota: p.winnerQuota,
      max_per_account: p.maxPerAccount,
      is_guaranteed: p.isGuaranteed,
      guarantee_min_spin: p.guaranteeMinSpin,
      guarantee_max_spin: p.guaranteeMaxSpin,
      auto_at_points: p.autoAtPoints,
      auto_at_spins: p.autoAtSpins,
      color: p.color,
      active: p.active,
      is_locked: p.isLocked,
      sort_order: p.sortOrder,
      // Peluang di UNDIAN ACAK saja. Hadiah berjaminan & hadiah yang
      // diberikan otomatis bernilai 0 di sini karena tidak lewat undian.
      chance:
        total > 0 && this.drawable(p)
          ? Number(((p.weight / total) * 100).toFixed(2))
          : 0,
    }));
  }

  /**
   * Hadiah masih DITAHAN karena ambang otomatisnya belum tercapai.
   *
   * Ambang bukan sekadar jaminan "paling lambat dapat di titik ini", tapi
   * juga penahan: sebelum ambang, hadiahnya dikeluarkan dari undian acak.
   * Tanpa itu, "hanya bisa didapat setelah 10x spin" bocor lewat
   * keberuntungan di spin ke-3.
   *
   * Kalau dua ambang diisi, cukup salah satu tercapai (poin ATAU spin),
   * konsisten dengan cara pemberian otomatisnya.
   */
  private gatedByThreshold(
    p: SpinPrize,
    spinNo: number,
    pointsEarned: number,
  ): boolean {
    if (p.autoAtPoints === null && p.autoAtSpins === null) return false;
    const reached =
      (p.autoAtPoints !== null && pointsEarned >= p.autoAtPoints) ||
      (p.autoAtSpins !== null && spinNo >= p.autoAtSpins);
    return !reached;
  }

  /** Hadiah ikut diundi hanya bila aktif, berbobot, dan stoknya masih ada. */
  private drawable(p: SpinPrize): boolean {
    if (p.isLocked) return false;
    return p.active && p.weight > 0 && (p.stock === null || p.stock > 0);
  }

  /**
   * Masih tersedia untuk diberikan (tanpa melihat bobot).
   *
   * Bobot hanya mengatur peluang di UNDIAN ACAK. Hadiah berjaminan dan
   * hadiah otomatis sengaja berbobot 0 supaya tidak ikut diundi, jadi bobot
   * tidak boleh dipakai menilai apakah hadiah itu boleh diberikan.
   */
  private available(p: SpinPrize): boolean {
    // Kunci diperiksa di sini, gerbang tunggal yang dilewati SEMUA jalur
    // pemberian hadiah (acak, otomatis, jaminan, paksa). Menaruhnya hanya di
    // undian acak tidak cukup: jalur otomatis dan jaminan tak melihat active.
    if (p.isLocked) return false;
    return p.active && (p.stock === null || p.stock > 0);
  }

  async createPrize(dto: Partial<SpinPrize> & { code: string; label: string }) {
    const code = dto.code.trim().toLowerCase();
    if (await this.prizes.findOneBy({ code }))
      throw new ConflictException(`Kode "${code}" sudah dipakai.`);
    const saved = await this.prizes.save(this.prizes.create({ ...dto, code }));
    return saved;
  }

  async updatePrize(id: string, patch: Partial<SpinPrize>) {
    const item = await this.prizes.findOneBy({ id });
    if (!item) throw new NotFoundException("Hadiah spin tidak ditemukan.");
    if (patch.code && patch.code !== item.code) {
      const code = patch.code.trim().toLowerCase();
      if (await this.prizes.findOneBy({ code }))
        throw new ConflictException(`Kode "${code}" sudah dipakai.`);
      patch.code = code;
    }
    Object.assign(item, patch);
    return this.prizes.save(item);
  }

  async removePrize(id: string) {
    const item = await this.prizes.findOneBy({ id });
    if (!item) throw new NotFoundException("Hadiah spin tidak ditemukan.");
    await this.prizes.delete({ id });
    return { ok: true };
  }

  // ---------------------------- Penukaran -----------------------------

  /**
   * Tukar poin dengan satu item katalog.
   *
   * Seluruh langkah dibungkus satu transaksi dan baris katalog dikunci
   * (SELECT ... FOR UPDATE), supaya dua permintaan bersamaan tidak bisa
   * mengambil stok terakhir yang sama.
   */
  async redeem(emailRaw: string, code: string, note?: string) {
    const email = emailRaw.trim().toLowerCase();
    if (!email) throw new BadRequestException("Email wajib diisi.");

    return this.db.transaction(async (m) => {
      const rows = (await m.query(
        `select * from reward_catalog where code = $1 for update`,
        [code.trim().toLowerCase()],
      )) as RewardCatalog[];
      const raw = rows[0];
      if (!raw) throw new NotFoundException("Item katalog tidak ditemukan.");

      // Query mentah mengembalikan nama kolom snake_case.
      const item = {
        code: raw.code,
        name: raw.name,
        active: (raw as unknown as { active: boolean }).active,
        pointCost: (raw as unknown as { point_cost: number }).point_cost,
        keyCost: (raw as unknown as { key_cost: number }).key_cost,
        spinGrant: (raw as unknown as { spin_grant: number }).spin_grant,
        stock: (raw as unknown as { stock: number | null }).stock,
      };

      if (!item.active)
        throw new BadRequestException("Item ini sedang tidak tersedia.");
      if (item.stock !== null && item.stock <= 0)
        throw new ConflictException("Stok hadiah sudah habis.");

      const bal = await this.getBalance(email, m);
      if (bal.points_available < item.pointCost) {
        throw new BadRequestException(
          `Poin tidak cukup. Butuh ${item.pointCost}, tersedia ${bal.points_available}.`,
        );
      }
      if (bal.keys_available < item.keyCost) {
        throw new BadRequestException(
          `Kunci tidak cukup. Butuh ${item.keyCost}, tersedia ${bal.keys_available}.`,
        );
      }

      if (item.stock !== null) {
        await m.query(
          `update reward_catalog set stock = stock - 1 where code = $1`,
          [item.code],
        );
      }

      const profile = await m.getRepository(Profile).findOneBy({ email });
      const saved = await m.getRepository(RewardRedemption).save(
        m.getRepository(RewardRedemption).create({
          profileId: profile?.id ?? null,
          email,
          rewardCode: item.code,
          rewardName: item.name,
          pointCost: item.pointCost,
          keyCost: item.keyCost,
          spinGrant: item.spinGrant,
          note: note ?? null,
          status: "pending",
        }),
      );

      return {
        ok: true,
        redemption: {
          id: saved.id,
          reward_code: saved.rewardCode,
          reward_name: saved.rewardName,
          point_cost: saved.pointCost,
          key_cost: saved.keyCost,
          spin_grant: saved.spinGrant,
          status: saved.status,
          created_at: saved.createdAt,
        },
        balance: await this.getBalance(email, m),
      };
    });
  }

  /** Riwayat penukaran satu akun. */
  async listRedemptions(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const rows = await this.redemptions.find({
      where: { email },
      order: { createdAt: "DESC" },
    });
    return rows.map((r) => ({
      id: r.id,
      reward_code: r.rewardCode,
      reward_name: r.rewardName,
      point_cost: r.pointCost,
      key_cost: r.keyCost,
      spin_grant: r.spinGrant,
      status: r.status,
      note: r.note,
      created_at: r.createdAt,
    }));
  }

  /** Admin menandai penukaran sudah diserahkan / dibatalkan. */
  async setRedemptionStatus(
    id: string,
    status: "pending" | "done" | "canceled",
  ) {
    const row = await this.redemptions.findOneBy({ id });
    if (!row) throw new NotFoundException("Penukaran tidak ditemukan.");
    // Membatalkan berarti poin & kunci kembali, karena saldo dihitung dengan
    // mengabaikan baris berstatus canceled.
    if (status === "canceled" && row.status !== "canceled") {
      const item = await this.catalog.findOneBy({ code: row.rewardCode });
      if (item && item.stock !== null) {
        item.stock += 1;
        await this.catalog.save(item);
      }
    }
    row.status = status;
    await this.redemptions.save(row);
    return { ok: true, status };
  }

  // ------------------------------ Spin --------------------------------

  /**
   * Undi satu hadiah memakai bobot.
   *
   * Hadiah berjaminan (Kunci) TIDAK ikut di sini: ia punya jalurnya sendiri
   * lewat titik spin yang sudah ditentukan per akun, jadi kalau ikut diundi
   * acak ia bisa keluar dobel.
   */
  private pick(pool: SpinPrize[]): SpinPrize | null {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return pool[pool.length - 1];
  }

  /** Hadiah cadangan saat peserta tidak dapat apa-apa (Dash / 💨). */
  private async emptyPrize(): Promise<SpinPrize | null> {
    return this.prizes.findOne({
      where: { isEmpty: true },
      order: { sortOrder: "ASC" },
    });
  }

  /** Ambil (atau buat) keadaan spin satu akun. */
  private async spinAccount(
    email: string,
    profileId: string | null,
  ): Promise<SpinAccount> {
    let acc = await this.accounts.findOneBy({ email });
    if (acc) return acc;

    // Titik jaminan kunci diundi SEKALI di sini lalu disimpan permanen.
    // Kalau diundi ulang tiap spin, peserta bisa tak pernah dapat kunci.
    const keyPrize = await this.prizes.findOneBy({ isGuaranteed: true });
    let target: number | null = null;
    if (keyPrize) {
      const lo = Math.max(1, keyPrize.guaranteeMinSpin);
      const hi = Math.max(lo, keyPrize.guaranteeMaxSpin);
      target = lo + Math.floor(Math.random() * (hi - lo + 1));
    }
    acc = this.accounts.create({
      email,
      profileId,
      keySpinTarget: target,
      firstSpinUsed: false,
    });
    return this.accounts.save(acc);
  }

  /** Berapa akun berbeda yang sudah pernah menerima hadiah ini. */
  private async winnerCount(code: string): Promise<number> {
    const r = (await this.db.query(
      `select count(distinct email)::int as n from spin_results where prize_code = $1`,
      [code],
    )) as { n: number }[];
    return r[0]?.n ?? 0;
  }

  /** Berapa kali SATU akun sudah menerima hadiah ini. */
  private async ownedCount(email: string, code: string): Promise<number> {
    const r = (await this.db.query(
      `select count(*)::int as n from spin_results
        where lower(email) = $1 and prize_code = $2`,
      [email, code],
    )) as { n: number }[];
    return r[0]?.n ?? 0;
  }

  /**
   * Apakah hadiah ini masih boleh diberikan ke akun tsb saat ini?
   * Mengecek stok keping, kuota jumlah penerima, dan batas per akun.
   */
  private async claimable(p: SpinPrize, email: string): Promise<boolean> {
    if (!this.available(p)) return false;
    if (p.maxPerAccount !== null) {
      if ((await this.ownedCount(email, p.code)) >= p.maxPerAccount) return false;
    }
    if (p.winnerQuota !== null) {
      // Kuota dihitung per ORANG. Akun yang sudah pernah menang tidak
      // menambah pemakaian kuota, jadi ia masih boleh menang lagi.
      const already = (await this.ownedCount(email, p.code)) > 0;
      if (!already && (await this.winnerCount(p.code)) >= p.winnerQuota)
        return false;
    }
    return true;
  }

  /**
   * Log spin: satu baris per PERMINTAAN dari web kedua, bukan per hadiah.
   *
   * Satu permintaan paket 5x+1 menghasilkan 6 hadiah tapi hanya satu tagihan
   * poin, jadi dikelompokkan per batch_id supaya "berapa yang dibayar" dan
   * "dapat apa saja" terbaca dalam satu baris.
   *
   * Poin yang ditagih diambil dari redemptions (kode spin_paid) karena di
   * situlah pemotongan poin dicatat.
   */
  async spinLog(opts: {
    email?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const email = opts.email?.trim().toLowerCase() || null;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const rows = (await this.db.query(
      `select
         sr.batch_id,
         min(sr.email) as email,
         min(pr.name) as name,
         min(sr.created_at) as created_at,
         count(*)::int as total_spin,
         count(*) filter (where sr.is_bonus)::int as bonus_spin,
         count(*) filter (where not sr.is_empty)::int as dapat_hadiah,
         coalesce(
           (select r.point_cost from reward_redemptions r
             where r.batch_id = sr.batch_id
               and r.reward_code = 'spin_paid'
             limit 1), 0)::int as poin_ditagih,
         json_agg(
           json_build_object(
             'prize_label', sr.prize_label,
             'prize_code', sr.prize_code,
             'is_empty', sr.is_empty,
             'is_bonus', sr.is_bonus,
             'source', sr.source
           ) order by sr.created_at
         ) as hasil
       from spin_results sr
       left join profiles pr on pr.id = sr.profile_id
       where ($1::text is null or lower(sr.email) = $1)
       -- coalesce ke id baris: data lama sebelum batch_id ada bernilai null,
       -- dan tanpa ini semuanya tergabung jadi satu baris raksasa.
       group by coalesce(sr.batch_id, sr.id), sr.batch_id
       order by min(sr.created_at) desc
       limit $2 offset $3`,
      [email, limit, offset],
    )) as unknown[];

    const [tot] = (await this.db.query(
      `select
         count(distinct batch_id)::int as total_permintaan,
         count(*)::int as total_spin,
         count(*) filter (where not is_empty)::int as total_hadiah,
         count(distinct email)::int as total_akun
       from spin_results
       where ($1::text is null or lower(email) = $1)`,
      [email],
    )) as {
      total_permintaan: number;
      total_spin: number;
      total_hadiah: number;
      total_akun: number;
    }[];

    return { ringkasan: tot, rows };
  }

  // --------------------- Penandaan hadiah per akun ---------------------

  /** Daftar penandaan; `?email=` / `?phone=` menyaring satu akun. */
  async listTargets(filter?: { email?: string; phone?: string }) {
    const email = filter?.email?.trim().toLowerCase() || null;
    const phone = filter?.phone ? normalizePhone(filter.phone) : null;
    return this.db.query(
      `select t.*, sp.label as prize_label,
              pr.name as account_name
         from spin_targets t
         left join spin_prizes sp on sp.code = t.prize_code
         left join profiles pr
                on lower(pr.email) = lower(t.email)
                or pr.phone_number = t.phone
        where ($1::text is null or lower(t.email) = $1)
          and ($2::text is null or t.phone = $2)
        order by t.used_at is not null, t.created_at desc
        limit 200`,
      [email, phone],
    );
  }

  /**
   * Tandai satu akun supaya mendapat hadiah tertentu.
   *
   * Email atau nomor WA, minimal salah satu. Hadiah terkunci ditolak di sini
   * juga, bukan hanya diabaikan saat spin, supaya panitia langsung tahu.
   */
  async addTarget(dto: {
    email?: string | null;
    phone?: string | null;
    prize_code: string;
    at_spin?: number | null;
    reason: string;
    created_by?: string | null;
  }) {
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (!email && !phone) {
      throw new BadRequestException("Isi email atau nomor WA akunnya.");
    }
    const code = dto.prize_code.trim().toLowerCase();
    const prize = await this.prizes.findOneBy({ code });
    if (!prize) throw new BadRequestException(`Hadiah "${code}" tidak ada.`);
    if (prize.isLocked) {
      throw new BadRequestException(
        `"${prize.label}" terkunci. Buka kuncinya dulu bila memang mau diberikan.`,
      );
    }
    if (dto.reason.trim().length < 3) {
      throw new BadRequestException("Alasan minimal 3 karakter.");
    }

    // Peringatan dini: penandaan ke akun yang belum ada tidak akan pernah
    // terpakai, dan itu lebih baik diketahui sekarang daripada saat acara.
    const found = (await this.db.query(
      `select 1 from profiles
        where ($1::text is not null and lower(email) = $1)
           or ($2::text is not null and phone_number = $2)
        limit 1`,
      [email, phone],
    )) as unknown[];
    if (found.length === 0) {
      throw new BadRequestException(
        "Akun dengan email/nomor itu belum ada. Periksa lagi datanya.",
      );
    }

    const saved = await this.targets.save(
      this.targets.create({
        email,
        phone,
        prizeCode: code,
        atSpin: dto.at_spin ?? null,
        reason: dto.reason.trim(),
        createdBy: dto.created_by ?? null,
      }),
    );
    return saved;
  }

  /** Batalkan penandaan yang belum terpakai. */
  async removeTarget(id: string) {
    const item = await this.targets.findOneBy({ id });
    if (!item) throw new NotFoundException("Penandaan tidak ditemukan.");
    if (item.usedAt) {
      throw new BadRequestException(
        "Sudah terpakai, tidak bisa dibatalkan. Hadiahnya sudah diberikan ke akun itu.",
      );
    }
    await this.targets.remove(item);
    return { ok: true };
  }

  /** Rekap jumlah hadiah yang sudah keluar, per hadiah. */
  async spinPrizeTally() {
    return this.db.query(
      `select sr.prize_code, min(sr.prize_label) as prize_label,
              count(*)::int as keluar,
              count(distinct sr.email)::int as penerima,
              min(sr.created_at) as pertama,
              max(sr.created_at) as terakhir
         from spin_results sr
        where sr.is_empty = false
        group by sr.prize_code
        order by 3 desc`,
    );
  }

  /**
   * Ambil hadiah yang sudah ditetapkan panitia untuk akun ini, kalau ada.
   *
   * Dicocokkan lewat email ATAU nomor WA: akun web kedua tidak selalu punya
   * keduanya terisi, jadi panitia boleh menandai dengan salah satunya.
   *
   * `at_spin` null berarti "spin berikutnya, kapan pun". Kalau diisi, hanya
   * berlaku tepat di spin ke-N.
   *
   * Penandaan terpakai dilakukan lewat UPDATE bersyarat `used_at is null`,
   * jadi dua permintaan berbarengan tidak bisa menukarkan target yang sama
   * dua kali: yang kalah balapan mendapat rowCount 0 dan dilewati.
   */
  private async claimTarget(
    email: string,
    phoneRaw: string | null,
    spinNo: number,
    profileId: string | null,
    batchId: string,
    isBonus: boolean,
  ): Promise<SpinResult | null> {
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;

    const rows = (await this.db.query(
      `update spin_targets t
          set used_at = now(), used_by_email = $1
        where t.id = (
          select id from spin_targets
           where used_at is null
             and (
               (email is not null and lower(email) = $1)
               or ($2::text is not null and phone = $2)
             )
             and (at_spin is null or at_spin = $3)
             -- Hadiah terkunci disaring DI SINI, bukan setelah baris
             -- ditandai terpakai: hadiah bisa dikunci setelah targetnya
             -- dibuat, dan target yang tak bisa diberikan jangan sampai
             -- hangus percuma.
             and exists (
               select 1 from spin_prizes sp
                where sp.code = spin_targets.prize_code
                  and sp.is_locked = false
             )
           -- Yang menyebut spin tertentu didahulukan: kalau ada dua target,
           -- yang khusus untuk spin ini lebih tepat dipakai daripada yang
           -- berlaku kapan saja.
           order by (at_spin is null), created_at
           limit 1
           for update skip locked
        )
        returning t.prize_code, t.reason`,
      [email, phone, spinNo],
    )) as unknown;
    const recs = (Array.isArray((rows as unknown[])[0])
      ? (rows as unknown[][])[0]
      : (rows as unknown[])) as { prize_code: string }[];
    const target = recs[0];
    if (!target) return null;

    const prize = await this.prizes.findOneBy({ code: target.prize_code });
    if (!prize) return null;

    return this.record(prize, email, profileId, batchId, isBonus, "targeted");
  }

  /** Simpan satu hasil spin + kurangi stok kepingnya. */
  private async record(
    prize: SpinPrize,
    email: string,
    profileId: string | null,
    batchId: string,
    isBonus: boolean,
    source: SpinSource,
  ): Promise<SpinResult> {
    if (prize.stock !== null) {
      prize.stock -= 1;
      await this.prizes.save(prize);
    }
    return this.spins.save(
      this.spins.create({
        profileId,
        email,
        prizeCode: prize.code,
        prizeLabel: prize.label,
        isEmpty: prize.isEmpty,
        keyGrant: prize.keyGrant,
        batchId,
        isBonus,
        source,
      }),
    );
  }

  /**
   * Harga spin berikutnya untuk satu akun: diskon kalau belum pernah spin.
   * Dipakai UI web kedua supaya bisa menampilkan harga yang benar.
   */
  async getSpinPricing(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const s = await this.appSettings();
    const acc = await this.accounts.findOneBy({ email });
    const isFirst = !acc?.firstSpinUsed;
    return {
      email,
      next_spin_cost: isFirst ? s.spinFirstCost : s.spinPointCost,
      is_first_spin: isFirst,
      first_spin_cost: s.spinFirstCost,
      normal_cost: s.spinPointCost,
    };
  }

  /**
   * Putar roda. `option` = "single" (1x) atau "bundle" (paket 5x + bonus).
   *
   * Urutan penentuan hadiah tiap putaran:
   *  1. Titik jaminan kunci tercapai  -> Kunci (kalau jatah orang masih ada)
   *  2. Ambang otomatis tercapai      -> hadiah otomatis (mis. Tumbler)
   *  3. Undian acak berbobot          -> hadiah biasa
   *  4. Tidak dapat apa-apa           -> Dash
   *
   * Jatah spin gratis dipakai lebih dulu, sisanya dibayar poin. Spin pertama
   * tiap akun memakai harga diskon.
   */
  async spin(emailRaw: string, option: "single" | "bundle" = "single") {
    const email = emailRaw.trim().toLowerCase();
    if (!email) throw new BadRequestException("Email wajib diisi.");

    // Gerbang di server, bukan hanya menyembunyikan tombol: web kedua bisa
    // memanggil endpoint langsung.
    const st = await this.appSettings();
    if (!st.spinEnabled) {
      throw new BadRequestException("Roda spin sedang ditutup panitia.");
    }

    const cfg = await this.getSpinOptions();
    const chosen = cfg.options.find((o) => o.code === option);
    if (!chosen) throw new BadRequestException("Pilihan spin tidak tersedia.");

    const paid = chosen.spins;
    const bonus = chosen.bonus;

    const profile = await this.profiles.findOneBy({ email });
    const acc = await this.spinAccount(email, profile?.id ?? null);
    const settings = await this.appSettings();

    const bal = await this.getBalance(email);
    const freeUsed = Math.min(bal.spins_available, paid);
    const needPay = paid - freeUsed;

    // Harga: putaran berbayar pertama akun ini memakai harga diskon.
    let pointNeeded = 0;
    let discountApplied = false;
    for (let i = 0; i < needPay; i++) {
      const first = !acc.firstSpinUsed && i === 0;
      if (first) discountApplied = true;
      pointNeeded += first ? settings.spinFirstCost : settings.spinPointCost;
    }
    if (bal.points_available < pointNeeded) {
      throw new BadRequestException(
        `Poin tidak cukup. Butuh ${pointNeeded}, tersedia ${bal.points_available}.`,
      );
    }

    const empty = await this.emptyPrize();
    const all = await this.prizes.find();
    if (all.length === 0)
      throw new BadRequestException("Belum ada hadiah spin yang aktif.");

    // Sudah berapa kali akun ini spin sebelum ronde ini (untuk titik jaminan).
    const before = (
      (await this.db.query(
        `select count(*)::int as n from spin_results where lower(email) = $1`,
        [email],
      )) as { n: number }[]
    )[0].n;

    const batchId = randomUUID();
    const results: SpinResult[] = [];

    for (let i = 0; i < paid + bonus; i++) {
      const spinNo = before + i + 1; // spin ke berapa untuk akun ini
      const isBonus = i >= paid;
      let given: SpinResult | null = null;

      // 0. Hadiah yang sudah ditetapkan panitia untuk akun ini.
      //
      //    Didahulukan dari semua jalur lain karena ini keputusan manusia,
      //    bukan hasil aturan. Sekali pakai: baris target ditandai terpakai
      //    dalam transaksi yang sama supaya dua permintaan berbarengan tidak
      //    mengambil target yang sama dua kali.
      {
        given = await this.claimTarget(
          email,
          profile?.phoneNumber ?? null,
          spinNo,
          profile?.id ?? null,
          batchId,
          isBonus,
        );
      }

      // 1. Titik jaminan kunci.
      if (!given && acc.keySpinTarget !== null && spinNo === acc.keySpinTarget) {
        const keyPrize = all.find((p) => p.isGuaranteed);
        if (keyPrize && (await this.claimable(keyPrize, email))) {
          given = await this.record(
            keyPrize,
            email,
            profile?.id ?? null,
            batchId,
            isBonus,
            "guaranteed",
          );
        }
        // Jatah kunci habis: jatuh ke Dash, sesuai aturan.
      }

      // 2. Ambang otomatis: hadiah diberikan tepat saat akun mencapai sekian
      //    poin atau sekian kali spin, mana yang lebih dulu.
      //
      //    Ambang ini juga MENAHAN: selama belum tercapai, hadiahnya tidak
      //    ikut undian acak (lihat langkah 3). Jadi menyetel Tumbler di 10x
      //    spin berarti benar-benar tidak bisa didapat sebelum spin ke-10,
      //    bukan sekadar dijamin paling lambat di situ.
      if (!given) {
        const pts = bal.points_earned;
        for (const p of all) {
          if (p.autoAtPoints === null && p.autoAtSpins === null) continue;
          const reached =
            (p.autoAtPoints !== null && pts >= p.autoAtPoints) ||
            (p.autoAtSpins !== null && spinNo >= p.autoAtSpins);
          if (!reached) continue;
          if (!(await this.claimable(p, email))) continue;
          given = await this.record(
            p,
            email,
            profile?.id ?? null,
            batchId,
            isBonus,
            "auto",
          );
          break;
        }
      }

      // 3. Undian acak. Hadiah berjaminan dikeluarkan dari kolam ini.
      if (!given) {
        // Dash IKUT kolam undian (bobot penyeimbang), supaya peluang hadiah
        // seperti 1:300 benar-benar 1 dari 300, bukan 1 dari jumlah hadiah.
        // Hadiah berjaminan tetap dikeluarkan: jalurnya sendiri.
        const pool: SpinPrize[] = [];
        for (const p of all) {
          if (p.isGuaranteed) continue;
          if (p.isEmpty) {
            if (p.active && p.weight > 0) pool.push(p);
            continue;
          }
          // Hadiah berambang DITAHAN sampai ambangnya tercapai. Kalau ikut
          // diundi lebih awal, "hanya bisa didapat setelah 10x spin" bocor
          // lewat keberuntungan di spin ke-3.
          if (this.gatedByThreshold(p, spinNo, bal.points_earned)) continue;
          if (p.weight > 0 && (await this.claimable(p, email))) pool.push(p);
        }
        const won = this.pick(pool);
        if (won) {
          given = await this.record(
            won,
            email,
            profile?.id ?? null,
            batchId,
            isBonus,
            "random",
          );
        }
      }

      // 4. Cadangan: Dash.
      if (!given && empty) {
        given = await this.record(
          empty,
          email,
          profile?.id ?? null,
          batchId,
          isBonus,
          "random",
        );
      }
      if (given) results.push(given);
    }

    // Poin yang dibayar dicatat sebagai penukaran, supaya semua pengurangan
    // saldo lewat satu jalur yang sama dan mudah diaudit.
    if (pointNeeded > 0) {
      await this.redemptions.save(
        this.redemptions.create({
          profileId: profile?.id ?? null,
          email,
          rewardCode: "spin_paid",
          rewardName: `Spin ${needPay}x (bayar poin)`,
          pointCost: pointNeeded,
          keyCost: 0,
          spinGrant: 0,
          status: "done",
          batchId,
        }),
      );
    }

    // Diskon spin pertama hangus setelah dipakai.
    if (discountApplied) {
      acc.firstSpinUsed = true;
      await this.accounts.save(acc);
    }

    return {
      ok: true,
      batch_id: batchId,
      option: chosen.code,
      spins_paid: paid,
      spins_bonus: bonus,
      free_spins_used: freeUsed,
      points_charged: pointNeeded,
      first_spin_discount: discountApplied,
      results: results.map((r) => ({
        prize_code: r.prizeCode,
        prize_label: r.prizeLabel,
        is_empty: r.isEmpty,
        key_grant: r.keyGrant,
        is_bonus: r.isBonus,
        source: r.source,
      })),
      balance: await this.getBalance(email),
    };
  }


  /** Riwayat spin satu akun. */
  async listSpins(emailRaw: string, limit = 50) {
    const email = emailRaw.trim().toLowerCase();
    const rows = await this.spins.find({
      where: { email },
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((r) => ({
      id: r.id,
      prize_code: r.prizeCode,
      prize_label: r.prizeLabel,
      is_empty: r.isEmpty,
      key_grant: r.keyGrant,
      batch_id: r.batchId,
      is_bonus: r.isBonus,
      created_at: r.createdAt,
    }));
  }

  // ------------------------------ Seed --------------------------------

  /**
   * Isi katalog & hadiah awal sesuai kesepakatan event. Idempoten: kode yang
   * sudah ada dilewati, jadi aman dipanggil berkali-kali dan tidak menimpa
   * perubahan yang sudah dibuat admin.
   */
  async seed() {
    const catalog: Partial<RewardCatalog>[] = [
      {
        code: "hp_baru",
        name: "HP Baru",
        pointCost: 2000,
        keyCost: 18,
        kind: "item",
        sortOrder: 1,
      },
      {
        code: "emoney_500k",
        name: "E-Money 500rb",
        pointCost: 750,
        keyCost: 10,
        kind: "item",
        sortOrder: 2,
      },
      {
        code: "tumbler_stainless",
        name: "Tumbler Stainless",
        pointCost: 100,
        keyCost: 3,
        kind: "item",
        sortOrder: 3,
      },
      {
        code: "spin_gratis",
        name: "1x Spin Gratis",
        pointCost: 10,
        keyCost: 0,
        kind: "spin",
        spinGrant: 1,
        sortOrder: 4,
      },
    ];

    // Aturan mengikuti dokumen "Cara Kerja Spin Keberuntungan YCS".
    const prizes: Partial<SpinPrize>[] = [
      // Hadiah besar: TERKUNCI, bukan sekadar nonaktif. Tetap tampil di roda
      // web kedua sebagai pemikat, tapi dijamin tak ada yang mendapatkannya
      // lewat jalur mana pun. Buka kuncinya hanya untuk event khusus.
      {
        code: "sepeda_listrik",
        label: "Sepeda Listrik",
        weight: 0,
        active: false,
        isLocked: true,
        sortOrder: 1,
      },
      {
        code: "hp_baru",
        label: "HP Baru",
        weight: 0,
        active: false,
        isLocked: true,
        sortOrder: 2,
      },
      {
        code: "vip_bali",
        label: "VIP Ticket Bali",
        weight: 0,
        active: false,
        isLocked: true,
        sortOrder: 3,
      },
      {
        code: "emoney_1jt",
        label: "E-Money 1jt",
        weight: 0,
        active: false,
        isLocked: true,
        sortOrder: 4,
      },

      // Kunci: pasti didapat di titik acak spin ke-1..5, jatah 41 ORANG,
      // maksimal 1 per akun. Bobot 0 karena tidak pernah lewat undian acak.
      {
        code: "kunci_1",
        label: "1 Kunci",
        weight: 0,
        keyGrant: 1,
        isGuaranteed: true,
        guaranteeMinSpin: 1,
        guaranteeMaxSpin: 5,
        winnerQuota: 41,
        maxPerAccount: 1,
        sortOrder: 5,
      },

      // Tumbler: peluang 1:300 lewat roda, ATAU otomatis saat 100 poin /
      // 10x spin. Jatah 8 orang, maksimal 1 per akun (lintas kedua jalur).
      {
        code: "tumbler",
        label: "Tumbler",
        weight: 1,
        winnerQuota: 8,
        maxPerAccount: 1,
        autoAtPoints: 100,
        autoAtSpins: 10,
        sortOrder: 6,
      },

      // Kaos: peluang 1:300 lewat roda, jatah 6 orang.
      {
        code: "kaos_eksklusif",
        label: "Kaos Eksklusif",
        weight: 1,
        winnerQuota: 6,
        maxPerAccount: 1,
        sortOrder: 7,
      },

      // Dash: ikut kolam undian dengan bobot penyeimbang, supaya Tumbler &
      // Kaos masing-masing tepat 1:300 (1 dari total bobot 600).
      {
        code: "zonk",
        label: "\u{1F4A8}",
        weight: 598,
        isEmpty: true,
        sortOrder: 8,
      },
    ];

    let added = 0;
    for (const c of catalog) {
      if (!(await this.catalog.findOneBy({ code: c.code! }))) {
        await this.catalog.save(this.catalog.create(c));
        added++;
      }
    }
    for (const p of prizes) {
      if (!(await this.prizes.findOneBy({ code: p.code! }))) {
        await this.prizes.save(this.prizes.create(p));
        added++;
      }
    }
    return { ok: true, added };
  }
}
