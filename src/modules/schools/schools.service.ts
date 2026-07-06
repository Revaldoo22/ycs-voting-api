import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Participant, School } from "../../database/entities";
import { CreateSchoolDto } from "./dto/create-school.dto";

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
  ) {}

  /**
   * Hanya sekolah yang PUNYA peserta — inilah yang relevan dikelola admin.
   * Master 36rb+ sekolah (dari CSV) tak ditampilkan di sini; itu cuma
   * referensi untuk wizard voter. Return snake_case agar konsisten dg API lain.
   */
  list() {
    return this.schools.manager.query(`
      select s.id, s.name, s.npsn, s.jenjang, s.region_id, s.created_at,
             case when r.id is null then null
                  else json_build_object('id', r.id, 'name', r.name) end as region
      from schools s
      left join regions r on r.id = s.region_id
      where exists (select 1 from participants p where p.school_id = s.id)
      order by s.name asc`);
  }

  /** Pindahkan sekolah ke kabupaten (null = lepas). */
  async setRegion(id: string, regionId: string | null) {
    const school = await this.schools.findOneBy({ id });
    if (!school) throw new NotFoundException("Sekolah tidak ditemukan.");
    school.regionId = regionId;
    return this.schools.save(school);
  }

  /** Case-insensitive find-or-create so duplicate names never pile up. */
  async createOrGet(dto: CreateSchoolDto) {
    const name = dto.name.trim();
    const existing = await this.schools
      .createQueryBuilder("s")
      .where("LOWER(s.name) = LOWER(:name)", { name })
      .getOne();
    if (existing) return existing;
    return this.schools.save(this.schools.create({ name }));
  }

  /** { school_id: participantCount } — used to guard deletion in the UI. */
  async participantCounts(): Promise<Record<string, number>> {
    const rows = await this.participants
      .createQueryBuilder("p")
      .select("p.school_id", "school_id")
      .addSelect("COUNT(*)", "c")
      .where("p.school_id IS NOT NULL")
      .groupBy("p.school_id")
      .getRawMany<{ school_id: string; c: string }>();
    return Object.fromEntries(rows.map((r) => [r.school_id, Number(r.c)]));
  }

  async rename(id: string, dto: CreateSchoolDto) {
    const school = await this.schools.findOneBy({ id });
    if (!school) throw new NotFoundException("Sekolah tidak ditemukan.");
    school.name = dto.name.trim();
    return this.schools.save(school);
  }

  async remove(id: string) {
    const used = await this.participants.countBy({ schoolId: id });
    if (used > 0) {
      throw new ConflictException(
        `Tidak bisa dihapus: masih ada ${used} peserta di sekolah ini.`,
      );
    }
    const res = await this.schools.delete({ id });
    if (!res.affected) throw new NotFoundException("Sekolah tidak ditemukan.");
    return { ok: true };
  }
}
