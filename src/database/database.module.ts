import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ENTITIES } from "./entities";

/**
 * Central DB wiring. Swapping databases later (e.g. away from Postgres)
 * only touches this file + entity column types.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get<string>("db.host"),
        port: config.get<number>("db.port"),
        username: config.get<string>("db.user"),
        password: config.get<string>("db.password"),
        database: config.get<string>("db.name"),
        entities: ENTITIES,
        synchronize: config.get<boolean>("db.sync"),
        // Hari voting mengikuti WIB, bukan zona server — CURRENT_DATE,
        // vote_date, dan submit_date semuanya bergantung ini.
        extra: { options: "-c timezone=Asia/Jakarta" },
      }),
    }),
  ],
})
export class DatabaseModule {}
