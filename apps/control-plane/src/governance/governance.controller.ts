import { Body, Controller, Param, Post } from "@nestjs/common";
import { GovernanceService } from "./governance.service.js";

@Controller("groups/:id/governance")
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Post("enable-proxy")
  enableProxy(
    @Param("id") id: string,
    @Body() body: { owner_node_id: string; owner_proof: string; proxy_base_url?: string },
  ) {
    return this.governance.enableProxy(
      id,
      body.owner_node_id,
      body.owner_proof,
      body.proxy_base_url,
    );
  }

  @Post("disable-proxy")
  disableProxy(
    @Param("id") id: string,
    @Body() body: { owner_node_id: string; owner_proof: string },
  ) {
    return this.governance.disableProxy(id, body.owner_node_id, body.owner_proof);
  }
}
