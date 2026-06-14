import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCollection,
  createItem,
  deleteItem,
  getCollection,
  type ItemInput,
  listCollections,
  listItems,
  updateItem,
} from "./api-client.js";

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

export function useCollection(id: string) {
  return useQuery({ queryKey: ["collections", id], queryFn: () => getCollection(id) });
}

export function useItems(collectionId: string) {
  return useQuery({ queryKey: ["collections", collectionId, "items"], queryFn: () => listItems(collectionId) });
}

export function useCreateItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ItemInput) => createItem(collectionId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}

export function useUpdateItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: ItemInput }) => updateItem(collectionId, itemId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}

export function useDeleteItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteItem(collectionId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}
