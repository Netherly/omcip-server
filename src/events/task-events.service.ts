import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class TaskEventsService {
  private logger = new Logger('TaskEventsService');

  constructor(private eventEmitter: EventEmitter2) {}

  emitTaskCompleted(userId: string, taskId: string) {
    this.logger.log(`[emitTaskCompleted] Emitting event for userId: ${userId}, taskId: ${taskId}`);
    this.eventEmitter.emit('task.completed', { userId, taskId });
  }

  emitTaskClaimed(userId: string, taskId: string, rewardCoins: number) {
    this.logger.log(`[emitTaskClaimed] Emitting event for userId: ${userId}, taskId: ${taskId}, rewardCoins: ${rewardCoins}`);
    this.eventEmitter.emit('task.claimed', { userId, taskId, rewardCoins });
  }
}
