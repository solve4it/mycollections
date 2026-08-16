import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCollection,
  createItem,
  deleteItem,
  getCollection,
  type ItemInput,
  importData,
  listCollections,
  listItems,
  restoreItem,
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

export function useImportData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importData,
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

export function useRestoreItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => restoreItem(collectionId, itemId),
    // Same key as useDeleteItem: an undo has to put back exactly what the delete
    // took away. The dashboard's itemCount needs no invalidation here — that
    // query reloads when it mounts, and it never mounts beside this one.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}
