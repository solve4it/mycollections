import { useQuery } from "@tanstack/react-query";
import { listCollections } from "./api-client.js";

export function useCollections() {
  return useQuery({ queryKey: ["collections"], queryFn: listCollections });
}
