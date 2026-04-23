import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section className="text-center">
      <h1 className="text-3xl font-semibold">404</h1>
      <p className="mt-2 text-sm text-gray-500">The page you requested could not be found.</p>
      <Link to="/" className="mt-4 inline-block text-blue-500 hover:underline">
        Back to dashboard
      </Link>
    </section>
  );
}
