import { categories as localCategories } from "../data/products";
import { useApi } from "./useApi";

export type Category = { id: string; name: string; nameEn: string; icon: string; color: string; productCount?: number };
export const fallbackCategories: Category[] = localCategories.map((c) => ({ id: c.id, name: c.label, nameEn: c.labelEn, icon: c.icon, color: c.color }));

// Server categories when connected (admins can add and reorder them), the bundled list otherwise.
export function useCategories() {
  const { data } = useApi<{ categories: Category[] }>("/categories");
  return data?.categories?.length ? data.categories : fallbackCategories;
}
export const categoryName = (category: Category, lang: "ar" | "en") => (lang === "en" && category.nameEn ? category.nameEn : category.name);
