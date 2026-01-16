import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ?? 3001;
  
  await app.listen(port, '0.0.0.0'); // <-- ensure 0.0.0.0
  console.log(`🚀 Backend server is running on: http://localhost:${port}`);
}
bootstrap();
