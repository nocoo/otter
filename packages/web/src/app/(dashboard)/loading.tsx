import Image from "next/image";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Image
        src="/logo-80.png"
        alt="Otter"
        width={80}
        height={80}
        className="animate-pulse"
        priority
      />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  );
}
