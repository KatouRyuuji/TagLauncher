export interface ModManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  type: string;
  entrypoints: {
    css?: string;
    js?: string;
    theme?: string;
  };
  min_app_version?: string;
}

export interface ModInfo extends ModManifest {
  enabled: boolean;
  path: string;
}
