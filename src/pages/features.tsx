import dynamic from "next/dynamic";
import React from "react";
const FeatureTree = dynamic(() => import("@/components/feature-tree/FeatureTree").then((m) => m.FeatureTree), { ssr: false });

export default function FeaturesPage() {
  return <FeatureTree />;
}
