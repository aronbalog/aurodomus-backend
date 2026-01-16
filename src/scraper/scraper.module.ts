import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScraperService } from './scraper.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}
