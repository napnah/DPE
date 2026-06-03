import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { SigningService } from "./crypto/signing.service.js";
import { GroupsController } from "./groups/groups.controller.js";
import { GroupsService } from "./groups/groups.service.js";
import { GovernanceController } from "./governance/governance.controller.js";
import { GovernanceService } from "./governance/governance.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { SnapshotCacheService } from "./groups/snapshot-cache.service.js";
import { DocStateService } from "./groups/doc-state.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, GroupsController, GovernanceController, AuthController],
  providers: [
    SigningService,
    GroupsService,
    GovernanceService,
    AuthService,
    SnapshotCacheService,
    DocStateService,
  ],
})
export class AppModule {}
