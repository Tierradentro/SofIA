import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordPolicyService } from './password-policy.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { User } from '../users/entities/user.entity';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { ParamsModule } from '../params/params.module';
import { AuditModule } from '../audit/audit.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ApiKey]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'sofia-dev-secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
    }),
    ParamsModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordPolicyService,
    TokenBlacklistService,
    // Guards globales en orden: autenticación JWT primero, RBAC después
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenBlacklistService, PasswordPolicyService],
})
export class AuthModule {}
