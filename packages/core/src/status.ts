import { z } from "zod";

export const ITEM_STATUSES = ["owned", "wanted", "ordered"] as const;

export const ItemStatusSchema = z.enum(ITEM_STATUSES);

export type ItemStatus = z.infer<typeof ItemStatusSchema>;
