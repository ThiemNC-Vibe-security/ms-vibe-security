export interface DiscoveryField {
  label: string;
  name: string;
  type: string;
}

export interface DiscoveryResult {
  page: string;
  url: string;
  fields: DiscoveryField[];
  buttons: string[];
}
