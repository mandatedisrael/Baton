import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { fromBase64 } from "@mysten/sui/utils";
import { reconcileSponsoredRegistration } from "../chain/sponsorship.ts";
import {
  completeSubmittedSponsorReservation,
  submittedSponsorReservations,
  withSponsorStateLock,
} from "./state.ts";

export interface SponsorReconciliationSummary {
  checked: number;
  completed: number;
  pending: number;
}

export async function reconcileSponsorState(input: {
  client: SuiJsonRpcClient;
  statePath: string;
  typePackageId: string;
  now?: Date;
}): Promise<SponsorReconciliationSummary> {
  return withSponsorStateLock(input.statePath, async () => {
    const submitted = submittedSponsorReservations(input.statePath);
    let completed = 0;
    for (const entry of submitted) {
      const result = await reconcileSponsoredRegistration({
        client: input.client,
        transactionBytes: fromBase64(entry.reservation.transactionBytes),
        transactionDigest: entry.reservation.transactionDigest,
        typePackageId: input.typePackageId,
      });
      if (!result) continue;
      completeSubmittedSponsorReservation(
        input.statePath,
        entry.inviteId,
        entry.reservation.requestId,
        result,
        input.now ?? new Date(),
      );
      completed += 1;
    }
    return { checked: submitted.length, completed, pending: submitted.length - completed };
  }, 90_000);
}
