// Typed popup ↔ service-worker messaging. Single source of truth for
// message shapes; popup imports the senders, SW imports the types and
// implements the handlers.
//
// chrome.runtime.sendMessage returns a Promise<Response>. We wrap it
// here so callers get tagged errors rather than raw rejections.
//
// Ref: https://developer.chrome.com/docs/extensions/develop/concepts/messaging

export type Request = RestoreRequest;

export interface RestoreRequest {
  type: "restore-pouch";
  pouchId: string;
}

export type RestoreResponse =
  | { ok: true; tabsOpened: number; groupsOpened: number }
  | { ok: false; reason: string };

export async function sendRestorePouch(
  pouchId: string,
): Promise<RestoreResponse> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "restore-pouch",
      pouchId,
    } satisfies RestoreRequest)) as RestoreResponse | undefined;

    if (!response) {
      return { ok: false, reason: "no-response" };
    }
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message };
  }
}
