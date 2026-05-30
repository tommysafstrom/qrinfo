export type CodeType = "internal" | "external";

export interface Code {
  id: string;
  code: string;
  label: string;
  type: CodeType;
  target: string;
  enabled: boolean;
  scanCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  id: string;
  slug: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface DB {
  codes: Code[];
  pages: Page[];
}
