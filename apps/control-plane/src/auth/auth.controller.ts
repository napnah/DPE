import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import type { LoginDto, RegisterDto } from "./auth.dto.js";

function extractToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const rawAuth = headers.authorization;
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const rawSession = headers["x-dpe-session"];
  const session = Array.isArray(rawSession) ? rawSession[0] : rawSession;
  if (session?.trim()) return session.trim();
  return undefined;
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Get("me")
  async me(@Headers() headers: Record<string, string | string[] | undefined>) {
    const token = extractToken(headers);
    if (!token) throw new UnauthorizedException("missing auth token");
    return this.auth.me(token);
  }
}

export { extractToken };
