import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

  // Enable CORS for frontend
  app.enableCors({
    origin: true, // Allow all origins in development
    methods: 'GET,POST,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Backend server listening on 0.0.0.0:${port}`);
}

bootstrap();
