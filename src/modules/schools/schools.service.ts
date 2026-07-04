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

  list() {
    return this.schools
      .createQueryBuilder("s")
      .leftJoinAndMapOne("s.region", "regions", "r", "r.id = s.region_id")
      .orderBy("s.name", "ASC")
      .getMany();
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
