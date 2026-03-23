import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <Image src="/logo-80.png" alt="Otter" width={80} height={80} className="opacity-40" />
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page doesn&apos;t exist or has been moved.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
