FROM denoland/deno:2.9.7@sha256:fa335acdf6b72106eda2cb6a8cb5f4187e7630e357467489db4b2e7352d5e432

# Base image provides non-root user 'deno' (UID 1993, GID 1993).
# Source: denoland/deno_docker debian.dockerfile
#   RUN useradd --uid 1993 --user-group deno

WORKDIR /app

COPY --chown=deno:deno server.ts .

RUN deno cache server.ts

USER deno

EXPOSE 8080

CMD ["deno", "run", "--allow-net=0.0.0.0", "--allow-env", "server.ts"]
