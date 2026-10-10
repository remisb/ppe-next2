# The API binary: built with the Go toolchain, shipped on scratch with nothing
# else. The Go version tracks go.mod; bump both together.
FROM golang:1.27-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
# github.com/remisb/dbbackup and github.com/remisb/pdf-mini are private, so they
# come straight from GitHub with the github_token build secret (the file
# .github-token, read-only on both; docs/backups.md). The token exists only
# during this RUN: it is in no layer and no image.
RUN apk add --no-cache git
ENV GOPRIVATE=github.com/remisb/dbbackup,github.com/remisb/pdf-mini
RUN --mount=type=secret,id=github_token \
    TOKEN="$(cat /run/secrets/github_token 2>/dev/null)" && \
    GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:${TOKEN}@github.com/remisb/dbbackup.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/remisb/dbbackup" \
    GIT_CONFIG_KEY_1="url.https://x-access-token:${TOKEN}@github.com/remisb/pdf-mini.insteadOf" \
    GIT_CONFIG_VALUE_1="https://github.com/remisb/pdf-mini" \
    go mod download

COPY cmd/ cmd/
COPY internal/ internal/

# Static (CGO off) for scratch. timetzdata embeds the zone database, which
# scratch lacks: API_ORG_TIMEZONE is loaded at startup and History and usage
# time count days in it.
# API_COMMIT (`make prod-build` passes `git describe`) names the build in
# GET /ready and the startup log. Declared here, after the module download, so a
# new commit does not invalidate that layer.
ARG API_COMMIT=
RUN CGO_ENABLED=0 GOOS=linux go build -tags timetzdata -trimpath -ldflags="-s -w -X main.commit=${API_COMMIT}" -o /out/api ./cmd/api

FROM scratch
# Root certificates for a managed (TLS) database.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/api /api
USER 65532:65532
EXPOSE 8090
# Exec form: the binary is PID 1 and gets SIGTERM, so shutdown drains.
ENTRYPOINT ["/api"]
# Scratch has no curl: the binary probes its own GET /ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=1m --retries=3 CMD ["/api", "-healthcheck"]
