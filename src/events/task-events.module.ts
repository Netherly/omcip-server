import { Module } from '@nestjs/common';
import { TaskEventsService } from './task-events.service';

@Module({
  providers: [TaskEventsService],
  exports: [TaskEventsService],
})
export class TaskEventsModule {}
