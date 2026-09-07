import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";

/**
 * Asisten penjelas fitur panel admin.
 *
 * AuthModule diimpor karena JwtGuard di controller membutuhkan JwtService.
 * Tanpa itu aplikasi gagal start dengan galat DI, dan build tidak
 * menangkapnya karena ini soal ketersediaan provider, bukan tipe.
 */
@Module({
  imports: [AuthModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
