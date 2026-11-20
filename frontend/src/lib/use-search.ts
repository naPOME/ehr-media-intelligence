import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchRecords, type SearchFilters } from "./api";

export function useRecordSearch(patientId?: string) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({ patientId });
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setQuery(draft.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [draft, composing]);
  const waiting = draft.trim() !== query;
  const result = useQuery({
    queryKey: ["search", query, filters],
    queryFn: ({ signal }) => searchRecords(query, filters, signal),
    enabled: !!query && !waiting,
    staleTime: 0,
  });
  function submit(value = draft) {
    if (composing) return;
    setDraft(value);
    setQuery(value.trim());
  }
  return {
    setComposing,
    draft,
    setDraft,
    query,
    filters,
    setFilters,
    submit,
    result,
    waiting,
    loading: !!draft.trim() && (waiting || result.isFetching),
  };
}
