export class CreateGroupDto {
  name!: string;
  ownerNodeId!: string;
  ownerPublicKey!: string;
  controlMode?: "owner_direct" | "proxy";
  proxyBaseUrl?: string;
}

export class JoinGroupDto {
  nodeId!: string;
  publicKey!: string;
}

export class CreateInvitationDto {
  inviteeNodeId!: string;
}

export class RefreshJwtDto {
  nodeId!: string;
  docId!: string;
}
