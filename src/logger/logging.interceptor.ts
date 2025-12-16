import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Logger } from './logger';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, query } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const status = context.switchToHttp().getResponse().statusCode;

        // Логируем только данные тела запроса если это POST/PATCH/PUT
        const requestData = ['POST', 'PATCH', 'PUT'].includes(method)
          ? body
          : query;

        this.logger.logRequest(method, url, status, duration, requestData);
      }),
    );
  }
}
