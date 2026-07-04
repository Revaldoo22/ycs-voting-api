import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** Single-row settings table (id is always true). */
@Entity("app_settings")
export class AppSettings {
  @PrimaryColumn({ type: "boolean", default: true })
  id!: boolean;

  @Column({ name: "event_open", type: "boolean", default: true })
  eventOpen!: boolean;

  @Column({ name: "closed_message", type: "text", default: "" })
  closedMessage!: string;

  @Column({ name: "ip_daily_limit", type: "int", default: 5 })
  ipDailyLimit!: number;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
