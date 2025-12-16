import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private userService: UserService, // ← Исправлено
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET') || "",
    });
  }

  async validate(payload: any) {
    // Try to find user by telegram_id from payload
    let user: any = null;
    if (payload.telegram_id) {
      user = await this.userService.findByTelegramId(payload.telegram_id);
    } else if (payload.sub) {
      // Fallback to old method for backward compatibility
      try {
        user = await this.userService.findOne(payload.sub);
      } catch (e) {
        // User not found by ID, that's ok
      }
    }
    
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    
    // Return user object with 'sub' as alias for 'id' to maintain backward compatibility
    // with @CurrentUser('sub') decorator calls
    return {
      ...user,
      sub: user.id, // Add 'sub' field as alias for database 'id'
    };
  }
}