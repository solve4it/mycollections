import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCollection, listCollections } from "./api-client.js";

export function useCollections() {
  return useQuery({ queryKey: ["collections"], queryFn: listCollections });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCollection,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
  });
}
