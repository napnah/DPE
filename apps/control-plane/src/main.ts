import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const port = Number(process.env.PORT ?? 3001);
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(port);
  console.log(`control-plane listening on ${port}`);
}
bootstrap();
