import { useState, useEffect } from "react";

interface ParamConfig {
  default: string;
  allow?: string[];
}

type Config = Record<string, ParamConfig>;
type Filters<C extends Config> = { [K in keyof C]: string };

export function useUrlFilters<C extends Config>(
  config: C
): Filters<C> & { set: (key: keyof C, value: string) => void } {
  const readFromUrl = (): Filters<C> => {
    const params = new URLSearchParams(window.location.search);
    const out = {} as Filters<C>;
    for (const key of Object.keys(config) as (keyof C & string)[]) {
      const { default: def, allow } = config[key]!;
      const raw = params.get(key) ?? "";
      (out as any)[key] = raw !== "" && (!allow || allow.includes(raw)) ? raw : def;
    }
    return out;
  };

  const [filters, setFilters] = useState<Filters<C>>(readFromUrl);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of Object.keys(config) as (keyof C & string)[]) {
      const val = (filters as any)[key] as string;
      const def = config[key]!.default;
      if (val && val !== def) params.set(key, val); else params.delete(key);
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters]);

  const set = (key: keyof C, value: string) => {
    const { default: def, allow } = config[key]!;
    const safe = (!allow || allow.includes(value)) ? value : def;
    setFilters(prev => ({ ...prev, [key]: safe }));
  };

  return { ...filters, set };
}
