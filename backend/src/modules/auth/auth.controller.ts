import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/** M01 Autenticación. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** HU-001 */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  /** HU-002 */
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() user: AuthenticatedUser & { jti: string; exp: number }) {
    return this.auth.logout(user.jti, user.exp, user);
  }

  /** HU-003 */
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user);
  }
}
