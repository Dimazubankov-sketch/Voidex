import { createContext, useContext } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";

/**
 * Where Notes is (Step 2.6): Projects → a project's documents → one document.
 *
 * The route lives in its own store, outside React render and outside data
 * loading: saving, refreshing, server events or the window re-rendering never
 * change it (in Step 2.5 a reload reset it and threw the person out of the
 * note they were writing). Only a person's action — or losing access — moves it.
 */
export type NotesRoute =
  | { screen: "projects" }
  | { screen: "project"; projectId: string }
  | { screen: "shared" }
  | { screen: "doc"; docId: string; back: { screen: "project"; projectId: string } | { screen: "shared" } | { screen: "projects" } }
  | { screen: "share"; token: string };

export interface NotesNav {
  route: NotesRoute;
  go: (r: NotesRoute) => void;
}

export type NotesNavStore = UseBoundStore<StoreApi<NotesNav>>;

export function createNotesNav(initial: NotesRoute): NotesNavStore {
  return create<NotesNav>((set) => ({ route: initial, go: (route) => set({ route }) }));
}

export const NavContext = createContext<NotesNavStore | null>(null);

export function useNav(): NotesNav {
  const store = useContext(NavContext);
  if (!store) throw new Error("useNav() outside Notes");
  return store();
}

/** The route as of now, outside render (event handlers). */
export function useNavStore(): NotesNavStore {
  const store = useContext(NavContext);
  if (!store) throw new Error("useNavStore() outside Notes");
  return store;
}

/** Route from window params / deep links (#notes/project/<id>, #notes/doc/<id>, #notes/share/<token>). */
export function routeFromParams(p: Record<string, unknown>): NotesRoute | null {
  if (typeof p.share === "string") return { screen: "share", token: p.share };
  if (typeof p.doc === "string") return { screen: "doc", docId: p.doc, back: typeof p.project === "string" ? { screen: "project", projectId: p.project } : { screen: "projects" } };
  if (typeof p.project === "string") return { screen: "project", projectId: p.project };
  return null;
}
