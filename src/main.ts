import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = 3000; // DO NOT use 3001 inside container

  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Backend server listening on 0.0.0.0:${port}`);
}

bootstrap();
