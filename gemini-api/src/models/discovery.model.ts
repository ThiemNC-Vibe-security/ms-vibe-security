export interface FormInput {
  label: string;
  name: string;
  type: string;
  required: boolean;
  placeholder: string;
}

export interface Form {
  name: string;
  action: string;
  method: string;
  inputs: FormInput[];
  validation: string[];
}

export interface Button {
  label: string;
  type: string;
  business_meaning: string;
}

export interface NavigationItem {
  label: string;
  href: string;
  section: string;
}

export interface TableInfo {
  name: string;
  columns: string[];
  row_count: number;
}

export interface LinkInfo {
  text: string;
  href: string;
  is_external: boolean;
}

export interface PageDiscovery {
  url: string;
  title: string;
  page_type: string;
  breadcrumb: string[];
  authentication: string;
  navigation: NavigationItem[];
  forms: Form[];
  buttons: Button[];
  inputs: FormInput[];
  tables: TableInfo[];
  dialogs: { name: string; trigger: string; purpose: string }[];
  links: LinkInfo[];
  business_actions: string[];
  next_candidate_pages: string[];
}

export interface ApplicationModel {
  base_url: string;
  total_pages_discovered: number;
  pages: PageDiscovery[];
}
