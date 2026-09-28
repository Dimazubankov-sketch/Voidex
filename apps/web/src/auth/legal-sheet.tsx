import { useLegalDocument } from "@/lib/system";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { Button, Notice, Skeleton } from "@/ui/controls";
import { Markdown } from "@/ui/markdown";
import { Sheet } from "@/ui/overlays";

/** Shows a legal document (served by the server, versioned) in a sheet. */
export function LegalSheet({ docKey, onClose }: { docKey: string | null; onClose: () => void }) {
  const t = useT();
  const doc = useLegalDocument(docKey);
  return (
    <Sheet open={!!docKey} onClose={onClose} title={doc.data?.title ?? " "} width={640} testId="legal-sheet">
      {doc.isLoading && (
        <div className="space-y-3 py-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      )}
      {doc.error && (
        <div className="space-y-3">
          <Notice tone="danger">{errorMessage(t, doc.error)}</Notice>
          <Button variant="secondary" onClick={() => doc.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {doc.data && (
        <>
          <div className="mb-2 text-[12px] text-text-tertiary">v{doc.data.version}</div>
          <Markdown source={doc.data.content.replace(/^#\s+.*\n/, "")} />
        </>
      )}
    </Sheet>
  );
}
