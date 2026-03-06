README.md

## Retrospective

- **Railway + Next.js standalone containers require `HOSTNAME=0.0.0.0`**: Next.js standalone server defaults to binding `localhost`, which is inaccessible from Railway's reverse proxy. Must set `HOSTNAME=0.0.0.0` env var so it listens on all interfaces.
- **Next.js 16 Turbopack monorepo builds require `turbopack.root`**: In Docker builds where the workspace root differs from the Next.js project dir, Turbopack cannot infer the root. Must set `turbopack: { root: path.join(__dirname, "../..") }` in `next.config.ts`.
- **Railway `dockerfilePath` format**: Use `./Dockerfile` (with `./` prefix), not bare `Dockerfile`.
