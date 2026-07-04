import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Profile, School } from "../../database/entities";
import { AuthService } from "./auth.service";
import { GoogleService } from "./google.service";
import { AuthController } from "./auth.controller";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Module({
  imports: [
    TypeOrmModule.forFeature([Profile, School]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("jwt.secret"),
        signOptions: { expiresIn: config.get<string>("jwt.expiresIn") },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleService, JwtGuard, RolesGuard],
  exports: [JwtModule, JwtGuard, RolesGuard],
})
export class AuthModule {}
