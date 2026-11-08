import React from "react";
import { Apple, Croissant, CupSoda, Drumstick, Headphones, Milk, Shirt, Snowflake, Sofa, Sparkles, Tag, Wheat } from "lucide-react-native";

const ICONS = { apple: Apple, milk: Milk, croissant: Croissant, drumstick: Drumstick, wheat: Wheat, "cup-soda": CupSoda, headphones: Headphones, sofa: Sofa, shirt: Shirt, sparkles: Sparkles, snowflake: Snowflake, tag: Tag };
export function CategoryIcon({ name, size = 24, color }: { name: string; size?: number; color: string }) {
  const Icon = ICONS[name as keyof typeof ICONS] || Tag;
  return <Icon size={size} color={color} />;
}
