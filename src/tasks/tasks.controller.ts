import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  // === USER ENDPOINTS ===

  // Получить все активные дневные задания
  // ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
  @UseGuards(JwtAuthGuard)
  @Get('daily')
  async getDailyTasks(@Request() req) {
    const userId = req.user?.sub || null;
    const tasks = await this.tasksService.getDailyTasks(userId);
    return {
      success: true,
      data: tasks,
    };
  }

  // Получить все активные еженедельные задания
  // ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
  @UseGuards(JwtAuthGuard)
  @Get('weekly')
  async getWeeklyTasks(@Request() req) {
    const userId = req.user?.sub || null;
    const tasks = await this.tasksService.getWeeklyTasks(userId);
    return {
      success: true,
      data: tasks,
    };
  }

  // Забрать награду за задание
  // ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
  @UseGuards(JwtAuthGuard)
  @Post('/:id/claim')
  async claimTaskReward(@Param('id') taskId: string, @Request() req) {
    const result = await this.tasksService.claimTaskReward(req.user.sub, taskId);
    return {
      success: result.success,
      data: {
        taskId: result.task_id,
        reward_coins: result.reward_coins,
        reward_boost_duration: result.reward_boost_duration,
        reward_boost_multiplier: result.reward_boost_multiplier,
      },
    };
  }

  // Завершить login_claim задачу (пользователь собрал ежедневный бонус)
  // ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
  @UseGuards(JwtAuthGuard)
  @Post('daily-claim/complete')
  async completeLoginClaim(@Request() req) {
    const result = await this.tasksService.completeLoginClaimTask(req.user.sub);
    return {
      success: result.success,
      data: {
        taskId: result.task_id,
        message: result.message,
      },
    };
  }

  // Получить конкретное задание
  // ДОЛЖНО БЫТЬ ПОСЛЕ /daily и /weekly но ПЕРЕД общей логикой
  @Get('/:id')
  async getTaskById(@Param('id') id: string) {
    return this.tasksService.getTaskById(id);
  }

  // === ADMIN ENDPOINTS ===

  // Получить все задания (администратор)
  @UseGuards(JwtAuthGuard)
  @Get()
  async getAllTasks(@Request() req) {
    // TODO: Добавить проверку на роль администратора
    return this.tasksService.getAllTasks();
  }

  // Создать новое задание (администратор)
  @UseGuards(JwtAuthGuard)
  @Post()
  async createTask(@Body() createTaskDto: CreateTaskDto, @Request() req) {
    // TODO: Добавить проверку на роль администратора
    return this.tasksService.createTask(createTaskDto);
  }

  // Обновить задание (администратор)
  @UseGuards(JwtAuthGuard)
  @Patch('/:id')
  async updateTask(
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @Request() req,
  ) {
    // TODO: Добавить проверку на роль администратора
    return this.tasksService.updateTask(id, updateTaskDto);
  }

  // Удалить задание (администратор)
  @UseGuards(JwtAuthGuard)
  @Delete('/:id')
  async deleteTask(@Param('id') id: string, @Request() req) {
    // TODO: Добавить проверку на роль администратора
    return this.tasksService.deleteTask(id);
  }
}
