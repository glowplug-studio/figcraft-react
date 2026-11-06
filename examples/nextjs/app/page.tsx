import { requireIdentity } from "../lib/supabase/server";
import { EditorHost } from "./editor-host";

export default async function PreviewPage() {
  const identity = await requireIdentity("/");
  return <EditorHost identity={identity} />;
}
