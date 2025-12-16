import * as fs from 'fs';
import * as path from 'path';

// ANSI цвета для консоли
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

export class Logger {
  private static logDir = path.join(process.cwd(), 'logs');
  private static logFile = path.join(this.logDir, 'app.log');
  private static errorLogFile = path.join(this.logDir, 'error.log');
  private context: string;

  constructor(context: string) {
    this.context = context;
    Logger.ensureLogDirExists();
  }

  private static ensureLogDirExists() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getTimestamp(): string {
    const now = new Date();
    return now.toISOString();
  }

  private colorize(text: string, color: string): string {
    return `${color}${text}${colors.reset}`;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = this.getTimestamp();
    const contextStr = `[${this.context}]`;
    const levelStr = `${level}`;
    
    let formattedData = '';
    if (data) {
      if (typeof data === 'object') {
        formattedData = `\n${JSON.stringify(data, null, 2)}`;
      } else {
        formattedData = ` ${data}`;
      }
    }

    return `${timestamp} ${levelStr} ${contextStr} ${message}${formattedData}`;
  }

  private writeToFile(level: LogLevel, message: string, data?: any) {
    const formattedMessage = this.formatMessage(level, message, data);
    
    try {
      // Пишем в основной лог
      fs.appendFileSync(Logger.logFile, formattedMessage + '\n', 'utf-8');

      // Пишем ошибки также в отдельный файл
      if (level === LogLevel.ERROR) {
        fs.appendFileSync(Logger.errorLogFile, formattedMessage + '\n', 'utf-8');
      }
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private consoleLog(level: LogLevel, message: string, data?: any) {
    const timestamp = this.getTimestamp();
    const contextStr = `[${this.context}]`;
    
    let levelColor = '';
    let levelBg = '';
    
    switch (level) {
      case LogLevel.DEBUG:
        levelColor = this.colorize(level, colors.cyan);
        break;
      case LogLevel.INFO:
        levelColor = this.colorize(level, colors.blue);
        break;
      case LogLevel.WARN:
        levelColor = this.colorize(level, colors.yellow);
        break;
      case LogLevel.ERROR:
        levelColor = this.colorize(level, colors.red);
        break;
      case LogLevel.SUCCESS:
        levelColor = this.colorize(level, colors.green);
        break;
    }

    const contextColored = this.colorize(contextStr, colors.magenta);
    const timestampColored = this.colorize(timestamp, colors.cyan);

    console.log(`${timestampColored} ${levelColor} ${contextColored} ${message}`, data || '');
  }

  debug(message: string, data?: any) {
    this.consoleLog(LogLevel.DEBUG, message, data);
    this.writeToFile(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any) {
    this.consoleLog(LogLevel.INFO, message, data);
    this.writeToFile(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any) {
    this.consoleLog(LogLevel.WARN, message, data);
    this.writeToFile(LogLevel.WARN, message, data);
  }

  error(message: string, data?: any) {
    this.consoleLog(LogLevel.ERROR, message, data);
    this.writeToFile(LogLevel.ERROR, message, data);
  }

  success(message: string, data?: any) {
    this.consoleLog(LogLevel.SUCCESS, message, data);
    this.writeToFile(LogLevel.SUCCESS, message, data);
  }

  // Специальный метод для HTTP запросов
  logRequest(method: string, path: string, statusCode: number, duration: number, data?: any) {
    const status = statusCode >= 200 && statusCode < 300 ? '✓' : '✗';
    const message = `${status} ${method} ${path} [${statusCode}] (${duration}ms)`;
    
    if (statusCode >= 400) {
      this.error(message, data);
    } else {
      this.info(message, data);
    }
  }

  // Метод для логирования аутентификации
  logAuth(action: string, userId?: string | number, telegramId?: string | number, success: boolean = true, error?: string) {
    const message = `AUTH: ${action}`;
    const data = {
      userId: userId ? (typeof userId === 'string' ? parseInt(userId) : userId) : undefined,
      telegramId: telegramId ? (typeof telegramId === 'string' ? parseInt(telegramId) : telegramId) : undefined,
      success,
      error: error || undefined,
    };

    if (success) {
      this.success(message, data);
    } else {
      this.error(message, data);
    }
  }

  // Получить содержимое логов (для отладки)
  static getRecentLogs(lines: number = 50): string[] {
    try {
      const content = fs.readFileSync(Logger.logFile, 'utf-8');
      return content.split('\n').slice(-lines).filter(line => line.trim());
    } catch (error) {
      return [`Error reading logs: ${error}`];
    }
  }

  // Очистить логи
  static clearLogs() {
    try {
      fs.writeFileSync(Logger.logFile, '', 'utf-8');
      fs.writeFileSync(Logger.errorLogFile, '', 'utf-8');
    } catch (error) {
      console.error('Error clearing logs:', error);
    }
  }
}
