import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare } from "bcryptjs";
import { InvalidCredentialsError } from "../common/errors/domain.errors";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload, LoginDto, LoginResponseDto } from "./auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.prisma.municipalityUser.findUnique({
      where: { email: dto.email },
    });

    // Same error whether the account is missing, disabled, or the
    // password is wrong — never reveal which one it was.
    if (!user || !user.isActive) {
      throw new InvalidCredentialsError();
    }
    const passwordMatches = await compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload, {
        expiresIn: dto.rememberMe ? "7d" : "12h",
      }),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        municipalityName: user.municipalityName,
      },
    };
  }
}
