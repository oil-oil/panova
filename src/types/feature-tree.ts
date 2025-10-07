// Shared feature tree types

export type FeatureStatus = "implemented" | "developing" | "pending";

export type FeatureNode = {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
  collapsed?: boolean;
  status: FeatureStatus;
  description: string;
};

export type Product = { id: string; name: string };

