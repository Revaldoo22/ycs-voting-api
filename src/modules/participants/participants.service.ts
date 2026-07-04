import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Participant, Profile } from "../../database/entities";
import { SchoolsService } from "../schools/schools.service";
import { hashPassword } from "../../common/utils/password";
import { generatePassword, normalizePhone } from "../../common/utils/normalize";
import {
  CreateParticipantDto,
  UpdateParticipantDto,
} from "./dto/participant.dto";

@Injectable()
export class ParticipantsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
    private readonly schools: SchoolsService,
  ) {}

  /** Admin list — snake_case + nested school + login phone (old shape). */
  list() {
    return this.dataSource.query(`
      select p.*,
             case when s.id is null then null
                  else json_build_object('id', s.id, 'name', s.name) end as schools,
             case when pr.id is null then null
                  else json_build_object('phone_number', pr.phone_number) end as profiles
      from participants p
      left join schools s on s.id = p.school_id
      left join profiles pr on pr.id = p.profile_id
      order by p.total_points desc`);
  }

  private async resolveSchoolId(dto: {
    school_id?: string;
    school_name?: string;
  }): Promise<string | undefined> {
    if (dto.school_id) return dto.school_id;
    if (dto.school_name?.trim()) {
      const school = await this.schools.createOrGet({
        name: dto.school_name.trim(),
      });
      return school.id;
    }
    return undefined;
  }

  /** Create participant + linked login; returns credentials ONCE. */
  async create(dto: CreateParticipantDto) {
    if (!dto.school_id && !dto.school_name?.trim()) {
      throw new BadRequestException("Pilih atau ketik nama sekolah");
    }
    const phone = normalizePhone(dto.phone_number);

    const dupe = await this.profiles.findOneBy({ phoneNumber: phone });
    if (dupe) {
      throw new ConflictException("Nomor WhatsApp sudah digunakan akun lain.");
    }

    const schoolId = (await this.resolveSchoolId(dto))!;
    const password = generatePassword();

    const participant = await this.dataSource.transaction(async (em) => {
      const profile = await em.getRepository(Profile).save({
        name: dto.name.trim(),
        phoneNumber: phone,
        passwordHash: hashPassword(password),
        role: "participant" as const,
        schoolId,
      });
      return em.getRepository(Participant).save({
        profileId: profile.id,
        name: dto.name.trim(),
        schoolId,
        description: dto.description?.trim() || null,
        photoUrl: dto.photo_url ?? null,
        status: "active" as const,
      });
    });

    return {
      ok: true,
      participant,
      credentials: { phone_number: phone, password },
    };
  }

  /** Edit fields and/or reset the login password (old contract). */
  async update(id: string, dto: UpdateParticipantDto) {
    const participant = await this.participants.findOneBy({ id });
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");

    const schoolId = await this.resolveSchoolId(dto);
    if (dto.name !== undefined) participant.name = dto.name.trim();
    if (schoolId) participant.schoolId = schoolId;
    if (dto.description !== undefined)
      participant.description = dto.description?.trim() || null;
    if (dto.photo_url !== undefined) participant.photoUrl = dto.photo_url;
    if (dto.status !== undefined) participant.status = dto.status;
    await this.participants.save(participant);

    // Keep the linked profile name/school in sync.
    if ((dto.name || schoolId) && participant.profileId) {
      await this.profiles.update(
        { id: participant.profileId },
        {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(schoolId ? { schoolId } : {}),
        },
      );
    }

    // Optional password change: admin-typed OR auto-generated.
    let newPassword: string | undefined;
    if ((dto.new_password || dto.reset_password) && participant.profileId) {
      newPassword = dto.new_password || generatePassword();
      await this.profiles.update(
        { id: participant.profileId },
        { passwordHash: hashPassword(newPassword) },
      );
    }

    return { ok: true, password: newPassword };
  }

  /** Delete participant + linked login account. */
  async remove(id: string) {
    const participant = await this.participants.findOneBy({ id });
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(Participant).delete({ id });
      if (participant.profileId) {
        await em.getRepository(Profile).delete({ id: participant.profileId });
      }
    });
    return { ok: true };
  }
}
