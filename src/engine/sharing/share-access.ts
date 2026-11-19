import type {OnlineGuestSession,OwnerShareSummary,SessionDetails} from "../../backends/online-files";

type Access=OnlineGuestSession["access"];

/** The order the native access choice lists the ways into a shared file. */
export const shareAccessOrder:readonly Access[]=["edit","comment","view"];

/** Native `NO_COMMENT_LINK`. It names the comment code, but the check is whether the requested link exists. */
const noShareLink="this share has no comment code (its server is older than comment links, or it was shared before them): stop sharing and share again";

/** Why an existing group of links cannot switch to `access`: it has no link for it. A missing join code is not a
 * missing link, and a file that is not shared at the moment has no group to check against. */
export function missingShareLink(share:SessionDetails["share"]|undefined,access:Access):Error|undefined {
  if(!share?.shared || share[`${access}Link`]!==null)return;
  return new Error("invalid parameters for `collab.share`: "+noShareLink);
}

/** The ways in a share can actually give, in native order. Adapters that only report codes offer the coded roles. */
export function offeredShareAccess(summary:OwnerShareSummary):Access[] {
  const known=summary.available ?? (Object.keys(summary.codes) as Access[]);
  return shareAccessOrder.filter(access=>known.includes(access));
}

/** Whether others can get in now. An edit link without a join code still shares the file. */
export function isShared(summary:OwnerShareSummary) {
  return summary.available ? summary.available.includes("edit") : Boolean(summary.codes.edit);
}
