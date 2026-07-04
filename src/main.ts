import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { join } from "path";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // verifikasi HMAC webhook Depot butuh body mentah
  });
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api", { exclude: ["uploads/(.*)"] });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: config.get<string>("CORS_ORIGIN", "http://localhost:3000"),
    credentials: true,
  });

  // Uploaded photos/proofs are served statically from ./uploads.
  app.useStaticAssets(join(process.cwd(), "uploads"), { prefix: "/uploads" });

  const port = config.get<number>("PORT", 4000);
  await app.listen(port);
   
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap();
