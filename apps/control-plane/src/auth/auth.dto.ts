export interface RegisterDto {
  username: string;
  password: string;
  display_name?: string;
  legacy_identity?: {
    node_id: string;
    public_key: string;
    private_key_base64?: string;
  };
}

export interface LoginDto {
  username: string;
  password: string;
}
