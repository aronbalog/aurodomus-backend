import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ?? 3001;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  // Enable CORS for frontend
  app.enableCors({
    origin: frontendUrl,
    methods: 'GET,POST,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });

  await app.listen(port, '0.0.0.0'); // <-- ensure 0.0.0.0
  console.log(`🚀 Backend server is running on: http://localhost:${port}`);
  console.log(`📡 CORS enabled for: ${frontendUrl}`);
}
bootstrap();
