import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { SigningService } from "./crypto/signing.service.js";
import { GroupsController } from "./groups/groups.controller.js";
import { GroupsService } from "./groups/groups.service.js";
import { GovernanceController } from "./governance/governance.controller.js";
import { GovernanceService } from "./governance/governance.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, GroupsController, GovernanceController],
  providers: [SigningService, GroupsService, GovernanceService],
})
export class AppModule {}
