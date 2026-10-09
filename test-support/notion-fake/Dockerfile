FROM denoland/deno:2.9.7
WORKDIR /app
COPY server.ts .
RUN deno cache server.ts
EXPOSE 8080
CMD ["deno", "run", "--allow-net=0.0.0.0", "--allow-env", "server.ts"]
