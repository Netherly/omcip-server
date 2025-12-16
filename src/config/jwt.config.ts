import { JwtModuleOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';

export const getJwtConfig = (
  configService: ConfigService,
): JwtModuleOptions => ({
  secret: configService.get<string>('JWT_SECRET', 'default_secret_change_me'),
  signOptions: {
    expiresIn: configService.get<StringValue>('JWT_EXPIRATION', '7d'),
  },
});
