import { Clock, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SnapshotData } from "./types";

interface ExportSectionProps {
  data: SnapshotData;
  snapshotId: string;
}

export function ExportSection({ data, snapshotId }: ExportSectionProps) {
  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapshot-${snapshotId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="py-0">
      <CardContent className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">
              Download the full snapshot as JSON
            </span>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Export JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
