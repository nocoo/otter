import { Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader title="404" description="This page doesn't exist or has been moved." />
      <LayerCard>
        <LayerCard.Empty
          icon={<img src="/logo-80.png" alt="Otter" width={80} height={80} />}
          title="Page not found"
          action={
            <Button asChild>
              <Link to="/">Back to Dashboard</Link>
            </Button>
          }
        />
      </LayerCard>
    </div>
  );
}
