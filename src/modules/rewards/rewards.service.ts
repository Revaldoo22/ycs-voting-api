import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  AppSettings,
  Profile,
  RewardCatalog,
  RewardRedemption,
  SpinPrize,
  SpinResult,
} from "../../database/entities";

/** Saldo yang bisa dibelanjakan oleh satu akun. */
export type Balance = {
  email: string;
  name: string | null;
  /** Poin dari vote yang masuk (1 vote = 1 poin). TIDAK pernah berkurang. */
  points_earned: number;
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
export class RewardsService {
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
  ) {}

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
    return { spin_point_cost: s.spinPointCost, options };
  }

  async updateSpinOptions(patch: {
    spin_point_cost?: number;
    spin_bundle_enabled?: boolean;
    spin_bundle_count?: number;
    spin_bundle_bonus?: number;
  }) {
    const s = await this.appSettings();
    if (patch.spin_point_cost !== undefined) s.spinPointCost = patch.spin_point_cost;
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
      points_spent: r.points_spent,
      points_available: r.points_earned - r.points_spent,
      keys_earned: r.keys_earned,
      keys_spent: r.keys_spent,
      keys_available: r.keys_earned - r.keys_spent,
      // Jatah gratis yang belum dipakai; bisa negatif kalau spin dibayar
      // pakai poin, jadi dijaga minimal 0.
      spins_available: Math.max(0, r.spins_granted - r.spins_used),
    };
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

  async listPrizes(includeInactive = false) {
    const where = includeInactive ? {} : { active: true };
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
      color: p.color,
      active: p.active,
      sort_order: p.sortOrder,
      chance:
        total > 0 && this.drawable(p)
          ? Number(((p.weight / total) * 100).toFixed(2))
          : 0,
    }));
  }

  /** Hadiah ikut diundi hanya bila aktif, berbobot, dan stoknya masih ada. */
  private drawable(p: SpinPrize): boolean {
    return p.active && p.weight > 0 && (p.stock === null || p.stock > 0);
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

  /** Undi satu hadiah memakai bobot. */
  private pick(pool: SpinPrize[]): SpinPrize {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = Math.random() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return pool[pool.length - 1];
  }

  /**
   * Putar roda. `option` = "single" (1x) atau "bundle" (paket 5x + bonus).
   *
   * Jatah spin gratis dipakai lebih dulu; sisanya baru dibayar dengan poin.
   * Putaran bonus tidak memotong jatah maupun poin.
   */
  async spin(emailRaw: string, option: "single" | "bundle" = "single") {
    const email = emailRaw.trim().toLowerCase();
    if (!email) throw new BadRequestException("Email wajib diisi.");

    const cfg = await this.getSpinOptions();
    const chosen = cfg.options.find((o) => o.code === option);
    if (!chosen)
      throw new BadRequestException("Pilihan spin tidak tersedia.");

    const paid = chosen.spins;
    const bonus = chosen.bonus;

    const bal = await this.getBalance(email);
    // Jatah gratis menutup sebagian, sisanya dibayar poin.
    const freeUsed = Math.min(bal.spins_available, paid);
    const needPay = paid - freeUsed;
    const pointNeeded = needPay * cfg.spin_point_cost;
    if (bal.points_available < pointNeeded) {
      throw new BadRequestException(
        `Poin tidak cukup. Butuh ${pointNeeded}, tersedia ${bal.points_available}.`,
      );
    }

    const pool = (await this.prizes.find()).filter((p) => this.drawable(p));
    if (pool.length === 0)
      throw new BadRequestException("Belum ada hadiah spin yang aktif.");

    const profile = await this.profiles.findOneBy({ email });
    const batchId = randomUUID();
    const results: SpinResult[] = [];

    for (let i = 0; i < paid + bonus; i++) {
      // Stok bisa habis di tengah paket, jadi pool dihitung ulang tiap putaran.
      const live = pool.filter((p) => this.drawable(p));
      const prize = this.pick(live.length ? live : pool);

      if (prize.stock !== null) {
        prize.stock -= 1;
        await this.prizes.save(prize);
      }

      results.push(
        await this.spins.save(
          this.spins.create({
            profileId: profile?.id ?? null,
            email,
            prizeCode: prize.code,
            prizeLabel: prize.label,
            isEmpty: prize.isEmpty,
            keyGrant: prize.keyGrant,
            batchId,
            isBonus: i >= paid,
          }),
        ),
      );
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
        }),
      );
    }

    return {
      ok: true,
      batch_id: batchId,
      option: chosen.code,
      spins_paid: paid,
      spins_bonus: bonus,
      free_spins_used: freeUsed,
      points_charged: pointNeeded,
      results: results.map((r) => ({
        prize_code: r.prizeCode,
        prize_label: r.prizeLabel,
        is_empty: r.isEmpty,
        key_grant: r.keyGrant,
        is_bonus: r.isBonus,
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

    const prizes: Partial<SpinPrize>[] = [
      { code: "sepeda_listrik", label: "Sepeda Listrik", weight: 1, sortOrder: 1 },
      { code: "hp_baru", label: "HP Baru", weight: 2, sortOrder: 2 },
      { code: "vip_bali", label: "VIP Ticket Bali", weight: 3, sortOrder: 3 },
      { code: "emoney_1jt", label: "E-Money 1jt", weight: 4, sortOrder: 4 },
      { code: "tumbler", label: "Tumbler", weight: 12, sortOrder: 5 },
      { code: "kaos_eksklusif", label: "Kaos Eksklusif", weight: 12, sortOrder: 6 },
      { code: "kunci_1", label: "1 Kunci", weight: 26, keyGrant: 1, sortOrder: 7 },
      { code: "zonk", label: "💨", weight: 40, isEmpty: true, sortOrder: 8 },
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
